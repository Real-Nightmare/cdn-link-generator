package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// settings persists user preferences so runs keep their configuration across
// sessions (persisting everything the user chose previously).
type settings struct {
	CommitsPerSVG int      `json:"commitsPerSVG"`
	CDNs          []string `json:"cdns"`
	Format        string   `json:"format"`
	Concurrency   int      `json:"concurrency"`
	Validate      bool     `json:"validate"`
	LastRepos     []string `json:"lastRepos"`
	SetupDone     bool     `json:"setupDone"`
	UpdatedAt     string   `json:"updatedAt"`
}

func getSettingsFilePath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		home = "."
	}
	return filepath.Join(home, ".cdn_settings.json")
}

func defaultSettings() *settings {
	return &settings{
		CommitsPerSVG: 0, // all found commits
		Format:        "txt",
		Concurrency:   20,
		Validate:      true,
	}
}

// loadSettings returns persisted settings or defaults; never fails hard.
func loadSettings() *settings {
	s := defaultSettings()
	data, err := os.ReadFile(getSettingsFilePath())
	if err != nil {
		return s
	}
	var stored settings
	if err := json.Unmarshal(data, &stored); err != nil {
		return s
	}
	if stored.CommitsPerSVG >= 0 {
		s.CommitsPerSVG = stored.CommitsPerSVG
	}
	if len(stored.CDNs) > 0 {
		s.CDNs = stored.CDNs
	}
	switch stored.Format {
	case "txt", "csv":
		s.Format = stored.Format
	}
	if stored.Concurrency > 0 {
		s.Concurrency = stored.Concurrency
	}
	s.Validate = stored.Validate
	if len(stored.LastRepos) > 0 {
		s.LastRepos = stored.LastRepos
	}
	s.SetupDone = stored.SetupDone
	return s
}

// saveSettings persists settings atomically (tmp file + rename, 0600).
func saveSettings(s *settings) error {
	s.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	path := getSettingsFilePath()
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// applySavedDefaults merges saved preferences into opts for fields the user
// did not explicitly set on the command line.
func applySavedDefaults(opts *options, saved *settings, explicit map[string]bool) {
	if !explicit["commits"] && saved.CommitsPerSVG > 0 {
		opts.commitsPerSVG = saved.CommitsPerSVG
	}
	if !explicit["cdns"] && len(saved.CDNs) > 0 {
		opts.cdnSelection = saved.CDNs
	}
	if !explicit["format"] {
		opts.format = saved.Format
	}
	if !explicit["c"] {
		opts.concurrency = saved.Concurrency
	}
	if explicit["validate"] && opts.forceValidate {
		opts.noValidate = false
	} else if !explicit["no-validate"] {
		opts.noValidate = !saved.Validate
	}
}

// persistRunSettings records the settings actually used in a run.
func persistRunSettings(opts *options, repos []string) {
	s := loadSettings()
	s.CommitsPerSVG = opts.commitsPerSVG
	s.CDNs = opts.cdnSelection
	s.Format = opts.format
	s.Concurrency = opts.concurrency
	s.Validate = !opts.noValidate
	if len(repos) > 0 {
		s.LastRepos = repos
	}
	if err := saveSettings(s); err != nil {
		fmt.Println(colorizeYellow("⚠ Could not save settings: " + err.Error()))
	}
}

// formatSettings renders the current persisted settings for display.
func formatSettings(s *settings) string {
	cdns := "all (13 providers)"
	if len(s.CDNs) > 0 {
		cdns = strings.Join(s.CDNs, ", ")
	}
	commits := "all found"
	if s.CommitsPerSVG > 0 {
		commits = fmt.Sprintf("%d", s.CommitsPerSVG)
	}
	validate := "enabled"
	if !s.Validate {
		validate = "disabled"
	}
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("  Commits per SVG:    %s\n", colorizeBold(commits)))
	sb.WriteString(fmt.Sprintf("  CDNs:               %s\n", colorizeBold(cdns)))
	sb.WriteString(fmt.Sprintf("  Output format:      %s\n", colorizeBold(s.Format)))
	sb.WriteString(fmt.Sprintf("  Validation:         %s\n", colorizeBold(validate)))
	sb.WriteString(fmt.Sprintf("  Validation workers: %s\n", colorizeBold(fmt.Sprintf("%d", s.Concurrency))))
	if len(s.LastRepos) > 0 {
		sb.WriteString(fmt.Sprintf("  Last repos:         %s\n", colorizeBold(strings.Join(s.LastRepos, " "))))
	}
	sb.WriteString(fmt.Sprintf("  Setup completed:    %s\n", colorizeBold(yesNo(s.SetupDone))))
	return sb.String()
}

func yesNo(b bool) string {
	if b {
		return "yes"
	}
	return "no"
}
