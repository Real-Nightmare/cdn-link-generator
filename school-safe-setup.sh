#!/bin/bash

# School Safe Setup - Minimal footprint, maximum stealth
# Use in Google Cloud Shell or school computers

echo "🛰 School-Safe CDN Link Generator Setup"
echo "========================================\n"

echo "⚠️  Important: This is for personal educational use only."
echo "  Respect your school's policies. Always ask permission.\n"

# Step 1: Check environment
echo "🔍 Checking environment..."
if [ -z "$HOME" ]; then
    echo "❌ HOME directory not found"
    exit 1
fi

echo "✓ Home: $HOME"

# Step 2: Build
echo "
📥 Building (no installation required)..."
if ! go build -o ~/.local/bin/cdn-link-gen . 2>/dev/null; then
    echo "❌ Go build failed. Trying system go..."
    go build -o ./cdn-link-gen .
fi

echo "✓ Binary ready"

# Step 3: Test firewall
echo "
🧫 Testing firewall bypass..."
bash test-firewall.sh

# Step 4: Ready
echo "
✅ Setup complete!"
echo "
Usage (no installation, runs from anywhere):"
echo "  ~/.local/bin/cdn-link-gen token add"
echo "  ~/.local/bin/cdn-link-gen generate owner/repo"
echo "
Or if built locally:"
echo "  ./cdn-link-gen token add"
echo "  ./cdn-link-gen generate owner/repo"
echo ""
