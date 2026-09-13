# COMPLETE USAGE GUIDE

## Master Guide to CDN Link Generation

### Quick Start (2 minutes)

```bash
# Setup
git clone https://github.com/Real-Nightmare/cdn-link-generator.git
cd cdn-link-generator
bash quickstart.sh

# Add token
./cdn-link-gen token add
# Paste your GitHub token

# Generate links
./cdn-link-gen generate owner/repo
# Follow prompts

# View results
cat cdn_links_*.txt | head -20
```

---

## Commands Reference

### Generate CDN Links

```bash
./cdn-link-gen generate <owner/repo> [owner/repo2] [owner/repo3]
```

**Examples:**

```bash
# Single repo
./cdn-link-gen generate torvalds/linux

# Multiple repos (all SVGs will be combined)
./cdn-link-gen generate torvalds/linux microsoft/vscode

# Three repos
./cdn-link-gen generate org/icons org/patterns org/backgrounds
```

**Interactive prompts:**

1. Scans for SVG files (shows progress)
2. Displays found SVGs
3. Shows available CDNs (13 total)
4. Asks for commits per SVG (1-1,000,000)
5. Shows total link count estimate
6. Asks for confirmation
7. Generates links (progress shown)
8. Tests link validity (shows % success)
9. Saves results to files

### Token Management

```bash
# Add a new token
./cdn-link-gen token add
# Paste token when prompted

# List all saved tokens
./cdn-link-gen token list
# Shows: "1. ghp_abc... (40 chars)"

# Remove a token
./cdn-link-gen token remove 1
# Removes token #1

# Clear all tokens
./cdn-link-gen token clear
# Asks for confirmation
```

### Testing & Demo

```bash
# Run demo (no GitHub access needed)
./cdn-link-gen demo
# Shows simulated run with sample data

# Test firewall connectivity
bash test-firewall.sh
# Shows which methods work on your network

# Test with school setup
bash school-safe-setup.sh
# Optimizes for school environment
```

### Help

```bash
# Show all commands
./cdn-link-gen

# View this guide
cat USAGE.md
```

---

## Step-by-Step Workflow

### Step 1: Get a GitHub Token

