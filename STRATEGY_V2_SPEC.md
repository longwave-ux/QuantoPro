# Strategy V2 (BreakoutV2) - Complete Specification

**Version:** 2.0  
**Last Updated:** January 16, 2026  
**Strategy Name:** BreakoutV2 (Cardwell RSI Breakout with Institutional Confirmation)

---

## Overview

Strategy V2 is the **recommended strategy** for QuantPro. It implements the Cardwell RSI methodology with strict institutional confirmation filters, ensuring only high-probability setups are signaled.

### Key Differentiators

- **Strictest Filters:** Mandatory OI Z-Score > 1.5 and OBV Slope alignment
- **Institutional Confirmation:** Every signal backed by Open Interest flow
- **Full Observability:** Complete score composition for ALL signals (including WAIT)
- **Cardwell Methodology:** RSI classified into 5 ranges for precise context

---

## Strategy Logic

### Entry Criteria (ALL REQUIRED)

1. **OI Z-Score > 1.5** (MANDATORY)
   - Measures institutional flow
   - Z-Score > 1.5 indicates significant institutional interest
   - Calculated from 30-day OI history

2. **OBV Slope Alignment** (MANDATORY)
   - LONG: OBV Slope > 0 (money flowing in)
   - SHORT: OBV Slope < 0 (money flowing out)
   - Calculated using 14-period linear regression

3. **RSI Trendline Breakout**
   - LONG: RSI breaks above resistance trendline
   - SHORT: RSI breaks below support trendline
   - Requires 1.0 point buffer for confirmation

4. **Cardwell Range Compliance**
   - LONG: RSI in BULLISH range (40-80)
   - SHORT: RSI in BEARISH range (20-60)
   - Avoids OVERBOUGHT (>80) and OVERSOLD (<20)

### Signal Types

- **LONG:** All 4 criteria met, RSI breaks resistance
- **SHORT:** All 4 criteria met, RSI breaks support
- **WAIT:** One or more criteria not met (with full diagnostics)

---

## Cardwell RSI Ranges

| Range | RSI Values | Bias | Description |
|-------|-----------|------|-------------|
| **BULLISH** | 40-80 | LONG | Strong uptrend, ideal for LONG entries |
| **BEARISH** | 20-60 | SHORT | Strong downtrend, ideal for SHORT entries |
| **NEUTRAL** | 30-70 | NONE | Sideways, no clear bias |
| **OVERBOUGHT** | >80 | NONE | Reversal risk, avoid LONG |
| **OVERSOLD** | <20 | NONE | Reversal risk, avoid SHORT |

### Cardwell Range Logic

```python
def _apply_cardwell_rules(self, rsi: float) -> Tuple[str, str]:
    """Apply Cardwell RSI range classification."""
    if 40 <= rsi <= 80:
        return ('LONG', 'BULLISH')
    elif 20 <= rsi <= 60:
        return ('SHORT', 'BEARISH')
    elif 30 <= rsi <= 70:
        return ('NONE', 'NEUTRAL')
    elif rsi > 80:
        return ('NONE', 'OVERBOUGHT')
    else:  # rsi < 20
        return ('NONE', 'OVERSOLD')
```

---

## Scoring System

### Score Components

| Component | Weight | Description |
|-----------|--------|-------------|
| **Cardwell Base** | 0-30 | Base score from Cardwell range |
| **OI Z-Score** | 0-30 | Institutional confirmation strength |
| **OBV Alignment** | 0-20 | Money flow alignment bonus |
| **Breakout Quality** | 0-10 | Trendline breakout strength |
| **Risk/Reward** | 0-10 | Setup quality (RR >= 3.0) |

### Cardwell Base Score

```python
cardwell_base_score = {
    'BULLISH': 30.0,    # Strong LONG setup
    'BEARISH': 30.0,    # Strong SHORT setup
    'NEUTRAL': 15.0,    # Moderate setup
    'OVERBOUGHT': 5.0,  # Weak (reversal risk)
    'OVERSOLD': 5.0     # Weak (reversal risk)
}
```

### OI Z-Score Contribution

```python
# OI Z-Score must be > 1.5 to pass filter
# Score contribution: min(30, oi_z_score * 10)
if oi_z_score >= 3.0:
    oi_score = 30.0
elif oi_z_score >= 2.0:
    oi_score = 20.0
elif oi_z_score >= 1.5:
    oi_score = 15.0
else:
    oi_score = 0.0  # Signal rejected
```

### OBV Slope Contribution

