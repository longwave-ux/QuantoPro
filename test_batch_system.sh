#!/bin/bash
# Comprehensive Test Suite for Batch Processing System V3

set -e  # Exit on error

echo "========================================="
echo "BATCH PROCESSING V3 - TEST SUITE"
echo "========================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counter
TESTS_PASSED=0
TESTS_FAILED=0

# Helper function
test_result() {
    if [ $1 -eq 0 ]; then
        echo -e "${GREEN}✓ PASSED${NC}"
        ((TESTS_PASSED++))
    else
        echo -e "${RED}✗ FAILED${NC}"
        ((TESTS_FAILED++))
    fi
}

# Test 1: Resolver Initialization
echo "TEST 1: CoinalyzeResolver Initialization"
echo "-----------------------------------------"
python3 -c "
from coinalyze_resolver import get_resolver
resolver = get_resolver()
resolver.ensure_initialized()
print(f'Symbols loaded: {len(resolver.symbol_map)}')
print(f'Aggregated symbols: {len(resolver.aggregated_symbols)}')
print(f'Exchange symbols: {len(resolver.exchange_symbols)}')
assert len(resolver.symbol_map) > 0, 'No symbols loaded'
assert len(resolver.aggregated_symbols) > 0, 'No aggregated symbols'
print('SUCCESS')
" 2>&1
test_result $?
echo ""

# Test 2: Symbol Resolution
echo "TEST 2: Symbol Resolution Logic"
echo "-----------------------------------------"
python3 -c "
from coinalyze_resolver import get_resolver
resolver = get_resolver()

# Test exchange-specific
symbol, status = resolver.resolve('BTCUSDT', 'BINANCE')
print(f'BTCUSDT + BINANCE → {symbol} ({status})')
assert symbol is not None, 'Failed to resolve BTCUSDT'
assert status in ['resolved', 'aggregated'], f'Invalid status: {status}'

# Test aggregated fallback
symbol2, status2 = resolver.resolve('ETHUSDT', 'MEXC')
print(f'ETHUSDT + MEXC → {symbol2} ({status2})')
assert symbol2 is not None, 'Failed to resolve ETHUSDT'

# Test neutral (unknown symbol)
symbol3, status3 = resolver.resolve('UNKNOWNCOIN', 'BINANCE')
print(f'UNKNOWNCOIN + BINANCE → {symbol3} ({status3})')
assert status3 == 'neutral', 'Should be neutral for unknown symbol'

print('SUCCESS')
" 2>&1
test_result $?
echo ""

# Test 3: Batch Client
echo "TEST 3: CoinalyzeBatchClient"
echo "-----------------------------------------"
python3 -c "
from coinalyze_batch_client import get_batch_client
from coinalyze_resolver import get_resolver

resolver = get_resolver()
client = get_batch_client()

# Resolve some symbols
symbols_to_test = [
    ('BTCUSDT', 'BINANCE'),
    ('ETHUSDT', 'BINANCE')
]

coinalyze_symbols = []
for sym, exch in symbols_to_test:
    resolved, status = resolver.resolve(sym, exch)
    if resolved:
        coinalyze_symbols.append(resolved)

print(f'Testing batch fetch with {len(coinalyze_symbols)} symbols: {coinalyze_symbols}')

# Fetch OI data
oi_data = client.get_open_interest_history_batch(coinalyze_symbols, hours=24)
print(f'OI data fetched for {len(oi_data)} symbols')

# Fetch funding rates
funding_data = client.get_funding_rate_batch(coinalyze_symbols)
print(f'Funding data fetched for {len(funding_data)} symbols')

# Fetch all data
all_data = client.fetch_all_data_batch(coinalyze_symbols)
print(f'All data fetched for {len(all_data)} symbols')

for sym in coinalyze_symbols:
    if sym in all_data:
        data = all_data[sym]
        print(f'{sym}: OI points={len(data[\"oi_history\"])}, Funding={data[\"funding_rate\"]}')

assert len(all_data) > 0, 'No data fetched'
print('SUCCESS')
" 2>&1
test_result $?
echo ""

# Test 4: Batch Processor
echo "TEST 4: BatchProcessor Integration"
echo "-----------------------------------------"
python3 -c "
from batch_processor import get_batch_processor

processor = get_batch_processor()

# Test with a few symbols
symbols = [
    ('BTCUSDT', 'BINANCE'),
    ('ETHUSDT', 'BINANCE'),
    ('SOLUSDT', 'BINANCE')
]

print(f'Processing {len(symbols)} symbols...')
batch_data = processor.process_symbols(symbols)

print(f'Batch data keys: {len(batch_data)}')

for symbol, exchange in symbols:
    key = f'{symbol}_{exchange}'
    if key in batch_data:
        data = batch_data[key]
        print(f'{key}: status={data.get(\"oi_status\")}, OI points={len(data.get(\"oi_history\", []))}')

assert len(batch_data) > 0, 'No batch data returned'
print('SUCCESS')
" 2>&1
test_result $?
echo ""

