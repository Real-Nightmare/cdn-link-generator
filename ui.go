package main

import (
	"fmt"
	"os"
	"strings"
	"sync"
)

func interactiveModeNewUI(repoArgs []string) {
	printHeader()

	// Load tokens
	tokens, err := loadTokens()
	if err != nil {
		fmt.Println(colorizeRed("✗ Error: " + err.Error()))
		return
	}

	if len(tokens) == 0 {
		fmt.Println(colorizeRed("✗ No tokens available. Add one first with: ./cdn-link-gen token add"))
		return
	}

	token := tokens[0]
	fmt.Printf(colorizeGreen("✓ Using token: %s...\n\n"), token[:6])

	// Parse repositories
	var repos []GitHubRepo
	for _, repoStr := range repoArgs {
		repo, err := parseRepoURL(repoStr)
		if err != nil {
			fmt.Println(colorizeRed("✗ Invalid repo: " + repoStr + " - " + err.Error()))
			return
		}
		repos = append(repos, repo)
	}

	if len(repos) == 0 {
		fmt.Println(colorizeRed("✗ No valid repositories provided"))
		return
	}

	// Fetch SVG files
	fmt.Println(colorizeYellow("🔍 Scanning repositories for SVG files..."))
	repoSVGs, err := getAllSVGFiles(repos, token)
	if err != nil {
		fmt.Println(colorizeRed("✗ Error: " + err.Error()))
		return
	}

	if len(repoSVGs) == 0 {
		fmt.Println(colorizeRed("✗ No SVG files found in any repository"))
		return
	}

	// Display found SVGs
	fmt.Println()
	fmt.Println(colorizeGreen("✓ Found SVG files:"))
	totalSVGs := 0
	for repoName, svgs := range repoSVGs {
		fmt.Printf("  %s: %d SVG(s)\n", colorizeBlue(repoName), len(svgs))
		for _, svg := range svgs {
			fmt.Printf("    • %s\n", svg)
		}
		totalSVGs += len(svgs)
	}

	fmt.Println()
	fmt.Printf(colorizeGreen("✓ Total SVGs found: %d\n"), totalSVGs)
	fmt.Printf(colorizeGreen("✓ CDN providers available: %d\n"), len(cdnProviders))
	fmt.Printf(colorizeGreen("✓ Potential links to generate: %d\n\n"), totalSVGs*len(cdnProviders))

	// Ask for number of commits per SVG
	fmt.Print(colorizeYellow("Enter number of commits per SVG (1-1000000): "))
	var commitsPerSVG int
	if _, err := fmt.Scanln(&commitsPerSVG); err != nil || commitsPerSVG < 1 {
		fmt.Println(colorizeRed("✗ Invalid input. Using default: 1000"))
		commitsPerSVG = 1000
	}

	totalLinks := totalSVGs * commitsPerSVG * len(cdnProviders)
	fmt.Printf("\n%s Total links to generate: %d\n", colorizeGreen("✓"), totalLinks)
	fmt.Printf("%s This will create ~%dMB of data\n\n", colorizeYellow("⚠"), (totalLinks*50)/1024/1024)

	// Ask for confirmation
	fmt.Print(colorizeYellow("Proceed with generation? (y/N): "))
	var confirm string
	fmt.Scanln(&confirm)
	if strings.ToLower(confirm) != "y" {
		fmt.Println(colorizeYellow("Cancelled."))
		return
	}

	// Generate links
	fmt.Println("\n" + colorizeBlue("═══════════════════════════════════════════════════════════════"))
	fmt.Println(colorizeYellow("📝 Generating Links..."))
	fmt.Println(colorizeBlue("═══════════════════════════════════════════════════════════════\n"))

	generateLinksBatch(repoSVGs, repos, token, commitsPerSVG)
}

