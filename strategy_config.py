
"""
Strategy Configuration
Centralized parameters for all QuantPro strategies.
"""

class StrategyConfig:
    # ==========================================
    # GLOBAL SETTINGS
    # ==========================================
    TIMEFRAME_HTF = '4h'
    TIMEFRAME_LTF = '15m'
    
    # ==========================================
    # STRATEGY V1: LEGACY & BREAKOUT (Original)
    # ==========================================
    # Indicators
    RSI_PERIOD_V1 = 14
    ADX_PERIOD = 14
    ADX_STRONG_TREND = 25
    OBV_LOOKBACK = 20
    
    # Scoring Weights (V1)
    SCORE_GEOMETRY_MAX = 40.0
    SCORE_MOMENTUM_MAX = 30.0
    SCORE_OI_FLOW_MAX = 20.0
    SCORE_SENTIMENT_MAX = 10.0
    
    # Bonuses
    BONUS_RETEST = 15.0
    BONUS_SQUEEZE = 10.0
    BONUS_DEEP_RSI = 5.0
    
    # Constants
    MIN_VOL_RATIO_SQUEEZE = 2.0
    MIN_OI_SCORE_SQUEEZE = 5.0
    
    # ==========================================
    # STRATEGY V2: INSTITUTIONAL RSI BREAKOUT
    # ==========================================
    # Core Parameters
    RSI_PERIOD = 14                # Standard Relative Strength Index period
    OI_ZSCORE_LOOKBACK = 60        # Lookback period for Open Interest Z-Score calculation
    RETEST_REVERSE_RSI_TOLERANCE = 3.0 # Tolerable deviation in RSI terms for a retest touch
    MIN_RR_RATIO = 2.0             # Minimum Risk/Reward ratio for valid setup
    V2_MIN_SCORE_V1 = 55           # Minimum V1 Score to validate a V2 Breakout (Technical Only in Backtest)
    
    # Future V2 Params (Placeholders)
    # V2_ENTRY_TRIGGER = "CANDLE_CLOSE"
    # V2_STOP_LOSS_ATR_MULT = 1.5
