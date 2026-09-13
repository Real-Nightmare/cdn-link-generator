#!/bin/bash

# CDN Link Generator - Build Script

set -e

echo "📦 Building CDN Link Generator..."

# Check Go installation
if ! command -v go &> /dev/null; then
    echo "❌ Go is not installed. Run ./install.sh or install Go 1.18+ from https://go.dev/dl/"
    exit 1
fi

GO_VERSION=$(go version | awk '{print $3}')
echo "✓ Using Go $GO_VERSION"

# Tidy module (no external deps — instant)
go mod tidy

# Build
echo "🔨 Compiling..."
CGO_ENABLED=0 go build -ldflags="-s -w" -o cdn-link-gen .

echo "✓ Build complete!"
echo ""
echo "📝 Usage:"
echo "  ./cdn-link-gen generate owner/repo -y"
echo "  ./cdn-link-gen token add"
echo "  ./cdn-link-gen cdns"
echo ""
echo "🚀 Ready to go!"
