package main

import (
	"bufio"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// GitManager handles git fast-import based commit generation for repos the
// user owns (used by `generate -make-commits`). Requires git on PATH.
type GitManager struct {
	repoPath string
	token    string
	owner    string
	repo     string
}

// NewGitManager creates a temp working directory for the clone.
func NewGitManager(owner, repo, token string) (*GitManager, error) {
	random := make([]byte, 6)
	if _, err := rand.Read(random); err != nil {
		return nil, fmt.Errorf("failed to generate temp dir suffix: %v", err)
	}
	tmpDir := filepath.Join(os.TempDir(), "cdn_gen_"+hex.EncodeToString(random))

	if err := os.MkdirAll(tmpDir, 0o755); err != nil {
		return nil, fmt.Errorf("failed to create temp directory: %v", err)
	}

	return &GitManager{repoPath: tmpDir, token: token, owner: owner, repo: repo}, nil
}

// CloneRepo clones the GitHub repository (full history — required to build on it).
func (gm *GitManager) CloneRepo() error {
	url := fmt.Sprintf("https://x-access-token:%s@github.com/%s/%s.git", gm.token, gm.owner, gm.repo)
	fmt.Println(colorizeYellow("⏳ Cloning repository (full history, this can take a moment)..."))

	clone := exec.Command("git", "clone", "--single-branch", url, gm.repoPath)
	clone.Stdout = os.Stdout
	clone.Stderr = os.Stderr
	if err := clone.Run(); err != nil {
		return fmt.Errorf("git clone failed: %v", err)
	}

	if err := gm.runGitCmd("config", "user.email", "cdn-gen@users.noreply.github.com"); err != nil {
		return err
	}
	return gm.runGitCmd("config", "user.name", "CDN Link Generator")
}

// GenerateCommits creates `count` empty commits on top of HEAD via fast-import.
func (gm *GitManager) GenerateCommits(count int) ([]string, error) {
	fmt.Printf(colorizeYellow("\n⏳ Generating %d commits via git fast-import...\n"), count)

	// fast-import mutates refs; run inside a bare-safe temp repo state.
	cmd := exec.Command("git", "fast-import", "--quiet")
	cmd.Dir = gm.repoPath
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to get stdin: %v", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to get stderr: %v", err)
	}
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("failed to start git fast-import: %v", err)
	}

	now := time.Now().Unix()
	ts := fmt.Sprintf("%d +0000", now)

	go func() {
		defer stdin.Close()
		w := bufio.NewWriterSize(stdin, 1<<20)

		// Reset the branch to current HEAD first.
		headCmd := exec.Command("git", "rev-parse", "HEAD")
		headCmd.Dir = gm.repoPath
		headOut, _ := headCmd.Output()
		headSha := strings.TrimSpace(string(headOut))

		w.WriteString("reset refs/heads/main\n")
		w.WriteString("from " + headSha + "\n\n")

		// Chain commits with fast-import marks: each commit builds on the previous one.
		for i := 0; i < count; i++ {
			msg := fmt.Sprintf("cdn-gen commit %d\n", i+1)
			fromMark := headSha
			if i > 0 {
				fromMark = fmt.Sprintf(":%d", i)
			}
			fmt.Fprintf(w,
				"commit refs/heads/main\n"+
					"mark :%d\n"+
					"author CDN Link Generator <cdn-gen@users.noreply.github.com> %s\n"+
					"committer CDN Link Generator <cdn-gen@users.noreply.github.com> %s\n"+
					"data %d\n"+
					"%s"+
					"from %s\n\n",
				i+1, ts, ts, len(msg), msg, fromMark)
			if i%250 == 0 && i > 0 {
				fmt.Printf("\r%s Generated %d/%d commits", colorizeBlue("⏳"), i, count)
			}
		}
		w.Flush()
	}()

	errLines := make(chan string, 64)
	go func() {
		defer close(errLines)
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			errLines <- scanner.Text()
		}
	}()

	if err := cmd.Wait(); err != nil {
		select {
		case line := <-errLines:
			return nil, fmt.Errorf("git fast-import failed: %v (%s)", err, line)
		default:
			return nil, fmt.Errorf("git fast-import failed: %v", err)
		}
	}
	fmt.Println()

	return gm.getCommitSHAs(count)
}

// PushCommits pushes the generated commits to GitHub.
func (gm *GitManager) PushCommits() error {
	fmt.Println(colorizeYellow("\n⏳ Pushing commits to GitHub..."))
	if err := gm.runGitCmd("push", "origin", "main", "--force-with-lease", "--no-verify"); err != nil {
		return fmt.Errorf("git push failed: %v", err)
	}
	return nil
}

// getCommitSHAs returns the SHAs of the newest `count` commits.
func (gm *GitManager) getCommitSHAs(count int) ([]string, error) {
	cmd := exec.Command("git", "rev-list", "--reverse", "HEAD")
	cmd.Dir = gm.repoPath
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("failed to list commits: %v", err)
	}
	lines := strings.Fields(string(out))
	if len(lines) > count {
		lines = lines[len(lines)-count:]
	}
	if len(lines) == 0 {
		return nil, fmt.Errorf("no commits found after import")
	}
	shas := make([]string, 0, len(lines))
	for _, l := range lines {
		if l = strings.TrimSpace(l); l != "" {
			shas = append(shas, l)
		}
	}
	return shas, nil
}

// runGitCmd runs a git command in the repo directory.
func (gm *GitManager) runGitCmd(args ...string) error {
	cmd := exec.Command("git", args...)
	cmd.Dir = gm.repoPath
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

// Cleanup removes the temporary clone.
func (gm *GitManager) Cleanup() error {
	return os.RemoveAll(gm.repoPath)
}
