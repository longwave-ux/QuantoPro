
import pandas as pd
import pandas_ta as ta
import numpy as np
import sys
from scipy.signal import find_peaks, argrelextrema
import datetime
import matplotlib.pyplot as plt
plt.switch_backend('Agg')
import datetime
import matplotlib.pyplot as plt
plt.switch_backend('Agg')
from abc import ABC, abstractmethod
from scoring_engine import calculate_score
from strategy_config import StrategyConfig

# Common LTF Default Structure for Frontend Compatibility
DEFAULT_LTF = {
    'rsi': 50.0,
    'adx': 0.0,
    'bias': 'NONE',
    'obvImbalance': 'NEUTRAL',
    'divergence': 'NONE',
    'isPullback': False,
    'pullbackDepth': 0.0,
    'volumeOk': True,
    'momentumOk': True,
    'isOverextended': False
}

def clean_nans(obj):
    """Recursively convert NaN, inf, and numpy types to JSON-serializable values."""
    import numpy as np
    import pandas as pd
    
    # Handle numpy integer types (int64, int32, etc.)
    if isinstance(obj, (np.integer, np.int64, np.int32)):
        return int(obj)
    # Handle numpy float types (float64, float32, etc.)
    elif isinstance(obj, (np.floating, np.float64, np.float32)):
        if pd.isna(obj) or np.isinf(obj):
            return 0.0
        return float(obj)
    # Handle regular Python floats
    elif isinstance(obj, float):
        if pd.isna(obj) or np.isinf(obj):
            return 0.0
        return obj
    # Recursively handle dictionaries
    elif isinstance(obj, dict):
        return {k: clean_nans(v) for k, v in obj.items()}
    # Recursively handle lists
    elif isinstance(obj, list):
        return [clean_nans(v) for v in obj]
    # Return everything else as-is
    return obj

class Strategy(ABC):
    @abstractmethod
    def analyze(self, df, df_htf=None, mcap=0):
        pass

    @abstractmethod
    def backtest(self, df, df_htf=None, mcap=0):
        pass

    @property
    @abstractmethod
    def name(self):
        pass

