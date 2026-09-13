package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"unicode/utf8"
)

const maxTokens = 10

type tokenData struct {
	Tokens []string `json:"tokens"`
}

func getTokensFilePath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		home = "."
	}
	return filepath.Join(home, ".cdn_tokens.json")
}

func loadTokens() ([]string, error) {
	data, err := os.ReadFile(getTokensFilePath())
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("no tokens found, run 'token add' first")
		}
		return nil, err
	}
	var td tokenData
	if err := json.Unmarshal(data, &td); err != nil {
		return nil, fmt.Errorf("corrupted tokens file (%s)", getTokensFilePath())
	}
	return td.Tokens, nil
}

func saveTokens(tokens []string) error {
	data, err := json.MarshalIndent(tokenData{Tokens: tokens}, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(getTokensFilePath(), data, 0o600)
}

func addToken(token string) error {
	tokens, _ := loadTokens()
	if len(tokens) >= maxTokens {
		return fmt.Errorf("maximum %d tokens allowed", maxTokens)
	}
	for _, t := range tokens {
		if t == token {
			return fmt.Errorf("token already exists")
		}
	}
	return saveTokens(append(tokens, token))
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

// readHiddenLine reads a line of input without echoing it (best effort).
// Falls back to normal reading when terminal control is unavailable (e.g. CI).
func readHiddenLine() (string, error) {
	fd := int(syscall.Stdin)
	termios, err := getTermios(fd)
	if err != nil {
		// Not a terminal (piped input) — read the full line normally.
		line, readErr := fallbackReader().ReadString('\n')
		if readErr != nil && line == "" {
			return "", readErr
		}
		return strings.TrimRight(line, "\r\n"), nil
	}

	defer setTermios(fd, termios) // always restore
	if err := disableEcho(fd, termios); err != nil {
		return "", err
	}

	var sb strings.Builder
	buf := make([]byte, 1)
	for {
		n, err := os.Stdin.Read(buf)
		if err != nil || n == 0 {
			break
		}
		b := buf[0]
		if b == '\n' || b == '\r' {
			fmt.Println()
			break
		}
		if b == 127 || b == 8 { // backspace
			if sb.Len() > 0 {
				str := sb.String()
				_, size := utf8.DecodeLastRuneInString(str)
				sb.Reset()
				sb.WriteString(str[:len(str)-size])
			}
			continue
		}
		sb.WriteByte(b)
	}
	return sb.String(), nil
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
