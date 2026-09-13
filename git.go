package main

import (
	"bufio"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

// GitManager handles git operations for commit generation
type GitManager struct {
	repoPath string
	token    string
	owner    string
	repo     string
}

// NewGitManager creates a new GitManager instance
func NewGitManager(owner, repo, token string) (*GitManager, error) {
	tmpDir := filepath.Join(os.TempDir(), "cdn_gen_"+strconv.FormatInt(time.Now().UnixNano(), 10))
	if err := os.MkdirAll(tmpDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create temp directory: %v", err)
	}

	gm := &GitManager{
		repoPath: tmpDir,
		token:    token,
		owner:    owner,
		repo:     repo,
	}

	return gm, nil
}

// CloneRepo clones the GitHub repository
func (gm *GitManager) CloneRepo() error {
	url := fmt.Sprintf("https://x-access-token:%s@github.com/%s/%s.git", gm.token, gm.owner, gm.repo)
	cmd := exec.Command("git", "clone", "--depth=1", "--single-branch", url, gm.repoPath)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	if err := cmd.Run(); err != nil {
		return fmt.Errorf("git clone failed: %v", err)
	}

	// Configure git
	if err := gm.runGitCmd("config", "user.email", "cdn-gen@example.com"); err != nil {
		return err
	}
	if err := gm.runGitCmd("config", "user.name", "CDN Generator"); err != nil {
		return err
	}

	return nil
}

// GenerateCommits creates multiple commits using git fast-import
func (gm *GitManager) GenerateCommits(count int) ([]string, error) {
	fmt.Printf(colorizeYellow("\n⏳ Generating %d commits via git fast-import...\n"), count)

	cmd := exec.Command("git", "fast-import", "--quiet")
	cmd.Dir = gm.repoPath

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to get stdin: %v", err)
	}

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("failed to start git fast-import: %v", err)
	}

	// Generate fast-import commands
	now := time.Now().Unix()
	ts := fmt.Sprintf("%d +0000", now)

	go func() {
		defer stdin.Close()
		writer := bufio.NewWriter(stdin)

		// Get current HEAD
		headCmd := exec.Command("git", "rev-parse", "HEAD")
		headCmd.Dir = gm.repoPath
		headOutput, _ := headCmd.Output()
		headSha := strings.TrimSpace(string(headOutput))

		for i := 0; i < count; i++ {
			msg := fmt.Sprintf("cdn-gen-commit-%d\n", i)
			commitData := fmt.Sprintf(
				"commit refs/heads/main\n"+
					"mark :%d\n"+
					"author CDN-Gen <%s> %s\n"+
					"committer CDN-Gen <%s> %s\n"+
					"data %d\n"+
					"%s"+
					"from %s\n"+
					"\n",
				i+1,
				"cdn@example.com", ts,
				"cdn@example.com", ts,
				len(msg),
				msg,
				if_else(i == 0, headSha, fmt.Sprintf(":%d", i)),
			)
			writer.WriteString(commitData)
			if i%100 == 0 && i > 0 {
				fmt.Printf("\r%s Generated %d/%d commits", colorizeBlue("⏳"), i, count)
			}
		}
		writer.Flush()
	}()

	if err := cmd.Wait(); err != nil {
		return nil, fmt.Errorf("git fast-import failed: %v", err)
	}

	// Get all commit SHAs
	commits, err := gm.getCommitSHAs(count)
	if err != nil {
		return nil, err
	}

	return commits, nil
}

// PushCommits pushes commits to GitHub
func (gm *GitManager) PushCommits() error {
	fmt.Println(colorizeYellow("\n💼 Pushing commits to GitHub..."))
	if err := gm.runGitCmd("push", "origin", "main", "--force", "--no-verify"); err != nil {
		return fmt.Errorf("git push failed: %v", err)
	}
	return nil
}

// getCommitSHAs retrieves all generated commit SHAs
func (gm *GitManager) getCommitSHAs(count int) ([]string, error) {
	var shas []string
	var mu sync.Mutex

	// Get the previous HEAD before our commits
	headCmd := exec.Command("git", "rev-list", "--reverse", "HEAD")
	headCmd.Dir = gm.repoPath
	output, err := headCmd.Output()
	if err != nil {
		return nil, fmt.Errorf("failed to get commits: %v", err)
	}

	lines := strings.Split(strings.TrimSpace(string(output)), "\n")

	// Take the last 'count' commits
	if len(lines) > count {
		lines = lines[len(lines)-count:]
	}

	for _, line := range lines {
		if line = strings.TrimSpace(line); line != "" {
			mu.Lock()
			shas = append(shas, line)
			mu.Unlock()
		}
	}

	return shas, nil
}

// runGitCmd runs a git command in the repo directory
func (gm *GitManager) runGitCmd(args ...string) error {
	cmd := exec.Command("git", args...)
	cmd.Dir = gm.repoPath
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

// Cleanup removes temporary files
func (gm *GitManager) Cleanup() error {
	return os.RemoveAll(gm.repoPath)
}

// Helper function
func if_else(condition bool, trueVal, falseVal string) string {
	if condition {
		return trueVal
	}
	return falseVal
}
