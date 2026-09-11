package main

import (
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"

	"github.com/go-resty/resty/v2"
)

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

var gitHubClient = resty.New().SetTimeout(15000)

func parseRepoURL(repoStr string) (GitHubRepo, error) {
	parts := strings.Split(strings.TrimSpace(repoStr), "/")
	if len(parts) != 2 {
		return GitHubRepo{}, fmt.Errorf("invalid repo format, use owner/repo")
	}
	return GitHubRepo{Owner: parts[0], Name: parts[1]}, nil
}

func getSVGFiles(repo GitHubRepo, token string) ([]string, error) {
	client := resty.New().
		SetTimeout(30000).
		SetHeader("Authorization", "token "+token).
		SetHeader("Accept", "application/vnd.github.v3+json")

	var files []GitHubFile
	resp, err := client.R().
		SetResult(&files).
		Get(fmt.Sprintf("https://api.github.com/repos/%s/%s/contents/", repo.Owner, repo.Name))

	if err != nil {
		return nil, fmt.Errorf("network error: %v", err)
	}

	if resp.StatusCode() != http.StatusOK {
		return nil, fmt.Errorf("repo not found or no access (status: %d)", resp.StatusCode())
	}

	var svgFiles []string
	for _, file := range files {
		if file.Type == "file" && strings.HasSuffix(strings.ToLower(file.Name), ".svg") {
			svgFiles = append(svgFiles, file.Name)
		}
	}

	return svgFiles, nil
}

func getAllSVGFiles(repos []GitHubRepo, token string) (map[string][]string, error) {
	result := make(map[string][]string)
	var mu sync.Mutex
	var wg sync.WaitGroup
	errChan := make(chan error, len(repos))

	for _, repo := range repos {
		wg.Add(1)
		go func(r GitHubRepo) {
			defer wg.Done()
			files, err := getSVGFiles(r, token)
			if err != nil {
				errChan <- fmt.Errorf("%s/%s: %v", r.Owner, r.Name, err)
				return
			}
			mu.Lock()
			result[r.Owner+"/"+r.Name] = files
			mu.Unlock()
		}(repo)
	}

	wg.Wait()
	close(errChan)

	for err := range errChan {
		if err != nil {
			return nil, err
		}
	}

	return result, nil
}

func generateCommits(repo GitHubRepo, token string, count int) ([]string, error) {
	// Simplified: returns example commits
	// In production, this would use git fast-import like the Python version
	var commits []string
	for i := 0; i < count; i++ {
		commits = append(commits, fmt.Sprintf("commit%d", i))
	}
	return commits, nil
}

func testLink(url string) bool {
	client := resty.New().SetTimeout(5000)
	resp, err := client.R().Head(url)
	if err != nil {
		return false
	}
	status := resp.StatusCode()
	return status >= 200 && status < 400
}

func testLinksParallel(links []string, concurrency int) ([]string, []string) {
	var validLinks []string
	var brokenLinks []string
	var mu sync.Mutex
	var wg sync.WaitGroup

	semaphore := make(chan struct{}, concurrency)

	for _, link := range links {
		wg.Add(1)
		go func(l string) {
			defer wg.Done()
			semaphore <- struct{}{}        // Acquire
			defer func() { <-semaphore }() // Release

			if testLink(l) {
				mu.Lock()
				validLinks = append(validLinks, l)
				mu.Unlock()
			} else {
				mu.Lock()
				brokenLinks = append(brokenLinks, l)
				mu.Unlock()
			}
		}(link)
	}

	wg.Wait()
	return validLinks, brokenLinks
}

func downloadFile(url string) ([]byte, error) {
	client := &http.Client{}
	resp, err := client.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("http status %d", resp.StatusCode)
	}

	return io.ReadAll(resp.Body)
}
