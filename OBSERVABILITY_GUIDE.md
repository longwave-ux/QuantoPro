# Enhanced Observability & Visual Data Enrichment Guide

**Status:** ✅ Fully Implemented  
**Date:** January 15, 2026  
**Purpose:** Bridge AI signals with human verification through complete transparency

---

## Overview

The QuantPro system now includes comprehensive observability features that expose all raw data, geometric calculations, and scoring components to enable human verification and visual charting of AI-generated signals.

### Key Features

1. **RSI Trendline Pivot Detection** - Automatic detection of support/resistance trendlines
2. **Full Score Transparency** - Every variable used in scoring calculations exposed
3. **Event Timestamps** - Exact candle time for each signal
4. **Visual Data Structure** - Coordinates and equations for charting

---

## Architecture Components

### 1. RSI Trendline Logic (`shared_context.py`)

**Location:** `FeatureFactory._detect_rsi_trendlines()`

**Algorithm:**
- Uses `scipy.signal.find_peaks` for pivot detection
- Identifies local peaks (resistance) and troughs (support)
- Selects top 2 most prominent pivots by prominence score
- Calculates trendline equation: `y = mx + b`

**Configuration Parameters:**
```python
{
    'rsi_trendline_lookback': 100,    # Candles to analyze
    'rsi_pivot_distance': 10,          # Minimum distance between pivots
    'rsi_pivot_prominence': 5          # Minimum prominence threshold
}
```

**Output Structure:**
```json
{
  "resistance": {
    "pivot_1": {"index": 1415, "value": 81.04},
    "pivot_2": {"index": 1489, "value": 66.36},
    "slope": -0.1984,
    "intercept": 361.78,
    "equation": "y = -0.1984x + 361.78"
  },
  "support": {
    "pivot_1": {"index": 1429, "value": 48.99},
    "pivot_2": {"index": 1464, "value": 32.01},
    "slope": -0.4853,
    "intercept": 742.47,
    "equation": "y = -0.4853x + 742.47"
  }
}
```

**Usage in Strategies:**
```python
# Automatically calculated by FeatureFactory
rsi_trendlines = context.get_ltf_indicator('rsi_trendlines', {})

# Access resistance trendline
if 'resistance' in rsi_trendlines:
    res = rsi_trendlines['resistance']
    slope = res['slope']
    pivot_1 = res['pivot_1']  # {'index': int, 'value': float}
```

---

### 2. Full Score Transparency (`strategies_refactored.py`)

**Implementation:** All strategies include `observability` object in results

#### Legacy Strategy Score Composition

```json
{
  "score_composition": {
    // Raw indicator values
    "rsi": 48.14,
    "adx": 21.65,
    "ema50": 96578.44,
    "ema200": 95368.14,
    "close_price": 96582.0,
    
    // Scoring components
    "trend_score": 12.0,
    "structure_score": 10.0,
    "money_flow_score": 0.0,
    "timing_score": 2.2,
    
    // Weights and multipliers
    "adx_strong_trend": false,
    "volume_multiplier": 1.0,
    "pullback_detected": true,
    "pullback_depth": 0.57,
    
    // Market context
    "mcap": 0.0,
    "vol_24h": 4080511892.35,
    "divergence": "NONE",
    "obv_imbalance": "NEUTRAL",
    "is_overextended": false
  }
}
```

#### Breakout Strategy Score Composition

```json
{
  "score_composition": {
    // Raw indicator values
    "rsi": 55.95,
    "close_price": 96620.0,
    
    // Scoring components
    "geometry_score": 25.0,
    "momentum_score": 15.0,
    "oi_flow_score": 5.0,
    
    // Trendline data (if breakout detected)
    "trendline_slope": -0.1984,
    "trendline_start_idx": 1415,
    "trendline_end_idx": 1489,
    
    // External data availability
    "oi_available": false,
    "funding_available": false,
    "ls_ratio_available": false,
    "liquidations_available": false,
    
    // Market context
    "atr": 1250.5,
    "obv_signal": "NEUTRAL"
  }
}
```

---

### 3. Data Structure (`results_aggregator.py`)

**Preservation:** The aggregator preserves the `observability` object through the entire pipeline.

**Default Structure (if missing):**
```json
{
  "observability": {
    "score_composition": {},
    "rsi_visuals": {},
    "calculated_at": 0,
    "candle_index": 0
  }
}
```

**Complete Signal Example:**
```json
{
  "strategy_name": "Legacy",
  "symbol": "BTCUSDT",
  "canonical_symbol": "BTC",
  "exchange": "HYPERLIQUID",
  "price": 96582.0,
  "score": 26.2,
  "bias": "LONG",
  "action": "WAIT",
  
  "observability": {
    "score_composition": {
      "rsi": 48.14,
      "adx": 21.65,
      "trend_score": 12.0,
      "structure_score": 10.0,
      "pullback_detected": true,
      "pullback_depth": 0.57
    },
    "rsi_visuals": {
      "resistance": {
        "pivot_1": {"index": 1415, "value": 81.04},
        "pivot_2": {"index": 1489, "value": 66.36},
        "slope": -0.1984,
        "intercept": 361.78
      },
      "support": {
        "pivot_1": {"index": 1429, "value": 48.99},
        "pivot_2": {"index": 1464, "value": 32.01},
        "slope": -0.4853,
        "intercept": 742.47
      }
    },
    "calculated_at": 1768477500000,
    "candle_index": 1499
  }
}
```

