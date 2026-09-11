package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

func main() {
	if len(os.Args) < 2 {
		printWelcome()
		return
	}

	cmd := strings.ToLower(os.Args[1])

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
			fmt.Println("Example: ./cdn-link-gen generate owner/repo owner/repo2")
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

func printWelcome() {
	fmt.Println(colorizeGreen("\n╔════════════════════════════════════════════════════╗"))
	fmt.Println(colorizeGreen("║     CDN Link Generator Pro - Go Edition             ║"))
	fmt.Println(colorizeGreen("║     Speed Optimized for Google Cloud Shell          ║"))
	fmt.Println(colorizeGreen("╚════════════════════════════════════════════════════╝\n"))
	fmt.Println(colorizeYellow("Available Commands:"))
	fmt.Println("  generate <repo1> [repo2]...  - Generate CDN links for SVG files")
	fmt.Println("  token add                    - Add GitHub token")
	fmt.Println("  token list                   - List saved tokens")
	fmt.Println("  token remove <n>             - Remove token #n")
	fmt.Println("  token clear                  - Clear all tokens")
	fmt.Println("  demo                         - Run demo mode\n")
	fmt.Println(colorizeGreen("Examples:"))
	fmt.Println("  ./cdn-link-gen generate owner/repo")
	fmt.Println("  ./cdn-link-gen generate owner/repo1 owner/repo2 owner/repo3\n")
}

func handleTokenCommand(sub string, args []string) {
	switch strings.ToLower(sub) {
	case "add":
		fmt.Print("Enter GitHub token: ")
		var token string
		fmt.Scanln(&token)
		token = strings.TrimSpace(token)
		if token == "" {
			fmt.Println(colorizeRed("Error: Token cannot be empty"))
			return
		}
		if err := addToken(token); err != nil {
			fmt.Println(colorizeRed("Error: " + err.Error()))
		} else {
			fmt.Println(colorizeGreen("✓ Token added successfully"))
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
			preview := t[:6] + "..." + t[len(t)-4:]
			fmt.Printf("  %d. %s (%d chars)\n", i+1, preview, len(t))
		}
		fmt.Println()
	case "remove":
		if len(args) == 0 {
			fmt.Println("Usage: token remove <index>")
			return
		}
		var idx int
		if _, err := fmt.Sscanf(args[0], "%d", &idx); err != nil {
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
		if strings.ToLower(confirm) == "y" {
			if err := clearTokens(); err != nil {
				fmt.Println(colorizeRed("Error: " + err.Error()))
			} else {
				fmt.Println(colorizeGreen("✓ All tokens cleared"))
			}
		}
	default:
		fmt.Println("Unknown token command:", sub)
	}
}

func getTokensFilePath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		panic(err)
	}
	return filepath.Join(home, ".cdn_tokens.json")
}

type tokenData struct {
	Tokens []string `json:"tokens"`
}

func loadTokens() ([]string, error) {
	filePath := getTokensFilePath()
	data, err := os.ReadFile(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("no tokens found, run 'token add' first")
		}
		return nil, err
	}

	var td tokenData
	if err := json.Unmarshal(data, &td); err != nil {
		return nil, fmt.Errorf("corrupted tokens file")
	}

	if len(td.Tokens) == 0 {
		return nil, fmt.Errorf("no tokens found")
	}

	return td.Tokens, nil
}

func saveTokens(tokens []string) error {
	filePath := getTokensFilePath()
	td := tokenData{Tokens: tokens}
	data, err := json.MarshalIndent(td, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filePath, data, 0600)
}

func addToken(token string) error {
	tokens, _ := loadTokens()
	if len(tokens) >= 10 {
		return fmt.Errorf("maximum 10 tokens allowed")
	}
	for _, t := range tokens {
		if t == token {
			return fmt.Errorf("token already exists")
		}
	}
	tokens = append(tokens, token)
	return saveTokens(tokens)
}

func removeToken(index int) error {
	tokens, err := loadTokens()
	if err != nil {
		return err
	}
	if index < 1 || index > len(tokens) {
		return fmt.Errorf("invalid index (1-%d)", len(tokens))
	}
	tokens = append(tokens[:index-1], tokens[index:]...)
	return saveTokens(tokens)
}

func clearTokens() error {
	return saveTokens([]string{})
}
