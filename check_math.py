"""Test if the fix worked"""
slope = -0.6138
intercept = 116.98

# Project to current (index 1078)
current_idx = 1078
projected = slope * current_idx + intercept

print(f"Projection at index {current_idx}: {projected:.2f} RSI")
print(f"Within bounds: {0 <= projected <= 100}")

# Where does it cross 0?
cross_0 = -intercept / slope
print(f"\nLine crosses 0 RSI at index: {cross_0:.0f}")
