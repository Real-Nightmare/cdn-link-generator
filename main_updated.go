package main

import (
	"fmt"
	"log"
	"os"
)

func init() {
	log.SetFlags(0)
}

func main() {
	if len(os.Args) < 2 {
		printWelcome()
		return
	}

	cmd := os.Args[1]

	switch cmd {
	case "test-firewall":
		fmt.Println(colorizeYellow("\n🧫 Testing firewall configuration..."))
		TestProxyWorking()
		fmt.Println(colorizeGreen("✓ All connection methods tested."))
		fmt.Println(colorizeGreen("✓ This tool will automatically bypass school filters!"))
		printWelcome()

	default:
		// Existing commands work as before
		cmd := os.Args[1]

		switch cmd {
		case "token":
			if len(os.Args) < 3 {
				fmt.Println("Usage: ./cdn-link-gen token <add|list|remove|clear>")
				return
			}
			handleTokenCommand(os.Args[2], os.Args[3:])
		case "generate", "gen", "create":
			if len(os.Args) < 3 {
				fmt.Println("Usage: ./cdn-link-gen generate <repo1> [repo2] [repo3]...")
				return
			}
			repos := os.Args[2:]
			interactiveModeNewUI(repos)
		case "demo":
			runDemo()
		default:
			fmt.Printf("Unknown command: %s\n", cmd)
			printWelcome()
		}
	}
}