1. Go to https://github.com/settings/tokens/new
2. Name it: "CDN Link Generator"
3. Select scope: **`repo`** (full control of repositories)
4. Click "Generate token"
5. Copy the token (it won't show again!)

### Step 2: Add Token to Tool

```bash
./cdn-link-gen token add
# Paste your token
# ✓ Token added successfully
```

### Step 3: Prepare Your Repository

Your repository must:
- ✅ Be public (or you have access)
- ✅ Contain .svg files
- ✅ Be on GitHub (github.com)

If private, ensure your token has access.

### Step 4: Run Generator

```bash
./cdn-link-gen generate owner/repo
```

### Step 5: Answer Prompts

```
Scanning repositories for SVG files...

✓ Found SVG files:
  owner/repo: 3 SVG(s)
    • icon.svg
    • logo.svg
    • pattern.svg

✓ Total SVGs found: 3
✓ CDN providers available: 13
✓ Potential links to generate: 39 (with 1 commit per SVG)

Enter number of commits per SVG (1-1000000): 100

✓ Total links to generate: 3,900
⚠ This will create ~195KB of data

Proceed with generation? (y/N): y
```

### Step 6: Wait for Generation

```
⏳ Processing: 3/3 SVGs

✓ Link generation complete!
  Generated: 3,900 links
  
🧪 Testing links for validity...

✓ Valid links: 3,885
✗ Broken links: 15
📊 Success rate: 99.6%

✓ Valid links saved to: cdn_links_2024-01-15_10-30-45.txt
⚠ Broken links saved to: cdn_links_broken_2024-01-15_10-30-45.txt

✓ Done! All files ready in current directory.
💡 Tip: Use 'cat cdn_links_*.txt | head -20' to preview links
```

### Step 7: Use Your Links

```bash
# View first 20 links
cat cdn_links_2024-01-15_10-30-45.txt | head -20

# Count total links
wc -l cdn_links_2024-01-15_10-30-45.txt

# Copy to clipboard (macOS)
cat cdn_links_2024-01-15_10-30-45.txt | pbcopy

# Copy to clipboard (Linux)
cat cdn_links_2024-01-15_10-30-45.txt | xclip -i

# Upload to cloud
gcloud storage cp cdn_links_*.txt gs://my-bucket/
```

---

## Output Files Explained

### `cdn_links_[timestamp].txt`

One working CDN link per line:

```
https://cdn.jsdelivr.net/gh/owner/repo@commit1/icon.svg
https://fastly.jsdelivr.net/gh/owner/repo@commit1/icon.svg
https://gcore.jsdelivr.net/gh/owner/repo@commit1/icon.svg
https://cdn.staticdelivr.com/gh/owner/repo/icon.svg
https://githubraw.com/owner/repo/commit1/icon.svg
https://rawcdn.githack.com/owner/repo/commit1/icon.svg
https://cdn.jsdelivr.net/gh/owner/repo@commit2/icon.svg
...
```

**Use cases:**
- Website hosting
- Image CDN
- Icon libraries
- Asset delivery
- Backup URLs

### `cdn_links_broken_[timestamp].txt`

Links that returned errors (usually very few):

```
https://some-cdn.net/gh/owner/repo@corrupt-commit/icon.svg
https://another-cdn.net/bad-link.svg
```

**Don't use these**, use valid links only.

---

## Advanced Usage

### Multiple Repositories in One Run

```bash
./cdn-link-gen generate \
  owner/icons \
  owner/patterns \
  owner/backgrounds
```

**Result:** Combined output with all repos' SVGs

### Large Commit Counts

```bash
# Generate 100,000 commits per SVG
./cdn-link-gen generate owner/repo
# Enter: 100000
# Result: 1,300,000 links (with 13 CDNs)
```

**Note:** Takes longer but creates massive link backlog

### Processing CSV Data

```bash
# Extract unique CDNs
grep -oP 'https://\K[^/]+' cdn_links_*.txt | sort -u

# Count per CDN
grep -oP 'https://\K[^/]+' cdn_links_*.txt | sort | uniq -c

# Get only Gcore CDN links
grep 'gcore.jsdelivr.net' cdn_links_*.txt > gcore_only.txt

# Random sample (10 links)
shuf -n 10 cdn_links_*.txt
```

### Batch Processing

```bash
#!/bin/bash
# Process multiple repo groups

REPOS=(
  "org1/repo1"
  "org1/repo2"
  "org2/repo1"
  "org2/repo2"
)

for repo in "${REPOS[@]}"; do
  echo "Processing $repo..."
  ./cdn-link-gen generate $repo <<< $'100\ny' # 100 commits, auto-confirm
done

# Combine all results
cat cdn_links_*.txt > all_links.txt
echo "Generated $(wc -l < all_links.txt) total links"
```

### Custom CDN Filtering

```bash
# Only jsDelivr links
grep 'jsdelivr.net' cdn_links_*.txt > jsdelivr_only.txt

# Only GitHub-based (raw, githack)
grep -E '(githubraw|githack)' cdn_links_*.txt > github_only.txt

# Only non-GitHub CDNs
grep -v -E '(github|githack)' cdn_links_*.txt > third_party_only.txt
```

### Upload to Cloud Storage

```bash
# Google Cloud Storage
gsutil cp cdn_links_*.txt gs://my-bucket/cdn-links/
gsutil acl ch -u AllUsers:R gs://my-bucket/cdn-links/*

# AWS S3
aws s3 cp cdn_links_*.txt s3://my-bucket/cdn-links/
aws s3api put-object-acl --bucket my-bucket --key cdn-links/ --acl public-read

# Azure Blob
az storage blob upload \
  --container-name cdn-links \
  --file cdn_links_*.txt \
  --account-name mystorageaccount
```

### Create Manifest File

```bash
# Create JSON manifest
cat > manifest.json << 'EOF'
{
  "generated_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "repository": "owner/repo",
  "total_links": $(wc -l < cdn_links_*.txt),
  "cdn_count": 13,
  "file": "cdn_links_$(basename cdn_links_*.txt)",
  "broken_count": $(wc -l < cdn_links_broken_*.txt 2>/dev/null || echo 0)
}
EOF

echo "Created manifest.json"
```

---

## Performance Tuning

### For Speed

```bash
# Reduce commits per SVG
./cdn-link-gen generate owner/repo
# Enter: 10 (fast)

# Skip link testing
# Edit github.go, comment out testLinksParallel call
go build -o cdn-link-gen .
```

### For Reliability

```bash
# Increase commits per SVG
./cdn-link-gen generate owner/repo
# Enter: 10000 (more redundancy)

# More thorough testing
# Edit github.go:
# testLinksParallel(allLinks, 50)  # Increase from 20
go build -o cdn-link-gen .
```

### For Storage

```bash
# Smaller output
./cdn-link-gen generate owner/repo
# Enter: 1 (minimal)

# Compress results
gzip cdn_links_*.txt
# Result: 80% size reduction
```

---

## Troubleshooting

### "No tokens found"

```bash
./cdn-link-gen token add
# Add your GitHub token
```

### "Repo not found"

```bash
# Check repo exists and is accessible
# Format should be: owner/repo (lowercase preferred)
# Example: Real-Nightmare/cdn-link-generator
```

### "No SVG files found"

```bash
# Repo must have .svg files (lowercase extension)
# Check files in repo are .svg not .SVG
# Or repo might be completely empty
```

### "Network timeout"

```bash
# Try again (GitHub API might be slow)
# Or use VPN/alternative connection
./cdn-link-gen test-firewall
```

### "Permission denied"

```bash
chmod +x cdn-link-gen
chmod +x *.sh
```

### "Build failed"

```bash
# Clean build
go clean
go build -o cdn-link-gen .

# Or use pre-built binary from releases
```

---

## Tips & Tricks

### 1. Parallel Generation

Generate for multiple repos simultaneously:

```bash
for repo in repo1 repo2 repo3; do
  (./cdn-link-gen generate org/$repo &)
done
wait
```

### 2. Automatic Retry

```bash
#!/bin/bash
for i in {1..3}; do
  ./cdn-link-gen generate owner/repo && break
  sleep 5
done
```

### 3. Monitor Progress

```bash
# In one terminal
./cdn-link-gen generate owner/repo

# In another
watch 'wc -l cdn_links_*.txt'
```

### 4. Format Output

```bash
# Markdown list
cat cdn_links_*.txt | sed 's/^/- [CDN](/' | sed 's/$/)/' > output.md

# HTML list
cat cdn_links_*.txt | sed 's/^/<li><a href="/' | sed 's/$/">Link<\/a><\/li>/' > output.html

# JSON array
echo '[' > output.json
cat cdn_links_*.txt | sed 's/^/"/' | sed 's/$/",/' | head -n -1 >> output.json
echo '"LAST_LINK"]' >> output.json
```

### 5. Verify Links Locally

```bash
# Check first 10 links
head -10 cdn_links_*.txt | while read link; do
  echo -n "Testing $link... "
  curl -sI "$link" | head -1
done
```

---

## Integration Examples

### Use in Website

```html
<!-- Load SVG from CDN -->
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

### CI/CD Integration

```yaml
# GitHub Actions
name: Generate CDN Links
on: [push]
jobs:
  generate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-go@v2
      - run: go build -o cdn-link-gen .
      - run: ./cdn-link-gen generate owner/repo
      - uses: actions/upload-artifact@v2
        with:
          name: cdn-links
          path: cdn_links_*.txt
```

---

## Best Practices

✅ **DO:**
- Use public repositories
- Store tokens securely
- Test links before using
- Keep backups of link lists
- Use multiple CDNs for redundancy
- Monitor link expiration

❌ **DON'T:**
- Share your GitHub token
- Use broken links
- Overload single CDN
- Store tokens in code
- Forget to test connectivity
- Ignore firewall warnings

---

## Getting Help

1. Run demo: `./cdn-link-gen demo`
2. Test setup: `bash test-firewall.sh`
3. Check tokens: `./cdn-link-gen token list`
4. Read README: `cat README.md`
5. View logs: Check terminal output

---

## Next Steps

1. ✅ Setup (INSTALL.md)
2. ✅ Add token
3. ✅ Try demo
4. ✅ Generate your first links
5. ✅ Integrate into your workflow

**Happy generating! 🚀**