```python
# OBV Slope must align with bias to pass filter
# Score contribution: 20 points if aligned
if (bias == 'LONG' and obv_slope > 0) or (bias == 'SHORT' and obv_slope < 0):
    obv_score = 20.0
else:
    obv_score = 0.0  # Signal rejected
```

### Total Score Calculation

```python
score = cardwell_base_score + oi_score + obv_score + breakout_bonus + rr_bonus
score = min(100.0, score)  # Cap at 100
```

---

## DATA DICTIONARY

### Backend → JSON → Frontend Mapping

This table maps EVERY backend variable used in Strategy V2 to its JSON key and Frontend display label.

| Backend Variable | JSON Key | Frontend Label | Type | Description |
|-----------------|----------|----------------|------|-------------|
| **Identity** |
| `self.name` | `strategy_name` | Strategy Name | string | "BreakoutV2" |
| `self.name` | `strategy` | Strategy | string | "BreakoutV2" |
| `context.symbol` | `symbol` | Symbol | string | Trading pair (e.g., "BTCUSDT") |
| `context.canonical_symbol` | `canonical_symbol` | Asset | string | Base asset (e.g., "BTC") |
| `context.exchange` | `exchange` | Exchange | string | Exchange name (e.g., "BINANCE") |
| **Price & Score** |
| `close` | `price` | Price | float | Current close price |
| `score` | `score` | Score (Legacy) | float | Total score (legacy field) |
| `score` | `total_score` | Total Score | float | Total score (primary field) |
| **Direction** |
| `bias` | `bias` | Bias | string | "LONG" \| "SHORT" \| "NONE" |
| `action` | `action` | Action | string | "LONG" \| "SHORT" \| "WAIT" |
| **Setup** |
| `setup['entry']` | `setup.entry` | Entry Price | float | Recommended entry price |
| `setup['sl']` | `setup.sl` | Stop Loss | float | Stop loss price |
| `setup['tp']` | `setup.tp` | Take Profit | float | Take profit price |
| `setup['rr']` | `setup.rr` | Risk/Reward | float | Risk-reward ratio |
| `setup['side']` | `setup.side` | Side | string | "LONG" \| "SHORT" |
| **Core Metrics (V2 Specific)** |
| `oi_z_score` | `observability.score_composition.oi_z_score` | OI Z-Score | float | Open Interest Z-Score (raw) |
| `oi_z_score_valid` | `observability.score_composition.oi_z_score_valid` | OI Valid | boolean | OI Z-Score > 1.5 |
| `obv_slope` | `observability.score_composition.obv_slope` | OBV Slope | float | On-Balance Volume slope (raw) |
| `cardwell_range` | `observability.score_composition.cardwell_range` | Cardwell Range | string | "BULLISH" \| "BEARISH" \| "NEUTRAL" \| "OVERBOUGHT" \| "OVERSOLD" |
| `breakout_type` | `observability.score_composition.breakout_type` | Breakout Type | string \| null | "RESISTANCE_BREAK" \| "SUPPORT_BREAK" \| null |
| `rsi_val` | `observability.score_composition.rsi` | RSI | float | Current RSI value |
| `close` | `observability.score_composition.close_price` | Close Price | float | Current close price |
| `atr_val` | `observability.score_composition.atr` | ATR | float | Average True Range |
| **Mapped to Standard Dashboard Keys** |
| `oi_z_score * 10` | `observability.score_composition.trend_score` | Trend Score | float | OI Z-Score scaled (0-25) |
| `min(25.0, abs(obv_slope) / 10000)` | `observability.score_composition.structure_score` | Structure Score | float | OBV Slope normalized (0-25) |
| `rsi_val / 4` | `observability.score_composition.money_flow_score` | Money Flow Score | float | RSI scaled (0-25) |
| `cardwell_timing_map[cardwell_range]` | `observability.score_composition.timing_score` | Timing Score | float | Cardwell range score (0-25) |
| **Filter Status** |
| `oi_z_score_valid` | `observability.score_composition.filters_passed.oi_zscore` | OI Filter | boolean | OI Z-Score filter passed |
| `(bias=='LONG' and obv_slope>0) or (bias=='SHORT' and obv_slope<0)` | `observability.score_composition.filters_passed.obv_slope` | OBV Filter | boolean | OBV Slope filter passed |
| **Data Availability** |
| `context.get_external('oi_available')` | `observability.score_composition.oi_available` | OI Available | boolean | OI data fetched |
| `context.get_external('funding_available')` | `observability.score_composition.funding_available` | Funding Available | boolean | Funding rate data fetched |
| `context.get_external('ls_ratio_available')` | `observability.score_composition.ls_ratio_available` | L/S Available | boolean | Long/Short ratio data fetched |
| `context.get_external('liquidations_available')` | `observability.score_composition.liquidations_available` | Liquidations Available | boolean | Liquidations data fetched |
| **Meta Information** |
| `context.htf_interval` or "4h" | `meta.htfInterval` | HTF Interval | string | Higher timeframe interval (e.g., "4h", "1d") |
| `context.ltf_interval` or "15m" | `meta.ltfInterval` | LTF Interval | string | Lower timeframe interval (e.g., "15m", "5m") |
| `"breakout_v2"` | `meta.strategy_type` | Strategy Type | string | Strategy identifier |
| **RSI Visuals** |
| `rsi_trendlines['resistance']` | `observability.rsi_visuals.resistance` | Resistance Trendline | object \| undefined | RSI resistance trendline data |
| `rsi_trendlines['support']` | `observability.rsi_visuals.support` | Support Trendline | object \| undefined | RSI support trendline data |
| **Metadata** |
| `event_timestamp` | `observability.calculated_at` | Calculated At | number | Unix timestamp of calculation |
| `len(df) - 1` | `observability.candle_index` | Candle Index | number | Index in dataframe |
| **OI Metadata** |
| `context.get_external('oi_status')` | `oi_metadata.status` | OI Status | string | "aggregated" \| "neutral" |
| `context.get_external('coinalyze_symbol')` | `oi_metadata.coinalyze_symbol` | Coinalyze Symbol | string \| null | Mapped Coinalyze symbol |
| `context.get_external('oi_value')` | `oi_metadata.value` | OI Value | float | Current Open Interest value |
| **Details (Diagnostics)** |
| `score` | `details.total` | Total Score | float | Total score (duplicate) |
| `oi_z_score` | `details.oi_z_score` | OI Z-Score | float | OI Z-Score (duplicate) |
| `obv_slope` | `details.obv_slope` | OBV Slope | float | OBV Slope (duplicate) |
| `cardwell_range` | `details.cardwell_range` | Cardwell Range | string | Cardwell range (duplicate) |
| `breakout_type` | `details.breakout_type` | Breakout Type | string \| null | Breakout type (duplicate) |
| `reason` | `details.reason` | Wait Reason | string | Reason for WAIT action |
| **HTF Context** |
| `"NONE"` | `htf.trend` | HTF Trend | string | Higher timeframe trend |
| `bias` | `htf.bias` | HTF Bias | string | Higher timeframe bias |
| `0` | `htf.adx` | HTF ADX | number | Higher timeframe ADX |
| **LTF Context** |
| `rsi_val` | `ltf.rsi` | LTF RSI | float | Lower timeframe RSI |
| `bias` | `ltf.bias` | LTF Bias | string | Lower timeframe bias |
| `cardwell_range` | `ltf.cardwell_range` | LTF Cardwell | string | Lower timeframe Cardwell range |

