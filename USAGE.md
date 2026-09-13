# COMPLETE USAGE GUIDE

## Master Guide to CDN Link Generation

### Quick Start (2 minutes)

```bash
# Setup (Go 1.18+, zero dependencies)
git clone https://github.com/Real-Nightmare/cdn-link-generator.git
cd cdn-link-generator
./install.sh

# Add token (recommended)
./cdn-link-gen token add

# Generate links — fully automatic
./cdn-link-gen generate owner/repo -y

# View results
head -20 cdn_links_*.txt
```

> No token? It still works for public repos (60 GitHub requests/hour).

---

## Commands Reference

### Generate CDN Links

```bash
./cdn-link-gen generate <owner/repo> [owner/repo2] [owner/repo3] [flags]
```

**Examples:**

```bash
# Interactive (shows findings, asks to confirm)
./cdn-link-gen generate owner/repo

# Fully automatic — no prompts
./cdn-link-gen generate owner/repo -y

# Multiple repos (all SVGs combined)
./cdn-link-gen generate owner/icons owner/patterns -y

# Custom CDNs only (IDs, names, or domains)
./cdn-link-gen generate owner/repo -y -cdns 1,2,3
./cdn-link-gen generate owner/repo -y -cdns githack,staticdelivr

# CSV output
./cdn-link-gen generate owner/repo -y -format csv -out links.csv

# Fastest: skip validation
./cdn-link-gen generate owner/repo -y -no-validate

# Cap commits per SVG
./cdn-link-gen generate owner/repo -y -commits 25
```

**What happens in a run:**

1. Scans each repo recursively for `.svg` files (one Trees API call per repo)
2. Displays found SVGs
3. Fetches the repos' commit history (up to 100 commits per repo)
4. Generates `SVGs × commits × CDNs` links concurrently
5. Saves all links to `cdn_links_<timestamp>.txt`
6. Validates every link in parallel (unless `-no-validate`)
7. Splits results into `_valid.txt` and `_broken.txt`

### Token Management

```bash
# Add a new token (input hidden)
./cdn-link-gen token add

# List saved tokens (masked)
./cdn-link-gen token list

# Verify active token + rate limit
./cdn-link-gen token verify

# Remove a token
./cdn-link-gen token remove 1

# Clear all tokens
./cdn-link-gen token clear
```

Tokens are used in this order: `GITHUB_TOKEN` env → first stored token → unauthenticated.

### Testing & Demo

```bash
# Simulated run (no GitHub access needed)
./cdn-link-gen demo

# List the 13 CDN providers
./cdn-link-gen cdns

# Version
./cdn-link-gen version
```

### Help

```bash
./cdn-link-gen --help
./cdn-link-gen generate -h
```

---

## Step-by-Step Workflow

### Step 1: Get a GitHub Token (optional but recommended)