class QuantProLegacy(Strategy):
    """
    Replicates the original JavaScript QuantPro logic:
    - EMA 50/200 Trend Bias
    - ADX Trend Strength
    - RSI Momentum & Divergence
    - OBV Money Flow
    - Pullback/Structure Scoring
    """
    
    def __init__(self, config=None):
        self.config = config or {}
        
        # Parse Indicators Config
        indicators = self.config.get('INDICATORS', {})
        self.rsi_len = int(indicators.get('RSI', {}).get('PERIOD', 14))
        self.adx_len = int(indicators.get('ADX', {}).get('PERIOD', 14))
        self.adx_trend = int(indicators.get('ADX', {}).get('STRONG_TREND', 25))
        self.bol_len = int(indicators.get('BOL_BANDS', {}).get('PERIOD', 20))
        self.bol_std = int(indicators.get('BOL_BANDS', {}).get('STD_DEV', 2))
        
        # Parse Scoring Config
        scoring = self.config.get('SCORING', {})
        self.kv_trend_base = scoring.get('TREND', {}).get('BASE', 15)
        self.kv_trend_strong = scoring.get('TREND', {}).get('STRONG_ADX', 10)
        self.kv_trend_weak = scoring.get('TREND', {}).get('WEAK_BIAS', 5) # Not used currently but good to have
        self.kv_struct_fib = scoring.get('STRUCTURE', {}).get('FIB', 25)
        self.kv_money_obv = scoring.get('MONEY_FLOW', {}).get('OBV', 25)
        
    def name(self):
        return "Legacy"

    def analyze(self, df, df_htf=None, mcap=0):
        # Deduplicate columns to prevent pandas-ta errors
        df = df.loc[:, ~df.columns.duplicated()]

        # 1. Calculate Indicators
        # EMA
        res = df.ta.ema(length=50)
        df['ema_50'] = res.iloc[:, 0] if isinstance(res, pd.DataFrame) else res
        
        res = df.ta.ema(length=200)
        df['ema_200'] = res.iloc[:, 0] if isinstance(res, pd.DataFrame) else res
        
        # RSI
        res = df.ta.rsi(length=self.rsi_len)
        df['rsi'] = res.iloc[:, 0] if isinstance(res, pd.DataFrame) else res
        
        # ADX
        res = df.ta.adx(length=self.adx_len)
        # ADX returns DataFrame with ADX, DMP, DMN. We want ADX column specifically or first column if generic
        if isinstance(res, pd.DataFrame):
            col_name = f'ADX_{self.adx_len}'
            if col_name in res.columns:
                df['adx'] = res[col_name]
            else:
                df['adx'] = res.iloc[:, 0]
        else:
            df['adx'] = res
            
        # ATR
        res = df.ta.atr(length=14)
        df['atr'] = res.iloc[:, 0] if isinstance(res, pd.DataFrame) else res
        
        # OBV
        res = df.ta.obv()
        df['obv'] = res.iloc[:, 0] if isinstance(res, pd.DataFrame) else res
        
        # Bollinger Bands
        bb = df.ta.bbands(length=self.bol_len, std=self.bol_std)
        
        # Fix for Column Names:
        # We'll use iloc to be safe: Lower=0, Mid=1, Upper=2
        if isinstance(bb, pd.DataFrame):
            df['bb_lower'] = bb.iloc[:, 0]
            df['bb_upper'] = bb.iloc[:, 2]
        else:
            # Fallback if somehow not DF (unlikely for bbands)
            pass

        # Get the specific row to analyze 
        last_row = df.iloc[-1]
        
        # 2. Logic Implementation
        
        # --- Trend Bias ---
        bias = 'NONE'
        close = last_row['close']
        ema50 = last_row['ema_50']
        ema200 = last_row['ema_200']
        adx = last_row['adx']
        
        if pd.notna(ema50) and pd.notna(ema200):
            if close > ema50 and ema50 > ema200:
                bias = 'LONG'
            elif close < ema50 and ema50 < ema200:
                bias = 'SHORT'
                
        # --- MTF OVERRIDE (If HTF data is available) ---
        # Replaces simple LTF bias with HTF bias (4H typically)
        
        # Default to LTF logic first
        trend_struct = 'DOWN'
        if len(df) > 4:
            if close > df.iloc[-4]['close']:
                 trend_struct = 'UP'

        htf_adx = adx # Default to LTF ADX if no HTF
        h_ema50 = None
        h_ema200 = None
        
        if df_htf is not None and len(df_htf) >= 50:
            # Deduplicate HTF columns
            df_htf = df_htf.loc[:, ~df_htf.columns.duplicated()]

            # Calculate Indicators on HTF
            res = df_htf.ta.ema(length=50)
            df_htf['ema_50'] = res.iloc[:, 0] if isinstance(res, pd.DataFrame) else res
            
            res = df_htf.ta.ema(length=200)
            df_htf['ema_200'] = res.iloc[:, 0] if isinstance(res, pd.DataFrame) else res
            
            res = df_htf.ta.adx(length=14)
            if isinstance(res, pd.DataFrame):
                if 'ADX_14' in res.columns:
                    df_htf['adx'] = res['ADX_14']
                else:
                    df_htf['adx'] = res.iloc[:, 0]
            else:
                df_htf['adx'] = res
                
            last_htf = df_htf.iloc[-1]
            h_close = last_htf['close']
            h_ema50 = last_htf['ema_50']
            h_ema200 = last_htf['ema_200']
            htf_adx = last_htf['adx'] if pd.notna(last_htf['adx']) else 0
            
            # Reset Bias based on HTF
            bias = 'NONE'
            if pd.notna(h_ema50) and pd.notna(h_ema200):
                if h_close > h_ema50 and h_ema50 > h_ema200:
                    bias = 'LONG'
                elif h_close < h_ema50 and h_ema50 < h_ema200:
                    bias = 'SHORT'
            
            # Use HTF trend structure (close > close[3])
            trend_struct = 'DOWN'
            if len(df_htf) > 4:
                if h_close > df_htf.iloc[-4]['close']:
                     trend_struct = 'UP'

        # --- Divergences (Simplified Lookback) ---
        divergence = 'NONE'
        if len(df) > 40:
             divergence = self.check_divergence(df.tail(60))

        # --- OBV Imbalance ---
        obv_imbalance = self.check_obv_imbalance(df.tail(30))
        
        # --- Pullback Detection ---
        is_pullback, pullback_depth = self.detect_pullback(df.tail(60), bias)
        
        # --- Volatility / Volume Checks ---
        volume_ok = self.check_volume(df.tail(20))
        
        # Check Overextended
        is_overextended = False
        if pd.notna(last_row['bb_upper']):
             is_overextended = close > last_row['bb_upper'] or close < last_row['bb_lower']
        
        # Vol 24h
        vol_24h = 0
        if len(df) >= 96:
             vol_window = df.tail(96)
             vol_24h = (vol_window['close'] * vol_window['volume']).sum()

        # --- Scoring ---
        # Note: We pass htf_adx to calculate_score
        score_breakdown = self.calculate_score(
            bias, htf_adx, obv_imbalance, divergence, is_pullback, volume_ok, is_overextended, trend_struct, mcap, vol_24h
        )
        
        # Setup Calculation via Python (Simplified)
        setup = None
        if score_breakdown['total'] >= self.config.get('THRESHOLDS', {}).get('MIN_SCORE_SIGNAL', 70):
             # Dynamic RR Logic
             swing_high = df['high'].tail(100).max()
             swing_low = df['low'].tail(100).min()
             
             if bias == 'LONG':
                  sl = float(last_row['low'] * 0.995)
                  entry = float(close)
                  risk = entry - sl
                  
                  # Target: Recent Swing High
                  tp = float(swing_high)
                  
                  # If Potential RR is poor (< 1), force 2.0R expansion
                  expected_reward = tp - entry
                  if risk > 0 and (expected_reward / risk) < 1.0:
                       tp = entry + (risk * 2.0)
                       
                  rr = round((tp - entry) / risk, 2) if risk > 0 else 0.0
                  setup = {"side": "LONG", "entry": entry, "tp": tp, "sl": sl, "rr": rr}

             elif bias == 'SHORT':
                  sl = float(last_row['high'] * 1.005)
                  entry = float(close)
                  risk = sl - entry
                  
                  # Target: Recent Swing Low
                  tp = float(swing_low)
                  
                  # If Potential RR is poor, force 2.0R expansion
                  expected_reward = entry - tp
                  if risk > 0 and (expected_reward / risk) < 1.0:
                       tp = entry - (risk * 2.0)
                       
                  rr = round((entry - tp) / risk, 2) if risk > 0 else 0.0
                  setup = {"side": "SHORT", "entry": entry, "tp": tp, "sl": sl, "rr": rr}

        # Handle NaN values for JSON output
        rsi_val = float(last_row['rsi']) if pd.notna(last_row['rsi']) else 0
        
        return {
            "strategy_name": self.name(),
            "symbol": "UNKNOWN",
            "price": float(close),
            "score": float(score_breakdown['total']),
            "bias": bias,
            "action": setup['side'] if setup else "WAIT",
            "rr": float(setup['rr']) if setup and 'rr' in setup else 0.0,
            "entry": float(setup['entry']) if setup else None,
            "stop_loss": float(setup['sl']) if setup else None,
            "take_profit": float(setup['tp']) if setup else None,
            "setup": setup,
            "details": {
                **score_breakdown,
                'oi_meta': {'oi_slope': 0.0, 'oi_points': 0, 'oi_avg': 0.0},
                'sentiment_meta': {
                   "liq_longs": 0, "liq_shorts": 0, "liq_ratio": 0.0, 
                   "top_ls_ratio": 0.0
                }
            }, 
            "score_breakdown": score_breakdown['score_breakdown'], # Hoist for convenience
            "raw_components": {
                "price_change_pct": 0.0,
                "duration_candles": 0,
                "divergence_type": 0
            },
            "htf": {
                "trend": trend_struct,
                "bias": bias,
                "adx": float(htf_adx) if pd.notna(htf_adx) else 0,
                "ema50": float(h_ema50) if pd.notna(h_ema50) else (float(ema50) if pd.notna(ema50) else 0),
                "ema200": float(h_ema200) if pd.notna(h_ema200) else (float(ema200) if pd.notna(ema200) else 0)
            },
            "ltf": {
                "rsi": rsi_val,
                "adx": float(htf_adx) if pd.notna(htf_adx) else 0,
                "bias": bias,
                "obvImbalance": obv_imbalance,
                "divergence": divergence,
                "isPullback": bool(is_pullback),
                "pullbackDepth": float(pullback_depth),
                "volumeOk": bool(volume_ok),
                "momentumOk": bool(30 < rsi_val < 70),
                "isOverextended": bool(is_overextended)
            }
        }

    def check_divergence(self, df):
        low_pivots = [] 
        high_pivots = []
        
        closes = df['close'].values
        rsis = df['rsi'].values
        
        # Ensure we have enough data and no NaNs in RSI
        if len(rsis) < 5: return 'NONE'
        
        for i in range(len(closes) - 2, 1, -1):
            if pd.isna(rsis[i]): continue
            
            # Low
            if closes[i] < closes[i-1] and closes[i] < closes[i+1]:
                low_pivots.append({'idx': i, 'price': closes[i], 'rsi': rsis[i]})
            # High
            if closes[i] > closes[i-1] and closes[i] > closes[i+1]:
                high_pivots.append({'idx': i, 'price': closes[i], 'rsi': rsis[i]})
                
            if len(low_pivots) >= 2 and len(high_pivots) >= 2:
                break
                
        if len(low_pivots) >= 2:
            recent = low_pivots[0]
            prev = low_pivots[1]
            if recent['price'] < prev['price'] and recent['rsi'] > prev['rsi']:
                if prev['rsi'] < 50: return 'BULLISH'

        if len(high_pivots) >= 2:
            recent = high_pivots[0]
            prev = high_pivots[1]
            if recent['price'] > prev['price'] and recent['rsi'] < prev['rsi']:
                if prev['rsi'] > 50: return 'BEARISH'
                    
        return 'NONE'

    def check_obv_imbalance(self, df):
        if len(df) < 20: return 'NEUTRAL'
        
        obv = df['obv'].values
        price = df['close'].values
        
        if np.any(pd.isna(obv)): return 'NEUTRAL'

        min_p, max_p = np.min(price), np.max(price)
        min_o, max_o = np.min(obv), np.max(obv)
        
        if (max_p - min_p) == 0 or (max_o - min_o) == 0: return 'NEUTRAL'
        
        norm_p = (price[-1] - min_p) / (max_p - min_p)
        norm_o = (obv[-1] - min_o) / (max_o - min_o)
        
        diff = norm_o - norm_p
        
        if diff > 0.25: return 'BULLISH'
        if diff < -0.25: return 'BEARISH'
        return 'NEUTRAL'

    def detect_pullback(self, df, bias):
        if bias == 'NONE': return False, 0
        
        highs = df['high'].values
        lows = df['low'].values
        close = df['close'].values[-1]
        
        recent_high = np.max(highs)
        recent_low = np.min(lows)
        rng = recent_high - recent_low
        
        if rng == 0: return False, 0
        
        depth = 0
        if bias == 'LONG':
            depth = (recent_high - close) / rng
        elif bias == 'SHORT':
            depth = (close - recent_low) / rng
            
        is_pullback = 0.3 <= depth <= 0.8
        return is_pullback, depth

    def check_volume(self, df):
        if len(df) < 20: return True
        vols = df['volume'].values
        current = vols[-1]
        avg = np.mean(vols)
        return current < avg 

    def calculate_score(self, bias, adx, obv, div, is_pullback, vol_ok, overextended, trend_struct, mcap=0, vol_24h=0):
        trend_score = 0
        structure_score = 0
        money_flow_score = 0
        timing_score = 0
        
        # Fill None/NaN
        if pd.isna(adx): adx = 0
        
        # [REFACTORED] Dampened Scoring to align with new system
        # Original was producing 89.7 clusters. New max target ~50-60.
        
        if bias != 'NONE':
            trend_score = 5.0 # Was 15
            if adx > self.adx_trend: trend_score += 5.0 # Was 10
        else:
            trend_score = 0 
            
        if is_pullback:
            structure_score = 10.0 # Was 25
        
        if (bias == 'LONG' and obv == 'BULLISH') or (bias == 'SHORT' and obv == 'BEARISH'):
            money_flow_score += 10.0 # Was 25
            
        if is_pullback and vol_ok: timing_score += 2.0 # Was 5
            
        # Multipliers (Reduced impact)
        if adx > 25:
            trend_score *= 1.2 # Was 1.5
            # structure_score *= 0.8
            timing_score *= 1.1 # Was 1.2
            
        # --- Rewards (Volume & Mcap) ---
        rewards_score = 0
        
        # 1. Volume (24h approx = last 96 candles of 15m)
        if vol_24h > 100_000_000:
             rewards_score += 2.0 # Was 5
                  
        # 2. Mcap
        if mcap > 0:
             if mcap < 1_000_000_000: rewards_score += 2.0
             elif mcap > 10_000_000_000: rewards_score += 2.0
                  
        total = trend_score + structure_score + money_flow_score + timing_score + rewards_score
        
        if is_pullback and not vol_ok: total -= 10
        if (bias == 'LONG' and obv == 'BEARISH') or (bias == 'SHORT' and obv == 'BULLISH'): total -= 10
        if (bias == 'LONG' and div == 'BEARISH') or (bias == 'SHORT' and div == 'BULLISH'): total -= 10
        if overextended: total -= 10
        
        total = max(0, min(100, total))
        
        return {
            "total": total,
            "trendScore": float(trend_score),
            "structureScore": float(structure_score),
            "moneyFlowScore": float(money_flow_score),
            "timingScore": float(timing_score),
            "mcap": float(mcap),
            "vol24h": float(vol_24h),
            "score_breakdown": {
                "base": 10.0, 
                "geometry": 0.0, 
                "momentum": float(trend_score + money_flow_score),
                "total": float(total)
            },
            "geometry_component": 0.0,
            "momentum_component": float(trend_score + money_flow_score)
        }

    def backtest(self, df, df_htf=None, mcap=0):
        # 1. Calculate Indicators (Vectorized) on LTF
        df['ema_50'] = df.ta.ema(length=50)
        df['ema_200'] = df.ta.ema(length=200)
        df['rsi'] = df.ta.rsi(length=self.rsi_len)
        adx_df = df.ta.adx(length=self.adx_len)
        
        col_adx = f'ADX_{self.adx_len}'
        if col_adx in adx_df.columns:
            df['adx'] = adx_df[col_adx]
        else:
            df['adx'] = adx_df.iloc[:, 0]
            
        df['obv'] = df.ta.obv()
        
        bb = df.ta.bbands(length=self.bol_len, std=self.bol_std)
        df['bb_lower'] = bb.iloc[:, 0]
        df['bb_upper'] = bb.iloc[:, 2]

        # 2. HTF Preparation
        # We need to map HTF data to LTF data (forward fill)
        if df_htf is not None and len(df_htf) >= 50:
            df_htf['htf_ema_50'] = df_htf.ta.ema(length=50)
            df_htf['htf_ema_200'] = df_htf.ta.ema(length=200)
            
            htf_adx_df_data = df_htf.ta.adx(length=14)
            if 'ADX_14' in htf_adx_df_data.columns:
                df_htf['htf_adx'] = htf_adx_df_data['ADX_14']
            else:
                df_htf['htf_adx'] = htf_adx_df_data.iloc[:, 0]
            
            # Rename columns for merge to avoid collision validation
            # We want: open, close, htf_ema_50, htf_ema_200, htf_adx
            # We must use merge_asof
            df = df.sort_values('timestamp')
            df_htf = df_htf.sort_values('timestamp')
            
            # Select relevant HTF columns
            htf_subset = df_htf[['timestamp', 'close', 'htf_ema_50', 'htf_ema_200', 'htf_adx']].copy()
            htf_subset.rename(columns={'close': 'htf_close'}, inplace=True)
            
            # Merge: For each LTF row, get the latest HTF row available (timestamp <= ltf.timestamp)
            df = pd.merge_asof(df, htf_subset, on='timestamp', direction='backward')
        else:
            # Init empty HTF cols if missing
            df['htf_close'] = np.nan
            df['htf_ema_50'] = np.nan
            df['htf_ema_200'] = np.nan
            df['htf_adx'] = df['adx'] # Fallback

        # 3. Iteration
        results = []
        
        # Warmup period
        start_idx = 50 
        
        # Pre-calculate Swing Points for Dynamic RR (Vectorized)
        df['swing_high_100'] = df['high'].rolling(100).max()
        df['swing_low_100'] = df['low'].rolling(100).min()
        
        # Generator for sliding window efficiency
        rows = df.to_dict('records')
        
        for i in range(start_idx, len(rows)):
            row = rows[i]
            
            # Context Windows (slicing dataframe is slow, but necessary for structure detection)
            # Alternative: Pre-calculate pivots, but let's stick to window logic for fidelity
            # Slice last 96 rows relative to i (24h)
            window_start = i - 96
            if window_start < 0: window_start = 0
            
            # We need a mini-df for the helper functions that expect a DF
            # This 'iloc' is the bottleneck, but acceptable for thousands of rows
            window_df = df.iloc[window_start:i+1] 
            
            # --- Logic (Copy from analyze) ---
            close = row['close']
            
            # Trend Bias (HTF Priority)
            bias = 'NONE'
            
            # Check HTF first
            h_close = row.get('htf_close')
            h_ema50 = row.get('htf_ema_50')
            h_ema200 = row.get('htf_ema_200')
            
            if pd.notna(h_close) and pd.notna(h_ema50) and pd.notna(h_ema200):
                if h_close > h_ema50 and h_ema50 > h_ema200:
                    bias = 'LONG'
                elif h_close < h_ema50 and h_ema50 < h_ema200: # Fix logic: h_ema50 > h_ema200 is LONG struct
                    # Correct logic:
                    # LONG: Price > 50 > 200
                    # SHORT: Price < 50 < 200
                    pass
                
                # Re-do logic properly
                if h_close > h_ema50 and h_ema50 > h_ema200:
                     bias = 'LONG'
                elif h_close < h_ema50 and h_ema50 < h_ema200:
                     bias = 'SHORT'
                     
            else:
                # Fallback to LTF
                l_ema50 = row['ema_50']
                l_ema200 = row['ema_200']
                if pd.notna(l_ema50) and pd.notna(l_ema200):
                    if close > l_ema50 and l_ema50 > l_ema200:
                         bias = 'LONG'
                    elif close < l_ema50 and l_ema50 < l_ema200:
                         bias = 'SHORT'
            
            # Trend Structure (HTF)
            trend_struct = 'DOWN'
            # Look at HTF History? 
            # Ideally we need last 4 HTF candles. merge_asof gives only current.
            # Using LTF fallback for structure in backtest for simplicity/speed
            # Or assume bias encapsulates structure
            if i > 4 and close > rows[i-4]['close']:
                 trend_struct = 'UP'

            htf_adx = row.get('htf_adx', 0)
            if pd.isna(htf_adx): htf_adx = 0
            
            # Helpers
            # Use tail(60) to match logic in analyze() for divergence/pullback
            divergence = self.check_divergence(window_df.tail(60))
            obv_imbalance = self.check_obv_imbalance(window_df.tail(30))
            is_pullback, pullback_depth = self.detect_pullback(window_df.tail(60), bias)
            volume_ok = self.check_volume(window_df.tail(20))
            
            # Vol 24h (uses full 96 window approx)
            vol_24h = (window_df['close'] * window_df['volume']).sum()
            
            is_overextended = False
            if pd.notna(row['bb_upper']):
                 is_overextended = close > row['bb_upper'] or close < row['bb_lower']
            
            # Score
            score_breakdown = self.calculate_score(
                bias, htf_adx, obv_imbalance, divergence, is_pullback, volume_ok, is_overextended, trend_struct, mcap, vol_24h
            )
            
            score = score_breakdown['total']
            
            # Setup Construction (if Score is high enough to be interesting)
            # Optimization: Only return signals > 30 to save data transfer
            if score >= 30:
                setup = None
                swing_high = row.get('swing_high_100')
                swing_low = row.get('swing_low_100')
                
                # Fallbacks if rolling data is missing (beginning of df)
                if pd.isna(swing_high): swing_high = close * 1.05
                if pd.isna(swing_low): swing_low = close * 0.95
                
                if bias == 'LONG':
                     sl = float(row['low'] * 0.995)
                     entry = float(close)
                     risk = entry - sl
                     
                     tp = float(swing_high)
                     expected_reward = tp - entry
                     
                     if risk > 0 and (expected_reward / risk) < 1.0:
                          tp = entry + (risk * 2.0)
                          
                     rr = round((tp - entry) / risk, 2) if risk > 0 else 0.0
                     setup = {"side": "LONG", "entry": entry, "tp": tp, "sl": sl, "rr": rr}
                     
                elif bias == 'SHORT':
                     sl = float(row['high'] * 1.005)
                     entry = float(close)
                     risk = sl - entry
                     
                     tp = float(swing_low)
                     expected_reward = entry - tp
                     
                     if risk > 0 and (expected_reward / risk) < 1.0:
                          tp = entry - (risk * 2.0)
                          
                     rr = round((entry - tp) / risk, 2) if risk > 0 else 0.0
                     setup = {"side": "SHORT", "entry": entry, "tp": tp, "sl": sl, "rr": rr}
                     
                # Backtest Result
                rsi_val = float(row['rsi']) if pd.notna(row['rsi']) else 0
                
                signal = {
                    "timestamp": row['timestamp'],
                    "price": float(close),
                    "score": float(score),
                    "bias": bias,
                    "action": setup['side'] if setup else "WAIT",
                    "rr": float(setup['rr']) if setup and 'rr' in setup else 0.0,
                    "entry": float(setup['entry']) if setup else None,
                    "stop_loss": float(setup['sl']) if setup else None,
                    "take_profit": float(setup['tp']) if setup else None,
                    "setup": setup,
                    "details": score_breakdown,
                    "htf": {
                        "trend": trend_struct,
                        "bias": bias,
                        "adx": float(htf_adx) if pd.notna(htf_adx) else 0,
                        "ema50": float(row.get('htf_ema_50', 0)) if pd.notna(row.get('htf_ema_50')) else 0,
                        "ema200": float(row.get('htf_ema_200', 0)) if pd.notna(row.get('htf_ema_200')) else 0
                    },
                    "ltf": {
                        "rsi": rsi_val,
                        "adx": float(htf_adx) if pd.notna(htf_adx) else 0,
                        "bias": bias,
                        "obvImbalance": obv_imbalance,
                        "divergence": divergence,
                        "isPullback": bool(is_pullback),
                        "pullbackDepth": float(pullback_depth),
                        "volumeOk": bool(volume_ok),
                        "momentumOk": bool(30 < rsi_val < 70),
                        "isOverextended": bool(is_overextended),
                        "volume": float(row['volume'])
                    }
                }
                results.append(signal)

        return results

