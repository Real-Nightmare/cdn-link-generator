# FREQUENTLY ASKED QUESTIONS

## General Questions

### Q: What does this tool do?
A: It takes any GitHub repository, finds every `.svg` file in it (recursively), and generates CDN links for each file across 13 CDN providers — using the repo's real commit history. It then validates the links so you know which ones work.

### Q: Is this tool legal?
A: Yes. It's a legitimate CDN link generator using public GitHub APIs — the same way jsDelivr and Githack work.

### Q: Do I need special permissions?
A: Just a GitHub account (free) and optionally a personal access token. No admin rights needed.

### Q: Is it free?
A: Completely free. Open source (MIT), no ads, no hidden fees.

### Q: What's the difference from the Python version?
A: This Go version is much faster, uses less memory, and ships as a single zero-dependency binary.

---

## Setup Questions

### Q: Do I need to install anything?
A: Go 1.18+ (only to build). The installer (`install.sh`) handles this automatically. The built binary has zero dependencies.

### Q: Can I use Google Cloud Shell?
A: Yes! Go and Git are pre-installed there. Clone, run `./install.sh`, done.

### Q: Can I use this on Windows?
A: Yes. Native Go build, WSL2, or the pre-built `.exe` from `make cross-compile`.

### Q: Can I use Docker?
A: Yes. `docker build -t cdn-link-gen . && docker run --rm -it -e GITHUB_TOKEN=ghp_xxx cdn-link-gen generate owner/repo -y`

---

## Token Questions

### Q: Where do I get a GitHub token?
A: https://github.com/settings/tokens — classic tokens work fine. For public repos no scope is needed; add `repo` scope only for private repos.

### Q: Do I even need a token?
A: Not strictly — public repos work unauthenticated at 60 GitHub requests/hour. With a token you get 5000/hour and private repo access.

### Q: Can I use my main GitHub password?
A: No. GitHub requires Personal Access Tokens (or fine-grained tokens `github_pat_…`).

### Q: Are my tokens safe?
A: Yes. Stored in `~/.cdn_tokens.json` with `0600` permissions (only your user can read), and input is hidden when you type them.

### Q: How does the tool pick which token to use?
A: `GITHUB_TOKEN` env var first, then the first stored token, then unauthenticated.

### Q: What if I lose my token?
A: Delete it and create a new one. Never share your token.

---

## Usage Questions

### Q: How many links can I generate?
A: Limited by real commit history: SVGs × commits × CDNs = total links. A repo with 3 SVGs, 42 commits, and all 13 CDNs = 1,638 links. Use `-commits N` to cap it.

### Q: How long does it take?
A: Scanning and generation are nearly instant (concurrent). Validation is the slow part — roughly 5-10 seconds per 1000 links at the default concurrency of 20. Skip it with `-no-validate`.

### Q: Will broken links affect my site?
A: No. The tool tests and separates them into `_broken.txt`; use the `_valid.txt` file.

### Q: Can I use other people's repos?
A: Yes, if they're public. Private repos need a token with access.

### Q: How do I skip the confirmation prompt?
A: Add `-y` — that's the fully automatic mode.

---

## Technical Questions

### Q: Why Go instead of Python?
A: Performance and deployment. Goroutines handle thousands of concurrent validations, and the result is a single static binary with zero dependencies.

### Q: What are the system requirements?
A: Minimal. ~15MB disk for the binary, ~20MB RAM at work, any OS (Linux/macOS/Windows/ARM).

### Q: Is it secure?
A: Yes. No malware, no tracking, no telemetry, open source. Tokens only ever go to `api.github.com` over HTTPS.

### Q: Does it work offline?
A: No. It needs the GitHub API to scan repos and fetch commits.

### Q: Can I modify the source?
A: Yes! It's MIT-licensed. Fork and customize as needed.

---

## CDN Questions

### Q: Why 13 CDNs?
A: Redundancy. If one CDN is slow or blocked for your users, others work.

### Q: Which CDN is fastest?
A: Depends on location:
- jsDelivr (Primary): Worldwide
- jsDelivr (Gcore): Europe/Asia
- StaticDelivr: Americas

### Q: Do these links expire?
A: Commit-pinned links are permanent as long as the repo exists. StaticDelivr's unversioned URLs always serve the latest version.

### Q: Can I use these links commercially?
A: Yes, as long as you have the rights to the underlying content.

### Q: Can I add my own CDN?
A: Yes — edit `cdn.go`, add an entry to `cdnProviders` with the right URL format, rebuild.

