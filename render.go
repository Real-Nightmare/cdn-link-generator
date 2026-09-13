package main

import (
	"fmt"
	"os"
	"strings"
)

// Render API is optional - this tool works without it
// It's only used for optional enhanced link shortening/sharing

type RenderService struct {
	APIKey string
	Active bool
}

func NewRenderService(apiKey string) *RenderService {
	return &RenderService{
		APIKey: apiKey,
		Active: apiKey != "",
	}
}

func (rs *RenderService) IsConfigured() bool {
	return rs.Active
}

func (rs *RenderService) PrintStatus() {
	if rs.Active {
		fmt.Println(colorizeGreen("✓ Render API: Configured (optional features enabled)"))
	} else {
		fmt.Println(colorizeYellow("⚠ Render API: Not configured (optional features disabled)"))
		fmt.Println(colorizeYellow("  Tip: CDN links will still work fine without it!"))
	}
}

// Optional: Upload results to Render for sharing
func (rs *RenderService) ShareResults(filename string) (string, error) {
	if !rs.Active {
		return "", fmt.Errorf("render API not configured")
	}
	// Implementation would go here
	return "", nil
}

// SchoolBlockBypassGuide provides instructions for bypassing school filters
func PrintSchoolBlockBypassGuide() {
	fmt.Println("\n" + colorizeYellow("=== SCHOOL/CORPORATE FIREWALL BYPASS GUIDE ==="))
	fmt.Println(colorizeGreen("\n✓ This tool automatically tries multiple connection routes:"))
	fmt.Println("  1. Direct GitHub API connection")
	fmt.Println("  2. CORS proxy (cors-anywhere.herokuapp.com)")
	fmt.Println("  3. AllOrigins proxy (api.allorigins.win)")
	fmt.Println("  4. Freeboard proxy (thingproxy.freeboard.io)")
	fmt.Println(colorizeYellow("\n⚠ NO Render API key required! The tool works standalone.\n"))

	fmt.Println(colorizeYellow("If you still can't connect:"))
	fmt.Println("  1. Use a VPN (NordVPN, ExpressVPN, Proton VPN - free options available)")
	fmt.Println("  2. Use mobile hotspot instead of school WiFi")
	fmt.Println("  3. Try from home/coffee shop WiFi")
	fmt.Println("  4. Use SSH tunneling through a personal server")
	fmt.Println("")
	fmt.Println(colorizeGreen("VPN Setup (2 minutes):"))
	fmt.Println("  - Download Proton VPN (free): https://protonvpn.com")
	fmt.Println("  - Or Windscribe (free): https://windscribe.com")
	fmt.Println("  - Connect to VPN")
	fmt.Println("  - Run the tool normally")
	fmt.Println("")
}