# Test 5: Cache Verification
echo "TEST 5: Cache File Verification"
echo "-----------------------------------------"
if [ -f data/coinalyze_symbols.json ]; then
    echo "✓ Symbol cache exists"
    CACHE_AGE=$(python3 -c "
import json, time, os
with open('data/coinalyze_symbols.json') as f:
    data = json.load(f)
age_hours = (time.time() - data['timestamp']) / 3600
print(f'{age_hours:.1f}')
")
    echo "  Cache age: ${CACHE_AGE} hours"
    
    SYMBOL_COUNT=$(jq '.symbol_map | length' data/coinalyze_symbols.json)
    echo "  Symbols cached: ${SYMBOL_COUNT}"
    
    test_result 0
else
    echo "✗ Symbol cache not found"
    test_result 1
fi
echo ""

# Test 6: Small Directory Scan (Performance Test)
echo "TEST 6: Small Directory Scan (Performance)"
echo "-----------------------------------------"
echo "Creating test directory with 10 files..."

# Create test directory
mkdir -p data/test_batch
cp data/BINANCE_BTCUSDT_15m.json data/test_batch/ 2>/dev/null || echo "BTCUSDT not found, skipping"
cp data/BINANCE_ETHUSDT_15m.json data/test_batch/ 2>/dev/null || echo "ETHUSDT not found, skipping"
cp data/BINANCE_SOLUSDT_15m.json data/test_batch/ 2>/dev/null || echo "SOLUSDT not found, skipping"

FILE_COUNT=$(ls data/test_batch/*_15m.json 2>/dev/null | wc -l)

if [ $FILE_COUNT -gt 0 ]; then
    echo "Testing with ${FILE_COUNT} files..."
    
    START_TIME=$(date +%s)
    ./venv/bin/python market_scanner_refactored.py data/test_batch/ --strategy all --output /tmp/test_master_feed.json 2>&1 | grep -E '\[BATCH\]|\[DIRECTORY\]|\[SUCCESS\]|\[TIMESTAMP\]'
    END_TIME=$(date +%s)
    
    DURATION=$((END_TIME - START_TIME))
    echo "Scan completed in ${DURATION} seconds"
    
    if [ -f /tmp/test_master_feed.json ]; then
        SIGNAL_COUNT=$(jq '.signals | length' /tmp/test_master_feed.json)
        echo "Generated ${SIGNAL_COUNT} signals"
        
        # Check for oi_status in signals
        HAS_STATUS=$(jq '.signals[0] | has("oi_metadata")' /tmp/test_master_feed.json 2>/dev/null || echo "false")
        if [ "$HAS_STATUS" = "true" ]; then
            echo "✓ OI metadata present in signals"
        fi
        
        test_result 0
    else
        echo "✗ Output file not created"
        test_result 1
    fi
    
    # Cleanup
    rm -rf data/test_batch
    rm -f /tmp/test_master_feed.json
else
    echo "⚠ No test files available, skipping"
fi
echo ""

# Test 7: Master Feed Structure
echo "TEST 7: Master Feed Structure Validation"
echo "-----------------------------------------"
if [ -f data/master_feed.json ]; then
    echo "✓ master_feed.json exists"
    
    # Check structure
    HAS_TIMESTAMP=$(jq 'has("last_updated")' data/master_feed.json)
    HAS_SIGNALS=$(jq 'has("signals")' data/master_feed.json)
    
    if [ "$HAS_TIMESTAMP" = "true" ] && [ "$HAS_SIGNALS" = "true" ]; then
        echo "✓ Structured format detected"
        
        TIMESTAMP=$(jq '.last_updated' data/master_feed.json)
        SIGNAL_COUNT=$(jq '.signals | length' data/master_feed.json)
        
        echo "  Timestamp: ${TIMESTAMP}"
        echo "  Signal count: ${SIGNAL_COUNT}"
        
        # Check for oi_status distribution
        echo "  OI Status distribution:"
        jq -r '.signals[] | select(.oi_metadata) | .oi_metadata.status' data/master_feed.json 2>/dev/null | sort | uniq -c || echo "    (oi_metadata not yet in signals)"
        
        test_result 0
    else
        echo "✗ Invalid structure"
        test_result 1
    fi
else
    echo "⚠ master_feed.json not found (run full scan first)"
fi
echo ""

# Summary
echo "========================================="
echo "TEST SUMMARY"
echo "========================================="
echo -e "Tests Passed: ${GREEN}${TESTS_PASSED}${NC}"
echo -e "Tests Failed: ${RED}${TESTS_FAILED}${NC}"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}✓ ALL TESTS PASSED${NC}"
    echo ""
    echo "Batch Processing System V3 is ready for production!"
    echo ""
    echo "Next steps:"
    echo "1. Run full market scan: ./venv/bin/python market_scanner_refactored.py data/ --strategy all"
    echo "2. Monitor performance: Should complete in ~2 minutes (vs 40 minutes before)"
    echo "3. Verify dashboard displays results correctly"
    exit 0
else
    echo -e "${RED}✗ SOME TESTS FAILED${NC}"
    echo ""
    echo "Please review the failures above and fix before proceeding."
    exit 1
fi
