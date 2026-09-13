package main

import (
	"bufio"
	"fmt"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
)

// ---------- Options ----------

type options struct {
	commitsPerSVG int
	cdnSelection  []string
	outputFile    string
	format        string // "txt" or "csv"
	noValidate    bool
	yes           bool
	skipPrompt    bool // alias for yes in automatic mode
	concurrency   int
	makeCommits   bool
}

// ---------- Interactive mode (no flags) ----------

func interactiveMode(repoArgs []string) {
	printHeader()

	token := getTokenFromEnv()
	if token == "" {
		if tokens, err := loadTokens(); err == nil && len(tokens) > 0 {
			token = tokens[0]
			fmt.Printf(colorizeGreen("✓ Using saved token: %s…\n\n"), token[:minInt(6, len(token))])
		}
	} else {
		fmt.Printf(colorizeGreen("✓ Using GITHUB_TOKEN: %s…\n\n"), token[:minInt(6, len(token))])
	}
	if token == "" {
		fmt.Println(colorizeYellow("⚠ No token found — running unauthenticated (public repos only, 60 requests/hour).\n"))
	}

	var repos []GitHubRepo
	for _, repoStr := range repoArgs {
		repo, err := parseRepoURL(repoStr)
		if err != nil {
			fmt.Println(colorizeRed("✗ Invalid repo: " + repoStr + " — " + err.Error()))
			return
		}
		repos = append(repos, repo)
	}
	if len(repos) == 0 {
		fmt.Println(colorizeRed("✗ No valid repositories provided"))
		return
	}

	opts := &options{commitsPerSVG: 0}
	fmt.Println(colorizeYellow("🔍 Scanning repositories for SVG files…"))
	runWorkflow(repos, token, opts)
}

// ---------- Automatic mode (flags) ----------

func automaticMode(repoArgs []string, opts *options) {
	token := getTokenFromEnv()
	if token == "" {
		if tokens, err := loadTokens(); err == nil && len(tokens) > 0 {
			token = tokens[0]
		}
	}
	if token == "" {
		fmt.Println(colorizeYellow("⚠ No token found — running unauthenticated (public repos only, 60 requests/hour)."))
		fmt.Println(colorizeYellow("  For private repos or higher limits: export GITHUB_TOKEN=ghp_… or run 'token add'."))
	}

	var repos []GitHubRepo
	var invalid []string
	for _, repoStr := range repoArgs {
		repo, err := parseRepoURL(repoStr)
		if err != nil {
			invalid = append(invalid, repoStr)
			continue
		}
		repos = append(repos, repo)
	}
	for _, bad := range invalid {
		fmt.Println(colorizeYellow("⚠ Skipping invalid repo: " + bad))
	}
	if len(repos) == 0 {
		fmt.Println(colorizeRed("✗ No valid repositories provided"))
		os.Exit(1)
	}

	_, _, _ = getRateLimit(token) // warm-up; non-fatal
	runWorkflow(repos, token, opts)
}

// ---------- Shared workflow ----------

