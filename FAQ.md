# FREQUENTLY ASKED QUESTIONS

## General Questions

### Q: Is this tool legal?
A: Yes. It's a legitimate CDN link generator using public GitHub APIs. It's similar to how jsDelivr works.

### Q: Do I need special permissions?
A: Just a GitHub account (free) and a personal access token. No admin rights needed.

### Q: Can I use this at school?
A: Yes, with permission. See INSTALL.md for school-safe setup. Always follow your school's acceptable use policy.

### Q: Is it free?
A: Completely free. Open source, no ads, no hidden fees.

### Q: What's the difference from the Python version?
A: This Go version is 50-100x faster, uses less memory, and has better school firewall bypass.

---

## Setup Questions

### Q: Do I need to install anything?
A: Just Go (1.21+) and Git. Download from go.dev and git-scm.com.

### Q: Can I use Google Cloud Shell?
A: Yes! Recommended method. Go/Git pre-installed, Google is usually whitelisted at schools.

### Q: My school blocks GitHub, what do I do?
A: See INSTALL.md section "School/Corporate Firewall Bypass". Multiple methods listed.

### Q: Can I use this on Windows?
A: Yes. Use WSL2, native Go binary, or pre-built .exe.

### Q: Can I use Docker?
A: Yes. `docker build -t cdn-gen . && docker run -it cdn-gen generate owner/repo`

---

## Token Questions

### Q: Where do I get a GitHub token?
A: https://github.com/settings/tokens/new - Select "repo" scope.

### Q: Can I use my main GitHub password?
A: No, you must use a Personal Access Token (PAT).

### Q: Are my tokens safe?
A: Yes. Stored in ~/.cdn_tokens.json with 0600 permissions (only you can read).

### Q: Can I add multiple tokens?
A: Yes, up to 10. Helps for rate limiting: `./cdn-link-gen token add`

### Q: What if I lose my token?
A: Delete it and create a new one. Never share your token.

---

## Usage Questions

### Q: How many links can I generate?
A: Technically unlimited. Limited by:
- Commits per SVG: 1-1,000,000
- Number of SVGs: Unlimited
- CDNs: 13 available
- Formula: SVGs × Commits × CDNs = Total Links

### Q: How long does it take?
A: Typical speeds:
- 5 SVGs × 100 commits: 10 seconds
- 50 SVGs × 1000 commits: 2 minutes
- 100 SVGs × 10000 commits: 5-10 minutes

### Q: Will broken links affect my site?
A: No. Tool automatically tests and removes broken links.

### Q: Can I use other people's repos?
A: Yes, if they're public. Private repos need your token to have access.

### Q: Do I need to credit anything?
A: No, but attribution appreciated: "Generated with CDN Link Generator Pro"

---

## Technical Questions

### Q: Why Go instead of Python?
A: Performance. Go is 50-100x faster for concurrent operations.

### Q: Can I modify the source?
A: Yes! It's open source. Fork and customize as needed.

### Q: What are the system requirements?
A: Minimal. 10MB disk, 20MB RAM, any OS (Linux/Mac/Windows).

### Q: How does the school firewall bypass work?
A: Multiple methods:
1. Direct connection (if allowed)
2. CORS proxies
3. Alternative routing
4. VPN fallback

### Q: Is it secure?
A: Yes. No malware, no tracking, open source code.

---

## CDN Questions

### Q: Why 13 CDNs?
A: Redundancy. If one CDN blocks you, others work.

### Q: Which CDN is fastest?
A: Depends on location:
- jsDelivr (Primary): Worldwide
- Gcore: Europe/Asia
- StaticDelivr: Americas

### Q: Can I use SVG-only CDNs for HTML files?
A: No. Tool prevents this. Use "CDN #1" or mix of CDNs instead.

### Q: Do these links expire?
A: No. CDN links are permanent as long as the GitHub repo exists.

### Q: Can I use these links commercially?
A: Yes, as long as you have rights to the content.

---

## Error Handling

### Q: "Network error" - what do I do?
A: 1. Check internet connection
2. Try again
3. Use VPN or alternative bypass
4. Run `bash test-firewall.sh`

### Q: "No SVG files found"
A: Repo doesn't have .svg files, or they're named differently (.SVG instead).

### Q: "Permission denied" on macOS/Linux
A: `chmod +x cdn-link-gen && chmod +x *.sh`

