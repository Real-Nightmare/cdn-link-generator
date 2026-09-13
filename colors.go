package main

import "os"

var colorEnabled = detectColorSupport()

func detectColorSupport() bool {
	if os.Getenv("NO_COLOR") != "" {
		return false
	}
	info, err := os.Stdout.Stat()
	if err != nil {
		return false
	}
	return (info.Mode() & os.ModeCharDevice) != 0
}

func colorize(text, code string) string {
	if !colorEnabled || text == "" {
		return text
	}
	return "\033[" + code + "m" + text + "\033[0m"
}

func colorizeGreen(s string) string  { return colorize(s, "32") }
func colorizeRed(s string) string    { return colorize(s, "31") }
func colorizeYellow(s string) string { return colorize(s, "33") }
func colorizeBlue(s string) string   { return colorize(s, "36") }
func colorizeBold(s string) string   { return colorize(s, "1") }
func colorizeDim(s string) string    { return colorize(s, "90") }
