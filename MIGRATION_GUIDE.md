# Migration Guide: Canonical Architecture Integration

## Overview

This guide provides step-by-step instructions for integrating the canonical architecture into the existing QuantPro Node.js system.

## Phase 1: Validation & Testing (Recommended First Step)

### Step 1.1: Run Validation Tests

```bash
cd /home/ubuntu/QuantPro
python test_canonical_architecture.py
```

**Expected Output:**
```
✓ PASSED: SymbolMapper
✓ PASSED: FeatureFactory
✓ PASSED: StrategyExecution
✓ PASSED: OutputCompatibility
```

### Step 1.2: Test with Real Data

```bash
# Test single symbol
python market_scanner_refactored.py data/HYPERLIQUID_BTCUSDT_15m.json --strategy all

# Test batch mode
python market_scanner_refactored.py data/symbols.txt --strategy legacy
```

**Verify:**
- JSON output is valid
- `canonical_symbol` field is present
- No NaN or Inf values in output
- Scores are reasonable (0-100 range)

## Phase 2: Parallel Deployment (Zero Downtime)

### Step 2.1: Add Feature Flag to Node.js

Edit `server/config.js`:

```javascript
export const CONFIG = {
    SYSTEM: {
        // ... existing config
        USE_CANONICAL_SCANNER: false, // Feature flag
    },
    // ... rest of config
};
```

### Step 2.2: Update Scanner to Support Both Modes

Edit `server/scanner.js`:

```javascript
// At the top of the file
import { CONFIG } from './config.js';

// In processBatch function, around line 150
const scannerScript = CONFIG.SYSTEM.USE_CANONICAL_SCANNER 
    ? 'market_scanner_refactored.py'
    : 'market_scanner.py';

const pythonArgs = [
    scannerScript,  // Use dynamic script
    ltfFile,
    '--strategy', strategyName,
    '--symbol', symbol,
    '--config', JSON.stringify(CONFIG)
];

// Rest of the code remains the same
```

### Step 2.3: Test Parallel Execution

```javascript
// In server.js or a test script
import { runServerScan } from './server/scanner.js';

// Test with canonical scanner
CONFIG.SYSTEM.USE_CANONICAL_SCANNER = true;
await runServerScan('HYPERLIQUID', 'legacy');

// Compare results with old scanner
CONFIG.SYSTEM.USE_CANONICAL_SCANNER = false;
await runServerScan('HYPERLIQUID', 'legacy');
```

**Verify:**
- Both scanners produce valid results
- Scores are comparable (within 10% variance expected)
- No crashes or errors

## Phase 3: Update Results Aggregator

### Step 3.1: Enhance Aggregator for Canonical Symbols

Edit `results_aggregator.py`:

```python
def enrich_signal(signal, source):
    """Enrich signal with metadata."""
    
    # ... existing enrichment code
    
    # Use canonical_symbol if present, otherwise derive it
    if 'canonical_symbol' in signal:
        base_symbol = signal['canonical_symbol']
    else:
        # Fallback to old logic
        base_symbol = signal['symbol'].replace('USDT', '').replace('USDC', '')
    
    signal['base_symbol'] = base_symbol
    
    # ... rest of enrichment
```

### Step 3.2: Update Deduplication Logic

```python
def deduplicate_signals(all_signals):
    """Deduplicate by (strategy, canonical_symbol)."""
    
    grouped = {}
    
    for signal in all_signals:
        strategy = signal.get('strategy_name', 'Unknown')
        
        # Use canonical_symbol for grouping
        base = signal.get('canonical_symbol') or signal.get('base_symbol', 'UNKNOWN')
        
        key = (strategy, base)
        
        if key not in grouped:
            grouped[key] = []
        grouped[key].append(signal)
    
    # Select winner per group
    winners = []
    for key, signals in grouped.items():
        # Sort by: volume desc, priority desc, score desc
        sorted_signals = sorted(
            signals,
            key=lambda s: (
                s.get('details', {}).get('vol24h', 0),
                get_exchange_priority(s.get('exchange', 'UNKNOWN')),
                s.get('score', 0)
            ),
            reverse=True
        )
        winners.append(sorted_signals[0])
    
    return winners
```

## Phase 4: Frontend Updates (Optional)

### Step 4.1: Display Canonical Symbol

Edit `components/ResultsTable.tsx` (or equivalent):

```typescript
interface Signal {
  symbol: string;
  canonical_symbol?: string;  // New field
  exchange?: string;          // New field
  // ... existing fields
}

// In render
<td>
  {signal.canonical_symbol || signal.symbol}
  {signal.exchange && (
    <span className="text-xs text-gray-500 ml-1">
      ({signal.exchange})
    </span>
  )}
</td>
```

### Step 4.2: Add Exchange Filter

```typescript
const [selectedExchange, setSelectedExchange] = useState<string>('ALL');

const filteredResults = results.filter(r => 
  selectedExchange === 'ALL' || r.exchange === selectedExchange
);

// In UI
<select onChange={(e) => setSelectedExchange(e.target.value)}>
  <option value="ALL">All Exchanges</option>
  <option value="HYPERLIQUID">Hyperliquid</option>
  <option value="KUCOIN">KuCoin</option>
  <option value="MEXC">MEXC</option>
</select>
```

## Phase 5: Enable Canonical Scanner

### Step 5.1: Gradual Rollout