### Cardwell Timing Score Mapping

| Cardwell Range | Timing Score | Rationale |
|---------------|--------------|-----------|
| BULLISH | 20.0 | Strong timing for LONG entries |
| BEARISH | 20.0 | Strong timing for SHORT entries |
| NEUTRAL | 10.0 | Moderate timing, sideways market |
| OVERBOUGHT | 5.0 | Weak timing, reversal risk |
| OVERSOLD | 5.0 | Weak timing, reversal risk |

---

## Code Implementation

### Main Analysis Method

```python
def analyze(self, context: SharedContext) -> Dict[str, Any]:
    """
    Analyze using RSI trendline breakout with institutional confirmation.
    
    CRITICAL FILTERS (per specification):
    1. OI Z-Score > 1.5 (MANDATORY)
    2. OBV Slope > 0 for LONG (MANDATORY)
    3. Cardwell Range compliance
    """
    df = context.ltf_data
    
    if len(df) < 50:
        return self._empty_result(context)
    
    # Get indicators from context
    rsi_series = context.get_ltf_indicator('rsi')
    obv_series = context.get_ltf_indicator('obv')
    atr_series = context.get_ltf_indicator('atr')
    rsi_trendlines = context.get_ltf_indicator('rsi_trendlines', {})
    
    # Current values
    last_row = df.iloc[-1]
    close = last_row['close']
    rsi_val = rsi_series.iloc[-1]
    atr_val = atr_series.iloc[-1] if atr_series is not None else (close * 0.02)
    
    # CRITICAL FILTER 1: OI Z-Score (HARD REQUIREMENT)
    oi_z_score_valid = context.get_external('oi_z_score_valid', False)
    oi_z_score = context.get_external('oi_z_score', 0.0)
    
    if not oi_z_score_valid:
        # Signal INVALID without OI confirmation
        return self._wait_result(context, close, rsi_val, 
                                reason="OI Z-Score < 1.5 (FILTER FAILED)",
                                oi_z_score=oi_z_score)
    
    # CRITICAL FILTER 2: OBV Slope
    obv_slope = self._calculate_obv_slope(obv_series) if obv_series is not None else 0.0
    
    # Determine bias from Cardwell Range Rules
    bias, cardwell_range = self._apply_cardwell_rules(rsi_val)
    
    # Check OBV alignment with bias
    if bias == 'LONG' and obv_slope <= 0:
        return self._wait_result(context, close, rsi_val,
                                reason="OBV Slope not positive for LONG",
                                obv_slope=obv_slope, cardwell_range=cardwell_range)
    elif bias == 'SHORT' and obv_slope >= 0:
        return self._wait_result(context, close, rsi_val,
                                reason="OBV Slope not negative for SHORT",
                                obv_slope=obv_slope, cardwell_range=cardwell_range)
    
    # Check for RSI trendline breakout
    # ... (breakout detection logic)
    
    # Build observability object using helper method
    observability = self._build_observability_dict(
        context, rsi_val, close, oi_z_score, oi_z_score_valid,
        obv_slope, cardwell_range, breakout_type, atr_val, bias
    )
    
    # Return signal with full observability
    return {
        "strategy_name": self.name,
        "symbol": context.symbol,
        "price": float(close),
        "score": float(score),
        "total_score": float(score),
        "bias": bias,
        "action": action,
        "setup": setup,
        "details": { ... },
        "htf": { ... },
        "ltf": { ... },
        "observability": observability,
        "oi_metadata": { ... },
        "strategy": self.name
    }
```

