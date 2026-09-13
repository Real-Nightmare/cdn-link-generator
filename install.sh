#!/bin/sh
# CDN Link Generator Pro - one-command installer
# Usage: curl -fsSL https://raw.githubusercontent.com/Real-Nightmare/cdn-link-generator/main/install.sh | sh
set -e

REPO="Real-Nightmare/cdn-link-generator"
BIN="cdn-link-gen"
PREFIX="${PREFIX:-/usr/local/bin}"

echo "🚀 CDN Link Generator Pro - Installer"
echo "======================================"

# --- Locate or install Go ---
if command -v go >/dev/null 2>&1; then
    echo "✓ Found Go: $(go version)"
else
    echo "📦 Go not found. Attempting automatic installation..."
    GO_VER="1.21.13"
    case "$(uname -s)/$(uname -m)" in
        Linux/x86_64)  GO_TARBALL="go${GO_VER}.linux-amd64.tar.gz" ;;
        Linux/aarch64) GO_TARBALL="go${GO_VER}.linux-arm64.tar.gz" ;;
        Linux/armv6l|Linux/armv7l) GO_TARBALL="go${GO_VER}.linux-armv6l.tar.gz" ;;
        Darwin/arm64)  GO_TARBALL="go${GO_VER}.darwin-arm64.tar.gz" ;;
        Darwin/x86_64) GO_TARBALL="go${GO_VER}.darwin-amd64.tar.gz" ;;
        *)
            echo "❌ Unsupported platform $(uname -s)/$(uname -m)."
            echo "   Install Go manually from https://go.dev/dl/ and re-run."
            exit 1
            ;;
    esac

    if [ -w /usr/local ] || [ "$(id -u)" = "0" ]; then
        curl -fsSL "https://go.dev/dl/${GO_TARBALL}" | tar -C /usr/local -xz
        PATH="$PATH:/usr/local/go/bin"
        export PATH
    else
        mkdir -p "$HOME/.local"
        curl -fsSL "https://go.dev/dl/${GO_TARBALL}" | tar -C "$HOME/.local" -xz
        PATH="$PATH:$HOME/.local/go/bin"
        export PATH
    fi
    echo "✓ Installed $(go version)"
fi

# --- Build ---
echo "🔨 Building..."
CGO_ENABLED=0 go build -ldflags="-s -w" -o "$BIN" .
echo "✓ Built $BIN"

# --- Install ---
mkdir -p "$PREFIX" 2>/dev/null || true
if mv "$BIN" "$PREFIX/$BIN" 2>/dev/null; then
    echo "✓ Installed to $PREFIX/$BIN"
else
    mkdir -p "$HOME/.local/bin"
    mv "$BIN" "$HOME/.local/bin/$BIN"
    echo "✓ Installed to $HOME/.local/bin/$BIN"
    case ":$PATH:" in
        *":$HOME/.local/bin:"*) ;;
        *)
            echo ""
            echo "⚠ $HOME/.local/bin is not on your PATH."
            echo "  Add this to your shell profile:"
            echo "    export PATH=\"\$HOME/.local/bin:\$PATH\""
            ;;
    esac
fi

echo ""
echo "🎉 Done! Next steps:"
echo "  $BIN token add                 # store a GitHub token (or export GITHUB_TOKEN)"
echo "  $BIN generate owner/repo -y    # generate links automatically"
echo "  $BIN demo                      # see a simulated run"
echo "  $BIN --help                    # all commands"
