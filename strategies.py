
import pandas as pd
import pandas_ta as ta
import numpy as np
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
        return "QuantProLegacy"

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
