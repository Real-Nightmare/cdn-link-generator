#!/bin/bash

# CDN Link Generator Pro - Quick Start
# Works in Google Cloud Shell, Codespaces, and local machines.
# For a full installer use: ./install.sh

set -e

echo "🚀 CDN Link Generator Pro - Quick Start"
echo "======================================="

# Check if Go is installed
if ! command -v go &> /dev/null; then
    echo "❌ Go not found. Run ./install.sh first (it installs Go automatically)."
    exit 1
fi
echo "✓ Go is ready: $(go version)"

echo "🔨 Compiling (zero dependencies, instant)..."
CGO_ENABLED=0 go build -ldflags="-s -w" -o cdn-link-gen .

echo "✓ Build complete!"
echo ""
echo "🚦 Next steps:"
echo "  ./cdn-link-gen token add                 # store a GitHub token (recommended)"
echo "  ./cdn-link-gen generate owner/repo -y    # fully automatic generation"
echo "  ./cdn-link-gen demo                      # simulated run, no GitHub access"
echo "  ./cdn-link-gen --help                    # all commands & flags"
echo ""
echo "🚀 All set! Start generating!"
