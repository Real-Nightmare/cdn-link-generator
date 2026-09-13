package main

import (
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"
)

// ---------- GitHub API types ----------

type GitHubFile struct {
	Name string `json:"name"`
	Path string `json:"path"`
	Type string `json:"type"`
	Size int    `json:"size"`
}

type GitHubRepo struct {
	Owner string
	Name  string
}

type githubUser struct {
	Login string `json:"login"`
}

type rateLimitInfo struct {
	Limit     int `json:"limit"`
	Remaining int `json:"remaining"`
}

type rateLimitResponse struct {
	Resources struct {
		Core rateLimitInfo `json:"core"`
	} `json:"resources"`
}

// ---------- Client ----------

const gitHubAPIBase = "https://api.github.com"

var githubHTTPClient = &http.Client{
	Timeout: 30 * time.Second,
	Transport: &http.Transport{
		TLSHandshakeTimeout:   10 * time.Second,
		ResponseHeaderTimeout: 25 * time.Second,
		TLSClientConfig:       &tls.Config{MinVersion: tls.VersionTLS12},
	},
}

// doGitHubRequest performs an authenticated GitHub API request with a few
// retries on transient failures. The caller is responsible for closing resp.Body.
func doGitHubRequest(method, path, token string) (*http.Response, error) {
	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		if attempt > 0 {
			time.Sleep(time.Duration(attempt) * 750 * time.Millisecond)
		}
		req, err := http.NewRequest(method, gitHubAPIBase+path, nil)
		if err != nil {
			return nil, err
		}
		if token != "" {
			req.Header.Set("Authorization", "token "+token)
		}
		req.Header.Set("Accept", "application/vnd.github.v3+json")
		req.Header.Set("User-Agent", "cdn-link-generator")

		resp, err := githubHTTPClient.Do(req)
		if err != nil {
			lastErr = err
			continue
		}
		if resp.StatusCode >= 500 && attempt < 2 {
			io.Copy(io.Discard, resp.Body)
			resp.Body.Close()
			lastErr = fmt.Errorf("server error (HTTP %d)", resp.StatusCode)
			continue
		}
		return resp, nil
	}
	return nil, fmt.Errorf("network error after retries: %v", lastErr)
}

// ---------- Repo parsing ----------

func parseRepoURL(repoStr string) (GitHubRepo, error) {
	s := strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(repoStr), ".git"))
	// Allow full URLs like https://github.com/owner/repo
	for _, prefix := range []string{"https://github.com/", "http://github.com/", "github.com/"} {
		if strings.HasPrefix(s, prefix) {
			s = strings.TrimPrefix(s, prefix)
			break
		}
	}
	parts := strings.Split(s, "/")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return GitHubRepo{}, fmt.Errorf("invalid repo format, use owner/repo")
	}
	return GitHubRepo{Owner: parts[0], Name: parts[1]}, nil
}

// ---------- SVG discovery ----------

// getSVGFiles scans a repo recursively for .svg files using the Git Trees API
// (one request for the entire tree instead of one per directory).
func getSVGFiles(repo GitHubRepo, token string) ([]string, error) {
	resp, err := doGitHubRequest("GET",
		fmt.Sprintf("/repos/%s/%s/git/trees/HEAD?recursive=1", repo.Owner, repo.Name), token)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case http.StatusOK:
		// continue
	case http.StatusNotFound:
		return nil, fmt.Errorf("repo not found or no access (check name and token scope)")
	case http.StatusUnauthorized:
		return nil, fmt.Errorf("token is invalid or expired")
	case http.StatusForbidden:
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		if strings.Contains(string(body), "rate limit") {
			return nil, fmt.Errorf("GitHub API rate limit exceeded for this token")
		}
		return nil, fmt.Errorf("access forbidden (status: 403)")
	default:
		return nil, fmt.Errorf("GitHub API error (status: %d)", resp.StatusCode)
	}

	var tree struct {
		Tree       []GitHubFile `json:"tree"`
		Truncated  bool         `json:"truncated"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&tree); err != nil {
		return nil, fmt.Errorf("failed to parse GitHub response: %v", err)
	}

	var svgFiles []string
	for _, file := range tree.Tree {
		// The Trees API returns "path" (no "name" field) — match on that.
		if file.Type == "blob" && strings.HasSuffix(strings.ToLower(file.Path), ".svg") {
			svgFiles = append(svgFiles, file.Path)
		}
	}
	if tree.Truncated {
		fmt.Println(colorizeYellow("  ⚠ Tree listing was truncated by GitHub; some SVGs may be missing"))
	}
	return svgFiles, nil
}

// getAllSVGFiles scans all repos concurrently. Returns per-repo results and
// per-repo errors; a failing repo does not abort the whole run.
func getAllSVGFiles(repos []GitHubRepo, token string) (map[string][]string, map[string]error) {
	result := make(map[string][]string, len(repos))
	errs := make(map[string]error, len(repos))
	var mu sync.Mutex
	var wg sync.WaitGroup

	for _, repo := range repos {
		wg.Add(1)
		go func(r GitHubRepo) {
			defer wg.Done()
			files, err := getSVGFiles(r, token)
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				errs[r.Owner+"/"+r.Name] = err
				return
			}
			result[r.Owner+"/"+r.Name] = files
		}(repo)
	}

	wg.Wait()
	return result, errs
}

// ---------- Token verification ----------

func verifyToken(token string) (string, error) {
	resp, err := doGitHubRequest("GET", "/user", token)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusUnauthorized {
		return "", fmt.Errorf("token is invalid or expired")
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("unexpected response (HTTP %d)", resp.StatusCode)
	}
	var user githubUser
	if err := json.NewDecoder(resp.Body).Decode(&user); err != nil {
		return "", fmt.Errorf("failed to parse response: %v", err)
	}
	return user.Login, nil
}

func getRateLimit(token string) (int, int, error) {
	resp, err := doGitHubRequest("GET", "/rate_limit", token)
	if err != nil {
		return 0, 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return 0, 0, fmt.Errorf("unexpected response (HTTP %d)", resp.StatusCode)
	}
	var rl rateLimitResponse
	if err := json.NewDecoder(resp.Body).Decode(&rl); err != nil {
		return 0, 0, fmt.Errorf("failed to parse response: %v", err)
	}
	return rl.Resources.Core.Remaining, rl.Resources.Core.Limit, nil
}

// ---------- Commit discovery ----------

// getCommitSHAs lists real commit SHAs from the repo's history (newest first).
func getCommitSHAs(repo GitHubRepo, token string, count int) ([]string, error) {
	resp, err := doGitHubRequest("GET",
		fmt.Sprintf("/repos/%s/%s/commits?per_page=%d", repo.Owner, repo.Name, count), token)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("failed to list commits (HTTP %d)", resp.StatusCode)
	}
	var commits []struct {
		SHA string `json:"sha"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&commits); err != nil {
		return nil, fmt.Errorf("failed to parse commits: %v", err)
	}
	shas := make([]string, 0, len(commits))
	for _, c := range commits {
		shas = append(shas, c.SHA)
	}
	return shas, nil
}

