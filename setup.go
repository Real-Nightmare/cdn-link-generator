package main

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

var stdinReader = bufio.NewReader(os.Stdin)

// prompt reads a line from stdin, with an optional default shown in brackets.
func prompt(label, def string) string {
	if def != "" {
		fmt.Printf("%s [%s]: ", label, def)
	} else {
		fmt.Printf("%s: ", label)
	}
	line, err := stdinReader.ReadString('\n')
	if err != nil && line == "" {
		return def
	}
	line = strings.TrimSpace(line)
	if line == "" {
		return def
	}
	return line
}

// ---------- Interactive setup wizard ----------

// runSetup walks the user through configuration once and persists everything,
// so later runs are fully automatic with their saved choices.
func runSetup() {
	printHeader()
	fmt.Println(colorizeBold("🛠  Interactive Setup"))
	fmt.Println("Answer each prompt; press Enter to accept the [default].")
	fmt.Println("Everything you choose is saved permanently to " + colorizeDim(getSettingsFilePath()))
	fmt.Println()

	s := loadSettings()

	// --- 1. Token ---
	fmt.Println(colorizeBold("1) GitHub token"))
	fmt.Println(colorizeDim("   Optional for public repos (60 req/hour). With a token: 5000 req/hour + private repos."))
	if envToken := getTokenFromEnv(); envToken != "" {
		fmt.Println(colorizeGreen("   ✓ GITHUB_TOKEN detected in your environment"))
	} else if tokens, err := loadTokens(); err == nil && len(tokens) > 0 {
		fmt.Println(colorizeGreen("   ✓ " + fmt.Sprintf("%d saved token(s) found", len(tokens))))
	}
	choice := prompt("   Add a token now? (y/N)", "n")
	if strings.ToLower(choice) == "y" {
		fmt.Print("   Paste token (input hidden): ")
		token, err := readHiddenLine()
		if err != nil {
			fmt.Println(colorizeRed("   ✗ Could not read token: " + err.Error()))
		} else if token = strings.TrimSpace(token); token == "" {
			fmt.Println(colorizeYellow("   ⚠ Skipped: empty token"))
		} else if err := addToken(token); err != nil {
			fmt.Println(colorizeRed("   ✗ " + err.Error()))
		} else {
			fmt.Println(colorizeGreen("   ✓ Token saved securely (0600 permissions)"))
			if login, err := verifyToken(token); err == nil {
				fmt.Println(colorizeGreen("   ✓ Verified as " + login))
			}
		}
	}
	fmt.Println()

	// --- 2. Commits per SVG ---
	fmt.Println(colorizeBold("2) Commits per SVG"))
	fmt.Println(colorizeDim("   More commits = more link variants, longer runtime."))
	commitsStr := prompt("   How many commits per SVG? (0 = all found)", fmt.Sprintf("%d", s.CommitsPerSVG))
	if n := parsePositiveInt(commitsStr, s.CommitsPerSVG); n >= 0 {
		s.CommitsPerSVG = n
	}
	fmt.Println()

	// --- 3. CDNs ---
	fmt.Println(colorizeBold("3) CDN providers"))
	printCDNs()
	cdnStr := prompt("   Which CDNs? (ids/names, comma-separated; empty = all)", strings.Join(s.CDNs, ","))
	s.CDNs = splitCSV(cdnStr)
	if _, err := selectCDNs(s.CDNs); err != nil {
		fmt.Println(colorizeRed("   ✗ " + err.Error() + " — keeping all CDNs"))
		s.CDNs = nil
	}
	fmt.Println()

	// --- 4. Output format ---
	fmt.Println(colorizeBold("4) Output format"))
	format := prompt("   Format? (txt/csv)", s.Format)
	if f := strings.ToLower(format); f == "txt" || f == "csv" {
		s.Format = f
	} else {
		fmt.Println(colorizeYellow("   ⚠ Invalid format — keeping " + s.Format))
	}
	fmt.Println()

	// --- 5. Validation ---
	fmt.Println(colorizeBold("5) Link validation"))
	fmt.Println(colorizeDim("   Tests every generated link so you only keep working ones."))
	validate := prompt("   Enable validation? (Y/n)", yesNo(s.Validate))
	s.Validate = strings.ToLower(validate) != "n"
	if s.Validate {
		cStr := prompt("   Concurrent validation workers (5-100)", fmt.Sprintf("%d", s.Concurrency))
		if n := parsePositiveInt(cStr, s.Concurrency); n > 0 {
			s.Concurrency = clampInt(n, 1, 500)
		}
	}
	fmt.Println()

	// --- 6. PATH health check ---
	fmt.Println(colorizeBold("6) PATH health check"))
	if ensureSelfOnPATH() {
		fmt.Println(colorizeGreen("   ✓ Command available on PATH — nothing to do"))
	} else {
		fix := prompt("   Fix PATH permanently now? (Y/n)", "y")
		if strings.ToLower(fix) != "n" {
			if err := installSelfToPath(); err != nil {
				fmt.Println(colorizeRed("   ✗ PATH fix failed: " + err.Error()))
			}
		}
	}

	// --- Save everything ---
	s.SetupDone = true
	if err := saveSettings(s); err != nil {
		fmt.Println(colorizeRed("\n✗ Could not save settings: " + err.Error()))
		os.Exit(1)
	}

	fmt.Println()
	fmt.Println(colorizeGreen("✓ Setup complete — settings saved permanently!"))
	fmt.Println(colorizeDim("\nSaved configuration:"))
	fmt.Println(formatSettings(s))
	fmt.Println("\nYou can now run fully automatic:")
	fmt.Println(colorizeBold("  cdn-link-gen generate owner/repo -y"))
	fmt.Println("Re-run any time with: cdn-link-gen setup")
}