func runWorkflow(repos []GitHubRepo, token string, opts *options) {
	fmt.Println(colorizeYellow("🔍 Scanning repositories for SVG files…"))

	repoSVGs, repoErrs := getAllSVGFiles(repos, token)
	for name, err := range repoErrs {
		fmt.Println(colorizeYellow(fmt.Sprintf("⚠ %s: %v", name, err)))
	}

	// Display found SVGs (deterministic order).
	var repoNames []string
	var totalSVGs int
	for _, r := range repos {
		key := r.Owner + "/" + r.Name
		if _, ok := repoSVGs[key]; ok {
			repoNames = append(repoNames, key)
			totalSVGs += len(repoSVGs[key])
		}
	}

	if totalSVGs == 0 {
		fmt.Println(colorizeRed("✗ No SVG files found in any accessible repository"))
		fmt.Println(colorizeYellow("  (Repos must contain .svg files on their default branch)"))
		os.Exit(1)
	}

	fmt.Println()
	fmt.Println(colorizeGreen("✓ Found SVG files:"))
	for _, name := range repoNames {
		fmt.Printf("  %s: %s\n", colorizeBlue(name), colorizeBold(fmt.Sprintf("%d SVG(s)", len(repoSVGs[name]))))
		if len(repoSVGs[name]) == 0 {
			fmt.Println(colorizeDim("    (no SVG files)"))
		}
		for _, svg := range repoSVGs[name] {
			fmt.Printf("    • %s\n", svg)
		}
	}

	cdns, err := selectCDNs(opts.cdnSelection)
	if err != nil {
		fmt.Println(colorizeRed("✗ " + err.Error()))
		os.Exit(1)
	}

	commitsPerSVG := opts.commitsPerSVG
	fmt.Println()
	fmt.Printf("%s Total SVGs: %s\n", colorizeGreen("✓"), colorizeBold(strconv.Itoa(totalSVGs)))
	fmt.Printf("%s CDN providers: %s\n", colorizeGreen("✓"), colorizeBold(strconv.Itoa(len(cdns))))
	fmt.Printf("%s Rate limit: %s\n", colorizeGreen("✓"), colorizeDim(func() string {
		rem, lim, err := getRateLimit(token)
		if err != nil {
			return "unknown"
		}
		return fmt.Sprintf("%d/%d requests remaining", rem, lim)
	}()))

	// Fetch real commits (up to 100 per repo via the commits API).
	fmt.Println(colorizeYellow("\n🔍 Fetching commit history…"))
	commitPool := make([]string, 0, 100)
	for _, r := range repos {
		shas, err := getCommitSHAs(r, token, 100)
		if err != nil {
			fmt.Println(colorizeYellow(fmt.Sprintf("⚠ Could not list commits for %s/%s: %v", r.Owner, r.Name, err)))
			continue
		}
		commitPool = append(commitPool, shas...)
	}
	if len(commitPool) == 0 {
		fmt.Println(colorizeRed("✗ No commits available — cannot generate versioned links"))
		os.Exit(1)
	}
	uniqueCommits := uniqueStrings(commitPool)
	fmt.Printf("%s Unique commits found: %s\n", colorizeGreen("✓"), colorizeBold(strconv.Itoa(len(uniqueCommits))))

	if commitsPerSVG <= 0 {
		commitsPerSVG = len(uniqueCommits)
	}
	commitsPerSVG = clampInt(commitsPerSVG, 1, len(uniqueCommits))

	totalLinks := totalSVGs * commitsPerSVG * len(cdns)
	fmt.Printf("%s Total links to generate: %s\n", colorizeGreen("✓"), colorizeBold(humanizeCount(totalLinks)))
	fmt.Printf("%s Estimated output size: %s\n\n", colorizeGreen("✓"), colorizeDim(estimateSize(totalLinks)))

	if !opts.yes {
		fmt.Print(colorizeYellow("Proceed with generation? (y/N): "))
		reader := bufio.NewReader(os.Stdin)
		answer, _ := reader.ReadString('\n')
		if strings.ToLower(strings.TrimSpace(answer)) != "y" {
			fmt.Println(colorizeYellow("Cancelled."))
			return
		}
	}

	// ---- Generate links ----
	fmt.Println("\n" + colorizeBlue("═══════════════════════════════════════════════════════════"))
	fmt.Println(colorizeYellow("📝 Generating links…"))
	fmt.Println(colorizeBlue("═══════════════════════════════════════════════════════════\n"))

	var allLinks []string
	var mu sync.Mutex
	var wg sync.WaitGroup
	processed := int32(0)

	for _, name := range repoNames {
		parts := strings.SplitN(name, "/", 2)
		owner, repoName := parts[0], parts[1]
		for _, svg := range repoSVGs[name] {
			wg.Add(1)
			go func(owner, repoName, svg string) {
				defer wg.Done()
				links := make([]string, 0, commitsPerSVG*len(cdns))
				for i := 0; i < commitsPerSVG; i++ {
					sha := uniqueCommits[i%len(uniqueCommits)]
					for _, cdn := range cdns {
						links = append(links, generateCDNLink(owner, repoName, sha, svg, cdn.Domain, cdn.Format))
					}
				}
				mu.Lock()
				allLinks = append(allLinks, links...)
				mu.Unlock()
				done := atomic.AddInt32(&processed, 1)
				fmt.Printf("\r%s Processing: %d/%d SVGs", colorizeBlue("⏳"), done, totalSVGs)
			}(owner, repoName, svg)
		}
	}
	wg.Wait()
	fmt.Println()

	fmt.Println(colorizeGreen("\n✓ Link generation complete!"))
	fmt.Printf("  Generated: %s links\n", colorizeBlue(humanizeCount(len(allLinks))))

	// ---- Save raw links ----
	outFile := opts.outputFile
	if outFile == "" {
		outFile = "cdn_links_" + getTimeString() + ".txt"
	}
	if opts.format == "csv" && !strings.HasSuffix(outFile, ".csv") {
		outFile = strings.TrimSuffix(outFile, ".txt") + ".csv"
	}
	if err := saveLinks(outFile, allLinks, opts.format); err != nil {
		fmt.Println(colorizeRed("✗ Error saving links: " + err.Error()))
		os.Exit(1)
	}
	fmt.Printf(colorizeGreen("✓ Links saved to: %s\n"), outFile)

	// ---- Validation ----
	if opts.noValidate {
		fmt.Println(colorizeYellow("\n⚠ Validation skipped (--no-validate)"))
	} else {
		fmt.Println("\n" + colorizeYellow("🧪 Testing links for validity…"))
		validLinks, brokenLinks := testLinksParallel(allLinks, opts.concurrency, func(done, total int) {
			fmt.Printf("\r%s Testing: %d/%d links", colorizeBlue("🧪"), done, total)
		})
		fmt.Println()

		rate := 0.0
		if len(allLinks) > 0 {
			rate = float64(len(validLinks)) * 100 / float64(len(allLinks))
		}
		fmt.Printf("\n%s Valid links: %s\n", colorizeGreen("✓"), colorizeGreen(humanizeCount(len(validLinks))))
		fmt.Printf("%s Broken links: %s\n", colorizeRed("✗"), colorizeRed(humanizeCount(len(brokenLinks))))
		fmt.Printf("%s Success rate: %s%%\n", colorizeBlue("📊"), colorizeGreen(fmt.Sprintf("%.1f", rate)))

		validFile := strings.TrimSuffix(outFile, ".txt") + "_valid.txt"
		if opts.format == "csv" {
			validFile = strings.TrimSuffix(outFile, ".csv") + "_valid.csv"
		}
		if err := saveLinks(validFile, validLinks, opts.format); err != nil {
			fmt.Println(colorizeRed("✗ Error saving valid links: " + err.Error()))
		} else {
			fmt.Printf(colorizeGreen("✓ Valid links saved to: %s\n"), validFile)
		}
		if len(brokenLinks) > 0 {
			brokenFile := strings.TrimSuffix(outFile, ".txt") + "_broken.txt"
			if opts.format == "csv" {
				brokenFile = strings.TrimSuffix(outFile, ".csv") + "_broken.csv"
			}
			if err := saveLinks(brokenFile, brokenLinks, opts.format); err != nil {
				fmt.Println(colorizeRed("✗ Error saving broken links: " + err.Error()))
			} else {
				fmt.Printf(colorizeYellow("⚠ Broken links saved to: %s\n"), brokenFile)
			}
		}
	}

	fmt.Println()
	fmt.Println(colorizeGreen("✓ Done! Files ready in current directory."))
	fmt.Println(colorizeYellow(fmt.Sprintf("💡 Tip: use 'head -20 %s' to preview links\n", outFile)))
}

