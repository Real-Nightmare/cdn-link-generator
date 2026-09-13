package main

import (
	"flag"
	"fmt"
	"os"
	"strconv"
	"strings"
)

const version = "2.0.0"

func main() {
	if len(os.Args) < 2 {
		printWelcome()
		return
	}

	cmd := strings.ToLower(os.Args[1])
	args := os.Args[2:]

	switch cmd {
	case "generate", "gen", "create":
		handleGenerate(args)
	case "token":
		if len(args) < 1 {
			fmt.Println("Usage: cdn-link-gen token <add|list|remove|clear|verify>")
			os.Exit(1)
		}
		handleTokenCommand(strings.ToLower(args[0]), args[1:])
	case "cdns":
		printCDNs()
	case "demo":
		runDemo()
	case "version", "--version", "-v":
		fmt.Printf("cdn-link-gen %s\n", version)
	case "help", "--help", "-h":
		printWelcome()
	default:
		fmt.Printf("Unknown command: %s\n\n", cmd)
		printWelcome()
		os.Exit(1)
	}
}

// handleGenerate parses flags and positional repo args in any order.
func handleGenerate(args []string) {
	fs := flag.NewFlagSet("generate", flag.ContinueOnError)
	fs.Usage = func() { printGenerateUsage() }

	commits := fs.Int("commits", 0, "commits per SVG (0 = use all found commits)")
	cdns := fs.String("cdns", "", "comma-separated CDN ids/names/domains (default: all)")
	out := fs.String("out", "", "output file (default: cdn_links_<timestamp>.txt)")
	format := fs.String("format", "txt", "output format: txt or csv")
	noValidate := fs.Bool("no-validate", false, "skip link validation (fastest)")
	yes := fs.Bool("y", false, "skip confirmation prompt (automatic mode)")
	concurrency := fs.Int("c", 20, "concurrent validation requests")
	makeCommits := fs.Bool("make-commits", false, "create new commits in a repo you own, then generate links")

	// Partition args into positional repos and flag tokens, supporting flags
	// before, between, or after repo arguments.
	valueFlags := map[string]bool{
		"-commits": true, "--commits": true,
		"-cdns": true, "--cdns": true,
		"-out": true, "--out": true,
		"-format": true, "--format": true,
		"-c": true, "--c": true,
	}
	var flagTokens []string
	var repos []string
	for i := 0; i < len(args); i++ {
		a := args[i]
		if strings.HasPrefix(a, "-") && a != "-" {
			flagTokens = append(flagTokens, a)
			base := strings.SplitN(a, "=", 2)[0]
			if valueFlags[base] && i+1 < len(args) {
				i++
				flagTokens = append(flagTokens, args[i])
			}
			continue
		}
		repos = append(repos, a)
	}
	if err := fs.Parse(flagTokens); err != nil {
		os.Exit(1)
	}

	opts := &options{
		commitsPerSVG: *commits,
		cdnSelection:  splitCSV(*cdns),
		outputFile:    *out,
		format:        strings.ToLower(*format),
		noValidate:    *noValidate,
		yes:           *yes,
		concurrency:   *concurrency,
		makeCommits:   *makeCommits,
	}

	if opts.format != "txt" && opts.format != "csv" {
		fmt.Println(colorizeRed("✗ Invalid format (use txt or csv)"))
		os.Exit(1)
	}
	if len(repos) == 0 {
		printGenerateUsage()
		os.Exit(1)
	}

	if opts.makeCommits {
		generateWithCommitCreation(repos, opts)
		return
	}

	if opts.yes || opts.noValidate || opts.outputFile != "" || opts.commitsPerSVG > 0 {
		// Any explicit flag => fully automatic mode.
		automaticMode(repos, opts)
		return
	}
	interactiveMode(repos)
}

