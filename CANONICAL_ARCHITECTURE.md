# Canonical Architecture - Implementation Guide

## Overview

The QuantPro system has been refactored to implement a **data-centric canonical architecture**. This eliminates redundant calculations, standardizes symbol handling across exchanges, and provides a plug-and-play system for adding new indicators and features.

## Architecture Components

### 1. Symbol Normalization Layer (`symbol_mapper.py`)

**Purpose:** Convert exchange-specific tickers to canonical symbols.

**Class:** `SymbolMapper`

**Examples:**
- `BTCUSDT` → `BTC`
- `XBTUSDTM` → `BTC` (KuCoin special mapping)
- `ETH-USDT` → `ETH`
- `SOLUSD_PERP` → `SOL`

**Usage:**
```python
from symbol_mapper import to_canonical, get_mapper

# Convert symbol
canonical = to_canonical('BTCUSDT', 'BINANCE')  # Returns 'BTC'

# Get mapper instance for batch operations
mapper = get_mapper()
canonical = mapper.to_canonical('ETHUSDT')
```

**Features:**
- Handles special exchange mappings (e.g., XBT → BTC)
- Strips quote currencies (USDT, USDC, USD, etc.)
- Strips suffixes (M, _PERP, -PERP, etc.)
- Internal caching for performance
- Exchange-specific logic support

### 2. SharedContext & Feature Factory (`shared_context.py`)

**Purpose:** Centralized storage for pre-calculated indicators and external data.

#### SharedContext DataClass

Holds all data and indicators for a single symbol:

```python
@dataclass
class SharedContext:
    symbol: str                    # Original exchange symbol
    canonical_symbol: str          # Canonical base (e.g., BTC)
    exchange: str                  # Source exchange
    ltf_data: pd.DataFrame        # Low timeframe candles
    htf_data: Optional[pd.DataFrame]  # High timeframe candles
    ltf_indicators: Dict[str, Any]    # LTF technical indicators
    htf_indicators: Dict[str, Any]    # HTF technical indicators
    external_data: Dict[str, Any]     # Institutional data (OI, funding, etc.)
    metadata: Dict[str, Any]          # Market metadata (mcap, volume, etc.)
    config: Dict[str, Any]            # Configuration
```

**Access Methods:**
```python
# Safe retrieval with defaults
rsi = context.get_ltf_indicator('rsi', default=50.0)
oi_data = context.get_external('open_interest')
mcap = context.get_metadata('mcap', 0)

# Check HTF availability
if context.has_htf_data():
    htf_ema = context.get_htf_indicator('ema_fast')
```

#### FeatureFactory

Calculates indicators and external data **ONCE** per canonical symbol.

**Supported Features:**

**Technical Indicators (LTF & HTF):**
- `rsi` - Relative Strength Index
- `ema_fast` / `ema_slow` - Exponential Moving Averages
- `adx` - Average Directional Index
- `atr` - Average True Range
- `bollinger` - Bollinger Bands (upper, middle, lower)
- `obv` - On-Balance Volume
- `macd` - MACD (line, signal, histogram)
- `volume_sma` - Volume Simple Moving Average
- `stoch_rsi` - Stochastic RSI

**External Data (Institutional):**
- `open_interest` - Open Interest history
- `funding_rate` - Predicted funding rate
- `long_short_ratio` - Long/Short ratio
- `liquidations` - Liquidation history

**Configuration:**
```python
from shared_context import FeatureFactory, create_default_config

# Create with defaults
config = create_default_config()
factory = FeatureFactory(config)

# Customize
config = {
    'enabled_features': ['rsi', 'ema', 'adx', 'open_interest'],
    'rsi_period': 14,
    'ema_fast': 50,
    'ema_slow': 200,
    'adx_period': 14
}
factory = FeatureFactory(config)

# Build context
context = factory.build_context(
    symbol='BTCUSDT',
    exchange='BINANCE',
    ltf_data=df_15m,
    htf_data=df_4h,
    metadata={'mcap': 1000000000}
)
```

**Plug & Play System:**

Adding a new indicator (e.g., VWAP):

1. Add to `enabled_features` in config
2. Add calculation in `_calculate_ltf_indicators`:
```python
if self._is_enabled('vwap'):
    context.ltf_indicators['vwap'] = ta.vwap(df['high'], df['low'], df['close'], df['volume'])
```
3. Strategies can now access it:
```python
vwap = context.get_ltf_indicator('vwap')
```

### 3. Refactored Strategies (`strategies_refactored.py`)

**Key Change:** Strategies **consume** SharedContext instead of calculating indicators.

#### Base Strategy Class

```python
class Strategy(ABC):
    @abstractmethod
    def analyze(self, context: SharedContext) -> Dict[str, Any]:
        """Analyze using pre-calculated data from context."""
        pass
    
    @abstractmethod
    def backtest(self, context: SharedContext) -> list:
        """Backtest using context."""
        pass
    
    @property
    @abstractmethod
    def name(self) -> str:
        """Strategy name."""
        pass
```

#### Refactored Strategy Classes

- `QuantProLegacyRefactored` - EMA/RSI/ADX trend following
- `QuantProBreakoutRefactored` - RSI trendline breakouts
- `QuantProBreakoutV2Refactored` - State machine breakouts

