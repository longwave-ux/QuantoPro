# All Strategies Now Use 4H RSI Trendlines - Complete Implementation

**Date:** January 16, 2026  
**Change:** Unified all strategies to calculate and plot RSI trendlines on 4H timeframe  
**Affected Strategies:** Legacy, Breakout, BreakoutV2

---

## Overview

Previously, strategies used different timeframes for RSI trendline calculation:
- **Legacy**: LTF (15m) ❌
- **Breakout**: HTF (4h) ✅
- **BreakoutV2**: LTF (15m) ❌

**Now all strategies use HTF (4h) for consistency and better trend detection.**

---

## Changes Made

### Backend Changes (strategies_refactored.py)

#### 1. Legacy Strategy - Line 234
```python
# BEFORE:
rsi_trendlines = context.get_ltf_indicator('rsi_trendlines', {})

# AFTER:
# Extract RSI trendline visuals from context (HTF for all strategies)
rsi_trendlines = context.get_htf_indicator('rsi_trendlines', {})
```

#### 2. BreakoutV2 Strategy - Line 938
```python
# BEFORE:
rsi_trendlines = context.get_ltf_indicator('rsi_trendlines', {})

# AFTER:
# Use HTF RSI trendlines for all strategies (4h timeframe)
rsi_trendlines = context.get_htf_indicator('rsi_trendlines', {})
```

#### 3. BreakoutV2 Observability Builder - Line 1113
```python
# BEFORE:
rsi_trendlines = context.get_ltf_indicator('rsi_trendlines', {})

# AFTER:
# Get RSI trendlines from context (HTF for all strategies)
rsi_trendlines = context.get_htf_indicator('rsi_trendlines', {})
```

**Note:** Breakout strategy already used HTF trendlines (line 560), so no change needed.

---

### Frontend Changes (components/DetailPanel.tsx)

#### 1. getTrendlineData() - Line 152-153
```typescript
// BEFORE:
const usesHTF = pair.strategy_name === 'Breakout';
const sourceData = usesHTF ? indicators.htfData : indicators.ltfData;

// AFTER:
// ALL strategies now use HTF (4h) for RSI trendlines
const sourceData = indicators.htfData;
```

#### 2. getZoomedData() - Line 180-181
```typescript
// BEFORE:
const usesHTF = pair.strategy_name === 'Breakout';
const sourceData = usesHTF ? indicators.htfData : indicators.ltfData;

// AFTER:
// ALL strategies now use HTF (4h) for RSI trendlines
const sourceData = indicators.htfData;
```

#### 3. getObservabilityTrendlines() - Line 199-200
```typescript
// BEFORE:
const usesHTF = pair.strategy_name === 'Breakout';
const sourceData = usesHTF ? indicators.htfData : indicators.ltfData;

// AFTER:
// ALL strategies now use HTF (4h) for RSI trendlines
const sourceData = indicators.htfData;
```

#### 4. RSI Chart Label - Line 363
```typescript
// BEFORE:
RSI Analysis ({pair.strategy_name === 'Breakout' ? '4H' : '15m'})

// AFTER:
RSI Analysis (4H)
```

---

## Why 4H Timeframe?

### Advantages of 4H RSI Trendlines

1. **Better Trend Detection**
   - 4H timeframe filters out noise from lower timeframes
   - Clearer pivot highs and lows
   - More reliable trendline validation

2. **Consistency Across Strategies**
   - All strategies now use same timeframe for trendlines
   - Easier to compare signals across strategies
   - Unified observability data

3. **Institutional Alignment**
   - 4H timeframe aligns with institutional trading patterns
   - Matches OI Z-Score analysis (also on higher timeframes)
   - Better correlation with significant market moves

4. **Reduced False Signals**
   - 15m trendlines can break frequently due to intraday volatility
   - 4H trendlines are more stable and meaningful
   - Breakouts on 4H RSI are more significant

---

## Strategy-Specific Behavior

### All Strategies Now Unified