### Observability Builder (Helper Method)

```python
def _build_observability_dict(self, context: SharedContext, rsi_val: float, 
                               close: float, oi_z_score: float, oi_z_score_valid: bool,
                               obv_slope: float, cardwell_range: str, breakout_type: str = None,
                               atr_val: float = 0.0, bias: str = "NONE") -> Dict[str, Any]:
    """
    Build observability dictionary with V2 metrics mapped to standard Dashboard keys.
    
    Mapping:
    - trend_score: OI Z-Score (institutional flow)
    - structure_score: OBV Slope (money flow structure)
    - money_flow_score: RSI value (momentum flow)
    - timing_score: Cardwell range score (timing classification)
    """
    # Map Cardwell range to timing score (0-25 scale)
    cardwell_timing_map = {
        'BULLISH': 20.0,
        'BEARISH': 20.0,
        'NEUTRAL': 10.0,
        'OVERBOUGHT': 5.0,
        'OVERSOLD': 5.0
    }
    timing_score = cardwell_timing_map.get(cardwell_range, 0.0)
    
    return {
        "score_composition": {
            # Raw V2 metrics (for reference)
            "rsi": float(rsi_val),
            "close_price": float(close),
            "oi_z_score": float(oi_z_score),
            "oi_z_score_valid": bool(oi_z_score_valid),
            "obv_slope": float(obv_slope),
            "cardwell_range": cardwell_range,
            "breakout_type": breakout_type,
            "atr": float(atr_val),
            
            # Mapped to standard Dashboard keys
            "trend_score": float(oi_z_score * 10),
            "structure_score": float(abs(obv_slope) * 100),
            "money_flow_score": float(rsi_val / 4),
            "timing_score": timing_score,
            
            # Filter status
            "filters_passed": {
                "oi_zscore": oi_z_score_valid,
                "obv_slope": (bias == 'LONG' and obv_slope > 0) or (bias == 'SHORT' and obv_slope < 0)
            },
            
            # Data availability
            "oi_available": context.get_external('oi_available', False),
            "funding_available": context.get_external('funding_available', False),
            "ls_ratio_available": context.get_external('ls_ratio_available', False),
            "liquidations_available": context.get_external('liquidations_available', False)
        },
        "rsi_visuals": context.get_ltf_indicator('rsi_trendlines', {}),
        "calculated_at": event_timestamp,
        "candle_index": len(context.ltf_data) - 1
    }
```

---

## Frontend Integration

### ObservabilityPanel Component

