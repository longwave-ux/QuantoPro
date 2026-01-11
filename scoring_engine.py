import json
import os
import sys

# Load Settings
SETTINGS_PATH = os.path.join(os.path.dirname(__file__), 'data', 'scoring_settings.json')

def load_settings():
    try:
        with open(SETTINGS_PATH, 'r') as f:
            return json.load(f)
    except Exception as e:
        print(f"Error loading settings from {SETTINGS_PATH}: {e}")
        # Fallback defaults
        return {
            "GEOMETRY_WEIGHT": 40.0,
            "MOMENTUM_WEIGHT": 40.0,
            "BASE_WEIGHT": 20.0,
            "TARGET_AREA": 500.0,
            "DIV_SCORES": {"0": 0, "1": 10, "2": 30, "3": 60}
        }

SETTINGS = load_settings()

def calculate_score(data: dict) -> float:
    """
    Calculates a normalized score (0-100) based on geometric and momentum components.

    Expected keys in data:
    - price_change_pct (float): Absolute percent change of the trendline (e.g., 5.0).
    - duration_candles (int): Length of the trendline in candles.
    - price_slope (float): Slope of price regression (Avg % change per candle).
    - rsi_slope (float): Slope of RSI regression.
    - divergence_type (int): 0=None, 1=Classic, 2=Double, 3=Triple.
    """
    
    # --- 1. Geometry Score (Trendline Force) ---
    change = abs(data.get('price_change_pct', 0))
    duration = data.get('duration_candles', 0)
    
    triangle_area = change * duration
    
    target_area = SETTINGS.get('TARGET_AREA', 500.0)
    geo_weight = SETTINGS.get('GEOMETRY_WEIGHT', 40.0)
    
    geometry_score = min(geo_weight, (triangle_area / target_area) * geo_weight)
    
    # --- 2. Momentum Score (Divergence Force) ---
    div_type = str(data.get('divergence_type', 0)) # keys are strings in JSON
    
    div_scores = SETTINGS.get('DIV_SCORES', {})
    base_div_score = div_scores.get(div_type, 0)
    
    # Decoupling logic
    p_slope = data.get('price_slope', 0)
    r_slope = data.get('rsi_slope', 0)
    slope_diff = r_slope - p_slope
    
    # Bonus for strong decoupling (capped at 5 pts)
    # Allow slope bonus even if no explicit divergence pattern found yet
    slope_bonus = min(10.0, abs(slope_diff) * 5.0)
    
    mom_weight = SETTINGS.get('MOMENTUM_WEIGHT', 40.0)
    momentum_score = min(mom_weight, base_div_score + slope_bonus)
    
    # --- 3. Base / Quality Score ---
    base_weight = SETTINGS.get('BASE_WEIGHT', 20.0)
    
    # --- Total ---
    total_score = geometry_score + momentum_score + base_weight
    
    # Debug Print
    symbol = data.get('symbol', 'Unknown')
    # Only print if we have real data (area > 0) to avoid spam
    if triangle_area > 0:
        print(f"[SCORE-DEBUG] {symbol}: Area={triangle_area:.1f}, Div={div_type}, Geo={geometry_score:.1f}, Mom={momentum_score:.1f}, Base={base_weight:.1f}, Total={total_score:.1f}", file=sys.stderr, flush=True)

    return {
        "total": min(100.0, max(0.0, total_score)),
        "score_breakdown": {
            "geometry": float(geometry_score),
            "momentum": float(momentum_score),
            "base": float(base_weight),
            "total": float(total_score)
        },
        "geometry_component": float(geometry_score), # Keep for legacy compatibility
        "momentum_component": float(momentum_score), # Keep for legacy compatibility
        "base_component": float(base_weight)         # Keep for legacy compatibility
    }

if __name__ == "__main__":
    # Reload settings to ensure we have latest
    SETTINGS = load_settings()
    
    print(f"Loaded Settings: TARGET_AREA={SETTINGS['TARGET_AREA']}")

    test_cases = [
        # 1. Weak Setup: Small TL, No Div
        # Area = 1% * 10 candles = 10. (10/500)*40 = 0.8 pts. Total = 0.8 + 0 + 20 = 20.8
        {"price_change_pct": 1.0, "duration_candles": 10, "price_slope": -0.1, "rsi_slope": -0.1, "divergence_type": 0},
        
        # 2. Medium Setup: Good TL (5% * 40 = 200 area), No Div
        # Area = 200. (200/500)*40 = 16 pts. Total = 16 + 0 + 20 = 36.
        {"price_change_pct": 5.0, "duration_candles": 40, "price_slope": -0.1, "rsi_slope": -0.1, "divergence_type": 0},

        # 3. Strong Setup: Good TL + Classic Div
        # Area = 200 -> 16 pts. Div(1) = 10 + bonus. Total ~ 16 + 10 + 20 = 46+.
        {"price_change_pct": 5.0, "duration_candles": 40, "price_slope": -0.5, "rsi_slope": 0.5, "divergence_type": 1},

        # 4. God Mode: Huge TL + Triple Div
        # Area = 10% * 60 = 600. (600/500)*40 = 40 (capped). 
        # Div(3) = 60. Momentum = min(40, 60+bonus) = 40.
        # Total = 40 + 40 + 20 = 100.
        {"price_change_pct": 10.0, "duration_candles": 60, "price_slope": -0.8, "rsi_slope": 0.9, "divergence_type": 3},
    ]
    
    print(f"{'Geometry':<10} | {'Momentum':<10} | {'Total':<10}")
    print("-" * 36)
    
    for case in test_cases:
        s = calculate_score(case)
        area = case['price_change_pct']*case['duration_candles']
        print(f"{area:<10.1f} | {case['divergence_type']:<10} | {s:<10.2f}")
