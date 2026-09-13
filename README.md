# CDN Link Generator Pro (Go Edition)

🚀 **Lightning-fast**, **multi-SVG**, **multi-CDN** link generator. Point it at any GitHub repository, and it turns every SVG into ready-to-use CDN links across 13 providers — automatically, in seconds.

## Features

✨ **High Performance**
- Written in Go for blazing-fast execution
- Concurrent SVG scanning, link generation, and validation (goroutines)
- **Zero runtime dependencies** — a single static binary, stdlib only

🎯 **Multi-Repository Support**
- Generate links for multiple repos in one run
- Recursive SVG discovery across entire repo trees (one API call per repo)
- Per-repo error isolation — one bad repo never stops the rest

📊 **Multi-CDN Support (13 providers)**
- jsDelivr: Primary, Fastly, Gcore, Testing CF, Quantil, Origin Fastly, CN, Mirror
- StaticDelivr
- GitHub Raw alternatives: githubraw.com, Githack (raw + CDN)
- Filter with `-cdns 1,3,githack` — mix IDs, names, or domains

✅ **Automatic Link Validation**
- Tests every generated link with bounded concurrency
- HEAD requests (GET fallback), HTTP status checking
- Order-preserving, progress-tracked
- Outputs:
  - `cdn_links_<timestamp>.txt` — all generated links
  - `cdn_links_<timestamp>_valid.txt` — valid links
  - `cdn_links_<timestamp>_broken.txt` — broken links (if any)

🤖 **Automatic Mode**
- One command, zero prompts: `cdn-link-gen generate owner/repo -y`
- Flags for commits, CDNs, output file, format (txt/csv), concurrency
- Works with `GITHUB_TOKEN` env var or stored tokens — or even unauthenticated for public repos

💾 **Secure Token Management**
- Up to 10 GitHub tokens
- Hidden input when adding (no shoulder surfing)
- Stored in `~/.cdn_tokens.json` with `0600` permissions
- `token verify` checks validity and shows your API rate limit

## Installation

### One-Command Install

```bash
curl -fsSL https://raw.githubusercontent.com/Real-Nightmare/cdn-link-generator/main/install.sh | sh
```

The installer finds or installs Go automatically (linux/macOS, amd64/arm64/arm), builds the binary, and installs it to your PATH.

### Google Cloud Shell

```bash
git clone https://github.com/Real-Nightmare/cdn-link-generator.git
cd cdn-link-generator
./install.sh
```

### Build from Source

```bash
# Prerequisite: Go 1.18+ (no go.sum needed — zero third-party deps)
git clone https://github.com/Real-Nightmare/cdn-link-generator.git
cd cdn-link-generator
go build -o cdn-link-gen .
```

Or with make: `make install`

### Docker

```bash
docker build -t cdn-link-gen .
docker run --rm -it -e GITHUB_TOKEN=ghp_xxx cdn-link-gen generate owner/repo -y
```

### Windows

```cmd
git clone https://github.com/Real-Nightmare/cdn-link-generator.git
cd cdn-link-generator
go build -o cdn-link-gen.exe .
cdn-link-gen.exe generate owner/repo -y
```

### Raspberry Pi / ARM

```bash
go build -o cdn-link-gen .   # Go builds natively for armv6/arm64
```

Cross-compile everything with `make cross-compile` (outputs to `dist/`).

## Quick Start

```bash
# 1. Add a token (recommended — 5000 req/hour vs 60 unauthenticated)
cdn-link-gen token add
# or: export GITHUB_TOKEN=ghp_yourtoken

# 2. Generate links — fully automatic
cdn-link-gen generate owner/repo -y

# 3. Use your links
head -20 cdn_links_*.txt
```

> Works without a token too (public repos, 60 requests/hour) — the tool warns you and continues.

## Usage

### Generate Links

```bash
# Interactive (asks for confirmation)
cdn-link-gen generate owner/repo

# Fully automatic — no prompts
cdn-link-gen generate owner/repo -y

# Multiple repos
cdn-link-gen generate owner/repo1 owner/repo2 owner/repo3

# Tune everything
cdn-link-gen generate owner/repo -y -commits 50 -cdns 1,2,3 -format csv -out links.csv

# Fastest possible (skip validation)
cdn-link-gen generate owner/repo -y -no-validate
```

**Flags:**

| Flag | Description |
|------|-------------|
| `-commits N` | Commits per SVG (default: all found commits) |
| `-cdns list` | Comma-separated CDN ids/names/domains |
| `-out file` | Output file path |
| `-format txt\|csv` | Output format |
| `-no-validate` | Skip link validation (fastest) |
| `-y` | Skip confirmation prompt (automatic mode) |
| `-c N` | Concurrent validation workers (default: 20) |
| `-make-commits` | Create new commits in a repo you own, then generate links |

### Token Management