// ---------- Link testing ----------

var testHTTPClient = &http.Client{
	Timeout: 10 * time.Second,
	Transport: &http.Transport{
		TLSHandshakeTimeout:   8 * time.Second,
		ResponseHeaderTimeout: 8 * time.Second,
		TLSClientConfig:       &tls.Config{MinVersion: tls.VersionTLS12},
	},
}

// testLink checks a URL with a HEAD request; falls back to GET for servers
// that reject HEAD.
func testLink(urlStr string) bool {
	testURL, err := url.Parse(urlStr)
	if err != nil || testURL.Scheme == "" {
		return false
	}

	for _, method := range []string{"HEAD", "GET"} {
		req, err := http.NewRequest(method, urlStr, nil)
		if err != nil {
			return false
		}
		req.Header.Set("User-Agent", "cdn-link-generator")

		resp, err := testHTTPClient.Do(req)
		if err != nil {
			return false
		}
		io.Copy(io.Discard, io.LimitReader(resp.Body, 64)) // drain for connection reuse
		resp.Body.Close()

		status := resp.StatusCode
		if status == http.StatusMethodNotAllowed && method == "HEAD" {
			continue // retry with GET
		}
		return status >= 200 && status < 400
	}
	return false
}

type linkTestResult struct {
	index  int
	link   string
	valid  bool
}

// testLinksParallel validates links with bounded concurrency, preserving the
// original link order. progress callback is optional (may be nil).
func testLinksParallel(links []string, concurrency int, progress func(done, total int)) ([]string, []string) {
	if concurrency < 1 {
		concurrency = 1
	}
	results := make([]linkTestResult, len(links))
	var wg sync.WaitGroup
	sem := make(chan struct{}, concurrency)

	var completed int32
	var mu sync.Mutex

	for i, link := range links {
		wg.Add(1)
		go func(idx int, l string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			results[idx] = linkTestResult{index: idx, link: l, valid: testLink(l)}

			mu.Lock()
			completed++
			done := int(completed)
			mu.Unlock()
			if progress != nil {
				progress(done, len(links))
			}
		}(i, link)
	}

	wg.Wait()

	var validLinks, brokenLinks []string
	for _, r := range results {
		if r.valid {
			validLinks = append(validLinks, r.link)
		} else {
			brokenLinks = append(brokenLinks, r.link)
		}
	}
	return validLinks, brokenLinks
}

// ---------- Misc ----------

// resolveRepoNames ensures every repo appears in the results map keyed by owner/name.
func resolveRepoNames(repos []GitHubRepo) []string {
	names := make([]string, 0, len(repos))
	seen := make(map[string]bool)
	for _, r := range repos {
		key := r.Owner + "/" + r.Name
		if !seen[key] {
			seen[key] = true
			names = append(names, key)
		}
	}
	return names
}

// getTokenFromEnv returns the GITHUB_TOKEN / GH_TOKEN env var if set.
func getTokenFromEnv() string {
	if t := os.Getenv("GITHUB_TOKEN"); t != "" {
		return strings.TrimSpace(t)
	}
	return strings.TrimSpace(os.Getenv("GH_TOKEN"))
}
