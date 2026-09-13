package main

import (
	"fmt"
	"strings"
)

type CDNProvider struct {
	ID      string
	Name    string
	Domain  string
	Format  string // "gh" | "static" | "raw"
	SVGOnly bool
}

var cdnProviders = []CDNProvider{
	{"1", "jsDelivr (Primary)", "cdn.jsdelivr.net", "gh", false},
	{"2", "jsDelivr (Fastly)", "fastly.jsdelivr.net", "gh", false},
	{"3", "jsDelivr (Gcore)", "gcore.jsdelivr.net", "gh", false},
	{"4", "jsDelivr (Testing CF)", "testingcf.jsdelivr.net", "gh", false},
	{"5", "jsDelivr (Quantil)", "quantil.jsdelivr.net", "gh", false},
	{"6", "jsDelivr (Origin Fastly)", "originfastly.jsdelivr.net", "gh", false},
	{"7", "StaticDelivr", "cdn.staticdelivr.com", "static", false},
	{"8", "jsDelivr CN", "jsd.onmicrosoft.cn", "gh", false},
	{"9", "jsDelivr Mirror", "cdn.jsdmirror.com", "gh", false},
	{"10", "GitHub Raw", "githubraw.com", "raw", true},
	{"11", "GitHub Raw (CDN)", "cdn.githubraw.com", "raw", true},
	{"12", "Githack", "raw.githack.com", "raw", true},
	{"13", "Githack (CDN)", "rawcdn.githack.com", "raw", true},
}

// generateCDNLink builds a CDN URL for the given provider format.
func generateCDNLink(owner, repo, sha, path, cdnDomain, format string) string {
	// Paths are URL-safe already; escape spaces defensively.
	path = strings.ReplaceAll(path, " ", "%20")

	switch format {
	case "static":
		// StaticDelivr serves the latest version by default.
		return "https://" + cdnDomain + "/gh/" + owner + "/" + repo + "/" + path
	case "raw":
		// githubraw.com / githack style: /owner/repo/commit/path
		return "https://" + cdnDomain + "/" + owner + "/" + repo + "/" + sha + "/" + path
	default: // gh (jsDelivr style): /gh/owner/repo@commit/path
		return "https://" + cdnDomain + "/gh/" + owner + "/" + repo + "@" + sha + "/" + path
	}
}

// filterCDNForSVG returns all CDNs (SVG is supported everywhere) or, for
// non-SVG assets, only providers that do not restrict file types.
func filterCDNForSVG(isSVG bool) []CDNProvider {
	if isSVG {
		return cdnProviders
	}
	var filtered []CDNProvider
	for _, cdn := range cdnProviders {
		if !cdn.SVGOnly {
			filtered = append(filtered, cdn)
		}
	}
	return filtered
}

// selectCDNs picks providers by 1-based index numbers ("1", "3"), names or
// domain substrings (case-insensitive). Empty/nil returns everything.
func selectCDNs(selection []string) ([]CDNProvider, error) {
	if len(selection) == 0 {
		return cdnProviders, nil
	}
	var chosen []CDNProvider
	seen := make(map[int]bool)
	for _, sel := range selection {
		sel = strings.ToLower(strings.TrimSpace(sel))
		if sel == "" {
			continue
		}
		matched := false
		for i, cdn := range cdnProviders {
			if seen[i] {
				continue
			}
			if sel == cdn.ID ||
				strings.Contains(strings.ToLower(cdn.Name), sel) ||
				strings.Contains(strings.ToLower(cdn.Domain), sel) {
				chosen = append(chosen, cdn)
				seen[i] = true
				matched = true
				break
			}
		}
		if !matched {
			return nil, fmt.Errorf("unknown CDN %q (see 'cdn-link-gen cdns' for the list)", sel)
		}
	}
	if len(chosen) == 0 {
		return nil, fmt.Errorf("no CDNs selected")
	}
	return chosen, nil
}
