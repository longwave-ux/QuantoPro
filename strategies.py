
import pandas as pd
import pandas_ta as ta
import numpy as np
from scipy.signal import find_peaks, argrelextrema
import matplotlib.pyplot as plt
plt.switch_backend('Agg')
from abc import ABC, abstractmethod

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
        # 1. Calculate Indicators
        # EMA
        df['ema_50'] = df.ta.ema(length=50)
        df['ema_200'] = df.ta.ema(length=200)
        
        # RSI
        df['rsi'] = df.ta.rsi(length=self.rsi_len)
        
        # ADX
        adx_df = df.ta.adx(length=self.adx_len)
        if f'ADX_{self.adx_len}' in adx_df.columns:
            df['adx'] = adx_df[f'ADX_{self.adx_len}']
        else:
            df['adx'] = adx_df.iloc[:, 0]
            
        # ATR
        df['atr'] = df.ta.atr(length=14)
        
        # OBV
        df['obv'] = df.ta.obv()
        
        # Bollinger Bands
        bb = df.ta.bbands(length=self.bol_len, std=self.bol_std)
        
        # Fix for Column Names:
        # pandas_ta column names depend on version/settings
        # Typically: BBL_20_2.0, BBM_20_2.0, BBU_20_2.0
        # But sometimes just BBL, BBM, BBU or different formatting
        # We'll use iloc to be safe: Lower=0, Mid=1, Upper=2
        df['bb_lower'] = bb.iloc[:, 0]
        # Mid is index 1
        df['bb_upper'] = bb.iloc[:, 2]

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
        
        if df_htf is not None and len(df_htf) >= 50:
            # Calculate Indicators on HTF
            df_htf['ema_50'] = df_htf.ta.ema(length=50)
            df_htf['ema_200'] = df_htf.ta.ema(length=200)
            
            htf_adx_df = df_htf.ta.adx(length=14)
            if 'ADX_14' in htf_adx_df.columns:
                df_htf['adx'] = htf_adx_df['ADX_14']
            else:
                df_htf['adx'] = htf_adx_df.iloc[:, 0]
                
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
            "details": score_breakdown,
            "htf": {
                "trend": trend_struct,
                "bias": bias,
                "adx": float(htf_adx) if pd.notna(htf_adx) else 0,
                "ema50": float(h_ema50) if pd.notna(h_ema50) else (float(l_ema50) if pd.notna(l_ema50) else 0),
                "ema200": float(h_ema200) if pd.notna(h_ema200) else (float(l_ema200) if pd.notna(l_ema200) else 0)
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
        
        if bias != 'NONE':
            trend_score = self.kv_trend_base
            if adx > self.adx_trend: trend_score += self.kv_trend_strong
        else:
            trend_score = 0 
            
        if is_pullback:
            structure_score = 25
        
        if (bias == 'LONG' and obv == 'BULLISH') or (bias == 'SHORT' and obv == 'BEARISH'):
            money_flow_score += 25
            
        if is_pullback and vol_ok: timing_score += 5
            
        if adx > 25:
            trend_score *= 1.5
            structure_score *= 0.8
            timing_score *= 1.2
            
            timing_score *= 1.2
            
        # --- Rewards (Volume & Mcap) ---
        rewards_score = 0
        
        # 1. Volume (24h approx = last 96 candles of 15m)
        if vol_24h > 100_000_000:
             rewards_score += 5
                  
        # 2. Mcap
        if mcap > 0:
             if mcap < 1_000_000_000: # Small Cap < 1B
                  rewards_score += 5
             elif mcap > 10_000_000_000: # Mega Cap > 10B
                  rewards_score += 5
                  
        total = trend_score + structure_score + money_flow_score + timing_score + rewards_score
        
        if is_pullback and not vol_ok: total -= 20
        if (bias == 'LONG' and obv == 'BEARISH') or (bias == 'SHORT' and obv == 'BULLISH'): total -= 40
        if (bias == 'LONG' and div == 'BEARISH') or (bias == 'SHORT' and div == 'BULLISH'): total -= 20
        if overextended: total -= 20
        
        return {
            "total": max(0, min(100, total)),
            "trendScore": float(trend_score),
            "structureScore": float(structure_score),
            "moneyFlowScore": float(money_flow_score),
            "timingScore": float(timing_score),
            "mcap": float(mcap),
            "vol24h": float(vol_24h)
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
                elif h_close < h_ema50 and h_ema50 < h_ema_200: # Fix logic: h_ema50 > h_ema200 is LONG struct
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
                        "isOverextended": bool(is_overextended)
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
            
    def detect_divergence(self, df, rsi_series, side):
        """
        Detects RSI Divergence.
        LONG (Bullish): Price Lows Lower, RSI Lows Higher.
        SHORT (Bearish): Price Highs Higher, RSI Highs Lower.
        Returns: (has_divergence, is_extreme)
        """
        # Lookback window for pivots
        window = 60
        if len(rsi_series) < window: return False, False
        
        rsi_slice = rsi_series.iloc[-window:]
        price_highs = df['high'].iloc[-window:]
        price_lows = df['low'].iloc[-window:]
        
        # Use underlying numpy array for finding peaks to avoid index confusion
        rsi_vals = rsi_slice.values
        w_len = len(rsi_slice)
        
        if side == 'LONG':
            # Bullish Divergence -> Find Valleys (Lows)
            # Invert for find_peaks
            pivots, _ = find_peaks(-rsi_vals, distance=10)
            if len(pivots) < 2: return False, False
            
            # Get last 2 pivots indices (relative to slice)
            idx2 = pivots[-1] # Most recent
            idx1 = pivots[-2] # Previous
            
            # RSI values
            rsi2 = rsi_vals[idx2]
            rsi1 = rsi_vals[idx1]
            
            # Map indices to DF slice to get Price
            # Slice indices are 0..N-1. iloc works.
            
            # Robust Price Low search (Min in +/- 1 candle window)
            # Ensure boundaries
            w_len = len(rsi_slice)
            
            def get_local_min(idx):
                start = max(0, idx - 1)
                end = min(w_len, idx + 2)
                return price_lows.iloc[start:end].min()
            
            p2_low = get_local_min(idx2)
            p1_low = get_local_min(idx1)

            # Condition: Price Lower, RSI Higher
            # Also ensure RSI lows are actually "low" (e.g. < 50) to filter range noise?
            # User requirement: "RSI Low_1 in Oversold < 30" is bonus.
            # Base divergence just needs direction.
            
            if p2_low < p1_low and rsi2 > rsi1:
                 is_extreme = rsi1 < 30
                 return True, is_extreme
                 
        elif side == 'SHORT':
            # Bearish Divergence -> Find Peaks (Highs)
            pivots, _ = find_peaks(rsi_vals, distance=10)
            if len(pivots) < 2: return False, False
            
            idx2 = pivots[-1]
            idx1 = pivots[-2]
            
            rsi2 = rsi_vals[idx2]
            rsi1 = rsi_vals[idx1]
            
            def get_local_max(idx):
                start = max(0, idx - 1)
                end = min(w_len, idx + 2)
                return price_highs.iloc[start:end].max()
            
            p2_high = get_local_max(idx2)
            p1_high = get_local_max(idx1)
            
            # Condition: Price Higher, RSI Lower
            if p2_high > p1_high and rsi2 < rsi1:
                is_extreme = rsi1 > 70
                return True, is_extreme

        return False, False
        
    def name(self):
        return "Breakout"

    def find_trendlines(self, rsi_series, direction='RESISTANCE'):
        """
        Identify valid trendlines on RSI.
        direction: 'RESISTANCE' (connecting highs) or 'SUPPORT' (connecting lows)
        """
        rsi = rsi_series.values
        if len(rsi) < 50: return None
        
        # 1. Find Pivots
        if direction == 'RESISTANCE':
            peaks, _ = find_peaks(rsi, distance=10)
            pivots = peaks
            # We need at least 3 pivots
            if len(pivots) < 3: return None
        else:
            # Find valleys by inverting
            peaks, _ = find_peaks(-rsi, distance=10)
            pivots = peaks
            if len(pivots) < 3: return None
            
        # 2. Geometric Trendline Logic
        # Try to connect the last pivot with previous ones
        # We prioritize the most recent structure
        
        last_pivot_idx = pivots[-1] # The most recent peak/valley
        
        # Iterate backwards to find a valid line creator
        best_line = None
        
        # We need to find a line that touches at least 3 points (approximated)
        # Equation: y = mx + c
        
        for i in range(len(pivots)-2, -1, -1):
            p1_idx = pivots[i]
            p2_idx = last_pivot_idx
            
            x1, y1 = p1_idx, rsi[p1_idx]
            x2, y2 = p2_idx, rsi[p2_idx]
            
            if x2 == x1: continue
            m = (y2 - y1) / (x2 - x1)
            c = y1 - m * x1
            
            # Constraint: Slope
            if direction == 'RESISTANCE' and m > 0.1: continue # Resistance shouldn't slope up too steep
            if direction == 'SUPPORT' and m < -0.1: continue # Support shouldn't slope down too steep
            
            # Constraint: Steepness (Vertical Noise Filter)
            if abs(m) > 1.5: continue
            
            # 3. Validation: Check touches and violations
            touches = 0
            violation = False
            
            # Check all points between p1 and current (end of series)
            # Actually we check ideally from start of trendline
            
            for k in range(p1_idx, len(rsi)):
                model_y = m * k + c
                actual_y = rsi[k]
                
                # Check for Violations
                if direction == 'RESISTANCE':
                    if actual_y > model_y + 1.0: # Tolerance
                        # If a point breaks the line significantly before the breakout, it's invalid
                        # But wait, we are looking for the breakout AT the end.
                        # So violations are only allowed at the very end (current candle)
                        if k < len(rsi) - 1:
                            violation = True
                            break
                else: # SUPPORT
                    if actual_y < model_y - 1.0:
                        if k < len(rsi) - 1:
                            violation = True
                            break

                # Check for Touches (Near the line)
                if abs(actual_y - model_y) < 2.0:
                    # Ensure it's a peak/valley or close to it
                    touches += 1
            
            if not violation and touches >= 3:
                best_line = {'m': float(m), 'c': float(c), 'touches': int(touches), 'start': int(p1_idx)}
                # prioritize the one with most touches or longest duration?
                # For now take the first valid one found from backwards search (most recent trend)
                break
                
        return best_line

    def analyze(self, df, df_htf=None, mcap=0):
        # Metrics
        df['rsi'] = df.ta.rsi(length=self.rsi_len)
        df['obv'] = df.ta.obv()
        df['mfi'] = df.ta.mfi(length=14)

        
        # Data prep
        rsi_series = df['rsi'].dropna()
        if len(rsi_series) < 50:
            return self.empty_result(df)
            
        current_rsi = rsi_series.iloc[-1]
        prev_rsi = rsi_series.iloc[-2]
        
        bias = 'NONE'
        score = 0
        action = 'WAIT'
        analysis_metadata = {}
        
        # Check Resistance Breakout (LONG)
        trendline_info = None
        res_line = self.find_trendlines(rsi_series[:-1], 'RESISTANCE') # Check trendline formed UP TO prev candle
        if res_line:
            # Check if current RSI crossed above logic model
            # Re-eval slope/intercept at current index
            curr_idx = len(df) - 1
            threshold = res_line['m'] * curr_idx + res_line['c']
            
            # Breakout Condition: Prev was below, Current is Above
            # Or just Current is significantly above after respecting it
            # Breakout Condition: Current > Model + Threshold
            if prev_rsi <= (threshold + self.breakout_threshold) and current_rsi > (threshold + self.breakout_threshold):
                # MFI Filter
                mfi_curr = df['mfi'].iloc[-1]
                mfi_prev = df['mfi'].iloc[-2]
                
                # Condition: Not OB (80) OR Trending UP
                # Warning if MFI is dropping while we breakout
                mfi_pass = (mfi_curr <= 80) or (mfi_curr > mfi_prev)
                
                if mfi_pass:
                    passed, bonus, meta = self.check_coinalyze_confirmation(df['symbol'].iloc[0] if 'symbol' in df else 'UNKNOWN', 'LONG')
                    analysis_metadata.update(meta)
                    analysis_metadata['mfi'] = mfi_curr
                    
                    if passed:
                        bias = 'LONG'
                        action = 'BUY'
                        score = 80 + bonus # Base + Bonus
                        
                        # Divergence Check
                        has_div, is_extreme = self.detect_divergence(df, rsi_series, 'LONG')
                        if has_div:
                            score += 20
                            analysis_metadata['divergence'] = True
                            if is_extreme:
                                score += 10
                                analysis_metadata['divergence_extreme'] = True
                        else:
                            analysis_metadata['divergence'] = False
                            
                        trendline_info = res_line
                
        # Check Support Breakout (SHORT)
        if bias == 'NONE':
            sup_line = self.find_trendlines(rsi_series[:-1], 'SUPPORT')
            if sup_line:
                curr_idx = len(df) - 1
                threshold = sup_line['m'] * curr_idx + sup_line['c']
                
                # Breakout Condition: Current < Model - Threshold
                if prev_rsi >= (threshold - self.breakout_threshold) and current_rsi < (threshold - self.breakout_threshold):
                    # MFI Filter
                    mfi_curr = df['mfi'].iloc[-1]
                    mfi_prev = df['mfi'].iloc[-2]
                    
                    # Condition: Not OS (20) OR Trending DOWN
                    mfi_pass = (mfi_curr >= 20) or (mfi_curr < mfi_prev)
                    
                    if mfi_pass:
                        passed, bonus, meta = self.check_coinalyze_confirmation(df['symbol'].iloc[0] if 'symbol' in df else 'UNKNOWN', 'SHORT')
                        analysis_metadata.update(meta)
                        analysis_metadata['mfi'] = mfi_curr
                        
                        if passed:
                            bias = 'SHORT'
                            action = 'SELL'
                            score = 80 + bonus
                            
                            # Divergence Check
                            has_div, is_extreme = self.detect_divergence(df, rsi_series, 'SHORT')
                            if has_div:
                                score += 20
                                analysis_metadata['divergence'] = True
                                if is_extreme:
                                    score += 10
                                    analysis_metadata['divergence_extreme'] = True
                            else:
                                analysis_metadata['divergence'] = False
                                
                            trendline_info = sup_line

        # Confirmation (OBV)
        if bias == 'LONG':
            # OBV should be rising
            if df['obv'].iloc[-1] < df['obv'].iloc[-5]:
                score -= 20 # Divergence penalty
        elif bias == 'SHORT':
             if df['obv'].iloc[-1] > df['obv'].iloc[-5]:
                score -= 20

        # Plotting (Triggered via Config)
        # Plot if we found ANY trendline for debug, even if no breakout
        debug_trendline = trendline_info or res_line or sup_line
        if self.config.get('plot', False) and debug_trendline:
             side_plot = 'LONG' if res_line else ('SHORT' if sup_line else 'NONE')
             if trendline_info and bias == 'SHORT': side_plot = 'SHORT' # Override if we actually triggered
             
             symbol_str = 'DEBUG'
             if 'symbol' in df:
                  val = df['symbol'].iloc[0] if hasattr(df['symbol'], 'iloc') else df['symbol']
                  symbol_str = str(val)
                  
             self.plot_debug_chart(df, rsi_series, debug_trendline, side_plot, symbol_str)

        # Construct Result
        return self.build_result(df, bias, action, score, mcap, trendline_info, analysis_metadata)

    def plot_debug_chart(self, df, rsi_series, trendline, side, symbol):
        try:
            plt.figure(figsize=(12, 6))
            plt.plot(rsi_series.index[-100:], rsi_series.values[-100:], label='RSI', color='blue')
            plt.axhline(70, linestyle='--', color='gray', alpha=0.5)
            plt.axhline(30, linestyle='--', color='gray', alpha=0.5)
            
            # Plot Trendline
            # Equation: y = mx + c (Indices are relative to rsi_series start)
            # We need to map relative indices to global plot indices
            m = trendline['m']
            c = trendline['c']
            start_idx = trendline['start'] 
            
            # rsi_series is a slice or full series?
            # analyze calls passing rsi_series. 
            # We need to correctly plot the line.
            # Let's project from start_idx to end
            
            # Create x points for the line from start_idx to current (end)
            # Note: rsi_series indices might be RangeIndex or Datetime.
            # Using integer indexing for simplicity
            
            x_vals = np.arange(start_idx, len(rsi_series))
            y_vals = m * x_vals + c
            
            # We need to align these x_vals with the plot's x-axis (which is rsi_series.index)
            # rsi_series length N. Index 0..N-1.
            plot_indices = rsi_series.index[x_vals]
            
            color = 'red' if side == 'LONG' else 'green' # Resistance=Red, Support=Green
            plt.plot(plot_indices, y_vals, color=color, linewidth=2, label=f'Trendline ({side})')
            
            # Highlight Pivots?
            # Requires re-running find_peaks or passing them? 
            # For simplicity just marking the trendline is enough visual proof.
            
            plt.title(f"RSI Breakout: {symbol} | {side}")
            plt.legend()
            plt.savefig(f"debug_breakout_{symbol}.png")
            plt.close()
        except Exception as e:
            print(f"Plot Error: {e}")

    def backtest(self, df, df_htf=None, mcap=0):
        # Rolling Window Backtest
        df['rsi'] = df.ta.rsi(length=self.rsi_len)
        df['obv'] = df.ta.obv()
        df['mfi'] = df.ta.mfi(length=14)
        df['swing_high_100'] = df['high'].rolling(100).max()
        df['swing_low_100'] = df['low'].rolling(100).min()
        
        results = []
        
        # We need at least 100 candles for lookback + 50 for trendlines
        if len(df) < 150: return []
        
        # Optimization: Only check every 15 minutes (since we are on 15m candles)
        # But we iterate row by row.
        
        # Iterating over every single candle and running geometric find_trendlines (O(N*M)) 
        # might be slow for 1500 candles.
        # However, for verification we will do it.
        
        for i in range(150, len(df)):
            # Current Slice
            # Window of last 100 candles ending at i
            # We want to detect breakout AT candle i
            
            # Helper to get slice
            rsi_slice = df['rsi'].iloc[i-100 : i+1] # 101 points: 0..99 is past, 100 is current
            
            if len(rsi_slice) < 50: continue
            
            current_rsi = rsi_slice.iloc[-1]
            prev_rsi = rsi_slice.iloc[-2]
            
            # Reuse logic
            bias = 'NONE'
            action = 'WAIT'
            score = 0
            
            # Resistance
            trendline_info = None
            res_line = self.find_trendlines(rsi_slice[:-1], 'RESISTANCE')
            if res_line:
                # Calc threshold at current index (relative to slice start)
                # find_trendlines returns calculated on slice[:-1], so 'current' is i-1 in global, or last in sub-slice
                # res_line['start'] is relative to slice start.
                
                # Careful with indices.
                # rsi_slice[:-1] has length 100. Indices 0..99.
                # Trendline is fit on 0..99.
                # We want to project to index 100 (current).
                
                # Slope m is per index unit.
                # Last known point was index 99. Protocol: m * k + c.
                # If we project 1 step forward:
                
                # Re-eval:
                # The line equation y = mx + c is based on the indices passed to find_trendlines.
                # If we passed slice[:-1], indices are 0 to 99.
                # Breakout check is at index 100.
                
                threshold = res_line['m'] * 100 + res_line['c']
                
                # Breakout Condition
                if prev_rsi <= (threshold + self.breakout_threshold) and current_rsi > (threshold + self.breakout_threshold):
                    # MFI Filter
                    mfi_curr = df['mfi'].iloc[i]
                    mfi_prev = df['mfi'].iloc[i-1]
                    if (mfi_curr <= 80) or (mfi_curr > mfi_prev):
                         bias = 'LONG'
                         action = 'BUY'
                         score = 80
                         
                         has_div, is_extreme = self.detect_divergence(df.iloc[:i+1], df['rsi'].iloc[:i+1], 'LONG')
                         if has_div:
                             score += 20
                             if is_extreme: score += 10
                         
                         trendline_info = res_line
            
            # Support
            if bias == 'NONE':
                sup_line = self.find_trendlines(rsi_slice[:-1], 'SUPPORT')
                if sup_line:
                    threshold = sup_line['m'] * 100 + sup_line['c']
                    if prev_rsi >= (threshold - self.breakout_threshold) and current_rsi < (threshold - self.breakout_threshold):
                        # MFI Filter
                        mfi_curr = df['mfi'].iloc[i]
                        mfi_prev = df['mfi'].iloc[i-1]
                        if (mfi_curr >= 20) or (mfi_curr < mfi_prev):
                            bias = 'SHORT'
                            action = 'SELL'
                            score = 80
                            
                            has_div, is_extreme = self.detect_divergence(df.iloc[:i+1], df['rsi'].iloc[:i+1], 'SHORT')
                            if has_div:
                                score += 20
                                if is_extreme: score += 10
                            
                            trendline_info = sup_line
            
            if score > 0:
                 # Generate signal
                 # Need row data
                 row = df.iloc[i]
                 # Build a temporary DF of just this row to reuse build_result? 
                 # Or just extract vals. build_result uses tail(100) for targets.
                 
                 # Construct Setup
                 setup = None
                 swing_high = df['swing_high_100'].iloc[i]
                 swing_low = df['swing_low_100'].iloc[i]
                 close = row['close']
                 
                 if bias == 'LONG':
                     sl = float(row['low'] * 0.99)
                     tp = float(swing_high) if pd.notna(swing_high) else close * 1.05
                     risk = close - sl
                     if risk > 0:
                        if (tp - close) / risk < 1: tp = close + (risk * 2.0)
                        rr = round((tp - close) / risk, 2)
                        setup = {"side": "LONG", "entry": float(close), "tp": tp, "sl": sl, "rr": rr}
                 
                 elif bias == 'SHORT':
                     sl = float(row['high'] * 1.01)
                     tp = float(swing_low) if pd.notna(swing_low) else close * 0.95
                     risk = sl - close
                     if risk > 0:
                        if (close - tp) / risk < 1: tp = close - (risk * 2.0)
                        rr = round((close - tp) / risk, 2)
                        setup = {"side": "SHORT", "entry": float(close), "tp": tp, "sl": sl, "rr": rr}

                 if setup and trendline_info:
                     setup['trendline'] = trendline_info

                 # Add to results
                 results.append({
                    "timestamp": int(row['timestamp']),
                    "price": float(close),
                    "score": float(score),
                    "bias": bias,
                    "action": action,
                    "rr": float(setup['rr']) if setup else 0.0,
                    "entry": float(setup['entry']) if setup else None,
                    "stop_loss": float(setup['sl']) if setup else None,
                    "take_profit": float(setup['tp']) if setup else None,
                    "setup": setup,
                    "details": {"total": score},
                    "htf": {}, "ltf": {"rsi": float(row['rsi'])}
                 })
                 
        return results

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
            "details": {"total": 0},
            "htf": {}, "ltf": {}
        }
        
    def build_result(self, df, bias, action, score, mcap, trendline_info=None, metadata=None):
        last_row = df.iloc[-1]
        close = float(last_row['close'])
        
        setup = None
        swing_high = df['high'].tail(100).max()
        swing_low = df['low'].tail(100).min()
        
        if score > 0 and 'BUY' in action:
            sl = float(last_row['low'] * 0.99) # Tight SL below candle
            tp = float(swing_high)
            risk = close - sl
            if risk > 0:
                reward = tp - close
                if reward / risk < 1: tp = close + (risk * 2.0)
                rr = round((tp - close) / risk, 2)
                setup = {"side": "LONG", "entry": close, "tp": tp, "sl": sl, "rr": rr}
        elif score > 0 and 'SELL' in action:
            sl = float(last_row['high'] * 1.01)
            tp = float(swing_low)
            risk = sl - close
            if risk > 0:
                reward = close - tp
                if reward / risk < 1: tp = close - (risk * 2.0)
                rr = round((close - tp) / risk, 2)
                setup = {"side": "SHORT", "entry": close, "tp": tp, "sl": sl, "rr": rr}
        
        if setup and trendline_info:
            setup['trendline'] = trendline_info
            
        return {
            "strategy_name": self.name(),
            "symbol": "UNKNOWN",
            "price": close,
            "score": float(score),
            "bias": bias,
            "action": action,
            "rr": float(setup['rr']) if setup else 0.0,
            "entry": float(setup['entry']) if setup else None,
            "stop_loss": float(setup['sl']) if setup else None,
            "take_profit": float(setup['tp']) if setup else None,
            "setup": setup,
            "analysis": metadata if metadata else {},
            "details": {"total": score},
            "htf": {}, "ltf": {"rsi": float(last_row['rsi']) if pd.notna(last_row['rsi']) else 0}
        }