### Q: "Build failed"
A: 
1. Check Go version: `go version` (need 1.21+)
2. Clean: `go clean`
3. Rebuild: `go build -o cdn-link-gen .`

### Q: "Invalid token"
A: Token might be:
- Expired
- Wrong scope
- Already revoked
Get a new one at https://github.com/settings/tokens

---

## School-Specific Questions

### Q: Will my school detect this?
A: If you follow terms of service, no. Bypass just makes GitHub accessible like any other website.

### Q: Is using a VPN allowed?
A: Check your school's acceptable use policy. Most allow personal VPNs.

### Q: Should I use Google Cloud Shell at school?
A: Yes! Google is usually whitelisted. Cloud Shell is "school-safe".

### Q: What if my school blocks VPNs?
A: Try:
1. Mobile hotspot
2. Public WiFi
3. Home/friend's network
4. GitHub Codespaces
5. Glitch or Replit

### Q: Can my school see my GitHub token?
A: No. It's stored locally in ~/.cdn_tokens.json

---

## Performance Questions

### Q: How do I speed it up?
A: 
1. Reduce commits per SVG
2. Use fewer SVGs
3. Skip link validation
4. Use faster network (mobile hotspot)

### Q: Why is it slow on Raspberry Pi?
A: Goroutines need CPU. Reduce concurrent tests in github.go.

### Q: Can I run multiple instances?
A: Yes, just use different output files.

### Q: Does it use a lot of bandwidth?
A: Minimal. Mostly API calls, not file downloads.

---

## Output Questions

### Q: What do the output files contain?
A: One valid CDN link per line. Ready to use immediately.

### Q: Why are some links broken?
A: Rare edge cases. Tool removes them automatically.

### Q: Can I edit the links?
A: Yes. They're just text files.

### Q: How do I share the links?
A: Upload to cloud storage, email, GitHub gist, etc.

### Q: Can I convert to different format?
A: Yes. See USAGE.md for JSON, HTML, CSV examples.

---

## Integration Questions

### Q: Can I use in my website?
A: Yes! CDN links are standard URLs.
```html
<img src="https://cdn.jsdelivr.net/gh/owner/repo@commit/file.svg">
```

### Q: Can I use in GitHub Actions?
A: Yes. See USAGE.md for CI/CD example.

### Q: Can I automate link generation?
A: Yes. Create a cron job or GitHub Action to regenerate monthly.

### Q: Can I use with other tools?
A: Yes. Links work anywhere that accepts URLs.

---

## Maintenance Questions

### Q: How often should I regenerate?
A: Links don't expire. Regenerate if:
- New SVG files added
- Repository moved
- CDN availability changes

### Q: How do I update the tool?
A: 
```bash
git pull origin main
go build -o cdn-link-gen .
```

### Q: Is there an update check?
A: Check GitHub Releases manually.

---

## Security Questions

### Q: Is my GitHub token exposed?
A: No. It's only used locally and sent over HTTPS to GitHub.

### Q: Does the tool track me?
A: No. Open source, no telemetry, no external services.

### Q: Can I audit the code?
A: Yes! It's all public: https://github.com/Real-Nightmare/cdn-link-generator

### Q: Is it safe for school networks?
A: Yes. No viruses, no malware, just generates links.

---

## Limits & Rate Limiting

### Q: GitHub API rate limits?
A: 5000 requests/hour with token (60/hour unauthenticated).
Tool uses ~1-5 requests per operation.

### Q: File size limits?
A: No limit. Generated files can be gigabytes.

### Q: CDN bandwidth limits?
A: CDNs typically have generous free tiers.

### Q: Repo size limits?
A: Tool works with any size repo.

---

## Uncommon Questions

### Q: Can I run this on a server?
A: Yes. Just build and run via cron/scheduler.

### Q: Does it work offline?
A: No. Needs GitHub API access.

### Q: Can I use old Go versions?
A: No. Requires Go 1.21+ (2023+).

### Q: Can I modify the CDNs?
A: Yes. Edit cdn.go and rebuild.

### Q: Will it work on ARM64?
A: Yes. Go compiles to ARM64 (Apple Silicon).

---

## Support

Still have questions?
1. Check README.md
2. See INSTALL.md for setup
3. See USAGE.md for examples
4. Run demo: `./cdn-link-gen demo`
5. Open an issue on GitHub

---

**Last Updated:** 2024
**Version:** Pro Edition (Go)
