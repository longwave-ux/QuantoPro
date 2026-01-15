#!/bin/bash
# Test script for Unified Market Engine

echo "========================================="
echo "UNIFIED MARKET ENGINE - TEST SUITE"
echo "========================================="
echo ""

# Test 1: Directory Scan
echo "TEST 1: Directory Scan (All Strategies)"
echo "-----------------------------------------"
./venv/bin/python market_scanner_refactored.py data/ --strategy all 2>&1 | grep -E '\[DIRECTORY MODE\]|\[PROGRESS\]|\[SUCCESS\]|\[TIMESTAMP\]'
echo ""

# Test 2: Verify Master Feed Structure
echo "TEST 2: Verify Master Feed Structure"
echo "-----------------------------------------"
if [ -f data/master_feed.json ]; then
    echo "✓ master_feed.json exists"
    
    # Check if it has the structured format
    if jq -e '.last_updated' data/master_feed.json > /dev/null 2>&1; then
        echo "✓ Structured format detected"
        TIMESTAMP=$(jq '.last_updated' data/master_feed.json)
        SIGNAL_COUNT=$(jq '.signals | length' data/master_feed.json)
        echo "  - Timestamp: $TIMESTAMP"
        echo "  - Signal Count: $SIGNAL_COUNT"
    else
        echo "✗ Flat array format (needs migration)"
    fi
else
    echo "✗ master_feed.json not found"
fi
echo ""

# Test 3: Verify Observability Data
echo "TEST 3: Verify Observability Preservation"
echo "-----------------------------------------"
if jq -e '.signals[0].observability.rsi_visuals' data/master_feed.json > /dev/null 2>&1; then
    echo "✓ RSI visuals preserved"
    jq '.signals[0].observability.rsi_visuals.resistance.equation' data/master_feed.json
else
    echo "✗ Observability data missing"
fi
echo ""

# Test 4: API Endpoint Test
echo "TEST 4: API Endpoint Integration"
echo "-----------------------------------------"
if curl -s http://localhost:3000/api/results > /dev/null 2>&1; then
    echo "✓ API endpoint accessible"
    
    # Check format
    RESPONSE=$(curl -s http://localhost:3000/api/results)
    if echo "$RESPONSE" | jq -e '.last_updated' > /dev/null 2>&1; then
        echo "✓ Structured format from API"
        echo "$RESPONSE" | jq '{timestamp: .last_updated, signals: .signals | length}'
    elif echo "$RESPONSE" | jq -e '.[0]' > /dev/null 2>&1; then
        echo "✓ Flat array format from API (backward compatible)"
        echo "$RESPONSE" | jq 'length'
    else
        echo "✗ Unexpected API response format"
    fi
else
    echo "✗ API endpoint not accessible (is server running?)"
fi
echo ""

# Test 5: Symbol Filter Test
echo "TEST 5: Symbol Filter Test"
echo "-----------------------------------------"
echo "Scanning only BTC pairs..."
./venv/bin/python market_scanner_refactored.py data/ --strategy all --symbol BTC --output /tmp/test_btc.json 2>&1 | grep -E '\[SUCCESS\]|\[TIMESTAMP\]'

if [ -f /tmp/test_btc.json ]; then
    BTC_COUNT=$(jq '.signals | length' /tmp/test_btc.json)
    echo "✓ BTC filter test complete: $BTC_COUNT signals"
    rm /tmp/test_btc.json
fi
echo ""

echo "========================================="
echo "TEST SUITE COMPLETE"
echo "========================================="