1. Go to https://github.com/settings/tokens
2. Generate a new token (classic): name it "CDN Link Generator"
3. Select scope: **`repo`** only if you need private repos — public repos need no scope
4. Copy the token (it won't be shown again!)

### Step 2: Add Token to Tool

```bash
./cdn-link-gen token add
# Paste your token (input is hidden)
# ✓ Token added successfully
```

Or use the environment variable (great for CI):

```bash
export GITHUB_TOKEN=ghp_xxxxxxxxxxxx
```

### Step 3: Pick a Repository

Any GitHub repo containing `.svg` files — yours or public ones:

```bash
./cdn-link-gen generate owner/repo -y
```

### Step 4: Read the Output

```
✓ Found SVG files:
  owner/repo: 3 SVG(s)
    • icon.svg
    • logo.svg
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
✓ Valid links: 5,452
✗ Broken links: 8
📊 Success rate: 99.9%
✓ Valid links saved to: cdn_links_2025-01-15_10-30-45_valid.txt
⚠ Broken links saved to: cdn_links_2025-01-15_10-30-45_broken.txt
```

### Step 5: Use Your Links

```bash
# Preview
head -20 cdn_links_2025-01-15_10-30-45_valid.txt

# Count
wc -l cdn_links_*.txt

# Copy to clipboard (macOS)
cat cdn_links_*_valid.txt | pbcopy

# Copy to clipboard (Linux)
cat cdn_links_*_valid.txt | xclip -selection clipboard
```

---

## Output Files Explained

### `cdn_links_<timestamp>.txt`

Every generated link, one per line:

```
https://cdn.jsdelivr.net/gh/owner/repo@<commit1>/icon.svg
https://fastly.jsdelivr.net/gh/owner/repo@<commit1>/icon.svg
https://gcore.jsdelivr.net/gh/owner/repo@<commit1>/icon.svg
https://cdn.staticdelivr.com/gh/owner/repo/icon.svg
https://githubraw.com/owner/repo/<commit1>/icon.svg
https://rawcdn.githack.com/owner/repo/<commit1>/icon.svg
https://cdn.jsdelivr.net/gh/owner/repo@<commit2>/icon.svg
...
```

### `cdn_links_<timestamp>_valid.txt`

Only links that passed validation (HTTP 2xx/3xx). **Use these.**

### `cdn_links_<timestamp>_broken.txt`

Links that failed validation. **Don't use these** — kept for transparency.

---

## Advanced Usage

### Multiple Repositories in One Run

```bash
./cdn-link-gen generate \
  owner/icons \
  owner/patterns \
  owner/backgrounds -y
```

Failing repos are reported with `⚠` but never abort the run.

### Create Fresh Commits (repos you own)

```bash
# Creates N new commits in the repo via git fast-import, pushes them,
# then generates links from the new history. Requires a token with repo
# write access and git installed.
./cdn-link-gen generate owner/your-repo -make-commits -commits 100 -y
```

### Processing CSV Data

```bash
# Count links per CDN
grep -oP 'https://\K[^/]+' cdn_links_*.txt | sort | uniq -c

# Get only Gcore links
grep 'gcore.jsdelivr.net' cdn_links_*.txt > gcore_only.txt

# Random sample (10 links)
shuf -n 10 cdn_links_*_valid.txt
```

### Batch Processing

```bash
#!/bin/bash
REPOS=(
  "org1/repo1"
  "org1/repo2"
  "org2/repo1"
)

for repo in "${REPOS[@]}"; do
  echo "Processing $repo..."
  ./cdn-link-gen generate "$repo" -y -no-validate
done

cat cdn_links_*.txt > all_links.txt
echo "Generated $(wc -l < all_links.txt) total links"
```

### Custom CDN Filtering

```bash
# Only jsDelivr links
grep 'jsdelivr.net' cdn_links_*.txt > jsdelivr_only.txt

# Only GitHub-based CDNs
grep -E '(githubraw|githack)' cdn_links_*.txt > github_only.txt

# Only non-GitHub CDNs
grep -v -E '(githubraw|githack)' cdn_links_*.txt > third_party_only.txt
```

### CI/CD Integration

```yaml
# GitHub Actions
name: Generate CDN Links
on:
  workflow_dispatch:
jobs:
  generate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: '1.21'
      - run: go build -o cdn-link-gen .
      - run: ./cdn-link-gen generate owner/repo -y -format csv
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - uses: actions/upload-artifact@v4
        with:
          name: cdn-links
          path: cdn_links_*.csv
```

---

## Performance Tuning

### For Speed

```bash
# Skip validation (validation is the slow part — it touches every CDN)
./cdn-link-gen generate owner/repo -y -no-validate

# Fewer commits per SVG
./cdn-link-gen generate owner/repo -y -commits 10

# Fewer CDNs
./cdn-link-gen generate owner/repo -y -cdns 1,2
```

### For Reliability

```bash
# More commits = more redundancy across CDN versions
./cdn-link-gen generate owner/repo -y -commits 100

# Thorough validation with higher concurrency
./cdn-link-gen generate owner/repo -y -c 50
```

### For Storage

```bash
# Minimal output
./cdn-link-gen generate owner/repo -y -commits 1

# Compress results (~80% smaller)
gzip cdn_links_*.txt
```

---

## Troubleshooting

### "No tokens found"

```bash
./cdn-link-gen token add
# …or just continue unauthenticated for public repos.
```

### "Repo not found"

```bash
# Format: owner/repo (full GitHub URLs also accepted)
./cdn-link-gen generate facebook/react -y
```

### "No SVG files found"

- Repo must contain `.svg` files on the default branch
- Scan is recursive and case-insensitive (`logo.SVG` counts too)

### "Network timeout"

The HTTP client retries transient failures 3× automatically. For persistent issues check https://www.githubstatus.com/

### "Permission denied"

```bash
chmod +x cdn-link-gen
```

### "Build failed"

```bash
go clean
go build -o cdn-link-gen .
```

---

## Tips & Tricks

### 1. Parallel Generation

Generate for multiple repos simultaneously (separate output files):

```bash
for repo in repo1 repo2 repo3; do
  (./cdn-link-gen generate org/$repo -y -out links_$repo.txt -no-validate &)
done
wait
```

### 2. Automatic Retry Wrapper

```bash
#!/bin/bash
for i in 1 2 3; do
  ./cdn-link-gen generate owner/repo -y && break
  sleep 5
done
```

### 3. Verify Links Locally

```bash
head -10 cdn_links_*_valid.txt | while read link; do
  echo -n "Testing $link... "
  curl -sI "$link" | head -1
done
```

---

## Integration Examples

### Use in Website

```html
<img src="https://cdn.jsdelivr.net/gh/owner/repo@commit/icon.svg" alt="Icon">
```

### Use in CSS

```css
.icon {
  background-image: url('https://cdn.jsdelivr.net/gh/owner/repo@commit/icon.svg');
}
```

### Use in JavaScript

```javascript
const cdnLink = 'https://cdn.jsdelivr.net/gh/owner/repo@commit/icon.svg';
const img = new Image();
img.src = cdnLink;
document.body.appendChild(img);
```

---

## Best Practices

✅ **DO:**
- Use a token (5000 req/hour vs 60)
- Keep backups of valid-link files
- Use multiple CDNs for redundancy
- Re-run validation before relying on old lists

❌ **DON'T:**
- Share your GitHub token
- Commit tokens to repos
- Use broken links in production
- Hammer validation with `-c 500` — you'll just rate-limit yourself

---

## Getting Help

1. `./cdn-link-gen demo` — simulated run
2. `./cdn-link-gen cdns` — provider list
3. `./cdn-link-gen token verify` — token health
4. Read [README.md](README.md) and [FAQ.md](FAQ.md)

---

## Next Steps

1. ✅ Setup ([INSTALL.md](INSTALL.md))
2. ✅ Add token
3. ✅ Try demo
4. ✅ Generate your first links
5. ✅ Integrate into your workflow

**Happy generating! 🚀**
