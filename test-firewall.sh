#!/bin/bash

# School Firewall Bypass Test
# Tests if the CDN tool can reach GitHub APIs

echo "🧫 Testing connectivity for school/corporate firewall..."
echo ""

# Test 1: Direct connection
echo "1️⃣ Testing direct GitHub access..."
if curl -s -m 3 -o /dev/null -w "%{http_code}" https://api.github.com -H "Accept: application/vnd.github.v3+json" | grep -q "200\|403"; then
    echo "   ✓ Direct access: WORKING"
    DIRECT_OK=1
else
    echo "   ❌ Direct access: BLOCKED"
    DIRECT_OK=0
fi

echo ""

# Test 2: CORS proxy
echo "2️⃣ Testing CORS proxy..."
if curl -s -m 3 -o /dev/null -w "%{http_code}" https://cors-anywhere.herokuapp.com/https://api.github.com | grep -q "200\|403\|429"; then
    echo "   ✓ CORS proxy: WORKING"
    CORS_OK=1
else
    echo "   ❌ CORS proxy: BLOCKED"
    CORS_OK=0
fi

echo ""

# Test 3: AllOrigins proxy
echo "3️⃣ Testing AllOrigins proxy..."
if curl -s -m 3 -o /dev/null -w "%{http_code}" https://api.allorigins.win/raw?url=https://api.github.com | grep -q "200\|403\|429"; then
    echo "   ✓ AllOrigins proxy: WORKING"
    ALLORIGINS_OK=1
else
    echo "   ❌ AllOrigins proxy: BLOCKED"
    ALLORIGINS_OK=0
fi

echo ""
echo "====================================="

if [ $DIRECT_OK -eq 1 ]; then
    echo "✅ Great! You can use the tool directly."
    echo "   ./cdn-link-gen generate owner/repo"
elif [ $CORS_OK -eq 1 ] || [ $ALLORIGINS_OK -eq 1 ]; then
    echo "⚠️  Firewall detected but workarounds available!"
    echo "   The tool will automatically use alternative routes."
    echo "   ./cdn-link-gen generate owner/repo"
else
    echo "❌ All direct routes blocked."
    echo "   🚀 Solutions:"
    echo "     1. Use a VPN (Proton VPN, Windscribe - both free)"
    echo "     2. Use mobile hotspot"
    echo "     3. Try from home/public WiFi"
fi

echo ""
