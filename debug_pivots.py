"""Debug script to understand pivot detection"""
import json
import pandas as pd
import numpy as np
from shared_context import FeatureFactory, create_default_config
import pandas_ta as ta

# Load data
with open('data/HYPERLIQUID_GRIFFAINUSDT_4h.json', 'r') as f:
    data = json.load(f)

df = pd.DataFrame(data)

# Calculate RSI
rsi_series = ta.rsi(df['close'], length=14)

# Create factory
config = create_default_config()
print(f"Current tolerance: {config['rsi_tolerance']}")
print(f"Current pivot order: {config['rsi_pivot_order']}")

factory = FeatureFactory(config)

# Find pivots manually to see how many there are
k_order = config['rsi_pivot_order']
lookback = config['rsi_trendline_lookback']
recent_rsi = rsi_series.iloc[-lookback:].values if len(rsi_series) > lookback else rsi_series.values

# Find pivot highs
pivot_highs = factory._find_k_order_pivots(recent_rsi, k_order, 'HIGH')
print(f"\nTotal pivot highs found: {len(pivot_highs)}")
print(f"Pivot highs in overbought zone (>70): {len([p for p in pivot_highs if p['value'] > 70])}")

# Show first few pivots
for i, p in enumerate(pivot_highs[:10]):
    print(f"  Pivot {i+1}: Index={p['index']}, RSI={p['value']:.2f}")

# Now detect trendline
timestamps = df['time'] if 'time' in df.columns else None
trendlines = factory._detect_rsi_trendlines(rsi_series, timestamps)

if 'resistance' in trendlines:
    res = trendlines['resistance']
    print(f"\n=== RESISTANCE TRENDLINE ===")
    print(f"P1: Index={res['pivot_1']['index']}, RSI={res['pivot_1']['value']:.2f}")
    print(f"P2: Index={res['pivot_2']['index']}, RSI={res['pivot_2']['value']:.2f}")
    print(f"Slope: {res['slope']:.4f}")
    print(f"Intercept: {res['intercept']:.4f}")
    
    # Check intermediate points manually
    print(f"\n=== CHECKING INTERMEDIATE PIVOTS ===")
    p1_idx = res['pivot_1']['index']
    p2_idx = res['pivot_2']['index']
    slope = res['slope']
    intercept = res['intercept']
    tolerance = config['rsi_tolerance']
    
    # Find all pivots between P1 and P2
    intermediate_pivots = [p for p in pivot_highs if p1_idx < p['index'] < p2_idx]
    print(f"Found {len(intermediate_pivots)} intermediate pivots between P1 and P2")
    
    for p in intermediate_pivots:
        projected = slope * p['index'] + intercept
        actual = p['value']
        diff = abs(actual - projected)
        touches = diff <= tolerance
        print(f"  Pivot at index {p['index']}: Actual={actual:.2f}, Projected={projected:.2f}, Diff={diff:.2f}, Touches={'YES' if touches else 'NO'}")
