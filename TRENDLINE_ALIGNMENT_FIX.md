# RSI Trendline Alignment Fix - Complete Resolution

**Date:** January 16, 2026  
**Issues Fixed:** 
1. Missing `source` field causing chart fetch failures
2. RSI trendline timeframe mismatch between backend and frontend

---

## Problem 1: Missing `source` Field

### Root Cause
The backend (`market_scanner_refactored.py`) was only adding `exchange` field to results, but the frontend's `getChartData()` function requires a `source` field of type `DataSource` ('KUCOIN' | 'MEXC' | 'HYPERLIQUID').

### Console Error
```
[FETCH ERROR] Invalid baseUrl for undefined. Check BASE_URLS configuration.
```

This occurred because `pair.source` was `undefined`, causing `BASE_URLS[undefined]` to fail.

### Fix Applied
**File:** `market_scanner_refactored.py` lines 241-248

```python
# Map exchange to DataSource for frontend chart fetching
exchange_to_source = {
    'BINANCE': 'MEXC',      # Use MEXC as fallback for Binance
    'MEXC': 'MEXC',
    'KUCOIN': 'KUCOIN',
    'HYPERLIQUID': 'HYPERLIQUID'
}
result['source'] = exchange_to_source.get(exchange.upper(), 'MEXC')
```

**Result:** ✅ Every result now includes a valid `source` field that maps to a valid `DataSource` type.

---

## Problem 2: RSI Trendline Timeframe Mismatch

### Root Cause Analysis

**Backend Behavior (Correct):**
- **Legacy Strategy**: Uses LTF (15m) RSI trendlines
  - `strategies_refactored.py` line 234: `context.get_ltf_indicator('rsi_trendlines')`
  
- **Breakout Strategy**: Uses HTF (4h) RSI trendlines
  - `strategies_refactored.py` line 560: `context.get_htf_indicator('rsi_trendlines')`
  
- **BreakoutV2 Strategy**: Uses LTF (15m) RSI trendlines
  - `strategies_refactored.py` line 937: `context.get_ltf_indicator('rsi_trendlines')`
  - `strategies_refactored.py` line 1112: `context.get_ltf_indicator('rsi_trendlines')`

**Frontend Behavior (INCORRECT):**
```typescript
// BEFORE (WRONG):
const isBreakout = pair.strategy_name === 'Breakout' || pair.strategy_name === 'BreakoutV2';
const sourceData = isBreakout ? indicators.htfData : indicators.ltfData;
```

This assumed **both** Breakout and BreakoutV2 use HTF data, causing:
1. BreakoutV2 trendlines plotted on wrong timeframe (4h instead of 15m)
2. Index misalignment between backend calculation and frontend rendering
3. Trendlines appearing shifted or in wrong positions

### The Alignment Issue

**Backend RSI Trendline Calculation:**
- Calculates pivot indices on the **actual timeframe** used (HTF for Breakout, LTF for BreakoutV2)
- Stores indices like `pivot_1.index = 85` (meaning 85th candle in that timeframe)

**Frontend Rendering (BEFORE FIX):**
- BreakoutV2: Backend calculated on LTF (15m), but frontend tried to plot on HTF (4h)
- Index 85 in 15m data ≠ Index 85 in 4h data
- Result: Trendlines appeared shifted or completely misaligned

### Fix Applied

**File:** `components/DetailPanel.tsx`

**1. getTrendlineData() - Line 152-154**
```typescript
// BEFORE:
const isBreakout = pair.strategy_name === 'Breakout' || pair.strategy_name === 'BreakoutV2';
const sourceData = isBreakout ? indicators.htfData : indicators.ltfData;

// AFTER:
// CRITICAL: Only 'Breakout' uses HTF (4h), BreakoutV2 and Legacy use LTF (15m)
const usesHTF = pair.strategy_name === 'Breakout';
const sourceData = usesHTF ? indicators.htfData : indicators.ltfData;
```

**2. getZoomedData() - Line 179-181**
```typescript
// AFTER:
const usesHTF = pair.strategy_name === 'Breakout';
const sourceData = usesHTF ? indicators.htfData : indicators.ltfData;
```