**Example Usage:**
```python
from strategies_refactored import QuantProLegacyRefactored

strategy = QuantProLegacyRefactored(config)
result = strategy.analyze(context)

# Result contains canonical metadata
print(result['canonical_symbol'])  # e.g., 'BTC'
print(result['exchange'])          # e.g., 'BINANCE'
print(result['score'])             # e.g., 75.5
```

**Forbidden Actions:**
- ❌ Strategies MUST NOT call `df.ta.rsi()` or any indicator calculation
- ❌ Strategies MUST NOT fetch external data directly
- ✅ Strategies MUST read from `context.get_ltf_indicator()` / `context.get_external()`

### 4. Market Scanner Orchestrator (`market_scanner_refactored.py`)

**Purpose:** Orchestrates the canonical flow.

**Flow:**
```
1. Load candle data (LTF + HTF)
2. Extract symbol and exchange
3. Normalize symbol → canonical form
4. Build SharedContext via FeatureFactory
5. Execute strategies with SharedContext
6. Enrich results with canonical metadata
7. Output JSON to stdout
```

**Command Line Interface:**
```bash
# Single symbol analysis
python market_scanner_refactored.py data/BINANCE_BTCUSDT_15m.json --strategy all

# Batch mode
python market_scanner_refactored.py symbols.txt --strategy legacy

# With custom config
python market_scanner_refactored.py data/BINANCE_BTCUSDT_15m.json \
    --strategy breakout \
    --config '{"INDICATORS":{"RSI":{"PERIOD":21}}}'

# Specific symbol filter
python market_scanner_refactored.py symbols.txt --symbol BTC
```

**Output Structure:**

Results maintain Node.js compatibility but are enriched with canonical metadata:

```json
{
  "strategy_name": "Legacy",
  "symbol": "BTCUSDT",
  "canonical_symbol": "BTC",
  "exchange": "BINANCE",
  "price": 45000.0,
  "score": 75.5,
  "bias": "LONG",
  "action": "LONG",
  "setup": {
    "side": "LONG",
    "entry": 45000.0,
    "sl": 44500.0,
    "tp": 46500.0,
    "rr": 3.0
  },
  "htf": { ... },
  "ltf": { ... },
  "details": { ... }
}
```

## Migration Path

### For Node.js Integration

**Option 1: Gradual Migration (Recommended)**

Keep both scanners running in parallel:

```javascript
// In server/scanner.js
const SCANNER_SCRIPT = USE_CANONICAL 
    ? 'market_scanner_refactored.py'
    : 'market_scanner.py';

const result = await execFile('venv/bin/python', [
    SCANNER_SCRIPT,
    ltfFile,
    '--strategy', strategy,
    '--config', JSON.stringify(CONFIG)
]);
```

**Option 2: Direct Replacement**

1. Update `server/scanner.js` to call `market_scanner_refactored.py`
2. Update `results_aggregator.py` to use `canonical_symbol` for deduplication
3. Test output compatibility with frontend

### For Strategy Development

**Old Pattern (Deprecated):**
```python
def analyze(self, df, df_htf=None, mcap=0):
    df['rsi'] = df.ta.rsi(length=14)  # ❌ Calculating indicator
    rsi_val = df['rsi'].iloc[-1]
    # ... logic
```

**New Pattern (Canonical):**
```python
def analyze(self, context: SharedContext):
    rsi_series = context.get_ltf_indicator('rsi')  # ✅ Reading from context
    rsi_val = rsi_series.iloc[-1] if rsi_series is not None else 50.0
    # ... logic
```

## Benefits

1. **Performance:** Indicators calculated once per symbol, not per strategy
2. **Consistency:** All strategies use identical indicator values
3. **Maintainability:** Adding new indicators requires minimal code changes
4. **Deduplication:** Canonical symbols enable proper cross-exchange aggregation
5. **Testability:** SharedContext can be mocked for unit tests
6. **Extensibility:** Plug-and-play architecture for new features

## Testing

### Unit Test Example

```python
from shared_context import SharedContext, FeatureFactory
from strategies_refactored import QuantProLegacyRefactored
import pandas as pd

# Create mock data
df = pd.DataFrame({
    'timestamp': range(100),
    'open': [100] * 100,
    'high': [105] * 100,
    'low': [95] * 100,
    'close': [102] * 100,
    'volume': [1000] * 100
})

# Build context
factory = FeatureFactory(create_default_config())
context = factory.build_context(
    symbol='TESTUSDT',
    exchange='TEST',
    ltf_data=df,
    metadata={'mcap': 1000000}
)

# Test strategy
strategy = QuantProLegacyRefactored()
result = strategy.analyze(context)

assert result['canonical_symbol'] == 'TEST'
assert result['score'] >= 0
```

## Future Enhancements

1. **Caching Layer:** Cache SharedContext objects for repeated analysis
2. **Parallel Processing:** Build contexts in parallel for batch scans
3. **Feature Versioning:** Track which feature factory version produced results
4. **Custom Features:** Allow user-defined feature functions
5. **Context Serialization:** Save/load contexts for debugging

## Files Reference

| File | Purpose |
|------|---------|
| `symbol_mapper.py` | Symbol normalization |
| `shared_context.py` | Context and feature factory |
| `strategies_refactored.py` | Refactored strategy implementations |
| `market_scanner_refactored.py` | Orchestrator script |
| `CANONICAL_ARCHITECTURE.md` | This documentation |

## Support

For questions or issues with the canonical architecture:
1. Check this documentation
2. Review `architect_context.md` for system overview
3. Examine example usage in `market_scanner_refactored.py`