| Strategy | RSI Calculation | Trendline Calculation | Trendline Display | Chart Label |
|----------|----------------|----------------------|-------------------|-------------|
| **Legacy** | LTF (15m) | HTF (4h) ✅ | HTF (4h) ✅ | "4H" ✅ |
| **Breakout** | HTF (4h) | HTF (4h) ✅ | HTF (4h) ✅ | "4H" ✅ |
| **BreakoutV2** | LTF (15m) | HTF (4h) ✅ | HTF (4h) ✅ | "4H" ✅ |

**Key Points:**
- **RSI values** remain on their original timeframes (LTF for Legacy/V2, HTF for Breakout)
- **Trendlines** are now calculated on 4H for all strategies
- **Display** always shows 4H RSI chart with trendlines

---

## Data Flow

### Backend (Python)

1. **Feature Factory** (`shared_context.py`):
   ```python
   # Calculates RSI trendlines on HTF (4h) data
   htf_indicators['rsi_trendlines'] = self._detect_rsi_trendlines(
       rsi_series=htf_rsi,
       timestamp_series=htf_data['timestamp']
   )
   ```

2. **Strategy Analysis** (`strategies_refactored.py`):
   ```python
   # All strategies now fetch from HTF
   rsi_trendlines = context.get_htf_indicator('rsi_trendlines', {})
   ```

3. **JSON Output**:
   ```json
   {
     "observability": {
       "rsi_visuals": {
         "resistance": {
           "pivot_1": {"index": 85, "value": 65.2, "time": 1705420800000},
           "pivot_2": {"index": 142, "value": 68.5, "time": 1705507200000},
           "slope": 0.0234,
           "intercept": 63.1
         }
       }
     }
   }
   ```

### Frontend (TypeScript)

1. **Chart Data Fetch**:
   ```typescript
   // Fetches both HTF (4h) and LTF (15m) data
   const [htfData, ltfData] = await Promise.all([
       fetchCandles(symbol, '4h', source),
       fetchCandles(symbol, '15m', source)
   ]);
   ```

2. **Trendline Rendering**:
   ```typescript
   // Always uses htfData for trendline plotting
   const sourceData = indicators.htfData;
   
   // Finds pivot points by timestamp or index
   const p1 = findPoint(res.pivot_1);  // Uses htfData
   const p2 = findPoint(res.pivot_2);  // Uses htfData
   ```

3. **RSI Chart Display**:
   ```typescript
   // Shows 4H RSI data with trendlines
   <LineChart data={slicedData}>  {/* slicedData = htfData */}
       <Line dataKey="rsi" />
       <ReferenceLine segment={[p1, p2]} />  {/* Trendline */}
   </LineChart>
   ```

---

## Index Alignment

### How It Works

**Backend Calculation:**
- Detects pivots on 4H candles
- Stores indices: `pivot_1.index = 85` (85th 4H candle)
- Stores timestamps: `pivot_1.time = 1705420800000`

**Frontend Rendering:**
- Receives pivot data with both index and timestamp
- Uses `indicators.htfData` (4H candles)
- Matches by timestamp first (primary), index second (fallback)

**Perfect Alignment:**
```
Backend: 85th 4H candle at timestamp 1705420800000
Frontend: Finds 4H candle with timestamp 1705420800000
Result: ✅ Exact match, trendline plotted correctly
```

---

## Verification Steps

### 1. Run Scanner
```bash
python market_scanner_refactored.py data/ --strategy all --limit 5
```

### 2. Check JSON Output
```bash
cat master_feed.json | jq '.[0].observability.rsi_visuals'
```

Expected output:
```json
{
  "resistance": {
    "pivot_1": {
      "index": 85,
      "value": 65.2,
      "time": 1705420800000
    },
    "pivot_2": {
      "index": 142,
      "value": 68.5,
      "time": 1705507200000
    },
    "slope": 0.0234,
    "intercept": 63.1,
    "equation": "y = 0.0234x + 63.10"
  }
}
```

### 3. Verify Dashboard

Open Dashboard → Click any signal:

**For All Strategies:**
- ✅ RSI chart label shows "4H"
- ✅ Trendlines plotted on 4H data
- ✅ Indices align with 4H candles
- ✅ No timeframe mismatch errors

### 4. Browser Console
```
# Should see NO errors:
✅ No "[FETCH ERROR] Invalid baseUrl"
✅ No alignment warnings
✅ Charts load correctly
✅ Trendlines appear in correct positions
```

