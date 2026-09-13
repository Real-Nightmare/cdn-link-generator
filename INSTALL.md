# INSTALLATION & SETUP GUIDE

## Complete Setup Instructions for All Environments

### Table of Contents
1. [One-Command Install](#one-command-install)
2. [Google Cloud Shell](#google-cloud-shell)
3. [Local Machine Setup](#local-machine-setup)
4. [Docker Setup](#docker-setup)
5. [Updating](#updating)
6. [Troubleshooting](#troubleshooting)
7. [Performance Tips](#performance-tips)

---

## One-Command Install

```bash
curl -fsSL https://raw.githubusercontent.com/Real-Nightmare/cdn-link-generator/main/install.sh | sh
```

The installer:
1. Detects your platform (Linux/macOS — amd64, arm64, armv6/v7)
2. Installs Go automatically if missing (user-local, no sudo required)
3. Builds the binary (zero third-party dependencies — works offline)
4. Installs to `/usr/local/bin` (or `~/.local/bin` with a PATH hint if not writable)

## Google Cloud Shell

Everything is pre-installed (Go, Git). Just:

```bash
git clone https://github.com/Real-Nightmare/cdn-link-generator.git
cd cdn-link-generator
./install.sh

# Or skip the installer and build directly:
go build -o cdn-link-gen .
```

Then:

```bash
./cdn-link-gen token add
./cdn-link-gen generate owner/repo -y
```

## Local Machine Setup

### Prerequisites

- **Go 1.18 or later** — https://go.dev/dl/ (installer can fetch it for you)
- **Git** — only needed for `git pull` updates and the `-make-commits` feature

### Windows 10/11

**Option 1: Native (recommended)**

```cmd
REM Install Go from https://go.dev/dl/go1.21.x.windows-amd64.msi
git clone https://github.com/Real-Nightmare/cdn-link-generator.git
cd cdn-link-generator
go build -o cdn-link-gen.exe .
cdn-link-gen.exe generate owner/repo -y
```

**Option 2: WSL2**

```powershell
# In PowerShell as Admin:
wsl --install -d Ubuntu
```

```bash
# Then in the Ubuntu terminal:
sudo apt-get update && sudo apt-get install -y golang-go git
git clone https://github.com/Real-Nightmare/cdn-link-generator.git
cd cdn-link-generator
./install.sh
```

### macOS

```bash
brew install go
git clone https://github.com/Real-Nightmare/cdn-link-generator.git
cd cdn-link-generator
./install.sh
```

### Linux (Ubuntu/Debian)

```bash
sudo apt-get update && sudo apt-get install -y golang-go git
git clone https://github.com/Real-Nightmare/cdn-link-generator.git
cd cdn-link-generator
./install.sh
```

### Raspberry Pi / ARM Devices

```bash
# Go builds natively for ARM — no special flags needed
git clone https://github.com/Real-Nightmare/cdn-link-generator.git
cd cdn-link-generator
go build -o cdn-link-gen .
```

### Cross-Compilation

Build binaries for every platform from any machine:

```bash
make cross-compile   # outputs to dist/
```

Targets: linux-amd64, linux-arm64, darwin-amd64, darwin-arm64, windows-amd64.exe

## Docker Setup

### Build the Image

```bash
git clone https://github.com/Real-Nightmare/cdn-link-generator.git
cd cdn-link-generator
docker build -t cdn-link-gen .
```

### Run

```bash
# Automatic generation with an env token
docker run --rm -it -e GITHUB_TOKEN=ghp_xxx cdn-link-gen generate owner/repo -y

# With token file persistence
docker run --rm -it -v ~/.cdn_tokens.json:/home/appuser/.cdn_tokens.json cdn-link-gen generate owner/repo -y

# Multiple repos
docker run --rm -it -e GITHUB_TOKEN=ghp_xxx cdn-link-gen generate owner/repo1 owner/repo2 -y

# Demo
docker run --rm -it cdn-link-gen demo
```

The container runs as a non-root user with `ca-certificates` and `git` included.

## Updating

```bash
git pull origin main
go build -o cdn-link-gen .     # or: make build
```

Binary version: `cdn-link-gen version`

## Troubleshooting

### "command not found: go"

```bash
# Let the installer handle it:
./install.sh

# Or manually:
# macOS:   brew install go
# Ubuntu:  sudo apt-get install golang-go
# Windows: https://go.dev/dl
go version   # verify
```

### "Go version too old"

The tool needs **Go 1.18+**. Download a newer one from https://go.dev/dl/ — the installer picks the right tarball automatically.

### "Permission denied" when running the binary

```bash
chmod +x cdn-link-gen
```

### "Permission denied" when installing to /usr/local/bin

The installer falls back to `~/.local/bin` automatically. Make sure it's on your PATH:

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc && source ~/.bashrc
```

### "Token authentication failed"

```bash
cdn-link-gen token verify     # checks validity + shows rate limit
cdn-link-gen token list       # review stored tokens
```

Token format: `ghp_…` (classic) or `github_pat_…` (fine-grained). Create one at https://github.com/settings/tokens

### "Repo not found or no access"

- Format must be `owner/repo`
- Public repo, no token, and rate-limited? Add a token: `cdn-link-gen token add`
- Private repo? Token needs `repo` scope

### "No SVG files found"

- The repository must contain `.svg` files on its default branch (scan is recursive, case-insensitive on the extension)
- Subfolder SVGs are found too — top level is not required

### Build fails on ARM/Raspberry Pi

Go 1.18+ supports ARM natively. If your distro ships an ancient Go, grab a fresh one:

```bash
curl -fsSL https://go.dev/dl/go1.21.13.linux-armv6l.tar.gz | sudo tar -C /usr/local -xz
export PATH=$PATH:/usr/local/go/bin
```

## Performance Tips

### For Large Repos (1000+ SVGs)

```bash
# The recursive tree scan handles any size in one API call per repo.
# Skip validation when you trust the CDNs:
./cdn-link-gen generate owner/mega-repo -y -no-validate

# Limit links generated:
./cdn-link-gen generate owner/mega-repo -y -commits 10
```

### For Slow Networks

```bash
# Lower validation concurrency:
./cdn-link-gen generate owner/repo -y -c 5
```

### For Maximum Speed

```bash
# Skip validation + fewer commits:
./cdn-link-gen generate owner/repo -y -no-validate -commits 5
```

## Getting Help

1. `./cdn-link-gen --help` — all commands and flags
2. `./cdn-link-gen cdns` — list CDN providers
3. `./cdn-link-gen demo` — simulated run
4. `./cdn-link-gen token verify` — check your token
5. See [FAQ.md](FAQ.md) and [USAGE.md](USAGE.md)

---

**Happy link generating! 🚀**