from data_fetcher import CoinalyzeClient

class QuantProBreakout(Strategy):
    """
    RSI Trendline Breakout Strategy:
    - Identifies geometric trendlines on RSI (Support/Resistance).
    - Triggers on breakout of these trendlines.
    - Confirms with OBV and structural targets.
    """
    
    def __init__(self, config=None):
        self.config = config or {}
        self.rsi_len = StrategyConfig.RSI_PERIOD_V1
        self.breakout_threshold = self.config.get('breakout_threshold', 2.0)
        self.coinalyze = CoinalyzeClient(api_key="5019d4cc-a330-4132-bac0-18d2b0a1ee38")
        
    def check_coinalyze_confirmation(self, symbol, side):
        """
        Verify breakout with Open Interest Delta & Liquidations.
        Returns: (passed: bool, score_bonus: int, metadata: dict)
        """
        score_bonus = 0
        metadata = {
            "oi_delta_pct": None,
            "liquidation_longs": 0,
            "liquidation_shorts": 0,
            "liquidation_ratio": 0.0,
            "squeeze_detected": False
        }
        
        try:
            # 1. Open Interest Check
            delta = self.coinalyze.get_open_interest_delta(symbol)
            metadata['oi_delta_pct'] = delta
            
            oi_passed = True
            if delta is not None:
                if side == 'LONG' and delta <= 0: oi_passed = False
                elif side == 'SHORT' and delta <= 0: oi_passed = False
            
            if not oi_passed:
                return (False, 0, metadata) # Basic filter failed

            # 2. Liquidation Check (Bonus)
            liqs = self.coinalyze.get_liquidation_history(symbol)
            if liqs:
                longs = liqs['longs']
                shorts = liqs['shorts']
                metadata['liquidation_longs'] = longs
                metadata['liquidation_shorts'] = shorts
                
                # Squeeze Logic:
                if side == 'LONG':
                    ratio = shorts / longs if longs > 0 else 0
                    metadata['liquidation_ratio'] = round(ratio, 2)
                    if shorts > (longs * 2.0) and shorts > 1000:
                        score_bonus += 15
                        metadata['squeeze_detected'] = True
                
                elif side == 'SHORT':
                    ratio = longs / shorts if shorts > 0 else 0
                    metadata['liquidation_ratio'] = round(ratio, 2)
                    if longs > (shorts * 2.0) and longs > 1000:
                        score_bonus += 15
                        metadata['squeeze_detected'] = True

            return (True, score_bonus, metadata)
            
        except Exception as e:
            # Log error?
            return (True, 0, metadata) # Fail Open
            
    def detect_divergence_type(self, df, rsi_series, side):
        """
        Detects RSI Divergence Type (1, 2, or 3).
        Returns: int (0=None, 1=Classic, 2=Double, 3=Triple)
        """
        try:
            # Lookback window for pivots
            window = 60
            if len(rsi_series) < window: return 0
            
            rsi_slice = rsi_series.iloc[-window:]
            price_highs = df['high'].iloc[-window:]
            price_lows = df['low'].iloc[-window:]
            
            rsi_vals = rsi_slice.values
            w_len = len(rsi_slice)
            
            start_idx_offset = len(df) - window

            pivots = []
            
            if side == 'LONG':
                # Find Valleys (-rsi)
                peaks, _ = find_peaks(-rsi_vals, distance=8) # Lower distance to catch multiples
                if len(peaks) < 2: return 0
                
                # Get last 4 pivots max
                check_indices = peaks[-4:] 
                
                # We iterate backwards from the most recent pivot
                # We need consecutive divergence: P_current vs P_prev
                
                # Collect Pivot Data
                pivot_data = []
                for idx in check_indices:
                    # Robust Price Min
                    p_start = max(0, idx - 1)
                    p_end = min(w_len, idx + 2)
                    price_val = price_lows.iloc[p_start:p_end].min()
                    rsi_val = rsi_vals[idx]
                    pivot_data.append({'p': price_val, 'r': rsi_val})
                
                # Check Divergence Chain (from end)
                # We want P_new < P_old (Price Lower) and R_new > R_old (RSI Higher)
                div_count = 0
                # Reverse to go Newest -> Oldest
                # pivot_data is [Oldest ... Newest]
                # Let's compare [i] vs [i-1]
                
                for i in range(len(pivot_data) - 1, 0, -1):
                    curr = pivot_data[i]
                    prev = pivot_data[i-1]
                    
                    if curr['p'] < prev['p'] and curr['r'] > prev['r']:
                        div_count += 1
                    else:
                        break # Chain broken
                
                return div_count # 1, 2, 3
                
            elif side == 'SHORT':
                # Find Peaks
                peaks, _ = find_peaks(rsi_vals, distance=8)
                if len(peaks) < 2: return 0
                
                check_indices = peaks[-4:]
                
                pivot_data = []
                for idx in check_indices:
                    p_start = max(0, idx - 1)
                    p_end = min(w_len, idx + 2)
                    price_val = price_highs.iloc[p_start:p_end].max()
                    rsi_val = rsi_vals[idx]
                    pivot_data.append({'p': price_val, 'r': rsi_val})
                    
                div_count = 0
                for i in range(len(pivot_data) - 1, 0, -1):
                    curr = pivot_data[i]
                    prev = pivot_data[i-1]
                    
                    # Bearish: Price Higher, RSI Lower
                    if curr['p'] > prev['p'] and curr['r'] < prev['r']:
                        div_count += 1
                    else:
                        break
                        
                return div_count

        except Exception as e:
            # print(f"Div Check Error: {e}")
            return 0

    def calculate_oi_flow(self, symbol, side, duration_hours):
        """
        Calculate OI Flow score (0-20 pts) based on Open Interest slope.
        Rewards positive OI slope for BOTH Long and Short setups.
        """
        try:
            # Dynamic lookback: trendline duration + 2 hours buffer
            lookback_hours = duration_hours + 2
            
            # Fetch OI data from Coinalyze
            # DEBUG: Log the fetch attempt
            print(f"[DATA-DEBUG] Requesting Coinalyze for: {symbol} (Lookback: {lookback_hours}h)", file=sys.stderr)
            
            oi_data = self.coinalyze.get_open_interest_history(
                symbol=symbol,
                hours=lookback_hours
            )
            
            # DEBUG: Log the response
            print(f"[DATA-DEBUG] Raw OI Data for {symbol}: {oi_data[:2] if oi_data else 'NONE'}", file=sys.stderr)

            if not oi_data or len(oi_data) < 3:
                return 0, {"oi_slope": 0, "oi_points": 0}
            
            # Extract timestamps and OI values
            timestamps = np.array([d['timestamp'] for d in oi_data])
            oi_values = np.array([d['value'] for d in oi_data])
            
            # Calculate slope using numpy.polyfit (linear regression)
            coefficients = np.polyfit(timestamps, oi_values, 1)
            slope = coefficients[0]  # First coefficient is the slope
            
            # Normalize slope to percentage change per hour
            avg_oi = np.mean(oi_values)
            if avg_oi == 0:
                return 0, {"oi_slope": 0, "oi_points": len(oi_data)}
            
            slope_pct_per_hour = (slope * 3600 / avg_oi) * 100  # Convert to %/hour
            
            # CRITICAL: Reward POSITIVE OI slope for both Long and Short
            # Increasing OI = More participants = Stronger move potential
            if slope_pct_per_hour > 0:
                # Linear scaling: 0-5% slope = 0-20 points
                score = min(20, max(0, slope_pct_per_hour * 4))
            else:
                score = 0
            
            return score, {
                "oi_slope": float(slope_pct_per_hour),
                "oi_points": len(oi_data),
                "oi_avg": float(avg_oi)
            }
        
        except Exception as e:
            print(f"[OI FLOW ERROR] {symbol}: {e}", file=sys.stderr)
            return 0, {"error": str(e)}

    def calculate_reverse_rsi(self, rsi_target, close_prev, avg_gain_prev, avg_loss_prev, period=14):
        """
        Calculate the exact price needed for RSI to hit a target.
        Formula:
        RS_target = RSI / (100 - RSI)
        Price_Change = ((RS_target * AvgLoss * (N-1)) - (AvgGain * (N-1))) / (1 + RS_target)
        """
        try:
            if rsi_target >= 100: return float('inf')
            if rsi_target <= 0: return float('-inf')
            
            rs_target = rsi_target / (100 - rsi_target)
            
            # 1. Try Upside Assumption (Gain > 0, Loss = 0 added)
            # Delta = (N-1) * (RS_target * AvgLoss - AvgGain)
            delta_up = (period - 1) * (rs_target * avg_loss_prev - avg_gain_prev)
            
            if delta_up >= 0:
                return close_prev + delta_up
            else:
                # 2. Downside Assumption (Gain = 0, Loss > 0 added)
                # Delta_Price = (N-1) * (AvgLoss - AvgGain / RS_target)
                if rs_target == 0: return float('-inf')
                delta_down = (period - 1) * (avg_loss_prev - avg_gain_prev / rs_target)
                return close_prev + delta_down

        except Exception as e:
            # print(f"RevRSI Error: {e}", file=sys.stderr)
            return close_prev # Fallback

    def check_funding_rate(self, symbol):
        """
        HARD FILTER: Reject if funding rate > |0.05%|
        Returns: (passed: bool, funding_rate: float)
        """
        try:
            funding = self.coinalyze.get_funding_rate(symbol)
            
            if funding is None:
                # If no data, pass (fail-open for data issues)
                return True, 0.0
            
            # Convert to percentage
            funding_pct = funding * 100
            
            # HARD FILTER: |funding| > 0.05%
            if abs(funding_pct) > 0.05:
                return False, funding_pct
            
            return True, funding_pct
        
        except Exception as e:
            print(f"[FUNDING ERROR] {symbol}: {e}", file=sys.stderr)
            return True, 0.0  # Fail-open

    def calculate_sentiment_score(self, symbol, side):
        """
        Calculate sentiment score (0-10 pts):
        - 5 pts: Liquidation Ratio (Contrary)
        - 5 pts: Top Traders L/S Ratio (Consensus)
        """
        try:
            score_liq = 0
            score_top = 0
            
            # DEBUG: Log the request
            print(f"[DATA-DEBUG] Requesting Coinalyze Sentiment for: {symbol}", file=sys.stderr)
            
            meta = {
                "liq_longs": 0, "liq_shorts": 0, "liq_ratio": 0.0,
                "top_ls_ratio": 0.0
            }

            # 1. Liquidation Ratio (Contrary View) - Max 5 pts
            liqs = self.coinalyze.get_liquidation_history(symbol)
            if liqs:
                longs = liqs.get('longs', 0)
                shorts = liqs.get('shorts', 0)
                meta['liq_longs'] = int(longs)
                meta['liq_shorts'] = int(shorts)
                
                if side == 'LONG':
                    # Bullish if Shorts are getting wrecked
                    ratio = shorts / (longs + 1)
                    meta['liq_ratio'] = round(ratio, 2)
                    if ratio > 1.5: score_liq = 5
                    elif ratio > 1.0: score_liq = 3
                else:
                    # Bearish if Longs are getting wrecked
                    ratio = longs / (shorts + 1)
                    meta['liq_ratio'] = round(ratio, 2)
                    if ratio > 1.5: score_liq = 5
                    elif ratio > 1.0: score_liq = 3

            # 2. Top Traders L/S Ratio (Smart Money) - Max 5 pts
            # Note: Requires self.coinalyze to carry this method or we mock it
            # Assuming get_ls_ratio_top_traders exists or we use a placeholder/generic
            # If not present in CoinalyzeClient, we'll need to add it or skip.
            # Based on user request, we assume it's available or we should try to use it.
            # Let's check `data_fetcher.py` content via tool first? 
            # User instruction: "In calculate_sentiment_score, integrate self.coinalyze.get_ls_ratio_top_traders(symbol)"
            
            top_ratio = self.coinalyze.get_ls_ratio_top_traders(symbol)
            if top_ratio:
                 meta['top_ls_ratio'] = float(top_ratio)
                 
                 if side == 'LONG':
                     # Bullish if Top Traders > 1.0 (More Longs)
                     if top_ratio > 1.2: score_top = 5
                     elif top_ratio > 1.0: score_top = 3
                 else:
                     # Bearish if Top Traders < 1.0 (More Shorts)
                     if top_ratio < 0.8: score_top = 5
                     elif top_ratio < 1.0: score_top = 3
            
            total_score = score_liq + score_top
            return total_score, meta
        
        except Exception as e:
            print(f"[SENTIMENT ERROR] {symbol}: {e}", file=sys.stderr)
            return 0, {"error": str(e)}
        
        except Exception as e:
            print(f"[SENTIMENT ERROR] {symbol}: {e}", file=sys.stderr)
            return 0, {"error": str(e)}
        
    def name(self):
        return "Breakout"

    def backtest(self, df, df_htf=None, mcap=0):
        """
        Backtest Breakout V1 strategy over historical data.
        Scans all candles for RSI trendline breakouts and generates signals.
        
        Returns: List of signal dicts with timestamps
        """
        # Use HTF data for V1 (4h timeframe)
        if df_htf is None or len(df_htf) < 100:
            return []
        
        # Calculate indicators
        df_htf['rsi'] = df_htf.ta.rsi(length=self.rsi_len)
        df_htf['obv'] = df_htf.ta.obv()
        df_htf['atr'] = df_htf.ta.atr(length=14)
        
        # Pre-calculate Wilder's smoothing components for reverse RSI
        delta = df_htf['close'].diff()
        gain = delta.clip(lower=0)
        loss = -delta.clip(upper=0)
        alpha = 1 / self.rsi_len
        df_htf['avg_gain'] = gain.ewm(alpha=alpha, adjust=False).mean()
        df_htf['avg_loss'] = loss.ewm(alpha=alpha, adjust=False).mean()
        
        rsi_series = df_htf['rsi'].fillna(50)
        
        all_signals = []
        
        # Find trendlines on FULL RSI history
        res_line = self.find_trendlines(rsi_series, 'RESISTANCE')
        sup_line = self.find_trendlines(rsi_series, 'SUPPORT')
        
        # Scan from index 100 to end-1 (avoid incomplete last candle)
        for scan_i in range(100, len(df_htf) - 1):
            latest_price = df_htf['close'].iloc[scan_i]
            
            # LONG: Check resistance breakout
            if res_line and scan_i >= 50:
                projected_rsi = res_line['m'] * scan_i + res_line['c']
                avg_gain_prev = df_htf['avg_gain'].iloc[scan_i-1]
                avg_loss_prev = df_htf['avg_loss'].iloc[scan_i-1]
                close_prev = df_htf['close'].iloc[scan_i-1]
                
                entry_price = self.calculate_reverse_rsi(projected_rsi, close_prev, avg_gain_prev, avg_loss_prev)
                
                current_high = df_htf['high'].iloc[scan_i]
                current_low = df_htf['low'].iloc[scan_i]
                
                is_breakout = current_high >= entry_price and entry_price > current_low * 0.9
                
                rsi_prev = rsi_series.iloc[scan_i-1]
                line_prev = res_line['m'] * (scan_i-1) + res_line['c']
                
                if is_breakout and rsi_prev <= line_prev:
                    # Calculate SL/TP
                    atr = df_htf['atr'].iloc[scan_i]
                    struct_sl = df_htf['low'].iloc[max(0, scan_i-5):scan_i].min() - (0.5 * atr)
                    vol_sl = entry_price - (2.5 * atr)
                    sl = max(struct_sl, vol_sl)
                    
                    p_max = df_htf['high'].iloc[res_line['start_idx']:res_line['end_idx']].max()
                    p_min = df_htf['low'].iloc[res_line['start_idx']:res_line['end_idx']].min()
                    structure_height = p_max - p_min
                    
                    tp = entry_price + (1.618 * structure_height)
                    
                    # Sanity checks
                    if tp <= entry_price:
                        tp = entry_price * 1.05
                    if sl >= entry_price:
                        sl = entry_price * 0.98
                    
                    # Validation: Not already expired
                    if latest_price >= tp or latest_price <= sl:
                        continue
                    if latest_price > entry_price * 1.03:
                        continue
                    
                    # MIN TP FILTER: Reject if profit target too small
                    MIN_TP_PERCENT = 0.03  # 3% minimum
                    tp_pct = (tp - entry_price) / entry_price
                    if tp_pct < MIN_TP_PERCENT:
                        continue
                    
                    # Calculate score (simplified for backtest)
                    p_start = df_htf['close'].iloc[res_line['start_idx']]
                    p_end = df_htf['close'].iloc[res_line['end_idx']]
                    price_change_pct = (abs(p_end - p_start) / p_start) * 100.0
                    duration = max(1, res_line['end_idx'] - res_line['start_idx'])
                    
                    scoring_data = {
                        "symbol": df_htf['symbol'].iloc[0] if 'symbol' in df_htf.columns else "BACKTEST",
                        "price_change_pct": float(price_change_pct),
                        "duration_candles": int(duration),
                        "price_slope": float(price_change_pct / duration),
                        "rsi_slope": float((res_line['end_val'] - res_line['start_val']) / duration),
                        "divergence_type": 0
                    }
                    
                    score_result = calculate_score(scoring_data)
                    geometry_score = min(StrategyConfig.SCORE_GEOMETRY_MAX, score_result['geometry_component'])
                    momentum_score = min(StrategyConfig.SCORE_MOMENTUM_MAX, score_result['momentum_component'])
                    total_score = geometry_score + momentum_score
                    
                    risk = entry_price - sl
                    rr = round((tp - entry_price) / risk, 2) if risk > 0 else 0.0
                    
                    setup = {'side': 'LONG', 'entry': entry_price, 'tp': tp, 'sl': sl, 'rr': rr}
                    
                    signal = {
                        "timestamp": int(df_htf['timestamp'].iloc[scan_i]) if 'timestamp' in df_htf.columns else scan_i,
                        "price": float(latest_price),
                        "score": float(total_score),
                        "bias": "LONG",
                        "action": "LONG",
                        "rr": float(rr),
                        "entry": float(entry_price),
                        "stop_loss": float(sl),
                        "take_profit": float(tp),
                        "setup": setup,
                        "details": {
                            'total': total_score,
                            'geometry_component': geometry_score,
                            'momentum_component': momentum_score,
                            'score_breakdown': {
                                'base': 10.0,
                                'geometry': geometry_score,
                                'momentum': momentum_score,
                                'total': total_score
                            }
                        },
                        "htf": {"bias": "LONG", "trend": "UP", "adx": 0},
                        "ltf": {
                            "rsi": float(rsi_series.iloc[scan_i]),
                            "bias": "LONG",
                            "obvImbalance": "NEUTRAL",
                            "divergence": "NONE",
                            "isPullback": False,
                            "pullbackDepth": 0.0,
                            "volumeOk": True,
                            "momentumOk": True,
                            "isOverextended": False
                        }
                    }
                    
                    all_signals.append(signal)
            
            # SHORT: Check support breakout
            if sup_line and scan_i >= 50:
                projected_rsi = sup_line['m'] * scan_i + sup_line['c']
                avg_gain_prev = df_htf['avg_gain'].iloc[scan_i-1]
                avg_loss_prev = df_htf['avg_loss'].iloc[scan_i-1]
                close_prev = df_htf['close'].iloc[scan_i-1]
                
                entry_price = self.calculate_reverse_rsi(projected_rsi, close_prev, avg_gain_prev, avg_loss_prev)
                
                current_high = df_htf['high'].iloc[scan_i]
                current_low = df_htf['low'].iloc[scan_i]
                
                is_breakout = current_low <= entry_price and entry_price < current_high * 1.1
                
                rsi_prev = rsi_series.iloc[scan_i-1]
                line_prev = sup_line['m'] * (scan_i-1) + sup_line['c']
                
                if is_breakout and rsi_prev >= line_prev:
                    # Calculate SL/TP for SHORT
                    atr = df_htf['atr'].iloc[scan_i]
                    struct_sl = df_htf['high'].iloc[max(0, scan_i-5):scan_i].max() + (0.5 * atr)
                    vol_sl = entry_price + (2.5 * atr)
                    sl = min(struct_sl, vol_sl)
                    
                    p_max = df_htf['high'].iloc[sup_line['start_idx']:sup_line['end_idx']].max()
                    p_min = df_htf['low'].iloc[sup_line['start_idx']:sup_line['end_idx']].min()
                    structure_height = p_max - p_min
                    
                    tp = entry_price - (1.618 * structure_height)
                    
                    if tp >= entry_price:
                        tp = entry_price * 0.95
                    if sl <= entry_price:
                        sl = entry_price * 1.02
                    
                    if latest_price <= tp or latest_price >= sl:
                        continue
                    if latest_price < entry_price * 0.97:
                        continue
                    
                    # MIN TP FILTER: Reject if profit target too small
                    MIN_TP_PERCENT = 0.03  # 3% minimum
                    tp_pct = (entry_price - tp) / entry_price
                    if tp_pct < MIN_TP_PERCENT:
                        continue
                    
                    # Calculate score
                    p_start = df_htf['close'].iloc[sup_line['start_idx']]
                    p_end = df_htf['close'].iloc[sup_line['end_idx']]
                    price_change_pct = (abs(p_end - p_start) / p_start) * 100.0
                    duration = max(1, sup_line['end_idx'] - sup_line['start_idx'])
                    
                    scoring_data = {
                        "symbol": df_htf['symbol'].iloc[0] if 'symbol' in df_htf.columns else "BACKTEST",
                        "price_change_pct": float(price_change_pct),
                        "duration_candles": int(duration),
                        "price_slope": float(price_change_pct / duration),
                        "rsi_slope": float((sup_line['end_val'] - sup_line['start_val']) / duration),
                        "divergence_type": 0
                    }
                    
                    score_result = calculate_score(scoring_data)
                    geometry_score = min(StrategyConfig.SCORE_GEOMETRY_MAX, score_result['geometry_component'])
                    momentum_score = min(StrategyConfig.SCORE_MOMENTUM_MAX, score_result['momentum_component'])
                    total_score = geometry_score + momentum_score
                    
                    risk = sl - entry_price
                    rr = round((entry_price - tp) / risk, 2) if risk > 0 else 0.0
                    
                    setup = {'side': 'SHORT', 'entry': entry_price, 'tp': tp, 'sl': sl, 'rr': rr}
                    
                    signal = {
                        "timestamp": int(df_htf['timestamp'].iloc[scan_i]) if 'timestamp' in df_htf.columns else scan_i,
                        "price": float(latest_price),
                        "score": float(total_score),
                        "bias": "SHORT",
                        "action": "SHORT",
                        "rr": float(rr),
                        "entry": float(entry_price),
                        "stop_loss": float(sl),
                        "take_profit": float(tp),
                        "setup": setup,
                        "details": {
                            'total': total_score,
                            'geometry_component': geometry_score,
                            'momentum_component': momentum_score,
                            'score_breakdown': {
                                'base': 10.0,
                                'geometry': geometry_score,
                                'momentum': momentum_score,
                                'total': total_score
                            }
                        },
                        "htf": {"bias": "SHORT", "trend": "DOWN", "adx": 0},
                        "ltf": {
                            "rsi": float(rsi_series.iloc[scan_i]),
                            "bias": "SHORT",
                            "obvImbalance": "NEUTRAL",
                            "divergence": "NONE",
                            "isPullback": False,
                            "pullbackDepth": 0.0,
                            "volumeOk": True,
                            "momentumOk": True,
                            "isOverextended": False
                        }
                    }
                    
                    all_signals.append(signal)
        
        return all_signals

    def find_trendlines(self, rsi_series, direction='RESISTANCE'):
        """
        Identify valid trendlines on RSI using Consensus Rules.
        """
        rsi = rsi_series.values
        if len(rsi) < 50: return None
        
        # 1. Find Pivots
        if direction == 'RESISTANCE':
            peaks, _ = find_peaks(rsi, distance=10)
            pivots = peaks
        else:
            # Find valleys by inverting
            peaks, _ = find_peaks(-rsi, distance=10)
            pivots = peaks
            
        if len(pivots) < 2: return None
        
        return self._find_best_line_in_pivots(pivots, rsi, direction)

    def _find_best_line_in_pivots(self, pivots, rsi, direction):
        # Configuration for "Human-like" vision (Consensus Logic)
        MIN_SLOPE = 0.015  # Avoid flat lines (drift)
        MAX_SLOPE = 0.6    # Avoid vertical parabolic lines
        ORIGIN_RES_MIN = 60 # Resistance must start high
        ORIGIN_SUP_MAX = 40 # Support must start low
        
        best_line = None
        best_score = -1
        
        # Iterate all pairs (i, j) to find the master trendline
        # This decouples the line from the "last pivot"
        for i in range(len(pivots)):
            for j in range(i + 1, len(pivots)):
                p1_idx = pivots[i]
                p2_idx = pivots[j]
                
                # 1. Duration Filter
                if (p2_idx - p1_idx) < 20: continue
                
                x1, y1 = p1_idx, rsi[p1_idx]
                x2, y2 = p2_idx, rsi[p2_idx]
                
                if x2 == x1: continue
                m = (y2 - y1) / (x2 - x1)
                c = y1 - m * x1
                
                # 2. Slope & Direction Filter
                if direction == 'RESISTANCE':
                    if m >= 0: continue # Must descend
                    if abs(m) < MIN_SLOPE or abs(m) > MAX_SLOPE: continue
                    if y1 < ORIGIN_RES_MIN: continue 
                else: # SUPPORT
                    if m <= 0: continue # Must ascend
                    if abs(m) < MIN_SLOPE or abs(m) > MAX_SLOPE: continue
                    if y1 > ORIGIN_SUP_MAX: continue 

                # 3. Validation & Consensus
                touches = 0
                valid_line = True
                
                # Integrity Check (P1 -> P2)
                for k in range(p1_idx, p2_idx + 1):
                    model_y = m * k + c
                    actual_y = rsi[k]
                    diff = actual_y - model_y
                    
                    if direction == 'RESISTANCE':
                        if diff > 2.0: # Major violation up
                            valid_line = False; break
                    else: # SUPPORT
                        if diff < -2.0: # Major violation down
                            valid_line = False; break
                            
                    if abs(diff) < 1.5: touches += 1
                        
                if not valid_line: continue
                
                # 4. Future Confirmation (Points after P2)
                future_hits = 0
                for k_idx in range(j + 1, len(pivots)):
                    p_k = pivots[k_idx]
                    model_k = m * p_k + c
                    if abs(rsi[p_k] - model_k) < 2.5:
                        future_hits += 1
                
                # Scoring: Touches + Future Hits + Duration
                score = (touches * 1) + (future_hits * 15) + ((p2_idx - p1_idx) * 0.05)
                
                if score > best_score:
                    best_score = score
                    segment = rsi[p1_idx:p2_idx+1]
                    best_line = {
                        'm': float(m), 
                        'c': float(c), 
                        'touches': int(touches + future_hits), 
                        'start_idx': int(p1_idx),
                        'end_idx': int(p2_idx),
                        'start_val': float(y1),
                        'end_val': float(y2),
                        'min_val_in_range': float(np.min(segment)) if len(segment)>0 else 0,
                        'max_val_in_range': float(np.max(segment)) if len(segment)>0 else 100
                    }
                    
        return best_line

    def analyze(self, df, df_htf=None, mcap=0):
        # 1. Metrics
        df['rsi'] = df.ta.rsi(length=self.rsi_len)
        
        # [NEW] Pre-calculate components for Reverse RSI (Wilder's Smoothing)
        delta = df['close'].diff()
        gain = delta.clip(lower=0)
        loss = -delta.clip(upper=0)
        alpha = 1 / self.rsi_len
        df['avg_gain'] = gain.ewm(alpha=alpha, adjust=False).mean()
        df['avg_loss'] = loss.ewm(alpha=alpha, adjust=False).mean()
        
        df['obv'] = df.ta.obv()
        df['mfi'] = df.ta.mfi(length=14)
        df['atr'] = df.ta.atr(length=14)
        
        rsi_series = df['rsi'].fillna(50)
        if len(rsi_series) < 50: return self.empty_result(df)

        # 2. Analysis Scope (Smart Persistence - Last 3 candles)
        curr_i = len(df) - 1
        latest_price = df['close'].iloc[-1]
        
        breakout_score = 0

        details = {}
        action = 'WAIT'
        bias = 'NONE'
        setup = None
        trendline_info = None
        details = {'total': 0}

        # --- LONG LOGIC ---
        res_line = self.find_trendlines(rsi_series, 'RESISTANCE')
        if res_line:
            for offset in range(3):
                scan_i = curr_i - offset
                if scan_i < 50: continue

                # [REVERSE RSI IMPLEMENTATION - LONG]
                # Calculate the EXACT price needed to hit trendline
                projected_rsi = res_line['m'] * scan_i + res_line['c']
                
                avg_gain_prev = df['avg_gain'].iloc[scan_i-1]
                avg_loss_prev = df['avg_loss'].iloc[scan_i-1]
                close_prev = df['close'].iloc[scan_i-1]
                
                # Predictive Entry Price
                entry_price = self.calculate_reverse_rsi(projected_rsi, close_prev, avg_gain_prev, avg_loss_prev)
                
                current_high = df['high'].iloc[scan_i]
                current_low = df['low'].iloc[scan_i]
                
                # Check if price touched the entry level
                is_breakout = current_high >= entry_price and entry_price > current_low * 0.9 
                
                rsi_prev = rsi_series.iloc[scan_i-1]
                line_prev = res_line['m'] * (scan_i-1) + res_line['c']
                
                # print(f"DEBUG: Scan {scan_i} | RSI Prev: {rsi_prev:.2f} vs Line: {line_prev:.2f} | Entry Px: {entry_price:.2f}")
                if is_breakout and rsi_prev <= line_prev:
                    # entry_price is the precise level to use

                    # [DYNAMIC SL/TP - LONG]
                    # SL: Max(Struct Low - 0.5*ATR, Entry - 2.5*ATR)
                    # For LONG, SL is BELOW price. We want the TIGHTER (Higher) SL.
                    atr = df['atr'].iloc[scan_i]
                    struct_sl = df['low'].iloc[scan_i-5:scan_i].min() - (0.5 * atr)
                    vol_sl = entry_price - (2.5 * atr)
                    sl = max(struct_sl, vol_sl)
                    
                    # TP: Entry + 1.618 * Structure Height
                    # Structure proxy = Range during Trendline formation
                    p_max = df['high'].iloc[res_line['start_idx']:res_line['end_idx']].max()
                    p_min = df['low'].iloc[res_line['start_idx']:res_line['end_idx']].min()
                    structure_height = p_max - p_min
                    
                    tp = entry_price + (1.618 * structure_height)
                    
                    # Sanity
                    if tp <= entry_price: tp = entry_price * 1.05
                    if sl >= entry_price: sl = entry_price * 0.98
                    
                    # Filters: Not Dead, Not Runaway
                    if latest_price >= tp or latest_price <= sl: continue
                    if latest_price > entry_price * 1.03: continue
                    
                    # Valid Signal logic
                    try:
                        # Get symbol for API calls
                        symbol = df['symbol'].iloc[0] if 'symbol' in df.columns else "UNKNOWN"
                        
                        # 1. Calculate Geometry & Slopes
                        p_start = df['close'].iloc[res_line['start_idx']]
                        p_end = df['close'].iloc[res_line['end_idx']]
                        
                        price_change_pct = (abs(p_end - p_start) / p_start) * 100.0
                        duration = res_line['end_idx'] - res_line['start_idx']
                        duration = max(1, duration)
                        
                        price_slope = price_change_pct / duration
                        rsi_slope = (res_line['end_val'] - res_line['start_val']) / duration
                        
                        # 2. Divergence Memory (Scan Backwards)
                        div_type = 0
                        div_badge = None
                        
                        # Ensure we have enough data and respect trendline bounds
                        # SCAN FULL HISTORY of trendline (plus buffer)
                        scan_limit = max(0, res_line['start_idx'] - 20)
                        check_range = range(curr_i, scan_limit, -5)
                        
                        if curr_i not in check_range:
                            check_range = list(check_range)
                            check_range.insert(0, curr_i)

                        for d_idx in check_range:
                            if d_idx < 60: break
                            d_slice_df = df.iloc[:d_idx+1]
                            d_slice_rsi = rsi_series.iloc[:d_idx+1]
                            
                            found_div = self.detect_divergence_type(d_slice_df, d_slice_rsi, 'LONG')
                            
                            if found_div > 0:
                                age = curr_i - d_idx
                                if age <= 10:
                                    div_type = 2
                                else:
                                    div_type = 1
                                    div_badge = "DIV-PREP"
                                break
                        
                        # 3. Call Scoring Engine for Geometry & Momentum
                        scoring_data = {
                            "symbol": symbol,
                            "price_change_pct": float(price_change_pct or 0.0),
                            "duration_candles": int(duration or 0),
                            "price_slope": float(price_slope or 0.0),
                            "rsi_slope": float(rsi_slope or 0.0),
                            "divergence_type": int(div_type or 0)
                        }
                        
                        score_result = calculate_score(scoring_data)
                        # Clamp and Round (Blueprint v1.1.5 Limits)
                        geometry_score = round(min(StrategyConfig.SCORE_GEOMETRY_MAX, score_result['geometry_component']), 1)
                        momentum_score = round(min(StrategyConfig.SCORE_MOMENTUM_MAX, score_result['momentum_component']), 1)
                        
                        # 4. FUNDING RATE HARD FILTER
                        funding_passed, funding_rate = self.check_funding_rate(symbol)
                        if not funding_passed:
                            print(f"[BREAKOUT REJECTED] {symbol} - Funding rate too high: {funding_rate:.4f}%", file=sys.stderr)
                            continue  # Skip this signal
                        
                        # 5. OI Flow Score (0-20 pts)
                        duration_hours = duration * 0.25  # Convert 15m candles to hours
                        oi_score, oi_meta = self.calculate_oi_flow(symbol, 'LONG', duration_hours)
                        
                        # 6. Sentiment Score (0-10 pts)
                        sentiment_score, sentiment_meta = self.calculate_sentiment_score(symbol, 'LONG')
                        
                        # Round intermediate scores
                        oi_score = round(oi_score, 1)
                        sentiment_score = round(sentiment_score, 1)
                        
                        # 7. Action Bonuses (Retest + Squeeze)
                        action_bonus = 0
                        # RETEST Bonus: +15
                        if offset > 0:
                            action_bonus += 15  
                        
                        # DEEP RSI Bonus (Oversold/Bought at Breakout point)
                        if res_line['min_val_in_range'] < 30:
                            action_bonus += 5  
                            
                        # SQUEEZE Bonus: +10 if Volume high + Positive OI Delta
                        # Check Volume Ratio (Current vs Avg)
                        vol_ratio = 1.0
                        if 'volume' in df.columns:
                            curr_vol = df['volume'].iloc[curr_i]
                            avg_vol = df['volume'].iloc[curr_i-20:curr_i].mean()
                            if avg_vol > 0: vol_ratio = curr_vol / avg_vol
                        
                        if vol_ratio > 2.0 and oi_score > 5: # oi_score > 5 implies positive slope
                             action_bonus += 10
                             div_badge = "SQUEEZE" # Override badge
                        
                        # TOTAL SCORE (5 components)
                        breakout_score = geometry_score + momentum_score + oi_score + sentiment_score + action_bonus
                        breakout_score = min(100.0, breakout_score)
                        
                        # Calculate actual R:R for LONG
                        risk = entry_price - sl
                        reward = tp - entry_price
                        rr_value = round(reward / risk, 2) if risk > 0 else 0.0
                        
                        setup = {'entry': entry_price, 'sl': sl, 'tp': tp, 'rr': rr_value, 'side': 'LONG'}
                        details = {
                            'total_score': breakout_score,
                            'score_breakdown': {
                                'geometry': float(geometry_score),
                                'momentum': float(momentum_score),
                                'oi_flow': float(oi_score),
                                'sentiment': float(sentiment_score),
                                'bonuses': float(action_bonus),
                                'total': float(breakout_score)
                            },
                            'geometry_component': float(geometry_score),
                            'momentum_component': float(momentum_score),
                            'oi_meta': clean_nans(oi_meta),
                            'sentiment_meta': clean_nans(sentiment_meta),
                            'funding_rate': float(funding_rate),
                            'type': 'BREAKOUT' if offset == 0 else 'RETEST',
                            'raw_components': scoring_data,
                            'context_badge': div_badge
                        }
                        trendline_info = res_line
                        
                        action = 'BUY_BREAKOUT' if offset == 0 else 'BUY_RETEST'
                        bias = 'LONG'
                        break 
                        
                    except Exception as e:
                        print(f"Scoring Error (LONG): {e}")
                        breakout_score = 50.0
            
            # Touch Check
            if action == 'WAIT':
                threshold = res_line['m'] * curr_i + res_line['c']
                curr_rsi = rsi_series.iloc[curr_i]
                if abs(curr_rsi - threshold) < 3.0 and curr_rsi < threshold:
                    score = 50
                    action = 'WATCH'
                    bias = 'LONG'
                    trendline_info = res_line
                    details = {'total': 50, 'type': 'TOUCH'}

        # --- SHORT LOGIC ---
        if action == 'WAIT':
            sup_line = self.find_trendlines(rsi_series, 'SUPPORT')
            if sup_line:
                for offset in range(3):
                    # [REVERSE RSI IMPLEMENTATION - SHORT]
                    projected_rsi = sup_line['m'] * curr_i + sup_line['c']
                    
                    avg_gain_prev = df['avg_gain'].iloc[curr_i-1]
                    avg_loss_prev = df['avg_loss'].iloc[curr_i-1]
                    close_prev = df['close'].iloc[curr_i-1]
                    
                    entry_price = self.calculate_reverse_rsi(projected_rsi, close_prev, avg_gain_prev, avg_loss_prev)
                    
                    current_high = df['high'].iloc[curr_i]
                    current_low = df['low'].iloc[curr_i]
                    
                    # For Short, we need Price <= Entry (Breakdown)
                    is_breakout = current_low <= entry_price and entry_price < current_high * 1.1 
                    
                    rsi_prev = rsi_series.iloc[curr_i-1]
                    line_prev = sup_line['m'] * (curr_i-1) + sup_line['c']
                    
                    if is_breakout and rsi_prev >= line_prev:
                        # entry_price is the breakout price
                        
                        # [DYNAMIC SL/TP - SHORT]
                        # SL: Min(Struct High + 0.5*ATR, Entry + 2.5*ATR)
                        atr = df['atr'].iloc[scan_i]
                        struct_sl = df['high'].iloc[scan_i-5:scan_i].max() + (0.5 * atr)
                        vol_sl = entry_price + (2.5 * atr)
                        sl = min(struct_sl, vol_sl) # Higher is safer? No, for SHORT, SL is ABOVE price.
                        # Wait, for SHORT, we want the LOWER stop loss? No, we want the TIGHTER stop loss.
                        # Price is dropping. SL is above. 
                        # Struct SL = 105. Vol SL = 110. Safer = 105 (Closer/Tighter).
                        # So for SHORT, SL = MIN(Struct, Vol) is correct.
                        
                        # TP: Entry - 1.618 * Structure Height
                        # Structure Height proxy = Trendline Duration Range
                        p_max = df['high'].iloc[sup_line['start_idx']:sup_line['end_idx']].max()
                        p_min = df['low'].iloc[sup_line['start_idx']:sup_line['end_idx']].min()
                        structure_height = p_max - p_min
                        
                        tp = entry_price - (1.618 * structure_height)
                        
                        # Sanity: TP must be below Entry. SL must be above Entry.
                        if tp >= entry_price: tp = entry_price * 0.95
                        if sl <= entry_price: sl = entry_price * 1.02
                        
                        if latest_price <= tp or latest_price >= sl: continue
                        if latest_price < entry_price * 0.97: continue # Too late
                        
                        try:
                            # Get symbol for API calls
                            symbol = df['symbol'].iloc[0] if 'symbol' in df.columns else "UNKNOWN"
                            
                            # 1. Calculate Geometry & Slopes
                            p_start = df['close'].iloc[sup_line['start_idx']]
                            p_end = df['close'].iloc[sup_line['end_idx']]
                            
                            price_change_pct = (abs(p_end - p_start) / p_start) * 100.0
                            duration = sup_line['end_idx'] - sup_line['start_idx']
                            duration = max(1, duration)
                            
                            price_slope = price_change_pct / duration
                            rsi_slope = (sup_line['end_val'] - sup_line['start_val']) / duration
                            
                            # 2. Divergence Memory (Scan Backwards)
                            div_type = 0
                            div_badge = None
                            
                            # Ensure we have enough data and respect trendline bounds
                            # SCAN FULL HISTORY of trendline (plus buffer)
                            scan_limit = max(0, sup_line['start_idx'] - 20) 
                            check_range = range(curr_i, scan_limit, -5)
                            
                            if curr_i not in check_range:
                                check_range = list(check_range)
                                check_range.insert(0, curr_i)

                            for d_idx in check_range:
                                if d_idx < 60: break
                                d_slice_df = df.iloc[:d_idx+1]
                                d_slice_rsi = rsi_series.iloc[:d_idx+1]
                                
                                found_div = self.detect_divergence_type(d_slice_df, d_slice_rsi, 'SHORT')
                                
                                if found_div > 0:
                                    age = curr_i - d_idx
                                    if age <= 10:
                                        div_type = 2 # Fresh -> 30 pts
                                    else:
                                        div_type = 1 # Old -> 20 pts (DIV-PREP)
                                        div_badge = "DIV-PREP"
                                    break
                            
                            # 3. Call Scoring Engine for Geometry & Momentum
                            scoring_data = {
                                "symbol": symbol,
                                "price_change_pct": float(price_change_pct or 0.0),
                                "duration_candles": int(duration or 0),
                                "price_slope": float(price_slope or 0.0),
                                "rsi_slope": float(rsi_slope or 0.0),
                                "divergence_type": int(div_type or 0)
                            }
                            
                            score_result = calculate_score(scoring_data)
                            # Clamp and Round (Blueprint v1.1.5 Limits)
                            geometry_score = round(min(StrategyConfig.SCORE_GEOMETRY_MAX, score_result['geometry_component']), 1)
                            momentum_score = round(min(StrategyConfig.SCORE_MOMENTUM_MAX, score_result['momentum_component']), 1)
                            
                            # 4. FUNDING RATE HARD FILTER
                            funding_passed, funding_rate = self.check_funding_rate(symbol)
                            if not funding_passed:
                                print(f"[BREAKOUT REJECTED] {symbol} - Funding rate too high: {funding_rate:.4f}%", file=sys.stderr)
                                continue  # Skip this signal
                            
                            # 5. OI Flow Score (0-20 pts)
                            duration_hours = duration * 0.25  # Convert 15m candles to hours
                            oi_score, oi_meta = self.calculate_oi_flow(symbol, 'SHORT', duration_hours)
                            
                            # 6. Sentiment Score (0-10 pts)
                            sentiment_score, sentiment_meta = self.calculate_sentiment_score(symbol, 'SHORT')
                            
                            # Round intermediate scores
                            oi_score = round(oi_score, 1)
                            sentiment_score = round(sentiment_score, 1)
                            
                            # 7. Action Bonuses (Retest + Squeeze)
                            action_bonus = 0
                            # RETEST Bonus: +15
                            if offset > 0:
                                action_bonus += StrategyConfig.BONUS_RETEST
                            
                            # DEEP RSI Bonus
                            if sup_line['max_val_in_range'] > 70:
                                action_bonus += 5
                                
                            # SQUEEZE Bonus: +10
                            vol_ratio = 1.0
                            if 'volume' in df.columns:
                                curr_vol = df['volume'].iloc[curr_i]
                                avg_vol = df['volume'].iloc[curr_i-20:curr_i].mean()
                                if avg_vol > 0: vol_ratio = curr_vol / avg_vol
                            
                            if vol_ratio > StrategyConfig.MIN_VOL_RATIO_SQUEEZE and oi_score > StrategyConfig.MIN_OI_SCORE_SQUEEZE:
                                 action_bonus += StrategyConfig.BONUS_SQUEEZE
                                 div_badge = "SQUEEZE"
                            
                            # TOTAL SCORE (5 components)
                            breakout_score = geometry_score + momentum_score + oi_score + sentiment_score + action_bonus
                            breakout_score = min(100.0, breakout_score)
                            
                            # Calculate actual R:R for SHORT
                            risk = sl - entry_price
                            reward = entry_price - tp
                            rr_value = round(reward / risk, 2) if risk > 0 else 0.0
                            
                            setup = {'entry': entry_price, 'sl': sl, 'tp': tp, 'rr': rr_value, 'side': 'SHORT'}
                            details = {
                                'total_score': breakout_score,
                                'score_breakdown': {
                                    'geometry': float(geometry_score),
                                    'momentum': float(momentum_score),
                                    'oi_flow': float(oi_score),
                                    'sentiment': float(sentiment_score),
                                    'bonuses': float(action_bonus),
                                    'total': float(breakout_score)
                                },
                                'geometry_component': float(geometry_score),
                                'momentum_component': float(momentum_score),
                                'oi_meta': clean_nans(oi_meta),
                                'sentiment_meta': clean_nans(sentiment_meta),
                                'funding_rate': float(funding_rate),
                                'type': 'BREAKOUT' if offset == 0 else 'RETEST',
                                'raw_components': scoring_data,
                                'context_badge': div_badge
                            }
                            trendline_info = sup_line
                            
                            action = 'SELL_BREAKDOWN' if offset == 0 else 'SELL_RETEST'
                            bias = 'SHORT'
                            break
                            
                        except Exception as e:
                            print(f"Scoring Error (SHORT): {e}")
                            breakout_score = 50.0

                if action == 'WAIT':
                    threshold = sup_line['m'] * curr_i + sup_line['c']
                    curr_rsi = rsi_series.iloc[curr_i]
                    if abs(curr_rsi - threshold) < 3.0 and curr_rsi > threshold:
                        score = 50
                        action = 'WATCH'
                        bias = 'SHORT'
                        trendline_info = sup_line
                        details = {'total': 50, 'type': 'TOUCH'}

        # Formatting
        # Formatting - Ensure robust structure for Aggregator
        final_score_details = {
             "total": 0.0,
             "score_breakdown": {
                 "geometry": 0.0, "momentum": 0.0, 
                 "oi_flow": 0.0, "sentiment": 0.0, "bonuses": 0.0,
                 "base": 0.0, "total": 0.0
             },
             "geometry_component": 0.0,
             "momentum_component": 0.0,
             "raw_components": {"price_change_pct": 0.0, "duration_candles": 0, "divergence_type": 0},
             "type": details.get('type', 'NONE')
        }
        
        # If we have a valid signal/touch, merge its details
        if details:
            final_score_details.update(details)
            
        # Ensure 'total' reflects the capped score if not in details
        if 'total' not in details and breakout_score > 0:
             final_score_details['total'] = int(breakout_score)

        if setup and trendline_info:
             t_proj_val = trendline_info['m'] * curr_i + trendline_info['c']
             setup['trendline'] = {
                 'm': float(trendline_info['m']),
                 'c': float(trendline_info['c']),
                 'start_idx': int(trendline_info['start_idx']),
                 'start_rsi': float(trendline_info['start_val']),
                 'end_idx': int(trendline_info['end_idx']),
                 'end_rsi': float(trendline_info['end_val']),
                 'current_idx': int(curr_i),
                 'current_projected_rsi': float(t_proj_val)
             }

        return {
            "strategy_name": "Breakout",
            "symbol": "UNKNOWN",
            "price": float(latest_price),
            "score": float(breakout_score) if action != 'WAIT' else 0.0,
            "bias": bias,
            "action": action,
            "rr": float(setup['rr']) if setup else 0.0,
            "entry": float(setup['entry']) if setup else None,
            "stop_loss": float(setup['sl']) if setup else None,
            "take_profit": float(setup['tp']) if setup else None,
            "setup": setup,
            "details": final_score_details,
            "htf": {'trend': bias}, 
            "ltf": {**DEFAULT_LTF, 'rsi': float(rsi_series.iloc[-1])},
            "timestamp": int(datetime.datetime.now().timestamp() * 1000)
        }

    def empty_result(self, df):
        last_row = df.iloc[-1]
        return {
            "strategy_name": self.name(),
            "symbol": "UNKNOWN",
            "price": float(last_row['close']),
            "score": 0.0,
            "bias": "NONE",
            "action": "WAIT",
            "rr": 0.0,
            "entry": None, "stop_loss": None, "take_profit": None,
            "setup": None,
            "details": {
                "total": 0.0,
                "score_breakdown": {
                    "geometry": 0.0,
                    "momentum": 0.0,
                    "oi_flow": 0.0,
                    "sentiment": 0.0,
                    "bonuses": 0.0,
                    "total": 0.0
                },
                "geometry_component": 0.0,
                "momentum_component": 0.0,
                "oi_meta": {},
                "sentiment_meta": {},
                "funding_rate": 0.0,
                "type": "NONE",
                "raw_components": {
                    "price_change_pct": 0.0,
                    "duration_candles": 0, 
                    "divergence_type": 0
                }
            },
            "htf": {}, "ltf": DEFAULT_LTF.copy()
        }