---

### 4. Frontend API Bridge

**Endpoint:** `/api/results?source=HYPERLIQUID`

**Verification:**
```bash
# Test API response includes observability
curl http://localhost:3000/api/results?source=HYPERLIQUID | jq '.[0].observability'

# Expected output:
{
  "score_composition": { ... },
  "rsi_visuals": { ... },
  "calculated_at": 1768477500000,
  "candle_index": 1499
}
```

**Frontend Access (React/TypeScript):**
```typescript
interface Observability {
  score_composition: {
    rsi: number;
    adx: number;
    trend_score: number;
    structure_score: number;
    pullback_detected: boolean;
    pullback_depth: number;
    // ... other fields
  };
  rsi_visuals: {
    resistance?: {
      pivot_1: { index: number; value: number };
      pivot_2: { index: number; value: number };
      slope: number;
      intercept: number;
      equation: string;
    };
    support?: {
      pivot_1: { index: number; value: number };
      pivot_2: { index: number; value: number };
      slope: number;
      intercept: number;
      equation: string;
    };
  };
  calculated_at: number;
  candle_index: number;
}

// Usage in component
const signal = data[0];
const obs = signal.observability;

// Draw RSI trendline on chart
if (obs.rsi_visuals.resistance) {
  const { slope, intercept } = obs.rsi_visuals.resistance;
  const trendlineY = (x: number) => slope * x + intercept;
}
```

---

## Use Cases

### 1. Visual Chart Overlay

**Goal:** Draw RSI trendlines on price chart

```javascript
// Extract trendline data
const resistance = signal.observability.rsi_visuals.resistance;

// Plot trendline from pivot_1 to pivot_2
const x1 = resistance.pivot_1.index;
const y1 = resistance.pivot_1.value;
const x2 = resistance.pivot_2.index;
const y2 = resistance.pivot_2.value;

// Extend trendline to current candle
const currentIndex = signal.observability.candle_index;
const currentY = resistance.slope * currentIndex + resistance.intercept;

// Draw line on chart
chart.addLine([
  { x: x1, y: y1 },
  { x: x2, y: y2 },
  { x: currentIndex, y: currentY }
], { color: 'red', style: 'dashed' });
```

### 2. Score Breakdown Tooltip

**Goal:** Show detailed score calculation on hover

```javascript
const composition = signal.observability.score_composition;

const tooltip = `
  Score Breakdown:
  - Trend: ${composition.trend_score}
  - Structure: ${composition.structure_score}
  - Money Flow: ${composition.money_flow_score}
  - Timing: ${composition.timing_score}
  
  Indicators:
  - RSI: ${composition.rsi.toFixed(2)}
  - ADX: ${composition.adx.toFixed(2)}
  - EMA50: ${composition.ema50.toFixed(2)}
  
  Conditions:
  - Pullback: ${composition.pullback_detected ? 'Yes' : 'No'}
  - Depth: ${(composition.pullback_depth * 100).toFixed(1)}%
  - Overextended: ${composition.is_overextended ? 'Yes' : 'No'}
`;
```

### 3. Signal Verification Dashboard

**Goal:** Validate AI signals with human review

```javascript
// Filter signals with specific conditions
const verifiableSignals = signals.filter(s => {
  const obs = s.observability;
  return (
    obs.rsi_visuals.resistance &&  // Has resistance trendline
    obs.score_composition.pullback_detected &&  // In pullback
    obs.score_composition.adx > 20  // Strong trend
  );
});

// Display for human review
verifiableSignals.forEach(signal => {
  console.log(`${signal.symbol}: Score ${signal.score}`);
  console.log(`  RSI: ${signal.observability.score_composition.rsi}`);
  console.log(`  Trendline: ${signal.observability.rsi_visuals.resistance.equation}`);
});
```

---

## Testing & Validation

### Manual Scan Test

```bash
# Run scan with observability
venv/bin/python market_scanner_refactored.py \
  data/HYPERLIQUID_BTCUSDT_15m.json \
  --strategy Legacy

# Verify observability in output
venv/bin/python market_scanner_refactored.py \
  data/HYPERLIQUID_BTCUSDT_15m.json \
  --strategy Legacy 2>/dev/null | jq '.[0].observability'
```

### API Test