// ---------- Main menu ----------

// runMenu is the interactive UI shown on a bare `cdn-link-gen` invocation.
func runMenu() {
	for {
		printHeader()
		s := loadSettings()
		fmt.Println(colorizeBold("════════ MAIN MENU ════════"))
		fmt.Println("  1. Generate CDN links")
		fmt.Println("  2. Manage tokens")
		fmt.Println("  3. Configure settings (setup wizard)")
		fmt.Println("  4. View current settings")
		fmt.Println("  5. List CDN providers")
		fmt.Println("  6. Fix PATH installation")
		fmt.Println("  7. Run demo")
		fmt.Println("  8. Exit")
		fmt.Println()
		if s.SetupDone {
			fmt.Println(colorizeDim("Configuration: saved (setup complete) — runs use your saved defaults"))
		} else {
			fmt.Println(colorizeYellow("Configuration: not set up yet — option 3 walks you through it"))
		}
		fmt.Println()

		choice := strings.TrimSpace(prompt("Select an option", "8"))
		fmt.Println()

		switch choice {
		case "1":
			repoStr := prompt("Repository (owner/repo, or several separated by spaces)", joinOrEmpty(s.LastRepos))
			repos := strings.Fields(repoStr)
			if len(repos) == 0 {
				fmt.Println(colorizeRed("✗ No repository provided"))
				continue
			}
			opts := &options{
				format:      s.Format,
				concurrency: s.Concurrency,
			}
			if s.CommitsPerSVG > 0 {
				opts.commitsPerSVG = s.CommitsPerSVG
			}
			opts.cdnSelection = s.CDNs
			opts.noValidate = !s.Validate
			opts.yes = true
			runWorkflow(parseRepoArgs(repos), activeToken(), opts)
			pauseForEnter()
		case "2":
			tokenMenu()
			pauseForEnter()
		case "3":
			runSetup()
			pauseForEnter()
		case "4":
			fmt.Println(colorizeBold("Current settings (" + getSettingsFilePath() + "):"))
			fmt.Println(formatSettings(loadSettings()))
			pauseForEnter()
		case "5":
			printCDNs()
			pauseForEnter()
		case "6":
			if err := installSelfToPath(); err != nil {
				fmt.Println(colorizeRed("✗ " + err.Error()))
			}
			pauseForEnter()
		case "7":
			runDemo()
			pauseForEnter()
		case "8", "q", "quit", "exit":
			fmt.Println(colorizeGreen("Goodbye! 👋"))
			return
		default:
			fmt.Println(colorizeRed("Unknown option: " + choice))
			pauseForEnter()
		}
	}
}

