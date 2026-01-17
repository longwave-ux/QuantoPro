"""Quick debug to understand projection"""
import json
import pandas as pd
import pandas_ta as ta
from shared_context import FeatureFactory, create_default_config

with open('data/HYPERLIQUID_GRIFFAINUSDT_4h.json', 'r') as f:
    data = json.load(f)

df = pd.DataFrame(data)
rsi_series = ta.rsi(df['close'], length=14)

# Test specific line that's being selected
p1_idx = 989  # Absolute
p2_idx = 1004  # Absolute
p1_rsi = 79.54
p2_rsi = 70.33

# In the algorithm, we use lookback=150
lookback = 150
recent_rsi = rsi_series.iloc[-lookback:].values

# The pivots found will have RELATIVE indices (0-149)
# If absolute 989 is in the recent 150, what's its relative index?
total_len = len(df)
print(f"Total candles: {total_len}")
print(f"Recent start index (absolute): {total_len - lookback} = {total_len - 150}")
print(f"Recent RSI length: {len(recent_rsi)}")

# P1 absolute 989 - if total is 1078, recent starts at 928
relative_p1 = p1_idx - (total_len - lookback)
relative_p2 = p2_idx - (total_len - lookback)

print(f"\nP1 absolute={p1_idx}, relative in recent_rsi={relative_p1}")
print(f"P2 absolute={p2_idx}, relative in recent_rsi={relative_p2}")

# Now calculate slope with relative indices
slope = (p2_rsi - p1_rsi) / (relative_p2 - relative_p1)
intercept = p1_rsi - (slope * relative_p1)

print(f"\nSlope with relative indices: {slope:.4f}")
print(f"Intercept: {intercept:.4f}")

# Project to END of recent_rsi (index 149)
last_idx = len(recent_rsi) - 1
projected = slope * last_idx + intercept

print(f"\nProjection at last index ({last_idx}): {projected:.2f} RSI")
print(f"Within bounds? {0 <= projected <= 100}")