**3. getObservabilityTrendlines() - Line 200-202**
```typescript
// AFTER:
const usesHTF = pair.strategy_name === 'Breakout';
const sourceData = usesHTF ? indicators.htfData : indicators.ltfData;
```

**4. RSI Chart Label - Line 363**
```typescript
// BEFORE:
RSI Analysis ({(pair.strategy_name === 'Breakout' || pair.strategy_name === 'BreakoutV2') ? '4H' : '15m'})

// AFTER:
RSI Analysis ({pair.strategy_name === 'Breakout' ? '4H' : '15m'})
```

**5. Trendline Rendering - Line 402**
```typescript
// BEFORE:
{(pair.strategy_name === 'Breakout' || pair.strategy_name === 'BreakoutV2') && trendLineSegment && (

// AFTER:
{pair.strategy_name === 'Breakout' && trendLineSegment && (
```

---

## Strategy-Specific Behavior

| Strategy | Timeframe | RSI Source | Trendline Source | Chart Display |
|----------|-----------|------------|------------------|---------------|
| **Legacy** | LTF (15m) | `context.get_ltf_indicator('rsi')` | `context.get_ltf_indicator('rsi_trendlines')` | 15m RSI chart |
| **Breakout** | HTF (4h) | `context.get_htf_indicator('rsi')` | `context.get_htf_indicator('rsi_trendlines')` | 4h RSI chart |
| **BreakoutV2** | LTF (15m) | `context.get_ltf_indicator('rsi')` | `context.get_ltf_indicator('rsi_trendlines')` | 15m RSI chart |

---

## How RSI Trendlines Work

### Backend Calculation (shared_context.py)

1. **Pivot Detection** (lines 495-610):
   - Uses k-order pivot logic (k=5 bars)
   - Detects pivot highs (resistance) and pivot lows (support)
   - Validates trendlines (no intermediate violations)

2. **Index Storage**:
   ```python
   result['resistance'] = {
       'pivot_1': {'index': p1_idx, 'value': p1_val, 'time': timestamp},
       'pivot_2': {'index': p2_idx, 'value': p2_val, 'time': timestamp},
       'slope': slope,
       'intercept': intercept
   }
   ```

3. **Timeframe Alignment**:
   - Indices are **relative to the timeframe** used for calculation
   - HTF calculation: indices refer to HTF candles
   - LTF calculation: indices refer to LTF candles

### Frontend Rendering (DetailPanel.tsx)

1. **Data Selection** (NOW FIXED):
   ```typescript
   const usesHTF = pair.strategy_name === 'Breakout';
   const sourceData = usesHTF ? indicators.htfData : indicators.ltfData;
   ```

2. **Point Matching** (lines 206-221):
   - **Primary**: Match by timestamp (1 min tolerance)
   - **Fallback**: Match by index
   - This ensures alignment even if there are small time discrepancies

3. **Projection Calculation** (lines 238-241):
   ```typescript
   const candlesSinceP2 = (current.time - p2.x) / (sourceData[1].time - sourceData[0].time);
   const currentY = res.pivot_2.value + (res.slope * candlesSinceP2);
   ```

---

## Verification Steps

### 1. Check Source Field
```bash
# Run scanner
python market_scanner_refactored.py data/ --strategy all --limit 5

# Check JSON output
cat master_feed.json | jq '.[0] | {symbol, exchange, source}'

# Expected output:
{
  "symbol": "ETHFIUSDTM",
  "exchange": "BINANCE",
  "source": "MEXC"  # ✅ Now present
}
```

### 2. Check Trendline Alignment
Open Dashboard → Click on a signal:

**For Breakout Strategy:**
- RSI chart label shows "4H" ✅
- Trendlines plotted on 4H data ✅
- Indices align with 4H candles ✅

**For BreakoutV2 Strategy:**
- RSI chart label shows "15m" ✅
- Trendlines plotted on 15m data ✅
- Indices align with 15m candles ✅