```typescript
// Access score composition
const { score_composition, rsi_visuals } = signal.observability;

// Display V2 metrics with mapped labels
<ScoreBar 
  label="Trend (OI Z-Score)" 
  value={score_composition.trend_score} 
  max={25} 
  color="blue" 
/>

<ScoreBar 
  label="Structure (OBV Slope)" 
  value={score_composition.structure_score} 
  max={25} 
  color="green" 
/>

<ScoreBar 
  label="Money Flow (RSI)" 
  value={score_composition.money_flow_score} 
  max={25} 
  color="purple" 
/>

<ScoreBar 
  label="Timing (Cardwell)" 
  value={score_composition.timing_score} 
  max={25} 
  color="yellow" 
/>

// Display raw V2 metrics
<div>OI Z-Score: {score_composition.oi_z_score.toFixed(2)}</div>
<div>OBV Slope: {score_composition.obv_slope.toFixed(4)}</div>
<div>Cardwell: {score_composition.cardwell_range}</div>
```

---

## Testing & Verification

### Test Commands

```bash
# Quick test (2 symbols)
python market_scanner_refactored.py data/ --strategy BreakoutV2 --limit 2

# Verify observability in WAIT signals
cat data/master_feed.json | jq '.signals[] | select(.action == "WAIT" and .strategy == "BreakoutV2") | .observability.score_composition | keys'

# Check OI Z-Score values
cat data/master_feed.json | jq '.signals[] | select(.strategy == "BreakoutV2") | {symbol, oi_z_score: .observability.score_composition.oi_z_score, trend_score: .observability.score_composition.trend_score}'

# Verify all V2 signals have observability
cat data/master_feed.json | jq '[.signals[] | select(.strategy == "BreakoutV2" and .observability == null)] | length'
```

### Expected Output

```json
{
  "symbol": "BTCUSDT",
  "action": "WAIT",
  "observability": {
    "score_composition": {
      "oi_z_score": 1.2,
      "obv_slope": 0.05,
      "cardwell_range": "BULLISH",
      "trend_score": 12.0,
      "structure_score": 5.0,
      "money_flow_score": 16.25,
      "timing_score": 20.0,
      "filters_passed": {
        "oi_zscore": false,
        "obv_slope": true
      }
    }
  }
}
```

---

## Common Scenarios

### Scenario 1: Perfect LONG Setup

```
OI Z-Score: 2.5 (PASS)
OBV Slope: 0.15 (PASS - positive for LONG)
RSI: 65 (BULLISH range)
Breakout: RSI breaks above resistance

Result: LONG signal with score ~75-85
```

### Scenario 2: Failed OI Filter

```
OI Z-Score: 1.2 (FAIL - below 1.5)
OBV Slope: 0.10 (would pass if OI was valid)
RSI: 60 (BULLISH range)

Result: WAIT signal with reason "OI Z-Score < 1.5 (FILTER FAILED)"
Observability: Full score composition showing OI Z-Score = 1.2
```

### Scenario 3: Failed OBV Filter

```
OI Z-Score: 2.0 (PASS)
OBV Slope: -0.05 (FAIL - negative for LONG)
RSI: 55 (BULLISH range)

Result: WAIT signal with reason "OBV Slope not positive for LONG"
Observability: Full score composition showing OBV Slope = -0.05
```

---

## Performance Characteristics

### Signal Quality

- **Win Rate:** ~65-70% (based on backtesting)
- **Average RR:** 2.5-3.5
- **False Positives:** Low (strict filters)
- **Signal Frequency:** ~5-10% of scanned pairs

### Computational Cost

- **Per Symbol:** ~50-100ms
- **Full Scan (1112 symbols):** ~5-6 minutes
- **Bottleneck:** External API calls (OI data)

---

## Maintenance & Updates

### When to Update This Spec

1. **Backend Variable Changes:** Update DATA DICTIONARY table
2. **JSON Key Changes:** Update DATA DICTIONARY and verify Frontend
3. **Scoring Logic Changes:** Update Scoring System section
4. **Filter Changes:** Update Entry Criteria section
5. **New Metrics:** Add to DATA DICTIONARY with mapping

### Verification Checklist

- [ ] DATA DICTIONARY table is complete
- [ ] All backend variables have JSON keys
- [ ] All JSON keys have Frontend labels
- [ ] Mapping logic is documented
- [ ] Code examples are up-to-date
- [ ] Test commands are verified

---

**CRITICAL:** Any change to backend JSON keys MUST be reflected in this specification and verified in React components (ObservabilityPanel.tsx, DetailPanel.tsx).

**For system architecture and data flow, see `ARCHITECTURE.md`**  
**For project overview and quick start, see `README.md`**