# ==========================================
# UTILITIES
# ==========================================
# ==========================================
# UTILITIES
# ==========================================
def calculate_reverse_rsi(target_rsi, data, rsi_period=14):
    """
    Calculate the price needed to hit a target RSI using proper Wilder's Smoothing (RMA).
    Formula: Delta = (TargetRS * AvgLoss - AvgGain) * (N-1)
    """
    import pandas as pd
    import numpy as np

    if isinstance(data, pd.DataFrame):
        close = data['close']
    else:
        close = data
        
    # Validation
    if len(close) < rsi_period + 1:
        return close.iloc[-1]

    delta = close.diff()
    
    # 1. Calculate Gains and Losses
    # Use numpy for speed if needed, but pandas Series is fine
    gains = delta.clip(lower=0)
    losses = -delta.clip(upper=0)
    
    # 2. Replicate Wilder's Smoothing (RMA) matches pandas_ta
    # First value is SMA of first N periods
    # Subsequent are (Prev * (N-1) + Current) / N
    
    # We only need the LAST AvgGain and AvgLoss. 
    # To be perfectly accurate, we must iterate from the index where RSI becomes valid.
    # However, pandas ewm(alpha=1/N, adjust=False) is ALMOST identical except for initialization.
    # To fix initialization:
    
    # Initialize with SMA
    avg_gain = gains.rolling(window=rsi_period).mean().iloc[rsi_period]
    avg_loss = losses.rolling(window=rsi_period).mean().iloc[rsi_period]
    
    # Iterate to current
    # We can use the ewm function but we need to supply the 'initial' value?
    # Easier to just loop for exact match if length is reasonable, or use a correction factor.
    # Given typical length ~1000 candles, loop is fine in Python for a single call? 
    # No, iteration is slow.
    
    # Faster way: Pandas ewm with adjust=False is Wilder's IF we handle pre-seeding.
    # But pandas_ta actually just uses `ewm(alpha=1/N, adjust=False)` on the whole series?
    # Let's verify standard pandas_ta behavior. 
    # Most libs do: rma = series.ewm(alpha=1/length, min_periods=length).mean()
    # BUT standard pandas ewm starts from index 0. RSI usually needs min_periods.
    
    # Let's try the vectorised EWM approach which is usually close enough IF data history is long (>100 candles).
    # The discrepancy in the debug script (2.9 RSI points) suggests a MAJOR difference, likely the SMA seed missing.
    
    # Correct Loop implementation for robust "Last Value":
    # (Optimized: we don't need to store all, just update)
    
    values_g = gains.values
    values_l = losses.values
    
    # SMA Seed (at index N)
    # Note: changes df index logic. 
    # data is expected to be Series.
    
    # Make sure we have enough data
    if len(values_g) < rsi_period: return close.iloc[-1]
    
    curr_avg_gain = np.mean(values_g[1:rsi_period+1]) # indices 1 to 14? (0 is NaN)
    curr_avg_loss = np.mean(values_l[1:rsi_period+1])
    
    alpha = 1.0 / rsi_period
    
    # Run loop from N+1 to End
    for i in range(rsi_period + 1, len(values_g)):
        curr_avg_gain = (curr_avg_gain * (rsi_period - 1) + values_g[i]) / rsi_period
        curr_avg_loss = (curr_avg_loss * (rsi_period - 1) + values_l[i]) / rsi_period
        
    prev_avg_gain = curr_avg_gain
    prev_avg_loss = curr_avg_loss
    
    prev_close = close.iloc[-1]
    
    # Edge Cases
    if target_rsi >= 100: return prev_close * 1.05
    if target_rsi <= 0: return prev_close * 0.95
    
    rs_target = target_rsi / (100.0 - target_rsi)
    
    # Solve for Price Delta
    # TargetRS = (AvgGain_new) / (AvgLoss_new)
    
    # Case 1: Assume Price Goes UP (Gain)
    # AvgGain_new = (PrevAvgGain * (N-1) + Delta) / N
    # AvgLoss_new = (PrevAvgLoss * (N-1) + 0) / N
    # TargetRS = [ (PrevAvgGain*(N-1) + Delta) ] / [ PrevAvgLoss*(N-1) ]
    # Delta = TargetRS * PrevAvgLoss * (N-1) - PrevAvgGain * (N-1)
    
    delta_gain = (rs_target * prev_avg_loss * (rsi_period - 1)) - (prev_avg_gain * (rsi_period - 1))
    
    # If delta_gain > 0, assumption was correct.
    if delta_gain >= 0:
        return prev_close + delta_gain
        
    # Case 2: Assume Price Goes DOWN (Loss)
    # AvgGain_new = (PrevAvgGain * (N-1) + 0) / N
    # AvgLoss_new = (PrevAvgLoss * (N-1) + DeltaLoss) / N
    # TargetRS = [ PrevAvgGain * (N-1) ] / [ PrevAvgLoss * (N-1) + DeltaLoss ]
    # PrevAvgLoss*(N-1) + DeltaLoss = (PrevAvgGain * (N-1)) / TargetRS
    # DeltaLoss = [ (PrevAvgGain * (N-1)) / TargetRS ] - (PrevAvgLoss * (N-1))
    
    delta_loss = ((prev_avg_gain * (rsi_period - 1)) / rs_target) - (prev_avg_loss * (rsi_period - 1))
    
    return prev_close - delta_loss

    prev_avg_gain = avg_gain_series.iloc[-2] # -1 is current (if included), -2 is previous? 
    # Wait, 'data' passed usually includes the current candle? 
    # If we are projecting for the CURRENT candle finishing at a certain price, we use averages from the PREVIOUS closed candle.
    # Assuming 'data' ends with the previous closed candle. 
    # Or if 'data' includes proper 'avg_gain', 'avg_loss'.
    
    # Let's assume passed 'data' includes usage up to index i-1.
    prev_close = close.iloc[-1]
    
    # Get last valid smoothed averages
    prev_avg_gain = avg_gain_series.iloc[-1]
    prev_avg_loss = avg_loss_series.iloc[-1]
    
    # RS Target
    if target_rsi == 100: return prev_close * 1.5 # Impossible high
    if target_rsi == 0: return prev_close * 0.5   # Impossible low
    
    rs_target = target_rsi / (100.0 - target_rsi)
    
    # Formula:
    # Price = prev_close + ((RS * AvgLoss * (N-1)) - (AvgGain * (N-1))) / (1 + RS) ??
    # User Formula Check:
    # Price = prev_close + ((RS_target * avg_loss * (N-1)) - (avg_gain * (N-1))) / (1 + RS_target)
    
    # This formula looks like it assumes Wilder's Smoothing where Total = Avg * N?
    # Or implies (N-1) factor from the smoothing step update.
    # Let's trust the user's provided logic verbatim.
    
    numerator = (rs_target * prev_avg_loss * (rsi_period - 1)) - (prev_avg_gain * (rsi_period - 1))
    denominator = 1 + rs_target
    
    target_price = prev_close + (numerator / denominator)
    return target_price