// tokenMenu is the token management submenu (option 2).
func tokenMenu() {
	for {
		fmt.Println(colorizeBold("Token management:"))
		fmt.Println("  1. Add token")
		fmt.Println("  2. List tokens")
		fmt.Println("  3. Verify active token")
		fmt.Println("  4. Remove token")
		fmt.Println("  5. Clear all tokens")
		fmt.Println("  6. Back")
		choice := strings.TrimSpace(prompt("Select", "6"))
		fmt.Println()
		switch choice {
		case "1":
			handleTokenCommand("add", nil)
		case "2":
			handleTokenCommand("list", nil)
		case "3":
			handleTokenCommand("verify", nil)
		case "4":
			idx := prompt("Token number to remove", "")
			handleTokenCommand("remove", []string{idx})
		case "5":
			handleTokenCommand("clear", nil)
		case "6", "b", "q":
			return
		default:
			fmt.Println(colorizeRed("Unknown option: " + choice))
		}
	}
}

// ---------- PATH auto-fix (permanent) ----------

// currentExecutable returns the absolute path of the running binary.
func currentExecutable() string {
	exe, err := os.Executable()
	if err != nil {
		return ""
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		return resolved
	}
	return exe
}

// findOnPATH reports whether the exact binary name is resolvable via PATH,
// and whether it resolves to this same binary.
func findOnPATH() (found bool, isSelf bool) {
	exe := currentExecutable()
	name := filepath.Base(exe)
	for _, dir := range filepath.SplitList(os.Getenv("PATH")) {
		if dir == "" {
			continue
		}
		cand := filepath.Join(dir, name)
		info, err := os.Stat(cand)
		if err != nil || info.IsDir() {
			continue
		}
		found = true
		if cand == exe {
			isSelf = true
		}
		if found && isSelf {
			return
		}
	}
	return found, isSelf
}

// ensureSelfOnPATH returns true when `cdn-link-gen` on PATH is this binary.
func ensureSelfOnPATH() bool {
	found, isSelf := findOnPATH()
	return found && isSelf
}

// installSelfToPath copies the running binary to a writable PATH directory
// (or installs into ~/.local/bin) and permanently fixes the shell profile.
func installSelfToPath() error {
	exe := currentExecutable()
	if exe == "" {
		return fmt.Errorf("cannot determine the running binary path")
	}
	if os.Geteuid() == 0 {
		return fmt.Errorf("refusing to modify PATH as root — run as your normal user")
	}

	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	binName := "cdn-link-gen"
	localBin := filepath.Join(home, ".local", "bin")
	target := filepath.Join(localBin, binName)

	// Prefer a writable dir already on PATH; otherwise use ~/.local/bin.
	dir := ""
	for _, d := range filepath.SplitList(os.Getenv("PATH")) {
		if d == "" {
			continue
		}
		if testWritableDir(d) {
			dir = d
			break
		}
	}
	if dir == "" {
		if err := os.MkdirAll(localBin, 0o755); err != nil {
			return fmt.Errorf("cannot create %s: %w", localBin, err)
		}
		dir = localBin
	}
	target = filepath.Join(dir, binName)

	// Copy (never move) so any repo copy stays intact — unless the running
	// binary IS the target (self-overwrite is blocked by the OS).
	if sameFile(exe, target) {
		fmt.Println(colorizeGreen("✓ Binary already installed at " + target))
	} else {
		if err := copyExecutable(exe, target); err != nil {
			return fmt.Errorf("install to %s failed: %w", target, err)
		}
		fmt.Println(colorizeGreen("✓ Installed binary to " + target))
	}

	// Permanently add the dir to PATH in shell profiles if missing.
	if err := ensurePATHInProfiles(dir); err != nil {
		return err
	}
	if pathHas(dir) {
		fmt.Println(colorizeGreen("✓ " + dir + " is on PATH — the command works in every shell, permanently"))
	} else {
		fmt.Println(colorizeYellow("⚠ Profile updated for future shells. For this shell only, run:"))
		fmt.Println(colorizeYellow("    export PATH=\"" + dir + ":$PATH\""))
	}
	return nil
}