func printHeader() {
	clearScreen()
	fmt.Println(colorizeGreen("╔═══════════════════════════════════════════════════════════════╗"))
	fmt.Println(colorizeGreen("║                                                               ║"))
	fmt.Println(colorizeGreen("║         🚀 CDN LINK GENERATOR PRO (Go Edition)           ║"))
	fmt.Println(colorizeGreen("║         Multi-SVG | Multi-CDN | Lightning Fast           ║"))
	fmt.Println(colorizeGreen("║                                                               ║"))
	fmt.Println(colorizeGreen("╚═══════════════════════════════════════════════════════════════╝\n"))
}

func generateLinksBatch(repoSVGs map[string][]string, repos []GitHubRepo, token string, commitsPerSVG int) {
	var allLinks []string
	var mu sync.Mutex
	var wg sync.WaitGroup

	totalSVGs := 0
	for _, svgs := range repoSVGs {
		totalSVGs += len(svgs)
	}

	processedSVGs := 0

	for repoKey, svgs := range repoSVGs {
		for _, svg := range svgs {
			wg.Add(1)
			go func(rk, s string) {
				defer wg.Done()
				defer func() {
					processedSVGs++
					fmt.Printf("\r%s Processing: %d/%d SVGs", colorizeBlue("⏳"), processedSVGs, totalSVGs)
				}()

				// Generate commits
				commits, err := generateCommits(GitHubRepo{}, token, commitsPerSVG)
				if err != nil {
					return
				}

				// Generate links for all CDNs
				for _, cdn := range cdnProviders {
					for _, commit := range commits {
						link := generateCDNLink(
							strings.Split(rk, "/")[0],
							strings.Split(rk, "/")[1],
							commit,
							s,
							cdn.Domain,
							cdn.Format,
						)
						mu.Lock()
						allLinks = append(allLinks, link)
						mu.Unlock()
					}
				}
			}(repoKey, svg)
		}
	}

	wg.Wait()
	fmt.Println()

	// Display statistics
	fmt.Println(colorizeGreen("\n✓ Link generation complete!"))
	fmt.Printf("  Generated: %s links\n", colorizeBlue(fmt.Sprintf("%d", len(allLinks))))

	// Test links
	fmt.Println("\n" + colorizeYellow("🧪 Testing links for validity..."))
	validLinks, brokenLinks := testLinksParallel(allLinks, 20)

	fmt.Printf("\n%s Valid links: %s\n", colorizeGreen("✓"), colorizeGreen(fmt.Sprintf("%d", len(validLinks))))
	fmt.Printf("%s Broken links: %s\n", colorizeRed("✗"), colorizeRed(fmt.Sprintf("%d", len(brokenLinks))))
	fmt.Printf("%s Success rate: %s%%\n\n", colorizeBlue("📊"), colorizeGreen(fmt.Sprintf("%.1f", float64(len(validLinks))*100/float64(len(allLinks)))))

	// Save results
	filename := "cdn_links_" + getTimeString() + ".txt"
	if err := saveLinks(filename, validLinks); err != nil {
		fmt.Println(colorizeRed("✗ Error saving links: " + err.Error()))
	} else {
		fmt.Printf(colorizeGreen("✓ Valid links saved to: %s\n"), filename)
	}

	if len(brokenLinks) > 0 {
		filename := "cdn_links_broken_" + getTimeString() + ".txt"
		if err := saveLinks(filename, brokenLinks); err != nil {
			fmt.Println(colorizeRed("✗ Error saving broken links: " + err.Error()))
		} else {
			fmt.Printf(colorizeYellow("⚠ Broken links saved to: %s\n"), filename)
		}
	}

	fmt.Println()
	fmt.Println(colorizeGreen("✓ Done! All files ready in current directory."))
	fmt.Println(colorizeYellow("💡 Tip: Use 'cat ' + filename + ' | head -20' to preview links\n"))
}

func saveLinks(filename string, links []string) error {
	file, err := os.Create(filename)
	if err != nil {
		return err
	}
	defer file.Close()

	for _, link := range links {
		if _, err := file.WriteString(link + "\n"); err != nil {
			return err
		}
	}
	return nil
}

func clearScreen() {
	fmt.Print("\033[2J\033[H")
}
