"""Find what pivots would create a line like the user's TradingView drawing"""
import json
import pandas as pd
import pandas_ta as ta
from shared_context import FeatureFactory, create_default_config

# Load data
with open('data/HYPERLIQUID_GRIFFAINUSDT_4h.json', 'r') as f:
    data = json.load(f)

df = pd.DataFrame(data)
rsi_series = ta.rsi(df['close'], length=14)

# Try with LOWER k-order (like TradingView)
config = create_default_config()
config['rsi_pivot_order'] = 3  # Lower = more pivots found
config['rsi_tolerance'] = 1.0  # More lenient

factory = FeatureFactory(config)

print("=" * 80)
print("TESTING WITH LOWER K-ORDER (k=3, like TradingView)")
print("=" * 80)

# Find pivots
lookback = 100
recent_rsi = rsi_series.iloc[-lookback:].values
pivot_highs = factory._find_k_order_pivots(recent_rsi, 3, 'HIGH')

print(f"\nPivot highs found with k=3: {len(pivot_highs)}")
print(f"Pivots in overbought zone (>70): {len([p for p in pivot_highs if p['value'] > 70])}")

# Show all pivots >60
overbought = [p for p in pivot_highs if p['value'] > 60]
print(f"\nPivots with RSI > 60:")
for p in overbought[:15]:
    abs_idx = len(df) - lookback + p['index']
    print(f"  Index {abs_idx}: RSI={p['value']:.2f}")

# Now detect trendline with new settings
timestamps = df['time'] if 'time' in df.columns else None
trendlines = factory._detect_rsi_trendlines(rsi_series, timestamps)

if 'resistance' in trendlines:
    res = trendlines['resistance']
    print(f"\n=== NEW TRENDLINE (k=3) ===")
    print(f"P1: Index={res['pivot_1']['index']}, RSI={res['pivot_1']['value']:.2f}")
    print(f"P2: Index={res['pivot_2']['index']}, RSI={res['pivot_2']['value']:.2f}")
    print(f"Pivots touched: {res.get('pivots_touched', '?')}")
    print(f"Slope: {res['slope']:.4f}")
    
    # Check if line stays in bounds
    current_idx = len(df) - 1
    current_projected = res['slope'] * current_idx + res['intercept']
    print(f"Projected RSI at current: {current_projected:.2f}")
    
    if current_projected < 0 or current_projected > 100:
        print("⚠️ WARNING: Line goes out of RSI bounds!")
else:
    print("\n❌ No resistance trendline found")
