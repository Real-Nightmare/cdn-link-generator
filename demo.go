package main

import (
	"fmt"
	"strconv"
	"time"
)

func runDemo() {
	printHeader()

	fmt.Println(colorizeGreen("📚 DEMO MODE"))
	fmt.Println(colorizeYellow("This demonstrates the tool without requiring GitHub access\n"))

	fmt.Println(colorizeBlue("Step 1: Scanning for SVG files..."))
	for i := 0; i < 3; i++ {
		fmt.Printf("\rProgress: %d/3", i+1)
		time.Sleep(400 * time.Millisecond)
	}
	fmt.Println()

	fmt.Println("\n" + colorizeGreen("✓ Found SVG files:"))
	fmt.Println("  demo/repo: 5 SVG(s)")
	fmt.Println("    • icon-1.svg")
	fmt.Println("    • icon-2.svg")
	fmt.Println("    • logo.svg")
	fmt.Println("    • background.svg")
	fmt.Println("    • pattern.svg")

	fmt.Println("\n" + colorizeGreen("✓ Statistics:"))
	fmt.Printf("  Total SVGs: %s\n", colorizeBlue("5"))
	fmt.Printf("  CDN providers: %s\n", colorizeBlue(strconv.Itoa(len(cdnProviders))))
	fmt.Printf("  With 100 commits per SVG: %s links\n\n", colorizeBlue("6,500"))

	fmt.Println(colorizeYellow("⏳ Generating 6,500 CDN links..."))
	for i := 0; i <= 100; i += 10 {
		fmt.Printf("\rProgress: %d%%", i)
		time.Sleep(100 * time.Millisecond)
	}
	fmt.Println()

	fmt.Println("\n" + colorizeGreen("✓ Link generation complete!"))
	fmt.Printf("  Generated: %s links\n", colorizeBlue("6,500"))
	fmt.Printf("  File size: %s\n", colorizeBlue("~325 KB"))
	fmt.Println()

	fmt.Println(colorizeYellow("🧪 Testing links for validity..."))
	for i := 0; i <= 100; i += 10 {
		fmt.Printf("\rTesting: %d%%", i)
		time.Sleep(100 * time.Millisecond)
	}
	fmt.Println()

	fmt.Println("\n" + colorizeGreen("✓ Link validation complete!"))
	fmt.Printf("  Valid links: %s\n", colorizeGreen("6,435"))
	fmt.Printf("  Broken links: %s\n", colorizeRed("65"))
	fmt.Printf("  Success rate: %s%%\n", colorizeGreen("98.9"))
	fmt.Println()

	fmt.Println(colorizeGreen("✓ Files saved:"))
	fmt.Println("  • cdn_links_2024-01-15_10-30-45.txt (6,435 valid links)")
	fmt.Println("  • cdn_links_broken_2024-01-15_10-30-45.txt (65 broken links)")

	fmt.Println("\n" + colorizeYellow("💡 Next steps:"))
	fmt.Println("  1. Add a token: cdn-link-gen token add")
	fmt.Println("  2. Generate: cdn-link-gen generate owner/repo -y")
	fmt.Println("  3. View results: head -20 cdn_links_*.txt")
	fmt.Println()
}
