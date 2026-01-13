import pandas as pd
import json
import os
from market_scanner import load_data
from strategies import QuantProBreakout

# Config
FILE_PATH = "data/HYPERLIQUID_SOLUSDT_15m.json"
TARGET_TIMESTAMP = 1767817800000 # Score 110 Signal

print("Loading Data...")
df = load_data(FILE_PATH)

# Find Index
try:
    # Ensure timestamp type match
    target_row = df[df['timestamp'] == TARGET_TIMESTAMP]
    if target_row.empty:
        print(f"Timestamp {TARGET_TIMESTAMP} not found!")
        # Debug: print first/last timestamps
        print(f"Range: {df['timestamp'].iloc[0]} to {df['timestamp'].iloc[-1]}")
        exit()
    
    idx = target_row.index[0]
    print(f"Found Target at Index: {idx}")
    
    # Slicing: analyze() expects the 'current' candle to be the last one.
    # So we take df up to idx (inclusive).
    # iloc slice end is exclusive, so idx+1
    df_slice = df.iloc[:idx+1].copy()
    
    # Inject symbol for plotting
    df_slice['symbol'] = "SOLUSDT" 
    
    print("Running Analysis with Plotting...")
    config = {'plot': True}
    strategy = QuantProBreakout(config)
    
    # We need to mock checking coinalyze? 
    # Logic: Score 110 came from Backtest which didn't check Coinalyze (or assumed passed).
    # Analyze WILL check Coinalyze.
    # Timestamp is historic (1767817800000 is likely future/recent in this mock dataset context? 
    # Or past? 17678... is 2026-01-08 roughly).
    # Coinalyze API fetch for historic timestamp?
    # Our `data_fetcher` fetches *recent* history relative to `time.time()`.
    # It won't match this specific historic candle if it's too old. output will likely be Score 0 
    # if Coinalyze fails or returns data that doesn't match criteria.
    # HOWEVER, plot is generated inside `analyze` as long as `trendline_info` is found.
    # Plotting happens *before* or *after* logic?
    # Trace `strategies.py`: 
    # `trendline_info = res_line`...
    # `plot_debug_chart` is called at the end of loop or function?
    # It's called: `self.plot_debug_chart(..., debug_trendline, ...)` inside `analyze`.
    # It runs IF `trendline_info` (debug_trendline) was found.
    # This happens regardless of the final Score/Action if I view the code correctly?
    # Wait, let's verify `strategies.py` plot logic location.
    
    res = strategy.analyze(df_slice)
    print("Analysis Complete.")
    print(f"Result Score: {res.get('score')}")
    
    # Rename file
    source = "debug_breakout_SOLUSDT.png"
    dest = "god_mode_solusdt.png"
    if os.path.exists(source):
        os.rename(source, dest)
        print(f"Plot saved to: {dest}")
    else:
        print("Plot file not generated.")

except Exception as e:
    import traceback
    traceback.print_exc()
