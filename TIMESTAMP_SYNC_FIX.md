# Timestamp Synchronization Fix Report

**Issue:** Dashboard "Last Update" timestamp not reflecting actual scan completion time.

## Root Cause Analysis

### Current Flow
1. **Node.js** (`server/scanner.js` line 181) adds `timestamp: now` to each result
2. **Results saved** to `data/latest_results_{SOURCE}.json`
3. **Aggregator** (`results_aggregator.py`) preserves timestamps, writes to `master_feed.json`
4. **Frontend** (`App.tsx` line 43-45) reads `data[0].timestamp` from API response
5. **API endpoint** (`server.js` line 130-132) returns `master_feed.json` content

### Problem Identified
The `/api/results` endpoint **ignores the `source` query parameter** and always returns `master_feed.json`, which may not have been updated yet when a manual scan completes.

**Sequence:**
1. User clicks "Scan" button → `/api/scan/manual` called
2. Node.js runs scan → saves to `latest_results_HYPERLIQUID.json`
3. Frontend polls `/api/results?source=HYPERLIQUID`
4. API returns `master_feed.json` (old data, not yet aggregated)
5. Timestamp doesn't update because aggregator hasn't run yet

## Solution

### Fix 1: Update `/api/results` to Respect Source Parameter

**File:** `server.js` (Line 130-133)

**Before:**
```javascript
app.get('/api/results', async (req, res) => {
    const results = await getMasterFeed();
    res.json(results);
});
```

**After:**
```javascript
app.get('/api/results', async (req, res) => {
    const { source } = req.query;
    
    // If source specified, return source-specific results
    if (source) {
        const sourceResults = await getLatestResults(source);
        res.json(sourceResults);
    } else {
        // Otherwise return aggregated master feed
        const results = await getMasterFeed();
        res.json(results);
    }
});
```

### Fix 2: Ensure Aggregator Runs After Each Scan

**File:** `server/scanner.js` (After line 280)

**Add aggregator call:**
```javascript
// After saving results, run aggregator
try {
    const aggregatorScript = path.join(process.cwd(), 'results_aggregator.py');
    const venvPython = path.join(process.cwd(), 'venv/bin/python');
    
    await execFilePromise(venvPython, [aggregatorScript], {
        timeout: 30000
    });
    
    Logger.info('[AGGREGATOR] Master feed updated');
} catch (aggErr) {
    Logger.error('[AGGREGATOR] Failed to update master feed', aggErr);
}
```

### Fix 3: Add Global Timestamp to Master Feed

**File:** `results_aggregator.py` (Line 263-270)

**Before:**
```python
with open(temp_file, 'w') as f:
    json.dump(final_list, f, indent=2)
```

**After:**
```python
# Add global metadata with timestamp
output = {
    'last_updated': int(time.time() * 1000),  # Milliseconds since epoch
    'signals': final_list,
    'count': len(final_list)
}

with open(temp_file, 'w') as f:
    json.dump(output, f, indent=2)
```

**Note:** This would be a breaking change. Better approach is to preserve flat array but ensure timestamps are correct.

## Recommended Implementation (Non-Breaking)

### Option A: Use Source-Specific Results (Recommended)

**Pros:**
- No breaking changes
- Timestamps always accurate
- Source-specific data immediately available

**Cons:**
- Doesn't show cross-exchange aggregation

**Implementation:** Apply Fix 1 only

### Option B: Trigger Aggregator After Each Scan

**Pros:**
- Master feed always up-to-date
- Cross-exchange aggregation works

**Cons:**
- Slight delay (aggregator execution time)
- More processing overhead

**Implementation:** Apply Fix 1 + Fix 2

## Testing Plan

1. **Apply Fix 1** (Update `/api/results` endpoint)
2. **Restart server:** `pm2 restart quantpro`
3. **Trigger manual scan** from dashboard
4. **Verify:**
   - Node.js logs show scan completion
   - `/api/results?source=HYPERLIQUID` returns fresh data
   - Dashboard timestamp updates immediately
5. **Check aggregator** runs periodically to update master feed

## Expected Behavior After Fix

1. User clicks "Scan" → Manual scan triggered
2. Node.js executes Python scanner
3. Results saved to `latest_results_{SOURCE}.json` with timestamp
4. Frontend polls `/api/results?source={SOURCE}`
5. API returns source-specific results (not master feed)
6. Dashboard displays correct timestamp from `data[0].timestamp`
7. Aggregator runs periodically (or after scan) to update master feed

## Files to Modify

1. **`server.js`** - Update `/api/results` endpoint (5 lines)
2. **`server/scanner.js`** - Optional: Add aggregator call (10 lines)

## Rollback Plan

If issues arise, revert `server.js` changes:
```javascript
app.get('/api/results', async (req, res) => {
    const results = await getMasterFeed();
    res.json(results);
});
```

---

**Status:** Ready to implement  
**Risk:** Low (backward compatible)  
**Effort:** 5 minutes
