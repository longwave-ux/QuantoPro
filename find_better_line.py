"""Search the ENTIRE dataset for high pivots to match user's TradingView line"""
import json
import pandas as pd
import pandas_ta as ta
from shared_context import FeatureFactory, create_default_config

# Load data
with open('data/HYPERLIQUID_GRIFFAINUSDT_4h.json', 'r') as f:
    data = json.load(f)

df = pd.DataFrame(data)
rsi_series = ta.rsi(df['close'], length=14)

# Find ALL pivots in the ENTIRE dataset (not just last 100)
config = create_default_config()
factory = FeatureFactory(config)

print(f"Total candles: {len(df)}")
print(f"RSI range: {rsi_series.min():.2f} - {rsi_series.max():.2f}")

# Find pivots in FULL dataset
full_rsi = rsi_series.values
pivot_highs_full = factory._find_k_order_pivots(full_rsi, 3, 'HIGH')

print(f"\nTotal pivot highs in FULL dataset (k=3): {len(pivot_highs_full)}")

# Find pivots with RSI > 70
extreme_pivots = [p for p in pivot_highs_full if p['value'] > 70]
print(f"Extreme pivots (RSI > 70): {len(extreme_pivots)}")

print("\nAll extreme pivots:")
for p in extreme_pivots:
    print(f"  Index {p['index']}: RSI={p['value']:.2f}")

# Try to find a line that touches MORE pivots and stays in bounds
print("\n" + "=" * 80)
print("SEARCHING FOR BETTER TRENDLINE")
print("=" * 80)

# Manually try the FIRST extreme pivot as P1
if len(extreme_pivots) >= 2:
    for i in range(len(extreme_pivots) - 1):
        p1 = extreme_pivots[i]
        for j in range(i + 1, len(extreme_pivots)):
            p2 = extreme_pivots[j]
            
            # Calculate slope
            duration = p2['index'] - p1['index']
            if duration < 14:  # Too close
                continue
                
            slope = (p2['value'] - p1['value']) / duration
            intercept = p1['value'] - (slope * p1['index'])
            
            # Check if this stays in bounds at current
            current_idx = len(df) - 1
            projected = slope * current_idx + intercept
            
            if 0 <= projected <= 100:  # STAYS IN BOUNDS!
                print(f"\n✅ VALID LINE FOUND:")
                print(f"   P1: Index={p1['index']}, RSI={p1['value']:.2f}")
                print(f"   P2: Index={p2['index']}, RSI={p2['value']:.2f}")
                print(f"   Duration: {duration} candles")
                print(f"   Slope: {slope:.4f}")
                print(f"   Current projection: {projected:.2f} RSI")
