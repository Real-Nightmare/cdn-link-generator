package main

type CDNProvider struct {
	ID      string
	Name    string
	Domain  string
	Format  string // "gh" or "raw" or "static"
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

func generateCDNLink(owner, repo, sha, filename, cdnDomain, format string) string {
	switch format {
	case "static":
		return "https://" + cdnDomain + "/gh/" + owner + "/" + repo + "/" + filename
	case "raw":
		return "https://" + cdnDomain + "/" + owner + "/" + repo + "/" + sha + "/" + filename
	default: // gh
		return "https://" + cdnDomain + "/gh/" + owner + "/" + repo + "@" + sha + "/" + filename
	}
}

func filterCDNForSVG(isSVG bool) []CDNProvider {
	if isSVG {
		return cdnProviders // All CDNs support SVG
	}
	// Filter out SVG-only CDNs
	var filtered []CDNProvider
	for _, cdn := range cdnProviders {
		if !cdn.SVGOnly {
			filtered = append(filtered, cdn)
		}
	}
	return filtered
}
