---
trigger: always_on
---

# QUANTPRO SYSTEM RULES & ARCHITECTURAL INTEGRITY

## 1. FILE PROTECTION & BACKUP
- NEVER overwrite `strategies.py`, `server.js`, or `data_fetcher.py` without explicit confirmation.
- ALWAYS create a backup before editing: `cp <filename> <filename>.bak`.
- If a session disconnects, check `strategies.py.bak` to restore the last working state.

## 2. SCORING ARCHITECTURE (STRICT)
- **Strategy A (Legacy):** Must use exactly 4 components: `trendScore`, `moneyFlowScore`, `structureScore`, `timingScore`. Total = 100.
- **Strategy B (Breakout):** Must use exactly 5 components to align with the UI:
    1. `geometry` (Max 40)
    2. `momentum` (Max 30)
    3. `oi_flow` (Max 20 - using numpy.polyfit for slope)
    4. `sentiment` (Max 10 - including Funding & Top Trader L/S Ratio)
    5. `bonuses` (For Retest +15, Triple Divergence, etc.)
- All 5 keys must be present in the `score_breakdown` dictionary.

## 3. DATA INTEGRITY (JSON SAFETY)
- ALWAYS use the `clean_nans(obj)` function for any data returned to the UI or written to JSON.
- Convert `np.int64`, `np.float64`, and `NaN` to native Python types (`int`, `float`, `0.0`) to prevent "Object not JSON serializable" errors.

## 4. SENTIMENT & INSTITUTIONAL LOGIC
- **Funding Filter:** Automatically REJECT/EXCLUDE signals if Funding Rate is > 0.05% or < -0.05%.
- **Top Trader L/S:** Use `coinalyze.get_ls_ratio_top_traders`. Reward signals where Top Traders' bias matches the price action.

## 5. VERIFICATION PROTOCOL
- After any change to `strategies.py`, you MUST run a manual test:
  `venv/bin/python market_scanner.py data/HYPERLIQUID_BTCUSDT_4h.json --strategy Breakout`
- Check stderr for crashes. Ensure the `score_breakdown` matches the total score (Math Check: 1+2+3+4+5 = Total).

## 6. TELEGRAM & LOGGING
- Maintain Institutional Badges: 🐳 (Inst. Entry), 🐻 (Inst. Short), 📊 (Div-Prep).
- Keep `[SCORE-DEBUG]` and `[OI-DEBUG]` logs active in terminal for transparency.