```javascript
// In server/config.js
export const CONFIG = {
    SYSTEM: {
        USE_CANONICAL_SCANNER: true,  // Enable for all scans
        
        // Or per-exchange rollout:
        CANONICAL_EXCHANGES: ['HYPERLIQUID'],  // Start with one exchange
    }
};
```

### Step 5.2: Monitor Performance

Add logging to track performance:

```javascript
// In server/scanner.js
const startTime = Date.now();

const result = await execFile('venv/bin/python', pythonArgs, {
    timeout: 60000,
    maxBuffer: 10 * 1024 * 1024
});

const duration = Date.now() - startTime;
console.log(`[SCANNER] ${scannerScript} completed in ${duration}ms`);

// Track metrics
if (CONFIG.SYSTEM.USE_CANONICAL_SCANNER) {
    // Log to monitoring system
    logMetric('canonical_scanner_duration', duration);
}
```

### Step 5.3: Verify Data Quality

Check `data/master_feed.json`:

```bash
# Count signals per exchange
jq '[.[] | .exchange] | group_by(.) | map({exchange: .[0], count: length})' data/master_feed.json

# Check for duplicates by canonical symbol
jq '[.[] | {strategy: .strategy_name, canonical: .canonical_symbol}] | group_by(.canonical) | map(select(length > 1))' data/master_feed.json
```

## Phase 6: Deprecate Old Scanner

### Step 6.1: Archive Old Files

```bash
mkdir -p archive/pre_canonical
mv market_scanner.py archive/pre_canonical/
mv strategies.py archive/pre_canonical/
```

### Step 6.2: Update Documentation

Update `PROJECT_STATUS.md` and `README.md` to reflect canonical architecture.

### Step 6.3: Remove Feature Flag

```javascript
// In server/scanner.js
// Remove conditional logic, always use canonical scanner
const scannerScript = 'market_scanner_refactored.py';
```

## Rollback Plan

If issues arise, rollback is simple:

### Quick Rollback

```javascript
// In server/config.js
export const CONFIG = {
    SYSTEM: {
        USE_CANONICAL_SCANNER: false,  // Disable immediately
    }
};
```

### Full Rollback

```bash
# Restore old files
cp archive/pre_canonical/market_scanner.py .
cp archive/pre_canonical/strategies.py .

# Restart server
pm2 restart quantpro
```

## Troubleshooting

### Issue: "Module not found: symbol_mapper"

**Solution:**
```bash
# Ensure all new files are in the correct location
ls -la symbol_mapper.py shared_context.py strategies_refactored.py market_scanner_refactored.py

# Check Python path
python -c "import sys; print('\n'.join(sys.path))"
```

### Issue: "Indicators not calculated"

**Solution:**
```python
# Check feature factory config
from shared_context import create_default_config
config = create_default_config()
print(config['enabled_features'])

# Ensure pandas_ta is installed
pip install pandas_ta
```

### Issue: "Canonical symbol incorrect"

**Solution:**
```python
# Test symbol mapper
from symbol_mapper import to_canonical
result = to_canonical('XBTUSDTM', 'KUCOIN')
print(result)  # Should be 'BTC'

# Add custom mapping if needed
from symbol_mapper import get_mapper
mapper = get_mapper()
mapper.SPECIAL_MAPPINGS['CUSTOMSYMBOL'] = 'CANONICAL'
```

### Issue: "Performance degradation"

**Solution:**
```python
# Disable expensive features
config = {
    'enabled_features': ['rsi', 'ema', 'adx'],  # Minimal set
    # Disable external data temporarily
}

# Or increase batch size in Node.js
CONFIG.SYSTEM.BATCH_SIZE = 10  # Increase from 5
```

## Validation Checklist

Before going live, verify:

- [ ] All tests pass (`python test_canonical_architecture.py`)
- [ ] Real data produces valid JSON output
- [ ] No NaN or Inf values in results
- [ ] Canonical symbols are correct (BTC, ETH, SOL, etc.)
- [ ] Scores are in 0-100 range
- [ ] Deduplication works across exchanges
- [ ] Frontend displays canonical symbols correctly
- [ ] Performance is acceptable (< 60s per batch)
- [ ] Rollback plan tested
- [ ] Monitoring/logging in place

## Performance Benchmarks

Expected performance improvements:

| Metric | Old Scanner | Canonical Scanner | Improvement |
|--------|-------------|-------------------|-------------|
| Indicator calc per symbol | 3x (once per strategy) | 1x (once total) | **3x faster** |
| Memory usage | High (duplicate data) | Low (shared context) | **~50% reduction** |
| Code maintainability | Low (scattered logic) | High (centralized) | **Qualitative** |

## Support

For issues during migration:

1. Check this guide's troubleshooting section
2. Review `CANONICAL_ARCHITECTURE.md` for architecture details
3. Run validation tests to isolate the issue
4. Check logs in `data/scanner.log` (if logging enabled)
5. Use rollback plan if critical issues arise

## Next Steps After Migration

1. **Add Custom Indicators**: Use plug-and-play system to add VWAP, Ichimoku, etc.
2. **Implement Caching**: Cache SharedContext objects for repeated analysis
3. **Parallel Processing**: Build contexts in parallel for batch scans
4. **Enhanced Deduplication**: Use canonical symbols for smarter aggregation
5. **Cross-Exchange Arbitrage**: Detect opportunities using canonical symbols