---

## Error Handling

### Q: "Repo not found or no access" — what do I do?
A: 1. Check the format is `owner/repo`
2. Public repo + no token? You may be rate-limited — wait or add a token
3. Private repo? Your token needs `repo` scope

### Q: "No SVG files found"
A: The repo has no `.svg` files on its default branch. The scan is recursive and case-insensitive, so subfolders and `.SVG` extensions are covered.

### Q: "Permission denied" on macOS/Linux
A: `chmod +x cdn-link-gen`

### Q: "Build failed"
A: 1. Check Go version: `go version` (need 1.18+)
2. Clean: `go clean`
3. Rebuild: `go build -o cdn-link-gen .`

### Q: "Invalid token"
A: Token might be expired, revoked, or lacking scope. Run `cdn-link-gen token verify`, then get a new one at https://github.com/settings/tokens

### Q: "GitHub API rate limit exceeded"
A: Add a token (`cdn-link-gen token add`) or `export GITHUB_TOKEN=…`. Check remaining quota with `cdn-link-gen token verify`.

---

## Performance Questions

### Q: How do I speed it up?
A: 1. Skip validation: `-no-validate`
2. Fewer commits: `-commits 10`
3. Fewer CDNs: `-cdns 1,2,3`

### Q: Can I run multiple instances?
A: Yes — use `-out` to give each run its own output file.

### Q: Does it use a lot of bandwidth?
A: Minimal. API calls plus a HEAD request per validated link — no file downloads.

---

## Output Questions

### Q: What do the output files contain?
A: One CDN link per line. `_valid.txt` has only links that passed validation; `_broken.txt` has the rest.

### Q: Can I get CSV instead?
A: Yes: `-format csv -out links.csv` (or any `-out` ending in `.csv`).

### Q: Why are some links broken?
A: Occasionally a CDN edge hasn't cached a fresh commit yet, or a provider rejects certain paths. The tool removes them automatically.

### Q: How do I share the links?
A: Upload the txt/csv anywhere — cloud storage, gists, email.

---

## Integration Questions

### Q: Can I use these in my website?
A: Yes! They're standard URLs:
```html
<img src="https://cdn.jsdelivr.net/gh/owner/repo@commit/file.svg">
```

### Q: Can I use in GitHub Actions?
A: Yes — see the CI/CD example in USAGE.md. Use `secrets.GITHUB_TOKEN` or a PAT secret.

### Q: Can I automate link generation?
A: Yes. `-y` makes runs fully non-interactive, so cron jobs and CI pipelines "just work".

---

## Maintenance Questions

### Q: How often should I regenerate?
A: Commit-pinned links never expire, but regenerate when you add new SVGs or want more versions covered.

### Q: How do I update the tool?
A:
```bash
git pull origin main
go build -o cdn-link-gen .
```

---

## Security Questions

### Q: Is my GitHub token exposed?
A: No. It's stored locally (`0600`), typed with hidden input, and only sent over HTTPS to GitHub.

### Q: Does the tool track me?
A: No. Open source, no telemetry, no external services.

### Q: Can I audit the code?
A: Yes! It's all public: https://github.com/Real-Nightmare/cdn-link-generator

---

## Limits & Rate Limiting

### Q: GitHub API rate limits?
A: 5000 requests/hour with a token, 60/hour without. Each repo costs ~2 requests (tree scan + commit list) regardless of SVG count.

### Q: File size limits?
A: No practical limit — output is streamed to disk in bulk.

### Q: Repo size limits?
A: The tool works with any repo; huge trees may be flagged as truncated by GitHub, and the tool warns you when that happens.

---

## Uncommon Questions

### Q: Can I run this on a server?
A: Yes. Build once, run via cron/scheduler with `-y`.

### Q: Will it work on ARM64?
A: Yes — including Apple Silicon and Raspberry Pi (Go cross-compiles natively).

### Q: What is -make-commits?
A: An optional feature for repos you own: it creates N real commits via `git fast-import`, pushes them, and then generates links from the new history. Requires a token with write access and git installed. Plain `generate` never writes to anyone's repo.

---

## Support

Still have questions?
1. Check [README.md](README.md)
2. See [INSTALL.md](INSTALL.md) for setup
3. See [USAGE.md](USAGE.md) for examples
4. Run `./cdn-link-gen demo`
5. Open an issue on GitHub

---

**Last Updated:** 2025
**Version:** 2.0 (Go)
