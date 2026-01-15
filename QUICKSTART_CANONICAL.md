# Quick Start: Canonical Architecture

## 5-Minute Setup

### 1. Verify Installation

```bash
cd /home/ubuntu/QuantPro

# Check Python dependencies
python -c "import pandas, pandas_ta, numpy, scipy; print('✓ Dependencies OK')"

# Check new files exist
ls -1 symbol_mapper.py shared_context.py strategies_refactored.py market_scanner_refactored.py
```

### 2. Run Validation Tests

```bash
python test_canonical_architecture.py
```

**Expected:** All tests pass (✓ PASSED)

### 3. Test with Sample Data

```bash
# Single symbol test
python market_scanner_refactored.py data/HYPERLIQUID_BTCUSDT_15m.json --strategy legacy

# Expected output: JSON array with canonical_symbol field
```

### 4. Compare with Old Scanner

```bash
# Old scanner
python market_scanner.py data/HYPERLIQUID_BTCUSDT_15m.json --strategy legacy > old_output.json

# New scanner
python market_scanner_refactored.py data/HYPERLIQUID_BTCUSDT_15m.json --strategy legacy > new_output.json

# Compare scores (should be similar)
echo "Old score:" && jq '.[0].score' old_output.json
echo "New score:" && jq '.[0].score' new_output.json
echo "Canonical symbol:" && jq '.[0].canonical_symbol' new_output.json
```

## Integration with Node.js (Simple)

### Option A: Direct Replacement (Aggressive)

Edit `server/scanner.js` line ~150:

```javascript
// Change this:
const pythonArgs = [
    'market_scanner.py',  // OLD
    ltfFile,
    // ...
];

// To this:
const pythonArgs = [
    'market_scanner_refactored.py',  // NEW
    ltfFile,
    // ...
];
```

Restart server:
```bash
pm2 restart quantpro
```

### Option B: Feature Flag (Safe)

1. Add to `server/config.js`:
```javascript
SYSTEM: {
    USE_CANONICAL_SCANNER: process.env.USE_CANONICAL === 'true',
}
```

2. Update `server/scanner.js`:
```javascript
const scannerScript = CONFIG.SYSTEM.USE_CANONICAL_SCANNER 
    ? 'market_scanner_refactored.py'
    : 'market_scanner.py';
```

3. Test with environment variable:
```bash
USE_CANONICAL=true npm start
```

## Common Use Cases

### Use Case 1: Add a New Indicator (VWAP)

**Step 1:** Edit `shared_context.py`, add to `_calculate_ltf_indicators`:

```python
# VWAP
if self._is_enabled('vwap'):
    context.ltf_indicators['vwap'] = ta.vwap(
        df['high'], df['low'], df['close'], df['volume']
    )
```

**Step 2:** Enable in config:
```python
config = {
    'enabled_features': ['rsi', 'ema', 'adx', 'vwap'],  # Add 'vwap'
}
```

**Step 3:** Use in strategy:
```python
def analyze(self, context: SharedContext):
    vwap = context.get_ltf_indicator('vwap')
    if vwap is not None:
        vwap_val = vwap.iloc[-1]
        # Use in logic...
```

**Done!** No changes needed to other strategies or the scanner.

### Use Case 2: Create a Custom Strategy

```python
from shared_context import SharedContext
from strategies_refactored import Strategy

class MyCustomStrategy(Strategy):
    @property
    def name(self) -> str:
        return "MyCustom"
    
    def analyze(self, context: SharedContext):
        # Read pre-calculated indicators
        rsi = context.get_ltf_indicator('rsi')
        ema_fast = context.get_ltf_indicator('ema_fast')
        
        # Your logic here
        if rsi.iloc[-1] < 30 and context.ltf_data['close'].iloc[-1] > ema_fast.iloc[-1]:
            bias = 'LONG'
            score = 80
        else:
            bias = 'NONE'
            score = 0
        
        return {
            "strategy_name": self.name,
            "symbol": context.symbol,
            "canonical_symbol": context.canonical_symbol,
            "exchange": context.exchange,
            "score": score,
            "bias": bias,
            "action": bias if bias != 'NONE' else 'WAIT',
            # ... rest of structure
        }
    
    def backtest(self, context: SharedContext):
        return []
```

Add to `market_scanner_refactored.py`:
```python
from my_custom_strategy import MyCustomStrategy

# In main():
elif args.strategy.lower() == 'mycustom':
    strategies_to_run = [MyCustomStrategy(user_config)]
```

### Use Case 3: Debug Indicator Values

```python
from shared_context import FeatureFactory, create_default_config
from symbol_mapper import to_canonical
import pandas as pd

# Load your data
df = pd.read_json('data/HYPERLIQUID_BTCUSDT_15m.json')

# Build context
factory = FeatureFactory(create_default_config())
context = factory.build_context(
    symbol='BTCUSDT',
    exchange='HYPERLIQUID',
    ltf_data=df
)

# Inspect indicators
print(f"Canonical: {context.canonical_symbol}")
print(f"RSI: {context.get_ltf_indicator('rsi').tail()}")
print(f"EMA50: {context.get_ltf_indicator('ema_fast').tail()}")
print(f"ADX: {context.get_ltf_indicator('adx').tail()}")
```

## Troubleshooting

### "Module not found"
```bash
# Ensure you're in the project directory
cd /home/ubuntu/QuantPro

# Check Python can find modules
python -c "from symbol_mapper import to_canonical; print('OK')"
```

### "Indicators are NaN"
```python
# Check data length
print(f"Data length: {len(df)}")  # Should be > 200 for most indicators

# Check for NaN in source data
print(df[['close', 'volume']].isna().sum())
```

### "Scores are different"
This is expected! The canonical architecture may produce slightly different scores due to:
- More accurate indicator calculations (no rounding errors from multiple calculations)
- Consistent data across strategies
- Differences are typically < 10%

## Performance Tips

### Tip 1: Disable Unused Features
```python
config = {
    'enabled_features': ['rsi', 'ema', 'adx'],  # Only what you need
}
```

### Tip 2: Batch Processing
```bash
# Process multiple symbols efficiently
python market_scanner_refactored.py symbols.txt --strategy all
```

### Tip 3: Cache Context Objects (Advanced)
```python
# In your application
context_cache = {}

def get_or_build_context(symbol, exchange, df_ltf, df_htf):
    key = f"{exchange}:{symbol}"
    if key not in context_cache:
        context_cache[key] = factory.build_context(symbol, exchange, df_ltf, df_htf)
    return context_cache[key]
```

## Next Steps

1. **Read Full Documentation:** `CANONICAL_ARCHITECTURE.md`
2. **Migration Guide:** `MIGRATION_GUIDE.md` for production deployment
3. **Add Custom Indicators:** Follow "Use Case 1" above
4. **Create Custom Strategies:** Follow "Use Case 2" above
5. **Monitor Performance:** Track scan times and memory usage

## Key Benefits Recap

✅ **Faster:** Indicators calculated once, not per-strategy  
✅ **Consistent:** All strategies use identical indicator values  
✅ **Maintainable:** Add indicators in one place  
✅ **Extensible:** Plug-and-play architecture  
✅ **Cross-Exchange:** Canonical symbols enable proper deduplication  

## Support

- **Architecture Details:** `CANONICAL_ARCHITECTURE.md`
- **Migration Help:** `MIGRATION_GUIDE.md`
- **System Overview:** `architect_context.md`
- **Tests:** Run `python test_canonical_architecture.py`