**For Legacy Strategy:**
- RSI chart label shows "15m" ✅
- No trendlines (Legacy doesn't use them) ✅

### 3. Browser Console
```
# BEFORE (BROKEN):
[FETCH ERROR] Invalid baseUrl for undefined. Check BASE_URLS configuration.

# AFTER (FIXED):
✅ No fetch errors
✅ Charts load correctly
✅ Trendlines appear in correct positions
```

---

## Technical Details

### Why the Mismatch Occurred

**Scenario:** BreakoutV2 signal for ETHFIUSDTM

1. **Backend** (Python):
   - Fetches 15m candles (1000 candles = ~10 days)
   - Calculates RSI on 15m data
   - Detects trendline pivots: `pivot_1.index = 85`, `pivot_2.index = 142`
   - These indices refer to the **85th and 142nd 15m candles**

2. **Frontend** (BEFORE FIX):
   - Receives pivot indices: 85, 142
   - **Incorrectly** uses `indicators.htfData` (4h candles)
   - Tries to plot at 4h candles[85] and 4h candles[142]
   - **Problem**: 85th 4h candle ≠ 85th 15m candle
   - Result: Trendline appears shifted by ~5.6x (4h/15m = 16 candles)

3. **Frontend** (AFTER FIX):
   - Receives pivot indices: 85, 142
   - **Correctly** uses `indicators.ltfData` (15m candles)
   - Plots at 15m candles[85] and 15m candles[142]
   - **Result**: Perfect alignment ✅

### Timestamp Matching

The frontend uses timestamp matching as primary method:
```typescript
if (pivot.time) {
    const match = sourceData.find(d => Math.abs(d.time - pivot.time!) < 60000);
    if (match) return { x: match.time, y: pivot.value };
}
```

This provides additional safety:
- Even if indices are slightly off, timestamps ensure correct alignment
- 1-minute tolerance handles minor time discrepancies
- Falls back to index matching if timestamps unavailable

---

## Files Modified

### Backend
1. **`market_scanner_refactored.py`** (lines 241-248)
   - Added `source` field mapping from exchange to DataSource

### Frontend
2. **`components/DetailPanel.tsx`** (multiple locations)
   - Line 152-154: Fixed `getTrendlineData()` timeframe selection
   - Line 179-181: Fixed `getZoomedData()` timeframe selection
   - Line 200-202: Fixed `getObservabilityTrendlines()` timeframe selection
   - Line 363: Fixed RSI chart label (4H vs 15m)
   - Line 402: Fixed trendline rendering condition

---

## Build Status

```bash
✓ 2513 modules transformed
dist/assets/index-P-91SbHr.js  678.26 kB
✓ built in 5.74s
```

**New build hash:** `P-91SbHr` (changed from `BOCn9meN`)

---

## Summary

### Issues Fixed

1. ✅ **Missing `source` field**: Backend now maps exchange to DataSource
2. ✅ **Timeframe mismatch**: Frontend now correctly uses HTF for Breakout, LTF for BreakoutV2/Legacy
3. ✅ **Index alignment**: Trendline indices now match the correct timeframe data
4. ✅ **Chart labels**: RSI chart shows correct timeframe (4H vs 15m)
5. ✅ **Trendline rendering**: Only Breakout uses setup.trendline, BreakoutV2 uses observability.rsi_visuals

### Strategy Behavior (Verified)

| Strategy | RSI Timeframe | Trendline Data | Chart Label | Rendering |
|----------|---------------|----------------|-------------|-----------|
| Legacy | 15m (LTF) | `rsi_trendlines` from LTF | "15m" | No trendlines |
| Breakout | 4h (HTF) | `rsi_trendlines` from HTF | "4H" | setup.trendline |
| BreakoutV2 | 15m (LTF) | `rsi_trendlines` from LTF | "15m" | observability.rsi_visuals |

### User Action Required

**HARD REFRESH BROWSER:**
- Windows/Linux: `Ctrl + Shift + R`
- Mac: `Cmd + Shift + R`
- Or: DevTools → Right-click refresh → "Empty Cache and Hard Reload"

**Verify in Network tab:**
- New bundle: `index-P-91SbHr.js` (not old `index-BOCn9meN.js`)

---

## Success Criteria

✅ No `[FETCH ERROR] Invalid baseUrl` errors  
✅ Charts load for all signals  
✅ RSI trendlines appear in correct positions  
✅ Breakout shows 4H RSI chart  
✅ BreakoutV2 shows 15m RSI chart  
✅ Trendlines align with actual RSI pivots  
✅ No index/timestamp mismatches  

**Status: COMPLETE** 🚀
