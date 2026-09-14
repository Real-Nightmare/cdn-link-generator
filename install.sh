#!/bin/sh
# CDN Link Generator Pro - one-command installer
#
# Usage 1 (from inside the cloned repo): ./install.sh
# Usage 2 (no clone needed): curl -fsSL <raw-url>/install.sh | sh
#
# - Installs Go automatically if missing (user-local, no sudo needed)
# - Copies (never moves) the binary, so ./cdn-link-gen keeps working in the repo
# - Adds the install dir to your shell profile automatically if needed
set -e

REPO="Real-Nightmare/cdn-link-generator"
BIN="cdn-link-gen"
PREFIX="${PREFIX:-/usr/local/bin}"
LOCAL_BIN="$HOME/.local/bin"

echo "🚀 CDN Link Generator Pro - Installer"
echo "======================================"

# --- Working directory: inside the repo, or clone it ---
if [ -f go.mod ] && [ -f main.go ]; then
    echo "✓ Repo detected in $(pwd)"
else
    TARGET="$HOME/cdn-link-generator"
    if [ ! -f "$TARGET/go.mod" ]; then
        echo "📥 Cloning $REPO to $TARGET ..."
        git clone "https://github.com/$REPO.git" "$TARGET"
    else
        echo "✓ Repo already exists at $TARGET"
    fi
    cd "$TARGET"
fi

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
echo "✓ Built $BIN (kept in repo dir: ./cdn-link-gen works too)"

# --- Choose install dir ---
install_target="$PREFIX"
if ! mkdir -p "$PREFIX" 2>/dev/null || [ ! -w "$PREFIX" ]; then
    install_target="$LOCAL_BIN"
fi

mkdir -p "$install_target"
cp "$BIN" "$install_target/$BIN"
echo "✓ Installed to $install_target/$BIN"

# --- Fix PATH if needed (profile update, so new shells get it) ---
case ":$PATH:" in
    *":$install_target:"*) PATH_OK=1 ;;
    *) PATH_OK=0 ;;
esac

if [ "$PATH_OK" = "0" ]; then
    # Prefer the binary's own permanent PATH fix (writes your shell profile
    # safely and verifies the result).
    if "./$BIN" fix-path >/dev/null 2>&1; then
        echo "✓ PATH permanently fixed (profile updated — new shells get the command)"
    else
        PROFILE=""
        for f in "$HOME/.bashrc" "$HOME/.profile" "$HOME/.zshrc"; do
            if [ -f "$f" ] && [ -w "$f" ]; then PROFILE="$f"; break; fi
        done
        if [ -z "$PROFILE" ]; then
            PROFILE="$HOME/.profile"   # none exists yet - create one (read by login shells)
        fi
        if ! grep -qs "$install_target" "$PROFILE"; then
            printf '\n# Added by cdn-link-generator installer\nexport PATH="%s:$PATH"\n' "$install_target" >> "$PROFILE"
            echo "✓ Added $install_target to PATH in $PROFILE"
        elif [ -n "$PROFILE" ]; then
            echo "✓ $install_target already referenced in $PROFILE"
        fi
        echo ""
        echo "⚠ PATH updated in profile but not in this shell. Run one of:"
        echo "    source $PROFILE"
        echo "    export PATH=\"$install_target:\$PATH\""
    fi
fi

# --- Current shell convenience: also expose ./cdn-link-gen via alias hint ---
echo ""
echo "🎉 Done! Next steps:"
echo "  $BIN setup                     # interactive wizard — saves everything permanently"
echo "  $BIN generate owner/repo -y    # generate links automatically"
echo "  $BIN token add                 # store a GitHub token (or export GITHUB_TOKEN)"
echo "  $BIN demo                      # see a simulated run"
echo "  $BIN --help                    # all commands"
echo ""
echo "  Tip: run '$BIN' with no arguments for the interactive menu."
echo "  (In this shell: source your profile, or run ./cdn-link-gen right here)"