---

## Technical Details

### RSI Trendline Calculation (shared_context.py)

**Pivot Detection:**
```python
def _detect_rsi_trendlines(self, rsi_series: pd.Series, timestamp_series: pd.Series = None):
    # Uses k-order pivot logic (k=5 bars)
    # Detects pivot highs (resistance) and pivot lows (support)
    # Validates trendlines (no intermediate violations)
    
    # For HTF (4h):
    # - Each candle represents 4 hours
    # - k=5 means 20 hours of lookback
    # - More stable pivots than 15m (5 bars = 75 minutes)
```

**Trendline Validation:**
```python
def _find_valid_trendline(self, rsi_values, pivots, direction):
    # Ensures no intermediate RSI points violate the trendline
    # For 4H: More reliable validation due to less noise
    # Result: Higher quality trendlines
```

### Frontend Point Matching (DetailPanel.tsx)

**Primary Method - Timestamp Matching:**
```typescript
if (pivot.time) {
    const match = sourceData.find(d => Math.abs(d.time - pivot.time!) < 60000);
    if (match) return { x: match.time, y: pivot.value };
}
```

**Fallback Method - Index Matching:**
```typescript
if (sourceData[pivot.index]) {
    return { x: sourceData[pivot.index].time, y: pivot.value };
}
```

**Projection Calculation:**
```typescript
const candlesSinceP2 = (current.time - p2.x) / (sourceData[1].time - sourceData[0].time);
const currentY = res.pivot_2.value + (res.slope * candlesSinceP2);
```

---

## Impact on Strategies

### Legacy Strategy
**Before:**
- Used 15m RSI trendlines
- Frequent trendline breaks due to intraday volatility
- Less reliable signals

**After:**
- Uses 4H RSI trendlines
- More stable trendlines
- Better signal quality

### Breakout Strategy
**Before:**
- Already used 4H RSI trendlines ✅
- No change needed

**After:**
- Still uses 4H RSI trendlines ✅
- Consistent with other strategies

### BreakoutV2 Strategy
**Before:**
- Used 15m RSI trendlines
- Trendlines could break frequently
- Misalignment with OI Z-Score (higher timeframe)

**After:**
- Uses 4H RSI trendlines
- Better alignment with institutional flow (OI Z-Score)
- More meaningful breakouts

---

## Build Status

```bash
✓ 2513 modules transformed
dist/assets/index-rKjLhntz.js  678.10 kB
✓ built in 5.57s
```

**New build hash:** `rKjLhntz` (changed from `P-91SbHr`)

---

## Files Modified

### Backend
1. **`strategies_refactored.py`**
   - Line 234: Legacy strategy - Changed to HTF trendlines
   - Line 938: BreakoutV2 strategy - Changed to HTF trendlines
   - Line 1113: BreakoutV2 observability - Changed to HTF trendlines

### Frontend
2. **`components/DetailPanel.tsx`**
   - Line 152-153: getTrendlineData() - Always use htfData
   - Line 180-181: getZoomedData() - Always use htfData
   - Line 199-200: getObservabilityTrendlines() - Always use htfData
   - Line 363: RSI chart label - Always show "4H"

---

## Summary

### Changes
✅ **Backend**: All strategies now fetch HTF (4h) RSI trendlines  
✅ **Frontend**: All strategies now plot on HTF (4h) data  
✅ **Labels**: RSI chart always shows "4H"  
✅ **Alignment**: Perfect index/timestamp matching  

### Benefits
✅ **Consistency**: All strategies use same timeframe  
✅ **Quality**: Better trendline detection on 4H  
✅ **Reliability**: Fewer false breakouts  
✅ **Institutional Alignment**: Matches higher timeframe analysis  

### User Action Required
**HARD REFRESH BROWSER:**
- Windows/Linux: `Ctrl + Shift + R`
- Mac: `Cmd + Shift + R`

**Verify:**
- Network tab shows `index-rKjLhntz.js` (new bundle)
- All RSI charts show "4H" label
- Trendlines appear correctly aligned

---

**Status: COMPLETE** 🚀

All strategies now calculate and display RSI trendlines on 4H timeframe for consistent, high-quality trend analysis.