// handleTokenCommand dispatches token subcommands.
func handleTokenCommand(sub string, args []string) {
	switch sub {
	case "add":
		fmt.Print("Enter GitHub token (input hidden): ")
		token, err := readHiddenLine()
		if err != nil {
			fmt.Println(colorizeRed("Error: could not read token: " + err.Error()))
			return
		}
		token = strings.TrimSpace(token)
		if token == "" {
			fmt.Println(colorizeRed("Error: Token cannot be empty"))
			return
		}
		fmt.Println()
		if err := addToken(token); err != nil {
			fmt.Println(colorizeRed("Error: " + err.Error()))
		} else {
			fmt.Println(colorizeGreen("✓ Token added successfully"))
		}
	case "verify":
		token := getTokenFromEnv()
		if token == "" {
			tokens, err := loadTokens()
			if err != nil || len(tokens) == 0 {
				fmt.Println(colorizeRed("✗ No token available. Set GITHUB_TOKEN or run: cdn-link-gen token add"))
				os.Exit(1)
			}
			token = tokens[0]
		}
		login, err := verifyToken(token)
		if err != nil {
			fmt.Println(colorizeRed("✗ Token verification failed: " + err.Error()))
			os.Exit(1)
		}
		fmt.Printf(colorizeGreen("✓ Token is valid — authenticated as %s\n"), login)
		if rem, lim, err := getRateLimit(token); err == nil {
			fmt.Printf(colorizeGreen("✓ API rate limit: %d/%d requests remaining\n"), rem, lim)
		}
	case "list":
		tokens, err := loadTokens()
		if err != nil {
			fmt.Println(colorizeRed("Error: " + err.Error()))
			return
		}
		if len(tokens) == 0 {
			fmt.Println(colorizeYellow("No tokens saved. Run 'token add' to add one."))
			return
		}
		fmt.Println(colorizeGreen("\nSaved Tokens:"))
		for i, t := range tokens {
			preview := t[:minInt(6, len(t))] + "…" + t[maxInt(0, len(t)-4):]
			fmt.Printf("  %d. %s (%d chars)\n", i+1, preview, len(t))
		}
		fmt.Println()
	case "remove":
		if len(args) == 0 {
			fmt.Println("Usage: token remove <index>")
			return
		}
		idx, err := strconv.Atoi(strings.TrimSpace(args[0]))
		if err != nil {
			fmt.Println(colorizeRed("Error: Invalid index"))
			return
		}
		if err := removeToken(idx); err != nil {
			fmt.Println(colorizeRed("Error: " + err.Error()))
		} else {
			fmt.Println(colorizeGreen("✓ Token removed"))
		}
	case "clear":
		fmt.Print("Are you sure? (y/N): ")
		var confirm string
		fmt.Scanln(&confirm)
		if strings.ToLower(strings.TrimSpace(confirm)) == "y" {
			if err := clearTokens(); err != nil {
				fmt.Println(colorizeRed("Error: " + err.Error()))
			} else {
				fmt.Println(colorizeGreen("✓ All tokens cleared"))
			}
		}
	default:
		fmt.Println("Unknown token command:", sub)
		fmt.Println("Usage: cdn-link-gen token <add|list|remove|clear|verify>")
	}
}

func splitCSV(s string) []string {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

func printCDNs() {
	fmt.Println(colorizeBold("\n📡 Available CDN providers:"))
	for _, cdn := range cdnProviders {
		svgTag := ""
		if cdn.SVGOnly {
			svgTag = colorizeDim("  (SVG-optimized)")
		}
		fmt.Printf("  %s. %-22s %s%s\n", cdn.ID, cdn.Name, colorizeDim(cdn.Domain), svgTag)
	}
	fmt.Printf("\nUse with: %s\n\n", colorizeDim("cdn-link-gen generate owner/repo -cdns 1,3,githack"))
}

func printWelcome() {
	printHeader()
	fmt.Println(colorizeBold("Available Commands:"))
	fmt.Println("  generate <repo…>   Generate CDN links for every SVG in the repos")
	fmt.Println("  token add          Add a GitHub token")
	fmt.Println("  token list         List saved tokens")
	fmt.Println("  token verify       Verify the active token & show rate limit")
	fmt.Println("  token remove <n>   Remove token #n")
	fmt.Println("  token clear        Clear all tokens")
	fmt.Println("  cdns               List supported CDN providers")
	fmt.Println("  demo               Run demo mode")
	fmt.Println("  version            Print version")
	fmt.Println()

	fmt.Println(colorizeBold("Generate flags (fully automatic when any flag is set):"))
	fmt.Println("  -commits N         Commits per SVG (default: all found)")
	fmt.Println("  -cdns list         Comma-separated CDN ids/names/domains")
	fmt.Println("  -out file          Output file path")
	fmt.Println("  -format txt|csv    Output format (default: txt)")
	fmt.Println("  -no-validate       Skip link validation")
	fmt.Println("  -y                 Skip confirmation prompt")
	fmt.Println("  -c N               Concurrent validation workers (default: 20)")
	fmt.Println()

	fmt.Println(colorizeBold("Examples:"))
	fmt.Println("  cdn-link-gen generate owner/repo")
	fmt.Println("  cdn-link-gen generate owner/repo -y -no-validate")
	fmt.Println("  cdn-link-gen generate owner/repo -commits 50 -cdns 1,2,3 -format csv")
	fmt.Println("  cdn-link-gen generate owner/repo1 owner/repo2")
	fmt.Println()
	fmt.Println("Docs: README.md | INSTALL.md | USAGE.md | FAQ.md")
}

func printGenerateUsage() {
	fmt.Println("Usage: cdn-link-gen generate <owner/repo> [owner/repo2…] [flags]")
	fmt.Println()
	fmt.Println("Flags:")
	fmt.Println("  -commits N        commits per SVG (0 = all found)")
	fmt.Println("  -cdns list        comma-separated CDN ids/names/domains")
	fmt.Println("  -out file         output file path")
	fmt.Println("  -format txt|csv   output format")
	fmt.Println("  -no-validate      skip link validation")
	fmt.Println("  -y                skip confirmation (automatic)")
	fmt.Println("  -c N              validation concurrency (default 20)")
	fmt.Println("  -make-commits     create new commits in a repo you own first")
	fmt.Println()
	fmt.Println("Example: cdn-link-gen generate owner/repo -y -commits 50 -cdns 1,2,3")
	fmt.Println()
}