// generateWithCommitCreation builds fresh commits in the user's repo, then
// generates links from them (for repos the user owns).
func generateWithCommitCreation(repoArgs []string, opts *options) {
	token := getTokenFromEnv()
	if token == "" {
		if tokens, err := loadTokens(); err == nil && len(tokens) > 0 {
			token = tokens[0]
		}
	}
	if token == "" {
		fmt.Println(colorizeRed("✗ -make-commits requires a token with repo write access."))
		fmt.Println(colorizeRed("  Set GITHUB_TOKEN or run: cdn-link-gen token add"))
		os.Exit(1)
	}
	if len(repoArgs) != 1 {
		fmt.Println(colorizeRed("✗ -make-commits works with exactly one repo you own"))
		os.Exit(1)
	}
	repo, err := parseRepoURL(repoArgs[0])
	if err != nil {
		fmt.Println(colorizeRed("✗ " + err.Error()))
		os.Exit(1)
	}

	gm, err := NewGitManager(repo.Owner, repo.Name, token)
	if err != nil {
		fmt.Println(colorizeRed("✗ " + err.Error()))
		os.Exit(1)
	}
	defer gm.Cleanup()

	if err := gm.CloneRepo(); err != nil {
		fmt.Println(colorizeRed("✗ " + err.Error()))
		os.Exit(1)
	}
	commits, err := gm.GenerateCommits(opts.commitsPerSVG)
	if err != nil {
		fmt.Println(colorizeRed("✗ " + err.Error()))
		os.Exit(1)
	}
	fmt.Printf(colorizeGreen("✓ Created %d commits\n"), len(commits))

	if err := gm.PushCommits(); err != nil {
		fmt.Println(colorizeRed("✗ " + err.Error()))
		os.Exit(1)
	}
	fmt.Println(colorizeGreen("✓ Commits pushed to GitHub"))

	// Now run the normal workflow using these commits.
	runWorkflow([]GitHubRepo{repo}, token, opts)
}

// ---------- Small helpers ----------

func printHeader() {
	fmt.Println(colorizeGreen("╔═══════════════════════════════════════════════════════════╗"))
	fmt.Println(colorizeGreen("║            🚀 CDN LINK GENERATOR PRO (Go Edition)         ║"))
	fmt.Println(colorizeGreen("║           Multi-SVG | Multi-CDN | Lightning Fast          ║"))
	fmt.Println(colorizeGreen("╚═══════════════════════════════════════════════════════════╝\n"))
}

func saveLinks(filename string, links []string, format string) error {
	file, err := os.Create(filename)
	if err != nil {
		return err
	}
	defer file.Close()

	w := bufio.NewWriter(file)
	defer w.Flush()

	if format == "csv" {
		if _, err := w.WriteString("url\n"); err != nil {
			return err
		}
		for _, link := range links {
			if _, err := w.WriteString("\"" + link + "\"\n"); err != nil {
				return err
			}
		}
		return nil
	}
	for _, link := range links {
		if _, err := w.WriteString(link + "\n"); err != nil {
			return err
		}
	}
	return nil
}

func uniqueStrings(in []string) []string {
	seen := make(map[string]bool, len(in))
	out := make([]string, 0, len(in))
	for _, s := range in {
		if !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	return out
}

func clampInt(v, min, max int) int {
	if v < min {
		return min
	}
	if v > max {
		return max
	}
	return v
}

func estimateSize(totalLinks int) string {
	const bytesPerLink = 80
	return humanizeBytes(int64(totalLinks) * bytesPerLink)
}