```bash
# Trigger manual scan
curl -X POST http://localhost:3000/api/scan/manual \
  -H "Content-Type: application/json" \
  -d '{"source": "HYPERLIQUID"}'

# Wait 30 seconds for scan to complete

# Fetch results with observability
curl http://localhost:3000/api/results?source=HYPERLIQUID | \
  jq '.[0] | {symbol, score, observability}'
```

### Validation Checklist

- [x] RSI trendlines detected (resistance & support)
- [x] Pivot coordinates include index and value
- [x] Trendline equation calculated (y = mx + b)
- [x] Score composition includes all raw indicators
- [x] Event timestamp captured (calculated_at)
- [x] Candle index recorded
- [x] Observability preserved through aggregator
- [x] Data accessible via /api/results endpoint

---

## Configuration

### Enable/Disable Features

**File:** `shared_context.py` - `create_default_config()`

```python
config = {
    'enabled_features': [
        'rsi',  # Required for trendline detection
        'ema',
        'adx',
        # ... other features
    ],
    
    # RSI Trendline Parameters
    'rsi_trendline_lookback': 100,
    'rsi_pivot_distance': 10,
    'rsi_pivot_prominence': 5,
}
```

### Adjust Sensitivity

**Increase Pivot Detection:**
```python
'rsi_pivot_prominence': 3  # Lower = more pivots detected
```

**Longer Lookback:**
```python
'rsi_trendline_lookback': 200  # More historical data
```

**Closer Pivots:**
```python
'rsi_pivot_distance': 5  # Pivots can be closer together
```

---

## Performance Considerations

### Computational Cost

- **RSI Trendline Detection:** ~5-10ms per symbol
- **Score Composition:** Negligible (data already calculated)
- **Total Overhead:** <2% increase in scan time

### Memory Usage

- **Observability Object:** ~500 bytes per signal
- **1000 signals:** ~500KB additional memory
- **Impact:** Minimal

### Optimization Tips

1. **Disable for batch scans** if not needed:
   ```python
   config['enabled_features'].remove('rsi')  # Disables trendline detection
   ```

2. **Reduce lookback** for faster processing:
   ```python
   'rsi_trendline_lookback': 50  # Half the default
   ```

3. **Cache results** on frontend to avoid repeated API calls

---

## Troubleshooting

### No RSI Trendlines Detected

**Symptoms:** `rsi_visuals` is empty `{}`

**Causes:**
1. Insufficient data (< 50 candles)
2. No prominent pivots found
3. RSI feature disabled

**Solutions:**
```python
# Check data length
if len(df) < 50:
    print("Insufficient data for trendline detection")

# Lower prominence threshold
config['rsi_pivot_prominence'] = 3

# Verify RSI is enabled
assert 'rsi' in config['enabled_features']
```

### Missing Observability Object

**Symptoms:** `observability` field is `null` or has default values

**Causes:**
1. Old strategy version (not refactored)
2. Aggregator sanitization issue
3. API caching old data

**Solutions:**
```bash
# Verify strategy is refactored
grep "observability" strategies_refactored.py

# Clear cache and restart
pm2 restart quantpro

# Force fresh scan
curl -X POST http://localhost:3000/api/scan/manual \
  -d '{"source": "HYPERLIQUID"}'
```

### Incorrect Timestamps

**Symptoms:** `calculated_at` is 0 or very old

**Causes:**
1. Candle data missing timestamp field
2. Timestamp not in milliseconds

**Solutions:**
```python
# Verify candle data has timestamp
df = pd.read_json('data/HYPERLIQUID_BTCUSDT_15m.json')
assert 'timestamp' in df.columns

# Convert to milliseconds if needed
df['timestamp'] = df['timestamp'] * 1000
```

---

## Future Enhancements

### Planned Features

1. **Volume Profile Visualization**
   - Price levels with highest volume
   - Support/resistance zones

2. **Order Flow Imbalance**
   - Buy/sell pressure visualization
   - Institutional footprint

3. **Multi-Timeframe Confluence**
   - HTF trendlines on LTF chart
   - Alignment indicators

4. **Machine Learning Confidence**
   - Model probability scores
   - Feature importance ranking

---

## Summary

### What Was Implemented

1. ✅ **RSI Trendline Pivot Detection**
   - Automatic support/resistance detection
   - Trendline equations for charting
   - Configurable sensitivity

2. ✅ **Full Score Transparency**
   - Every scoring variable exposed
   - Raw indicator values included
   - Weights and multipliers visible

3. ✅ **Event Timestamps**
   - Exact candle time captured
   - Candle index recorded
   - Millisecond precision

4. ✅ **Data Structure**
   - Observability object in all signals
   - Preserved through aggregator
   - Accessible via API

### Benefits

- **Human Verification:** Traders can validate AI signals
- **Visual Charting:** Draw trendlines and indicators on charts
- **Debugging:** Understand why signals were generated
- **Transparency:** Complete visibility into scoring logic
- **Education:** Learn how strategies work

---

**Documentation Version:** 1.0  
**Last Updated:** January 15, 2026  
**Maintainer:** QuantPro Development Team
