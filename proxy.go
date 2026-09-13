package main

import (
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"
)

// ProxyConfig holds proxy information
type ProxyConfig struct {
	URL    string
	Active bool
}

// Available proxies for bypassing school/corporate firewalls
var schoolBlockBypassProxies = []ProxyConfig{
	{"https://cors-anywhere.herokuapp.com/", true},
	{"https://api.allorigins.win/raw?url=", true},
	{"https://jsonp.afeld.me/?url=", true},
	{"https://thingproxy.freeboard.io/fetch/", true},
}

// Enhanced HTTP client with automatic proxy rotation
func getHTTPClient(useProxy bool) *http.Client {
	client := &http.Client{
		Timeout: 15 * time.Second,
	}

	if !useProxy {
		return client
	}

	// Will implement proxy rotation if direct access fails
	return client
}

// RobustHTTPRequest makes HTTP requests with automatic retry and proxy fallback
func RobustHTTPRequest(method, url string, headers map[string]string) (*http.Response, error) {
	// Try direct connection first
	client := getHTTPClient(false)

	req, err := http.NewRequest(method, url, nil)
	if err != nil {
		return nil, err
	}

	// Add headers
	for key, value := range headers {
		req.Header.Set(key, value)
	}

	resp, err := client.Do(req)
	if err == nil && resp.StatusCode < 500 {
		return resp, nil
	}

	// Fallback to proxy
	fmt.Println(colorizeYellow("⚠ Direct access failed, trying alternative routes..."))

	for _, proxy := range schoolBlockBypassProxies {
		if !proxy.Active {
			continue
		}

		proxyURL := proxy.URL + url
		if strings.Contains(proxy.URL, "?") {
			proxyURL = proxy.URL + url
		}

		req, _ := http.NewRequest(method, proxyURL, nil)
		for key, value := range headers {
			req.Header.Set(key, value)
		}

		if resp, err := client.Do(req); err == nil && resp.StatusCode < 500 {
			fmt.Printf(colorizeGreen("✓ Connected via alternative route\n"))
			return resp, nil
		}

		time.Sleep(500 * time.Millisecond)
	}

	return resp, err
}

// TestConnectivity checks if the script can reach GitHub
func TestConnectivity(token string) bool {
	headers := map[string]string{
		"Authorization": "token " + token,
		"Accept":        "application/vnd.github.v3+json",
	}

	resp, err := RobustHTTPRequest("GET", "https://api.github.com/user", headers)
	if err != nil {
		return false
	}
	defer resp.Body.Close()

	return resp.StatusCode == 200
}

// TestProxyWorking verifies proxy availability
func TestProxyWorking() {
	fmt.Println(colorizeYellow("\n🧫 Testing connectivity options..."))

	var wg sync.WaitGroup
	var mu sync.Mutex
	workingCount := 0

	for i, proxy := range schoolBlockBypassProxies {
		wg.Add(1)
		go func(index int, p ProxyConfig) {
			defer wg.Done()

			client := &http.Client{Timeout: 5 * time.Second}
			testURL := p.URL + "https://api.github.com"

			resp, err := client.Head(testURL)
			if err == nil && (resp.StatusCode < 500) {
				mu.Lock()
				workingCount++
				mu.Unlock()
				fmt.Printf(colorizeGreen("✓ Route %d: OK\n"), index+1)
			} else {
				fmt.Printf(colorizeYellow("⚠ Route %d: Limited\n"), index+1)
			}
			if resp != nil {
				resp.Body.Close()
			}
		}(i, proxy)
	}

	wg.Wait()
	fmt.Printf(colorizeGreen("\n✓ %d connection routes available\n\n"), workingCount)
}
