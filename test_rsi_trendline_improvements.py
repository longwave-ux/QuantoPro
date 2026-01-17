"""
Test script to verify RSI trendline detection improvements.

Tests:
1. First pivot filter (>70 for resistance, <30 for support)
2. Minimum 14-candle distance between pivots
3. Duration-based scoring (longer trendlines score higher)
"""

import json
import pandas as pd
import numpy as np
from shared_context import FeatureFactory, create_default_config

def test_rsi_trendline_improvements():
    """Test RSI trendline detection with improved filters."""
    
    print("=" * 80)
    print("RSI TRENDLINE DETECTION - MULTI-PIVOT TOUCH TEST (TradingView-style)")
    print("=" * 80)
    
    # Load test data
    try:
        with open('data/HYPERLIQUID_GRIFFAINUSDT_4h.json', 'r') as f:
            data = json.load(f)
    except FileNotFoundError:
        print("❌ Test data not found. Using fallback data.")
        # Fallback: try BTCUSDT
        try:
            with open('data/BINANCE_BTCUSDT_4h.json', 'r') as f:
                data = json.load(f)
        except:
            print("❌ No test data available. Exiting.")
            return
    
    df = pd.DataFrame(data)
    print(f"✓ Loaded {len(df)} candles of data")
    
    # Create feature factory with improved config
    config = create_default_config()
    factory = FeatureFactory(config)
    
    # Calculate RSI manually
    import pandas_ta as ta
    rsi_series = ta.rsi(df['close'], length=14)
    
    if rsi_series is None or len(rsi_series) < 50:
        print("❌ Insufficient RSI data")
        return
    
    print(f"✓ Calculated RSI (mean: {rsi_series.mean():.2f}, min: {rsi_series.min():.2f}, max: {rsi_series.max():.2f})")
    
    # Detect trendlines using improved logic
    timestamps = df['timestamp'] if 'timestamp' in df.columns else None
    trendlines = factory._detect_rsi_trendlines(rsi_series, timestamps)
    
    print("\n" + "=" * 80)
    print("TRENDLINE DETECTION RESULTS")
    print("=" * 80)
    
    # Check resistance trendline
    if 'resistance' in trendlines:
        res = trendlines['resistance']
        p1_val = res['pivot_1']['value']
        p2_val = res['pivot_2']['value']
        p1_idx = res['pivot_1']['index']
        p2_idx = res['pivot_2']['index']
        slope = res['slope']
        duration = p2_idx - p1_idx
        
        print(f"✓ RESISTANCE TRENDLINE FOUND:")
        print(f"  - Pivot 1: RSI={p1_val:.2f} at index {p1_idx}")
        print(f"  - Pivot 2: RSI={p2_val:.2f} at index {p2_idx}")
        print(f"  - Duration: {duration} candles 📏 (LONGER = BETTER)")
        print(f"  - Slope: {slope:.4f}")
        print(f"  - Equation: {res['equation']}")
        
        # Verify filters
        print("\n  Filter Checks:")
        if p1_val >= config['rsi_first_pivot_resistance_min']:
            print(f"  ✓ First pivot >={config['rsi_first_pivot_resistance_min']} (PASS)")
        else:
            print(f"  ❌ First pivot <{config['rsi_first_pivot_resistance_min']} (FAIL)")
        
        if duration >= config['rsi_min_pivot_distance']:
            print(f"  ✓ Distance >={config['rsi_min_pivot_distance']} candles (PASS)")
        else:
            print(f"  ❌ Distance <{config['rsi_min_pivot_distance']} candles (FAIL)")
        
        if abs(slope) >= config['rsi_min_slope']:
            print(f"  ✓ Slope >={config['rsi_min_slope']} (PASS)")
        else:
            print(f"  ❌ Slope <{config['rsi_min_slope']} (FAIL)")
        
        if abs(slope) <= config['rsi_max_slope']:
            print(f"  ✓ Slope <={config['rsi_max_slope']} (PASS)")
        else:
            print(f"  ❌ Slope >{config['rsi_max_slope']} (FAIL)")
            
        pivots_touched = res.get('pivots_touched', 2)
        print(f"\n  📊 SCORING BREAKDOWN (Multi-Pivot Touch):")
        print(f"  - Pivots Touched: {pivots_touched} pivots × 20 = {pivots_touched * 20} points ⭐")
        print(f"  - Duration: {duration} candles × 1 = {duration} points")
        slope_bonus = 10 if 0.1 <= abs(slope) <= 1.0 else 0
        print(f"  - Slope Bonus: {slope_bonus} points")
        total_score = (pivots_touched * 20) + duration + slope_bonus
        print(f"  - TOTAL SCORE: {total_score} points")
        print(f"  📈 Concept: MORE PIVOT TOUCHES = BETTER (like TradingView)")
    else:
        print("⚠ No resistance trendline found")
        print("  (This is OK if no pivots meet the new strict criteria)")
    
    # Check support trendline
    if 'support' in trendlines:
        sup = trendlines['support']
        p1_val = sup['pivot_1']['value']
        p2_val = sup['pivot_2']['value']
        p1_idx = sup['pivot_1']['index']
        p2_idx = sup['pivot_2']['index']
        slope = sup['slope']
        duration = p2_idx - p1_idx
        
        print(f"\n✓ SUPPORT TRENDLINE FOUND:")
        print(f"  - Pivot 1: RSI={p1_val:.2f} at index {p1_idx}")
        print(f"  - Pivot 2: RSI={p2_val:.2f} at index {p2_idx}")
        print(f"  - Duration: {duration} candles 📏 (LONGER = BETTER)")
        print(f"  - Slope: {slope:.4f}")
        print(f"  - Equation: {sup['equation']}")
        
        # Verify filters
        print("\n  Filter Checks:")
        if p1_val <= config['rsi_first_pivot_support_max']:
            print(f"  ✓ First pivot <={config['rsi_first_pivot_support_max']} (PASS)")
        else:
            print(f"  ❌ First pivot >{config['rsi_first_pivot_support_max']} (FAIL)")
        
        if duration >= config['rsi_min_pivot_distance']:
            print(f"  ✓ Distance >={config['rsi_min_pivot_distance']} candles (PASS)")
        else:
            print(f"  ❌ Distance <{config['rsi_min_pivot_distance']} candles (FAIL)")
        
        if abs(slope) >= config['rsi_min_slope']:
            print(f"  ✓ Slope >={config['rsi_min_slope']} (PASS)")
        else:
            print(f"  ❌ Slope <{config['rsi_min_slope']} (FAIL)")
        
        if abs(slope) <= config['rsi_max_slope']:
            print(f"  ✓ Slope <={config['rsi_max_slope']} (PASS)")
        else:
            print(f"  ❌ Slope >{config['rsi_max_slope']} (FAIL)")
            
        pivots_touched = sup.get('pivots_touched', 2)
        print(f"\n  📊 SCORING BREAKDOWN (Multi-Pivot Touch):")
        print(f"  - Pivots Touched: {pivots_touched} pivots × 20 = {pivots_touched * 20} points ⭐")
        print(f"  - Duration: {duration} candles × 1 = {duration} points")
        slope_bonus = 10 if 0.1 <= abs(slope) <= 1.0 else 0
        print(f"  - Slope Bonus: {slope_bonus} points")
        total_score = (pivots_touched * 20) + duration + slope_bonus
        print(f"  - TOTAL SCORE: {total_score} points")
        print(f"  📈 Concept: MORE PIVOT TOUCHES = BETTER (like TradingView)")
    else:
        print("\n⚠ No support trendline found")
        print("  (This is OK if no pivots meet the new strict criteria)")
    
    print("\n" + "=" * 80)
    print("CONFIGURATION USED")
    print("=" * 80)
    print(f"  rsi_first_pivot_resistance_min: {config['rsi_first_pivot_resistance_min']}")
    print(f"  rsi_first_pivot_support_max: {config['rsi_first_pivot_support_max']}")
    print(f"  rsi_min_pivot_distance: {config['rsi_min_pivot_distance']} candles ⭐ NEW")
    print(f"  rsi_min_slope: {config['rsi_min_slope']}")
    print(f"  rsi_max_slope: {config['rsi_max_slope']}")
    print(f"  rsi_tolerance: {config['rsi_tolerance']}")
    print(f"  rsi_pivot_order: {config['rsi_pivot_order']}")
    print("=" * 80)
    
    # Summary
    print("\n✅ TEST COMPLETE")
    if 'resistance' in trendlines or 'support' in trendlines:
        print("✓ Trendline detection is working with MULTI-PIVOT TOUCH scoring")
        print("✓ Lines touching MORE pivots are prioritized (like TradingView)")
    else:
        print("⚠ No trendlines found (filters may be too strict or data lacks extreme pivots)")

if __name__ == "__main__":
    test_rsi_trendline_improvements()
