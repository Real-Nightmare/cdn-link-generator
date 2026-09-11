package main

import "github.com/fatih/color"

var (
	colorGreen = color.New(color.FgGreen).SprintFunc()
	colorRed = color.New(color.FgRed).SprintFunc()
	colorYellow = color.New(color.FgYellow).SprintFunc()
	colorBlue = color.New(color.FgCyan).SprintFunc()
)

func colorizeGreen(s string) string {
	return colorGreen(s)
}

func colorizeRed(s string) string {
	return colorRed(s)
}

func colorizeYellow(s string) string {
	return colorYellow(s)
}

func colorizeBlue(s string) string {
	return colorBlue(s)
}