```bash
cdn-link-gen token add        # hidden input, stored with 0600 perms
cdn-link-gen token list       # masked preview
cdn-link-gen token verify     # validity + rate limit
cdn-link-gen token remove 1
cdn-link-gen token clear
```

**Get a token:** https://github.com/settings/tokens (scope: `repo` for private repos; no scope needed for public).

### Other Commands

```bash
cdn-link-gen cdns      # list the 13 CDN providers
cdn-link-gen demo      # simulated run, no GitHub access
cdn-link-gen version
cdn-link-gen --help
```

## Workflow Example

```bash
$ cdn-link-gen generate yourname/svg-repo -y

✓ Found SVG files:
  yourname/svg-repo: 3 SVG(s)
    • logo.svg
    • icon.svg
    • pattern.svg

✓ Total SVGs: 3
✓ CDN providers: 13
✓ Rate limit: 4987/5000 requests remaining
✓ Unique commits found: 42
✓ Total links to generate: 5,460
✓ Estimated output size: 426.5 KB

📝 Generating links...
⏳ Processing: 3/3 SVGs

✓ Link generation complete!
  Generated: 5,460 links
✓ Links saved to: cdn_links_2025-01-15_10-30-45.txt

🧪 Testing links for validity...
🧪 Testing: 5460/5460 links

✓ Valid links: 5,452
✗ Broken links: 8
📊 Success rate: 99.9%
✓ Valid links saved to: cdn_links_2025-01-15_10-30-45_valid.txt
⚠ Broken links saved to: cdn_links_2025-01-15_10-30-45_broken.txt
```

## Output Files

### `cdn_links_<timestamp>.txt`

One CDN link per line:

```
https://cdn.jsdelivr.net/gh/owner/repo@<commit>/logo.svg
https://fastly.jsdelivr.net/gh/owner/repo@<commit>/logo.svg
https://gcore.jsdelivr.net/gh/owner/repo@<commit>/logo.svg
https://cdn.staticdelivr.com/gh/owner/repo/logo.svg
https://githubraw.com/owner/repo/<commit>/logo.svg
https://rawcdn.githack.com/owner/repo/<commit>/logo.svg
...
```

### `_valid.txt` / `_broken.txt`

Validation splits results so you can grab the working links directly.

## Performance

| Operation | Duration | Notes |
|-----------|----------|-------|
| Scan 10 SVGs (recursive) | ~1-2s | One Trees API call per repo |
| Generate 1000 links | ~0.05s | Memory only |
| Generate 100k links | ~0.5s | Memory only |
| Test 1000 links | ~5-10s | 20 concurrent workers |
| Binary startup | ~5ms | Static binary, no deps |

**Why Go?**
- Goroutines handle thousands of concurrent validations
- Single static binary — no interpreter, no runtime deps
- Stdlib-only: builds instantly, even offline

## Configuration

### Adjusting Validation Concurrency

Use `-c N` (default 20):
```bash
cdn-link-gen generate owner/repo -y -c 50   # faster, more load
cdn-link-gen generate owner/repo -y -c 5    # gentler on slow networks
```

### Custom CDN List

Edit `cdn.go` and add entries to `cdnProviders`, or select at runtime with `-cdns`.

## Troubleshooting

### "No tokens found"
Run `cdn-link-gen token add`, or `export GITHUB_TOKEN=...`, or continue unauthenticated for public repos.

### "Repo not found or no access"
- Check the name format: `owner/repo`
- Public repo + no token + rate-limited? Wait an hour or add a token
- Private repo? Your token needs `repo` scope

### "No SVG files found"
- The repo has no `.svg` files (scan is recursive — check subfolders exist on the default branch)
- Try another repository

### "Network error"
The client retries transient failures automatically. Check your internet connection and GitHub API status.

### "GitHub API rate limit exceeded"
Add a token (`token add`) — authenticated requests get 5000/hour vs 60/hour.

## API Rate Limiting

- GitHub API: 60 requests/hour (unauthenticated), 5000/hour (authenticated)
- Each repo costs ~2 requests (tree scan + commit listing) regardless of SVG count
- Check usage any time: `cdn-link-gen token verify`

## Security

- Tokens stored in `~/.cdn_tokens.json` with `0600` permissions
- Hidden input when typing tokens
- No tokens sent anywhere except `api.github.com` over HTTPS
- Links tested with HEAD requests only (no content download)
- No telemetry, ever

## License

MIT License — see [LICENSE](LICENSE).

## Credits

- Based on the original Python version by @arozely
- Rewritten in Go for performance
- Multi-SVG, multi-CDN, and automatic mode

## Support

1. Run `cdn-link-gen demo` to see examples
2. Check [FAQ.md](FAQ.md)
3. Verify your token: `cdn-link-gen token verify`
4. Open a GitHub issue

---

**Lightning Fast** ⚡ | **Zero Dependencies** 📦 | **Production Ready** ✨
