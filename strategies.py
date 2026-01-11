
import pandas as pd
import pandas_ta as ta
import numpy as np
import sys
from scipy.signal import find_peaks, argrelextrema
import datetime
import matplotlib.pyplot as plt
plt.switch_backend('Agg')
from abc import ABC, abstractmethod
from scoring_engine import calculate_score

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
            "details": score_breakdown, # score_breakdown now contains the breakdown dict
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
        self.rsi_len = 14
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
        


        
    def name(self):
        return "Breakout"

    def backtest(self, df, df_htf=None, mcap=0):
        return []

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
        df['obv'] = df.ta.obv()
        df['mfi'] = df.ta.mfi(length=14)
        
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

                rsi_now = rsi_series.iloc[scan_i]
                rsi_prev = rsi_series.iloc[scan_i-1]
                line_now = res_line['m'] * scan_i + res_line['c']
                line_prev = res_line['m'] * (scan_i-1) + res_line['c']
                
                # Breakout Check (Strict Freshness)
                if rsi_prev <= line_prev and rsi_now > line_now:
                    entry_price = df['close'].iloc[scan_i]
                    sl = df['low'].iloc[scan_i-5:scan_i].min()
                    if sl >= entry_price: sl = entry_price * 0.98
                    tp = entry_price * 1.05
                    
                    # Filters: Not Dead, Not Runaway
                    if latest_price >= tp or latest_price <= sl: continue
                    if latest_price > entry_price * 1.03: continue
                    
                    # Valid Signal logic
                    breakout_score = 0
                    
                    try:
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
                        
                        # 3. Call Scoring Engine with Null Safety
                        scoring_data = {
                            "symbol": df['symbol'].iloc[0] if 'symbol' in df.columns else "Unknown",
                            "price_change_pct": float(price_change_pct or 0.0),
                            "duration_candles": int(duration or 0),
                            "price_slope": float(price_slope or 0.0),
                            "rsi_slope": float(rsi_slope or 0.0),
                            "divergence_type": int(div_type or 0)
                        }
                        
                        score_result = calculate_score(scoring_data)
                        breakout_score = score_result['total']
                        
                        # 4. Bonuses specific to Breakout (Retest bonus, etc)
                        # REMOVED static bonuses to rely on geometry score
                        # if offset > 0: breakout_score += 2 
                        # if res_line['min_val_in_range'] < 30: breakout_score += 3
                        
                        # Cap
                        breakout_score = min(100.0, breakout_score)
                        
                        setup = {'entry': entry_price, 'sl': sl, 'tp': tp, 'rr': 2.0, 'side': 'LONG'}
                        details = {
                            'total_score': breakout_score,
                            'score_breakdown': score_result['score_breakdown'],
                            'geometry_component': score_result['geometry_component'],
                            'momentum_component': score_result['momentum_component'], 
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
                    scan_i = curr_i - offset
                    if scan_i < 50: continue
                    
                    rsi_now = rsi_series.iloc[scan_i]
                    rsi_prev = rsi_series.iloc[scan_i-1]
                    line_now = sup_line['m'] * scan_i + sup_line['c']
                    line_prev = sup_line['m'] * (scan_i-1) + sup_line['c']
                    
                    if rsi_prev >= line_prev and rsi_now < line_now:
                        entry_price = df['close'].iloc[scan_i]
                        sl = df['high'].iloc[scan_i-5:scan_i].max()
                        if sl <= entry_price: sl = entry_price * 1.02
                        tp = entry_price * 0.95
                        
                        if latest_price <= tp or latest_price >= sl: continue
                        if latest_price < entry_price * 0.97: continue
                            
                        try:
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
                            
                            # 3. Call Scoring Engine with Null Safety
                            scoring_data = {
                                "symbol": df['symbol'].iloc[0] if 'symbol' in df.columns else "Unknown",
                                "price_change_pct": float(price_change_pct or 0.0),
                                "duration_candles": int(duration or 0),
                                "price_slope": float(price_slope or 0.0),
                                "rsi_slope": float(rsi_slope or 0.0),
                                "divergence_type": int(div_type or 0)
                            }
                            
                            score_result = calculate_score(scoring_data)
                            breakout_score = score_result['total']
                            
                            # 4. Bonuses
                            # REMOVED static bonuses to rely on geometry score
                            # if offset > 0: breakout_score += 2
                            # if sup_line['max_val_in_range'] > 70: breakout_score += 3
                            
                            breakout_score = min(100.0, breakout_score)
                            
                            setup = {'entry': entry_price, 'sl': sl, 'tp': tp, 'rr': 2.0, 'side': 'SHORT'}
                            details = {
                                'total_score': breakout_score,
                                'score_breakdown': score_result['score_breakdown'],
                                'geometry_component': score_result['geometry_component'],
                                'momentum_component': score_result['momentum_component'],
                                'type': 'BREAKOUT',
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
             "score_breakdown": {"geometry": 0.0, "momentum": 0.0, "base": 0.0, "total": 0.0},
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
            "ltf": {'rsi': float(rsi_series.iloc[-1])},
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
                    "base": 0.0,
                    "total": 0.0
                },
                "geometry_component": 0.0,
                "momentum_component": 0.0,
                "raw_components": {
                    "price_change_pct": 0.0,
                    "duration_candles": 0, 
                    "divergence_type": 0
                }
            },
            "htf": {}, "ltf": {}
        }
