#!/bin/bash

# CDN Link Generator - Build Script

set -e

echo "📦 Building CDN Link Generator..."

# Check Go installation
if ! command -v go &> /dev/null; then
    echo "❌ Go is not installed. Please install Go 1.21 or later."
    exit 1
fi

GO_VERSION=$(go version | awk '{print $3}')
echo "✓ Using Go $GO_VERSION"

# Download dependencies
echo "📥 Downloading dependencies..."
go mod download
go mod tidy

# Build
echo "🔨 Compiling..."
GO111MODULE=on CGO_ENABLED=0 go build -ldflags="-s -w" -o cdn-link-gen .

echo "✓ Build complete!"
echo ""
echo "📝 Usage:"
echo "  ./cdn-link-gen generate owner/repo"
echo "  ./cdn-link-gen token add"
echo "  ./cdn-link-gen token list"
echo ""
echo "🚀 Ready to go!"
