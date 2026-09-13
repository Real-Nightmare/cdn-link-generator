#!/bin/bash

# CDN Link Generator - Quick Start Guide
# Works in Google Cloud Shell and local machines

set -e

echo "🚀 CDN Link Generator Pro - Quick Start"
echo "=====================================\n"

# Check if Go is installed
if ! command -v go &> /dev/null; then
    echo "❌ Go not found. Installing..."
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        curl -fsSL https://go.dev/dl/go1.21.0.linux-amd64.tar.gz | tar -C /usr/local -xz
        export PATH=$PATH:/usr/local/go/bin
    fi
fi

echo "✓ Go is ready"
echo "📥 Downloading dependencies..."

go mod download 2>/dev/null || true
go mod tidy 2>/dev/null || true

echo "✓ Compiling..."
GO111MODULE=on CGO_ENABLED=0 go build -o cdn-link-gen . 2>/dev/null

echo "✓ Build complete!\n"
echo "🚦 First, add your GitHub token:"
echo "  ./cdn-link-gen token add"
echo ""
echo "📊 Then generate links:"
echo "  ./cdn-link-gen generate owner/repo"
echo ""
echo "🧸 Or try the demo:"
echo "  ./cdn-link-gen demo"
echo ""
echo "🚀 All set! Start generating!"
