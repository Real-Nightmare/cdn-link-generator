# INSTALLATION & SETUP GUIDE

## Complete Setup Instructions for All Environments

### Table of Contents
1. [Quick Setup (Google Cloud Shell)](#quick-setup-google-cloud-shell)
2. [Local Machine Setup](#local-machine-setup)
3. [School/Corporate Firewall Bypass](#schoolcorporate-firewall-bypass)
4. [Docker Setup](#docker-setup)
5. [Troubleshooting](#troubleshooting)

---

## Quick Setup (Google Cloud Shell)

### Method 1: One-Command Setup

```bash
curl -fsSL https://raw.githubusercontent.com/Real-Nightmare/cdn-link-generator/main/quickstart.sh | bash
```

### Method 2: Manual Setup (Step by Step)

```bash
# Clone repository
git clone https://github.com/Real-Nightmare/cdn-link-generator.git
cd cdn-link-generator

# Build
bash build.sh

# Test it works
./cdn-link-gen demo

# Add your GitHub token
./cdn-link-gen token add

# Generate links!
./cdn-link-gen generate owner/repo
```

### Google Cloud Shell Features

✅ **Pre-installed:**
- Go 1.21+
- Git
- curl/wget
- Persistent home directory

✅ **Free tier includes:**
- 50 hours/week computing
- 5GB cloud storage
- GitHub integration
- No firewall blocks (usually)

⚡ **Speed:** Link generation is 50-100x faster than Python version

---

## Local Machine Setup

### Windows 10/11

#### Option 1: WSL2 (Windows Subsystem for Linux)

```powershell
# In PowerShell as Admin:
wsl --install -d Ubuntu

# Then in WSL Ubuntu terminal:
wget https://go.dev/dl/go1.21.0.linux-amd64.tar.gz
tar -C /usr/local -xzf go1.21.0.linux-amd64.tar.gz
export PATH=$PATH:/usr/local/go/bin

git clone https://github.com/Real-Nightmare/cdn-link-generator.git
cd cdn-link-generator
go build -o cdn-link-gen .
./cdn-link-gen generate owner/repo
```

#### Option 2: Native Windows

```cmd
REM Download Go from https://go.dev/dl/go1.21.0.windows-amd64.msi
REM Install it

REM Then in Command Prompt:
git clone https://github.com/Real-Nightmare/cdn-link-generator.git
cd cdn-link-generator
go build -o cdn-link-gen.exe .
cdn-link-gen.exe generate owner/repo
```

#### Option 3: Pre-built Binary

```powershell
# Download from releases
# Run directly - no dependencies needed
.\cdn-link-gen.exe generate owner/repo
```

### macOS

```bash
# Using Homebrew
brew install go git

# Clone and build
git clone https://github.com/Real-Nightmare/cdn-link-generator.git
cd cdn-link-generator
go build -o cdn-link-gen .

# Make it executable
chmod +x cdn-link-gen

# Optional: Add to PATH
sudo mv cdn-link-gen /usr/local/bin/

# Use anywhere
cdn-link-gen generate owner/repo
```

### Linux (Ubuntu/Debian)

```bash
# Install Go
sudo apt-get update
sudo apt-get install -y golang-go git

# Clone and build
git clone https://github.com/Real-Nightmare/cdn-link-generator.git
cd cdn-link-generator
go build -o cdn-link-gen .

# Add to PATH
sudo mv cdn-link-gen /usr/local/bin/

# Use anywhere
cdn-link-gen generate owner/repo
```

### Raspberry Pi / ARM Devices

```bash
# Install Go for ARM
wget https://go.dev/dl/go1.21.0.linux-armv6l.tar.gz
sudo tar -C /usr/local -xzf go1.21.0.linux-armv6l.tar.gz
export PATH=$PATH:/usr/local/go/bin

# Clone and build
git clone https://github.com/Real-Nightmare/cdn-link-generator.git
cd cdn-link-generator
GO111MODULE=on go build -o cdn-link-gen .
./cdn-link-gen generate owner/repo
```

---

## School/Corporate Firewall Bypass

### Understanding School Firewalls

Schools typically block:
- GitHub API endpoints
- Direct file downloads
- VPN protocols
- Proxy services

BUT they often allow:
- HTTP/HTTPS through whitelisted domains
- DNS over HTTPS (DoH)
- Academic resources
- Cloud Shell services (Google Cloud)

### ✅ Bypass Method 1: Google Cloud Shell (RECOMMENDED)

**Why it works:** Schools typically whitelist Google services, and Cloud Shell runs on Google's servers.

```bash
# 1. Go to https://cloud.google.com/shell (free, requires Google account)
# 2. Click "Activate Cloud Shell"
# 3. Run:
git clone https://github.com/Real-Nightmare/cdn-link-generator.git
cd cdn-link-generator
bash quickstart.sh
./cdn-link-gen generate owner/repo
```

**Advantages:**
- ✅ Works in most schools (Google is whitelisted)
- ✅ No installation needed
- ✅ Free 50 hours/week
- ✅ Persistent storage
- ✅ Fast internet

### ✅ Bypass Method 2: VPN Services

#### Free VPNs

**Proton VPN (Free)**
```bash
# Download: https://protonvpn.com
# - Free tier available
# - 1 simultaneous connection
# - Works in most countries
# - No logs kept

# After connecting to VPN:
./cdn-link-gen generate owner/repo
```

**Windscribe (Free)**
```bash
# Download: https://windscribe.com
# - Free 10 GB/month
# - Works well for this use case
# - Good performance

# After connecting:
./cdn-link-gen generate owner/repo
```

**ExpressVPN Trial**
```bash
# 30-day money-back guarantee
# https://expressvpn.com
# Highest quality/speed
```

**TunnelBear (Free)**
```bash
# Download: https://www.tunnelbear.com
# - Free 500 MB/month
# - Very user-friendly
# - Fast for this task
```

### ✅ Bypass Method 3: Mobile Hotspot

```bash
# Turn on your phone's hotspot
# Connect school computer to it
# School WiFi firewall doesn't apply
./cdn-link-gen generate owner/repo
```

### ✅ Bypass Method 4: SSH Tunneling

**If you have a home server or cloud VM:**

```bash
# On school computer:
ssh -D 9050 user@your-server.com

# In another terminal:
export ALL_PROXY=socks5://127.0.0.1:9050
./cdn-link-gen generate owner/repo
```

### ✅ Bypass Method 5: Public WiFi

- Coffee shops (Starbucks, local cafe)
- Libraries
- Parks with public WiFi
- Friend's house
- Fast food restaurants

Public WiFi usually has fewer restrictions.

### ✅ Bypass Method 6: Tor Network

```bash
# Download Tor Browser: https://www.torproject.org
# Start Tor Browser
# Configure socks proxy on port 9050

export ALL_PROXY=socks5://127.0.0.1:9050
./cdn-link-gen test-firewall
./cdn-link-gen generate owner/repo
```

### ✅ Bypass Method 7: Automatic Proxy Fallback

**The tool automatically tries multiple routes:**

```
1. Direct GitHub API (if allowed)
2. CORS proxies (cors-anywhere.herokuapp.com)
3. Alternative proxies (api.allorigins.win)
4. Freeboard proxy (thingproxy.freeboard.io)
```

Just run normally:
```bash
./cdn-link-gen generate owner/repo
```

If direct connection is blocked, it will try alternatives automatically.

### ✅ Bypass Method 8: Docker Containerization

```bash
# Run in Docker (containerized environment)
docker build -t cdn-gen .
docker run -it cdn-gen generate owner/repo

# Some school filters don't block Docker
```

### ✅ Bypass Method 9: Cloud Services

**GitHub Codespaces** (Free tier included with GitHub account)

```bash
# Go to https://github.com/Real-Nightmare/cdn-link-generator
# Click "Code" → "Codespaces" → "Create codespace on main"
# In terminal:
bash quickstart.sh
./cdn-link-gen generate owner/repo
```

**Glitch** (Free web development environment)

```bash
# Go to https://glitch.com
# Create new project
# Terminal:
git clone https://github.com/Real-Nightmare/cdn-link-generator.git
cd cdn-link-generator
go build -o cdn-link-gen .
./cdn-link-gen generate owner/repo
```

**Replit** (Free cloud IDE)

```bash
# Go to https://replit.com
# Create new Repl (select Shell)
# Run:
git clone https://github.com/Real-Nightmare/cdn-link-generator.git
cd cdn-link-generator
go build -o cdn-link-gen .
./cdn-link-gen generate owner/repo
```

### Firewall Test

Test which bypass method works:

```bash
bash test-firewall.sh
```

Output will show:
- ✅ What's accessible
- ✅ What works as fallback
- ✅ Best method for your network

---

## Docker Setup

### Build Docker Image

```bash
git clone https://github.com/Real-Nightmare/cdn-link-generator.git
cd cdn-link-generator
docker build -t cdn-link-gen .
```

### Run Container

```bash
# Interactive mode
docker run -it cdn-link-gen generate owner/repo

# With token persistence
docker run -it -v ~/.cdn_tokens:/root/.cdn_tokens cdn-link-gen generate owner/repo

# Multiple repos
docker run -it cdn-link-gen generate owner/repo1 owner/repo2 owner/repo3

# Demo mode
docker run -it cdn-link-gen demo
```

### Docker Compose

```yaml
version: '3'
services:
  cdn-generator:
    build: .
    environment:
      - GITHUB_TOKEN=${GITHUB_TOKEN}
    volumes:
      - ./output:/workspace
    stdin_open: true
    tty: true
```

```bash
docker-compose up
```

---

## Troubleshooting

### "command not found: go"

```bash
# Install Go
# macOS: brew install go
# Ubuntu: sudo apt-get install golang-go
# Windows: Download from https://go.dev/dl

# Verify installation
go version
```

### "Go version too old"

```bash
# Download Go 1.21+
wget https://go.dev/dl/go1.21.0.linux-amd64.tar.gz
sudo rm -rf /usr/local/go
sudo tar -C /usr/local -xzf go1.21.0.linux-amd64.tar.gz
```

### "Git not found"

```bash
# Install Git
# macOS: brew install git
# Ubuntu: sudo apt-get install git
# Windows: https://git-scm.com/download/win
```

### "Permission denied"

```bash
chmod +x cdn-link-gen
chmod +x build.sh
chmod +x quickstart.sh
chmod +x test-firewall.sh
```

### "Port already in use" (for local proxy)

```bash
# Change port in proxy.go or use different port
# Or kill the process:
lsof -i :9050
kill -9 <PID>
```

### "Network unreachable"

```bash
# Check firewall
bash test-firewall.sh

# Try VPN or alternative method
# See "School/Corporate Firewall Bypass" section
```

### "Token authentication failed"

```bash
# Verify token:
./cdn-link-gen token list

# Token format should be: ghp_xxxxx...
# Get new token: https://github.com/settings/tokens/new
```

### "No SVG files found"

```bash
# Check repo has SVG files
# Repo must be public or you must have access
# SVG files must have .svg extension (lowercase)

# Try:
./cdn-link-gen generate facebook/react  # Has files
```

### Build fails on ARM/Raspberry Pi

```bash
# Use ARM-specific Go version
wget https://go.dev/dl/go1.21.0.linux-armv6l.tar.gz
# Or armv7l for newer Pi

# Then build
GO111MODULE=on go build -o cdn-link-gen .
```

### Can't access GitHub from school

```bash
# See "School/Corporate Firewall Bypass" section
# Recommended: Use Google Cloud Shell or VPN

# Quick test:
bash test-firewall.sh
```

---

## Performance Tips

### For Large Repos (1000+ SVGs)

```bash
# Increase timeout
export HTTP_TIMEOUT=30000

# Use fewer commits per SVG
./cdn-link-gen generate owner/mega-repo  # Then enter: 100 (not 10000)

# Split into multiple runs
./cdn-link-gen generate owner/repo1
./cdn-link-gen generate owner/repo2
```

### For Slow Networks

```bash
# Reduce concurrent testing (default 20)
# Edit github.go, line testLinksParallel:
# Change to: testLinksParallel(allLinks, 5)  # Lower number

go build -o cdn-link-gen .
```

### For Limited Storage (Cloud Shell)

```bash
# Output to stdout instead of file
cat cdn_links_*.txt

# Or upload to cloud storage:
gsutil cp cdn_links_*.txt gs://my-bucket/
```

---

## Getting Help

1. **Check FAQ**: See README.md
2. **Test connectivity**: `bash test-firewall.sh`
3. **See demo**: `./cdn-link-gen demo`
4. **Check token**: `./cdn-link-gen token list`
5. **View help**: `./cdn-link-gen`

---

## Next Steps

1. ✅ Choose your setup method (Google Cloud Shell recommended)
2. ✅ Run quickstart.sh
3. ✅ Add GitHub token
4. ✅ Try demo: `./cdn-link-gen demo`
5. ✅ Generate your first links!

**Happy link generating! 🚀**