# ==========================================
# STRATEGY V2
# ==========================================
# ==========================================
# STRATEGY V2
# ==========================================
class QuantProBreakoutV2(Strategy):
    """
    Strategy V2: Institutional RSI Breakout (Sidecar)
    Features: State Persistence, V1 Scoring Filter, Breakout -> Retest Logic.
    """
    def __init__(self, config=None):
        self.config = config or {}
        self.state_file = "data/v2_state.json"
        self.v1_strategy = QuantProBreakout(config)
        self.state = self.load_state()
        
    def name(self):
        return "BreakoutV2"
        
    def load_state(self):
        import os
        if os.path.exists(self.state_file):
            try:
                with open(self.state_file, 'r') as f:
                    return json.load(f)
            except:
                return {}
        return {}
        
    def save_state(self):
        import json
        with open(self.state_file, 'w') as f:
            json.dump(self.state, f, indent=2)

    def analyze(self, df, df_htf=None, mcap=0):
        # V2 runs on HTF (4H) mostly. Ensure we have data.
        target_df = df_htf if df_htf is not None else df
        if len(target_df) < 50: 
            return {
                'action': 'WAIT',
                'score': 0,
                'details': {'total': 0},
                'strategy_name': self.name()
            }
        
        symbol = target_df['symbol'].iloc[0] if 'symbol' in target_df.columns else "UNKNOWN"
        
        # Get Symbol State
        sym_state = self.state.get(symbol, {
            'status': 'IDLE', # IDLE, WAITING_RETEST, IN_TRADE
            'target_rsi': 0,
            'entry_target': 0,
            'sl': 0,
            'tp': 0
        })
        
        # Prepare Indicators
        # We only need the last few candles for decision, but calculating RSI needs history.
        # Check if column exists or calc it?
        # Assuming df has standard OHLCV.
        if 'rsi' not in target_df.columns:
            target_df['rsi'] = target_df.ta.rsi(length=StrategyConfig.RSI_PERIOD)
            
        # Vol Z-Score
        # Calculate only for tail to save time? Or full series.
        # Full series is safer for rolling.
        vol_mean = target_df['volume'].rolling(window=StrategyConfig.OI_ZSCORE_LOOKBACK).mean()
        vol_std = target_df['volume'].rolling(window=StrategyConfig.OI_ZSCORE_LOOKBACK).std()
        target_df['vol_zscore'] = (target_df['volume'] - vol_mean) / vol_std
        
        # Current Candle (Latest Closed or Forming?)
        # Market Scanner loads data. Usually last row is the LATEST candle.
        # If it's forming, we might want to check previous closed.
        # Assuming last row is 'Current'.
        
        row = target_df.iloc[-1]
        prev = target_df.iloc[-2]
        
        curr_rsi = row['rsi']
        prev_rsi = prev['rsi']
        
        action = 'WAIT'
        details = {
            'total': 0,
            'oi_meta': {'oi_slope': 0.0, 'oi_points': 0, 'oi_avg': 0.0},
            'sentiment_meta': {
                "liq_longs": 0, "liq_shorts": 0, "liq_ratio": 0.0, 
                "top_ls_ratio": 0.0
            }
        }
        
        # --- STATE MACHINE ---
        
        if sym_state['status'] == 'IDLE':
            # Check Breakout
            is_breakout = (prev_rsi <= 60 and curr_rsi > 60)
            
            if is_breakout:
                # V1 Filter
                try:
                    # Score the breakout using V1 logic
                    # Pass slice for scoring
                    slice_df = target_df.copy() # Safe copy
                    analysis = self.v1_strategy.analyze(slice_df, slice_df)
                    v1_score = analysis.get('details', {}).get('total', 0)
                except:
                    v1_score = 0
                    
                if v1_score >= StrategyConfig.V2_MIN_SCORE_V1:
                     # 70/30 RULE: Check Anchor
                     # Bullish Line must start > 70
                     setup_tl = analysis.get('setup', {}).get('trendline', {})
                     anchor_rsi = setup_tl.get('start_rsi', 50.0)
                     
                     print(f"[V2-GEOMETRY] {symbol}: Checking Anchor at RSI {anchor_rsi:.1f}...", file=sys.stderr, end="")
                     
                     if anchor_rsi > 70.0:
                         print(" [VALID]", file=sys.stderr)
                         
                         # Check Institutional Filter (Mocked via Vol Z-Score)
                         if row['vol_zscore'] > 1.5:
                             # VALID BREAKOUT -> TRANSITION
                             sym_state['status'] = 'WAITING_RETEST'
                             sym_state['target_rsi'] = 60.0 # Strict retest target
                             print(f"[V2] {symbol}: Breakout Detected! Score={v1_score}, VolZ={row['vol_zscore']:.2f}. Waiting for Retest.", file=sys.stderr)
                         else:
                             print(f"[V2] {symbol}: Breakout Filtered by VolZ ({row['vol_zscore']:.2f})", file=sys.stderr)
                     else:
                         print(" [INVALID - Anchor < 70]", file=sys.stderr)
                else:
                    print(f"[V2] {symbol}: Breakout Filtered by V1 Score ({v1_score})", file=sys.stderr)
                    
        elif sym_state['status'] == 'WAITING_RETEST':
            # Check Failure conditions
            if prev_rsi < sym_state['target_rsi']:
                # Collapsed
                sym_state['status'] = 'IDLE'
                print(f"[V2] {symbol}: Retest Failed (RSI Collapsed)", file=sys.stderr)
            else:
                # Calculate Price Target
                retest_target = sym_state['target_rsi']
                target_price = calculate_reverse_rsi(retest_target, target_df.iloc[:-1], rsi_period=StrategyConfig.RSI_PERIOD)
                
                # Check Entry (Low Hit)
                if row['low'] <= target_price:
                    # TRIGGER ENTRY
                    entry_price = target_price
                    pivot_low = target_df['low'].iloc[-15:-1].min() # Last 15 candles pivot
                    
                    # [DYNAMIC SL/TP for V2]
                    # Logic: Max(Structure Low, Entry - 2.5 ATR)
                    atr = target_df['atr'].iloc[-1]
                    sl_struct = pivot_low - (0.5 * atr)
                    sl_vol = entry_price - (2.5 * atr)
                    sl = max(sl_struct, sl_vol)
                    
                    # Logic: Fib extension of Recent Impulse
                    # V2 Impulse = Low to Recent High (The move that failed and came back)
                    p_high = target_df['high'].iloc[-15:-1].max()
                    impulse_height = p_high - pivot_low
                    tp = entry_price + (1.618 * impulse_height)
                    
                    # Sanity
                    if sl >= entry_price: sl = entry_price * 0.98
                    if tp <= entry_price: tp = entry_price * 1.05
                    
                    sym_state['status'] = 'IDLE' # Reset after signaling (Or IN_TRADE if we tracked via execution)
                    # For Scanner, we signal BUY. The Tracker handles the trade management.
                    # We reset state so we don't signal repeatedly?
                    # Or we stay in specific state?
                    # Let's signal ONCE.
                    
                    action = 'BUY'
                    details = {
                        'entry': entry_price,
                        'sl': sl,
                        'tp': tp,
                        'type': 'RETEST_ENTRY',
                        'desc': f"V2 Retest of RSI {retest_target}"
                    }
                    
                    # [V2 RR CALCULATION]
                    risk = entry_price - sl
                    reward = tp - entry_price
                    if risk > 0:
                        rr_val = round(reward / risk, 2)
                    else:
                        rr_val = 0.0
                    details['rr'] = rr_val # Save in details too?
                    # The scanner main loop extracts 'rr' from top-level sometimes.
                    # We should return it in the main dict.
                    
                    print(f"[V2] {symbol}: ENTRY SIGNAL! Price {entry_price:.2f} RR: {rr_val}", file=sys.stderr)
                    
        # Prepare Score Breakdown for UI
        # We try to get V1 breakdown if available (from Breakout check phase)
        # If not available (e.g. entry signal phase), we should probably run a quick scoring check
        # or defaults.
        
        score_breakdown = {
            'geometry': 0, 'momentum': 0, 'oi_flow': 0, 'sentiment': 0, 'bonuses': 0, 'total': 0
        }
        
        # If we have a pending/active state, we likely want to see the "Validation" scores
        # Run a V1 analysis to get current metrics (OI/Sentiment) even if not a fresh breakout
        # Also need badge metadata
        try:
             # Full V1 analysis to get metadata
             v1_full = self.v1_strategy.analyze(target_df, df_htf, mcap)
             if v1_full:
                 if 'details' in v1_full:
                     d = v1_full['details']
                     if 'score_breakdown' in d:
                         score_breakdown = d['score_breakdown']
                         # Override total if we are forcing a buy
                         if action == 'BUY': score_breakdown['total'] = 100
                     
                     # MERGE METADATA FOR BADGES
                     details['oi_meta'] = d.get('oi_meta', details['oi_meta'])
                     details['sentiment_meta'] = d.get('sentiment_meta', details['sentiment_meta'])
                     
                     # Extract raw_components for badge display (HUGE AREA, TRIPLE DIV, etc.)
                     if 'raw_components' in d:
                         details['raw_components'] = d['raw_components']
                     
                     # Extract context_badge (DIV-PREP, SQUEEZE, etc.)
                     if 'context_badge' in d:
                         details['context_badge'] = d['context_badge']

        except Exception as e:
             # print(e, file=sys.stderr)
             pass
             
        # Inject into details
        details['score_breakdown'] = score_breakdown
        
        # Prepare State Details
        details['status'] = sym_state['status']
        details['target_rsi'] = sym_state['target_rsi']
        
        # Decide on Setup output
        # If we have a V1 setup (e.g. Trendline), show it for context even if we are waiting
        v1_setup = None
        try:
             # We already ran v1_full earlier. 
             # RE-RUN with explict copy and debug if needed?
             # If v1_full was 0, maybe we force a re-run or check components
             if v1_full:
                 v1_setup = v1_full.get('setup')
             
             # FALLBACK: If status is WAITING_RETEST, we MUST have a setup for UI?
             # Or if IDLE but high score.
             # If v1_setup is still None, create a dummy one to prevent crash
             if v1_setup is None:
                 v1_setup = {
                    "side": "WATCH", "entry": 0, "tp": 0, "sl": 0, "rr": 0,
                    "trendline": {"start_rsi": 50, "end_rsi": 50, "current_projected_rsi": 50}
                 }
        except:
             pass

        final_score = float(score_breakdown['total'])
        if action == 'BUY':
             final_score = 100.0
             
        # FORCE NON-ZERO SCORE FOR DEBUG IF 0 (To verify UI)
        if final_score == 0: 
             final_score = 0.1 # Minimal nonzero to show it exists
        
        # [FIX] Propagate Breakdown Total to Details Total
        if 'score_breakdown' in details and 'total' in details['score_breakdown']:
            details['total'] = details['score_breakdown']['total']
            
        print(f"[V2-DEBUG] {symbol} Final Score: {final_score}, Details Total: {details.get('total')}, Breakdown: {details.get('score_breakdown')}", file=sys.stderr)

        return clean_nans({
            'action': action,
            'score': final_score,
            'details': details,
            'strategy_name': self.name(),
            # Use V2 trade setup if BUY, otherwise fallback to V1 setup (trendline) for watching
            'setup': details if action == 'BUY' else v1_setup,
            'price': float(target_df['close'].iloc[-1]),
            'bias': 'LONG' if action == 'BUY' else (v1_full.get('bias', 'NONE') if v1_full else 'NONE'),
            'rr': float(details.get('rr', 0)) if action == 'BUY' else (float(v1_setup.get('rr', 0)) if v1_setup else 0.0),
            'entry': details.get('entry') if action == 'BUY' else (float(v1_setup.get('entry')) if v1_setup and 'entry' in v1_setup else None),
            'stop_loss': details.get('sl') if action == 'BUY' else (float(v1_setup.get('sl')) if v1_setup and 'sl' in v1_setup else None),
            'take_profit': details.get('tp') if action == 'BUY' else (float(v1_setup.get('tp')) if v1_setup and 'tp' in v1_setup else None),
            'timestamp': int(datetime.datetime.now().timestamp() * 1000),
            'components': details.get('raw_components', {
                'price_change_pct': 0.0,
                'duration_candles': 0,
                'divergence_type': 0
            }),
            'raw_components': details.get('raw_components', {
                'price_change_pct': 0.0,
                'duration_candles': 0,
                'divergence_type': 0
            }),
            'htf': {},
            'ltf': DEFAULT_LTF.copy()
        })

    def backtest(self, df, df_htf=None, mcap=0):
        # V2 Backtest logic is in backtest_v2.py
        # This function is required by abstract base class but unused for scanner backtest mode here.
        return []