// ensurePATHInProfiles appends a PATH export line to shell profiles when the
// directory is not already configured, creating a profile if none exists.
func ensurePATHInProfiles(dir string) error {
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	profiles := candidateProfiles(home)
	if len(profiles) == 0 {
		profiles = []string{filepath.Join(home, ".profile")}
	}
	for _, p := range profiles {
		data, err := os.ReadFile(p)
		if err == nil {
			if strings.Contains(string(data), dir) {
				continue // already configured
			}
		} else if !os.IsNotExist(err) {
			continue // unreadable profile; skip it
		}
		// Append the PATH line (creates the file when it does not exist yet).
		line := "\n# Added by cdn-link-gen (PATH fix)\nexport PATH=\"" + dir + ":$PATH\"\n"
		f, err := os.OpenFile(p, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
		if err != nil {
			continue
		}
		_, werr := f.WriteString(line)
		f.Close()
		if werr == nil {
			fmt.Println(colorizeGreen("✓ PATH updated permanently in " + p))
		}
	}
	return nil
}

// candidateProfiles lists existing, writable shell profiles in priority order.
func candidateProfiles(home string) []string {
	var out []string
	for _, name := range []string{".bashrc", ".profile", ".zshrc"} {
		p := filepath.Join(home, name)
		if info, err := os.Stat(p); err == nil && !info.IsDir() {
			out = append(out, p)
		}
	}
	return out
}

// pathHas reports whether dir is an entry of the current PATH.
func pathHas(dir string) bool {
	for _, d := range filepath.SplitList(os.Getenv("PATH")) {
		if d == dir {
			return true
		}
	}
	return false
}

// testWritableDir checks that dir exists and we can create files in it.
func testWritableDir(dir string) bool {
	probe, err := os.CreateTemp(dir, ".cdn-link-gen-probe-*")
	if err != nil {
		return false
	}
	name := probe.Name()
	probe.Close()
	os.Remove(name)
	return true
}

// sameFile reports whether two paths refer to the same file.
func sameFile(a, b string) bool {
	if a == b {
		return true
	}
	ia, erra := os.Stat(a)
	ib, errb := os.Stat(b)
	if erra != nil || errb != nil {
		return false
	}
	return os.SameFile(ia, ib)
}

// copyExecutable copies src to dst with executable permissions.
func copyExecutable(src, dst string) error {
	data, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(dst, data, 0o755); err != nil {
		return err
	}
	return nil
}

// ---------- Small helpers ----------

func parseRepoArgs(repos []string) []GitHubRepo {
	var out []GitHubRepo
	for _, r := range repos {
		if repo, err := parseRepoURL(r); err == nil {
			out = append(out, repo)
		} else {
			fmt.Println(colorizeYellow("⚠ Skipping invalid repo " + r + ": " + err.Error()))
		}
	}
	return out
}

func activeToken() string {
	if t := getTokenFromEnv(); t != "" {
		return t
	}
	if tokens, err := loadTokens(); err == nil && len(tokens) > 0 {
		return tokens[0]
	}
	return ""
}

func joinOrEmpty(in []string) string {
	return strings.Join(in, " ")
}

func parsePositiveInt(s string, def int) int {
	s = strings.TrimSpace(s)
	if s == "" {
		return def
	}
	n := 0
	for _, c := range s {
		if c < '0' || c > '9' {
			return def
		}
		n = n*10 + int(c-'0')
	}
	return n
}

// pauseForEnter keeps the menu open until the user has read the output.
func pauseForEnter() {
	fmt.Print(colorizeDim("\nPress Enter to continue…"))
	_, _ = stdinReader.ReadString('\n')
}

var _ = runtime.GOOS // keep runtime import available for platform tweaks
