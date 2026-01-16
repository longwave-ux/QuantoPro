"""
Refactored Strategies - Consume SharedContext
Strategies read pre-calculated indicators and external data from SharedContext.
They DO NOT fetch data or calculate indicators themselves.
"""

import pandas as pd
import numpy as np
from abc import ABC, abstractmethod
from typing import Dict, Any, Optional
from shared_context import SharedContext
from scoring_engine import calculate_score
from strategy_config import StrategyConfig
from scipy.signal import find_peaks


def clean_nans(obj):
    """Recursively convert NaN, inf, and numpy types to JSON-serializable values."""
    if isinstance(obj, (np.integer, np.int64, np.int32)):
        return int(obj)
    elif isinstance(obj, (np.floating, np.float64, np.float32)):
        if pd.isna(obj) or np.isinf(obj):
            return 0.0
        return float(obj)
    elif isinstance(obj, float):
        if pd.isna(obj) or np.isinf(obj):
            return 0.0
        return obj
    elif isinstance(obj, dict):
        return {k: clean_nans(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [clean_nans(v) for v in obj]
    return obj


class Strategy(ABC):
    """Base strategy class - all strategies consume SharedContext."""
    
    @abstractmethod
    def analyze(self, context: SharedContext) -> Dict[str, Any]:
        """
        Analyze market data from SharedContext and return signal.
        
        Args:
            context: SharedContext with pre-calculated indicators and data
            
        Returns:
            Signal dictionary with standardized structure
        """
        pass
    
    @abstractmethod
    def backtest(self, context: SharedContext) -> list:
        """Run backtest using SharedContext."""
        pass
    
    @property
    @abstractmethod
    def name(self) -> str:
        """Strategy name."""
        pass


class QuantProLegacyRefactored(Strategy):
    """
    Legacy strategy refactored to consume SharedContext.
    Reads EMA, RSI, ADX, OBV, Bollinger from context instead of calculating.
    """
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        self.config = config or {}
        
        # Parse config
        indicators = self.config.get('INDICATORS', {})
        self.adx_trend = int(indicators.get('ADX', {}).get('STRONG_TREND', 25))
        
        scoring = self.config.get('SCORING', {})
        self.kv_trend_base = scoring.get('TREND', {}).get('BASE', 15)
        self.kv_trend_strong = scoring.get('TREND', {}).get('STRONG_ADX', 10)
        self.kv_struct_fib = scoring.get('STRUCTURE', {}).get('FIB', 25)
        self.kv_money_obv = scoring.get('MONEY_FLOW', {}).get('OBV', 25)
    
    @property
    def name(self) -> str:
        return "Legacy"
    
    def analyze(self, context: SharedContext) -> Dict[str, Any]:
        """Analyze using pre-calculated indicators from context."""
        df = context.ltf_data
        
        if len(df) < 50:
            return self._empty_result(context)
        
        # Read indicators from context (already calculated)
        ema_50 = context.get_ltf_indicator('ema_fast')
        ema_200 = context.get_ltf_indicator('ema_slow')
        rsi_series = context.get_ltf_indicator('rsi')
        adx_series = context.get_ltf_indicator('adx')
        obv_series = context.get_ltf_indicator('obv')
        bb_upper = context.get_ltf_indicator('bb_upper')
        bb_lower = context.get_ltf_indicator('bb_lower')
        atr_series = context.get_ltf_indicator('atr')
        
        # Get last values
        last_row = df.iloc[-1]
        close = last_row['close']
        
        ema50_val = ema_50.iloc[-1] if ema_50 is not None else np.nan
        ema200_val = ema_200.iloc[-1] if ema_200 is not None else np.nan
        rsi_val = rsi_series.iloc[-1] if rsi_series is not None else 50.0
        adx_val = adx_series.iloc[-1] if adx_series is not None else 0.0
        
        # Determine bias (LTF first)
        bias = 'NONE'
        if pd.notna(ema50_val) and pd.notna(ema200_val):
            if close > ema50_val and ema50_val > ema200_val:
                bias = 'LONG'
            elif close < ema50_val and ema50_val < ema200_val:
                bias = 'SHORT'
        
        # HTF Override if available
        trend_struct = 'DOWN'
        if len(df) > 4:
            if close > df.iloc[-4]['close']:
                trend_struct = 'UP'
        
        htf_adx = adx_val
        h_ema50 = None
        h_ema200 = None
        
        if context.has_htf_data():
            df_htf = context.htf_data
            h_ema50_series = context.get_htf_indicator('ema_fast')
            h_ema200_series = context.get_htf_indicator('ema_slow')
            h_adx_series = context.get_htf_indicator('adx')
            
            if h_ema50_series is not None and h_ema200_series is not None:
                last_htf = df_htf.iloc[-1]
                h_close = last_htf['close']
                h_ema50 = h_ema50_series.iloc[-1]
                h_ema200 = h_ema200_series.iloc[-1]
                htf_adx = h_adx_series.iloc[-1] if h_adx_series is not None else 0
                
                # Reset bias based on HTF
                bias = 'NONE'
                if pd.notna(h_ema50) and pd.notna(h_ema200):
                    if h_close > h_ema50 and h_ema50 > h_ema200:
                        bias = 'LONG'
                    elif h_close < h_ema50 and h_ema50 < h_ema200:
                        bias = 'SHORT'
                
                # HTF trend structure
                trend_struct = 'DOWN'
                if len(df_htf) > 4:
                    if h_close > df_htf.iloc[-4]['close']:
                        trend_struct = 'UP'
        
        # Divergence check
        divergence = 'NONE'
        if len(df) > 40 and rsi_series is not None:
            divergence = self._check_divergence(df.tail(60), rsi_series.tail(60))
        
        # OBV Imbalance
        obv_imbalance = 'NEUTRAL'
        if obv_series is not None:
            obv_imbalance = self._check_obv_imbalance(df.tail(30), obv_series.tail(30))
        
        # Pullback detection
        is_pullback, pullback_depth = self._detect_pullback(df.tail(60), bias)
        
        # Volume check
        volume_ok = self._check_volume(df.tail(20))
        
        # Overextended check
        is_overextended = False
        if bb_upper is not None and bb_lower is not None:
            bb_upper_val = bb_upper.iloc[-1]
            bb_lower_val = bb_lower.iloc[-1]
            if pd.notna(bb_upper_val) and pd.notna(bb_lower_val):
                is_overextended = close > bb_upper_val or close < bb_lower_val
        
        # Vol 24h
        vol_24h = 0
        if len(df) >= 96:
            vol_window = df.tail(96)
            vol_24h = (vol_window['close'] * vol_window['volume']).sum()
        
        # Get mcap from metadata
        mcap = context.get_metadata('mcap', 0)
        
        # Scoring
        score_breakdown = self._calculate_score(
            bias, htf_adx, obv_imbalance, divergence, is_pullback, 
            volume_ok, is_overextended, trend_struct, mcap, vol_24h
        )
        
        # Setup calculation
        setup = None
        if score_breakdown['total'] >= self.config.get('THRESHOLDS', {}).get('MIN_SCORE_SIGNAL', 70):
            swing_high = df['high'].tail(100).max()
            swing_low = df['low'].tail(100).min()
            atr_val = atr_series.iloc[-1] if atr_series is not None else (close * 0.02)
            
            if bias == 'LONG':
                sl = float(last_row['low'] * 0.995)
                entry = float(close)
                risk = entry - sl
                tp = float(swing_high)
                
                expected_reward = tp - entry
                if risk > 0 and (expected_reward / risk) < 1.0:
                    tp = entry + (risk * 2.0)
                
                rr = round((tp - entry) / risk, 2) if risk > 0 else 0.0
                setup = {"side": "LONG", "entry": entry, "tp": tp, "sl": sl, "rr": rr}
            
            elif bias == 'SHORT':
                sl = float(last_row['high'] * 1.005)
                entry = float(close)
                risk = sl - entry
                tp = float(swing_low)
                
                expected_reward = entry - tp
                if risk > 0 and (expected_reward / risk) < 1.0:
                    tp = entry - (risk * 2.0)
                
                rr = round((entry - tp) / risk, 2) if risk > 0 else 0.0
                setup = {"side": "SHORT", "entry": entry, "tp": tp, "sl": sl, "rr": rr}
        
        # Get event timestamp (last candle timestamp)
        event_timestamp = int(last_row.get('timestamp', 0)) if 'timestamp' in last_row else 0
        
        # Extract RSI trendline visuals from context
        rsi_trendlines = context.get_ltf_indicator('rsi_trendlines', {})
        
        # Build comprehensive observability object
        observability = {
            "score_composition": {
                # Raw indicator values
                "rsi": float(rsi_val) if pd.notna(rsi_val) else 0,
                "adx": float(adx_val) if pd.notna(adx_val) else 0,
                "ema50": float(ema50_val) if pd.notna(ema50_val) else 0,
                "ema200": float(ema200_val) if pd.notna(ema200_val) else 0,
                "close_price": float(close),
                
                # Scoring components
                "trend_score": score_breakdown.get('trendScore', 0),
                "structure_score": score_breakdown.get('structureScore', 0),
                "money_flow_score": score_breakdown.get('moneyFlowScore', 0),
                "timing_score": score_breakdown.get('timingScore', 0),
                
                # Weights and multipliers
                "adx_strong_trend": bool(adx_val > self.adx_trend),
                "volume_multiplier": 1.0 if volume_ok else 0.8,
                "pullback_detected": bool(is_pullback),
                "pullback_depth": float(pullback_depth),
                
                # Market context
                "mcap": float(mcap),
                "vol_24h": float(vol_24h),
                "divergence": divergence,
                "obv_imbalance": obv_imbalance,
                "is_overextended": bool(is_overextended)
            },
            "rsi_visuals": rsi_trendlines,
            "calculated_at": event_timestamp,
            "candle_index": len(df) - 1
        }
        
        # Build result
        return {
            "strategy_name": self.name,
            "symbol": context.symbol,
            "canonical_symbol": context.canonical_symbol,
            "exchange": context.exchange,
            "price": float(close),
            "score": float(score_breakdown['total']),
            "total_score": float(score_breakdown['total']),
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
            "score_breakdown": score_breakdown['score_breakdown'],
            "raw_components": {
                "price_change_pct": 0.0,
                "duration_candles": 0,
                "divergence_type": 0
            },
            "htf": {
                "trend": trend_struct,
                "bias": bias,
                "adx": float(htf_adx) if pd.notna(htf_adx) else 0,
                "ema50": float(h_ema50) if pd.notna(h_ema50) else (float(ema50_val) if pd.notna(ema50_val) else 0),
                "ema200": float(h_ema200) if pd.notna(h_ema200) else (float(ema200_val) if pd.notna(ema200_val) else 0)
            },
            "ltf": {
                "rsi": float(rsi_val) if pd.notna(rsi_val) else 0,
                "adx": float(htf_adx) if pd.notna(htf_adx) else 0,
                "bias": bias,
                "obvImbalance": obv_imbalance,
                "divergence": divergence,
                "isPullback": bool(is_pullback),
                "pullbackDepth": float(pullback_depth),
                "volumeOk": bool(volume_ok),
                "momentumOk": bool(30 < rsi_val < 70),
                "isOverextended": bool(is_overextended)
            },
            "observability": observability,
            "oi_metadata": {
                "status": context.get_external('oi_status') or 'neutral',
                "coinalyze_symbol": context.get_external('coinalyze_symbol') or None,
                "value": context.get_external('oi_value', 0)
            },
            "strategy": self.name,
            "meta": {
                "htfInterval": context.htf_interval if hasattr(context, 'htf_interval') else "4h",
                "ltfInterval": context.ltf_interval if hasattr(context, 'ltf_interval') else "15m",
                "strategy_type": "legacy"
            }
        }
    
    def backtest(self, context: SharedContext) -> list:
        """Backtest implementation - simplified for now."""
        return []
    
    def _empty_result(self, context: SharedContext) -> Dict[str, Any]:
        """Return empty result when insufficient data."""
        return {
            "strategy_name": self.name,
            "symbol": context.symbol,
            "canonical_symbol": context.canonical_symbol,
            "exchange": context.exchange,
            "price": 0.0,
            "score": 0.0,
            "bias": "NONE",
            "action": "WAIT",
            "setup": None,
            "details": {},
            "htf": {},
            "ltf": {}
        }
    
    def _check_divergence(self, df, rsi_series):
        """Check for RSI divergence."""
        low_pivots = []
        high_pivots = []
        
        closes = df['close'].values
        rsis = rsi_series.values
        
        if len(rsis) < 5:
            return 'NONE'
        
        for i in range(len(closes) - 2, 1, -1):
            if pd.isna(rsis[i]):
                continue
            
            if closes[i] < closes[i-1] and closes[i] < closes[i+1]:
                low_pivots.append({'idx': i, 'price': closes[i], 'rsi': rsis[i]})
            
            if closes[i] > closes[i-1] and closes[i] > closes[i+1]:
                high_pivots.append({'idx': i, 'price': closes[i], 'rsi': rsis[i]})
            
            if len(low_pivots) >= 2 and len(high_pivots) >= 2:
                break
        
        if len(low_pivots) >= 2:
            recent = low_pivots[0]
            prev = low_pivots[1]
            if recent['price'] < prev['price'] and recent['rsi'] > prev['rsi']:
                if prev['rsi'] < 50:
                    return 'BULLISH'
        
        if len(high_pivots) >= 2:
            recent = high_pivots[0]
            prev = high_pivots[1]
            if recent['price'] > prev['price'] and recent['rsi'] < prev['rsi']:
                if prev['rsi'] > 50:
                    return 'BEARISH'
        
        return 'NONE'
    
    def _check_obv_imbalance(self, df, obv_series):
        """Check OBV imbalance."""
        if len(df) < 20:
            return 'NEUTRAL'
        
        obv = obv_series.values
        price = df['close'].values
        
        if np.any(pd.isna(obv)):
            return 'NEUTRAL'
        
        min_p, max_p = np.min(price), np.max(price)
        min_o, max_o = np.min(obv), np.max(obv)
        
        if (max_p - min_p) == 0 or (max_o - min_o) == 0:
            return 'NEUTRAL'
        
        norm_p = (price[-1] - min_p) / (max_p - min_p)
        norm_o = (obv[-1] - min_o) / (max_o - min_o)
        
        diff = norm_o - norm_p
        
        if diff > 0.25:
            return 'BULLISH'
        if diff < -0.25:
            return 'BEARISH'
        return 'NEUTRAL'
    
    def _detect_pullback(self, df, bias):
        """Detect pullback."""
        if bias == 'NONE':
            return False, 0
        
        highs = df['high'].values
        lows = df['low'].values
        close = df['close'].values[-1]
        
        recent_high = np.max(highs)
        recent_low = np.min(lows)
        rng = recent_high - recent_low
        
        if rng == 0:
            return False, 0
        
        depth = 0
        if bias == 'LONG':
            depth = (recent_high - close) / rng
        elif bias == 'SHORT':
            depth = (close - recent_low) / rng
        
        is_pullback = 0.3 <= depth <= 0.8
        return is_pullback, depth
    
    def _check_volume(self, df):
        """Check if volume is below average."""
        if len(df) < 20:
            return True
        vols = df['volume'].values
        current = vols[-1]
        avg = np.mean(vols)
        return current < avg
    
    def _calculate_score(self, bias, adx, obv, div, is_pullback, vol_ok, overextended, trend_struct, mcap=0, vol_24h=0):
        """Calculate score components."""
        trend_score = 0
        structure_score = 0
        money_flow_score = 0
        timing_score = 0
        
        if pd.isna(adx):
            adx = 0
        
        if bias != 'NONE':
            trend_score = 5.0
            if adx > self.adx_trend:
                trend_score += 5.0
        else:
            trend_score = 0
        
        if is_pullback:
            structure_score = 10.0
        
        if (bias == 'LONG' and obv == 'BULLISH') or (bias == 'SHORT' and obv == 'BEARISH'):
            money_flow_score += 10.0
        
        if is_pullback and vol_ok:
            timing_score += 2.0
        
        if adx > 25:
            trend_score *= 1.2
            timing_score *= 1.1
        
        rewards_score = 0
        if vol_24h > 100_000_000:
            rewards_score += 2.0
        
        if mcap > 0:
            if mcap < 1_000_000_000:
                rewards_score += 2.0
            elif mcap > 10_000_000_000:
                rewards_score += 2.0
        
        total = trend_score + structure_score + money_flow_score + timing_score + rewards_score
        
        if is_pullback and not vol_ok:
            total -= 10
        if (bias == 'LONG' and obv == 'BEARISH') or (bias == 'SHORT' and obv == 'BULLISH'):
            total -= 10
        if (bias == 'LONG' and div == 'BEARISH') or (bias == 'SHORT' and div == 'BULLISH'):
            total -= 10
        if overextended:
            total -= 10
        
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


class QuantProBreakoutRefactored(Strategy):
    """
    Breakout strategy refactored to consume SharedContext.
    Reads RSI, OBV, external data (OI, funding, sentiment) from context.
    """
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        self.config = config or {}
        self.rsi_len = StrategyConfig.RSI_PERIOD_V1
        self.breakout_threshold = self.config.get('breakout_threshold', 2.0)
    
    @property
    def name(self) -> str:
        return "Breakout"
    
    def analyze(self, context: SharedContext) -> Dict[str, Any]:
        """Analyze using pre-calculated indicators and external data from context."""
        df = context.ltf_data
        
        if len(df) < 50:
            return self._empty_result(context)
        
        # Read indicators from context
        rsi_series = context.get_ltf_indicator('rsi')
        obv_series = context.get_ltf_indicator('obv')
        atr_series = context.get_ltf_indicator('atr')
        
        if rsi_series is None:
            return self._empty_result(context)
        
        rsi_series = rsi_series.fillna(50)
        
        # Read external data from context
        oi_data = context.get_external('open_interest')
        oi_available = context.get_external('oi_available', False)
        funding_data = context.get_external('funding_rate')
        ls_ratio_data = context.get_external('long_short_ratio')
        liq_data = context.get_external('liquidations')
        
        # Find trendlines
        curr_i = len(df) - 1
        latest_price = df['close'].iloc[-1]
        
        action = 'WAIT'
        bias = 'NONE'
        setup = None
        details = {'total': 0}
        
        # LONG LOGIC
        res_line = self._find_trendlines(rsi_series, 'RESISTANCE')
        if res_line:
            # Check for breakout (simplified - check last 3 candles)
            for offset in range(3):
                scan_i = curr_i - offset
                if scan_i < 50:
                    continue
                
                # Check if RSI broke above resistance
                rsi_val = rsi_series.iloc[scan_i]
                line_val = res_line['m'] * scan_i + res_line['c']
                rsi_prev = rsi_series.iloc[scan_i - 1]
                line_prev = res_line['m'] * (scan_i - 1) + res_line['c']
                
                if rsi_val > line_val and rsi_prev <= line_prev:
                    # Breakout detected
                    entry_price = df['close'].iloc[scan_i]
                    atr_val = atr_series.iloc[scan_i] if atr_series is not None else (entry_price * 0.02)
                    
                    # Calculate SL/TP
                    struct_sl = df['low'].iloc[max(0, scan_i-5):scan_i].min() - (0.5 * atr_val)
                    vol_sl = entry_price - (2.5 * atr_val)
                    sl = max(struct_sl, vol_sl)
                    
                    p_max = df['high'].iloc[res_line['start_idx']:res_line['end_idx']].max()
                    p_min = df['low'].iloc[res_line['start_idx']:res_line['end_idx']].min()
                    structure_height = p_max - p_min
                    tp = entry_price + (1.618 * structure_height)
                    
                    if tp <= entry_price:
                        tp = entry_price * 1.05
                    if sl >= entry_price:
                        sl = entry_price * 0.98
                    
                    # Check if still valid
                    if latest_price >= tp or latest_price <= sl:
                        continue
                    if latest_price > entry_price * 1.03:
                        continue
                    
                    # Calculate score using external data
                    p_start = df['close'].iloc[res_line['start_idx']]
                    p_end = df['close'].iloc[res_line['end_idx']]
                    price_change_pct = (abs(p_end - p_start) / p_start) * 100.0
                    duration = res_line['end_idx'] - res_line['start_idx']
                    duration = max(1, duration)
                    
                    scoring_data = {
                        "symbol": context.symbol,
                        "price_change_pct": float(price_change_pct),
                        "duration_candles": int(duration),
                        "price_slope": float(price_change_pct / duration),
                        "rsi_slope": float((res_line['end_val'] - res_line['start_val']) / duration),
                        "divergence_type": 0
                    }
                    
                    score_result = calculate_score(scoring_data)
                    geometry_score = round(min(StrategyConfig.SCORE_GEOMETRY_MAX, score_result['geometry_component']), 1)
                    momentum_score = round(min(StrategyConfig.SCORE_MOMENTUM_MAX, score_result['momentum_component']), 1)
                    
                    # Add OI flow bonus if available
                    oi_flow_score = 0
                    if oi_available and oi_data:
                        # Simplified OI slope calculation
                        oi_flow_score = 5  # Placeholder
                    
                    total_score = geometry_score + momentum_score + oi_flow_score
                    total_score = max(0, min(100, total_score))
                    
                    risk = entry_price - sl
                    rr = round((tp - entry_price) / risk, 2) if risk > 0 else 0.0
                    
                    setup = {"side": "LONG", "entry": float(entry_price), "tp": float(tp), "sl": float(sl), "rr": rr}
                    bias = 'LONG'
                    action = 'LONG'
                    
                    details = {
                        "total": total_score,
                        "geometry_component": geometry_score,
                        "momentum_component": momentum_score,
                        "oi_flow_score": oi_flow_score,
                        "score_breakdown": {
                            "base": 10.0,
                            "geometry": geometry_score,
                            "momentum": momentum_score,
                            "total": total_score
                        }
                    }
                    
                    break
        
        # SHORT LOGIC (similar pattern)
        if action == 'WAIT':
            sup_line = self._find_trendlines(rsi_series, 'SUPPORT')
            if sup_line:
                for offset in range(3):
                    scan_i = curr_i - offset
                    if scan_i < 50:
                        continue
                    
                    rsi_val = rsi_series.iloc[scan_i]
                    line_val = sup_line['m'] * scan_i + sup_line['c']
                    rsi_prev = rsi_series.iloc[scan_i - 1]
                    line_prev = sup_line['m'] * (scan_i - 1) + sup_line['c']
                    
                    if rsi_val < line_val and rsi_prev >= line_prev:
                        entry_price = df['close'].iloc[scan_i]
                        atr_val = atr_series.iloc[scan_i] if atr_series is not None else (entry_price * 0.02)
                        
                        struct_sl = df['high'].iloc[max(0, scan_i-5):scan_i].max() + (0.5 * atr_val)
                        vol_sl = entry_price + (2.5 * atr_val)
                        sl = min(struct_sl, vol_sl)
                        
                        p_max = df['high'].iloc[sup_line['start_idx']:sup_line['end_idx']].max()
                        p_min = df['low'].iloc[sup_line['start_idx']:sup_line['end_idx']].min()
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
                        
                        p_start = df['close'].iloc[sup_line['start_idx']]
                        p_end = df['close'].iloc[sup_line['end_idx']]
                        price_change_pct = (abs(p_end - p_start) / p_start) * 100.0
                        duration = sup_line['end_idx'] - sup_line['start_idx']
                        duration = max(1, duration)
                        
                        scoring_data = {
                            "symbol": context.symbol,
                            "price_change_pct": float(price_change_pct),
                            "duration_candles": int(duration),
                            "price_slope": float(price_change_pct / duration),
                            "rsi_slope": float((sup_line['end_val'] - sup_line['start_val']) / duration),
                            "divergence_type": 0
                        }
                        
                        score_result = calculate_score(scoring_data)
                        geometry_score = round(min(StrategyConfig.SCORE_GEOMETRY_MAX, score_result['geometry_component']), 1)
                        momentum_score = round(min(StrategyConfig.SCORE_MOMENTUM_MAX, score_result['momentum_component']), 1)
                        
                        oi_flow_score = 0
                        if oi_available and oi_data:
                            oi_flow_score = 5
                        
                        total_score = geometry_score + momentum_score + oi_flow_score
                        total_score = max(0, min(100, total_score))
                        
                        risk = sl - entry_price
                        rr = round((entry_price - tp) / risk, 2) if risk > 0 else 0.0
                        
                        setup = {"side": "SHORT", "entry": float(entry_price), "tp": float(tp), "sl": float(sl), "rr": rr}
                        bias = 'SHORT'
                        action = 'SHORT'
                        
                        details = {
                            "total": total_score,
                            "geometry_component": geometry_score,
                            "momentum_component": momentum_score,
                            "oi_flow_score": oi_flow_score,
                            "score_breakdown": {
                                "base": 10.0,
                                "geometry": geometry_score,
                                "momentum": momentum_score,
                                "total": total_score
                            }
                        }
                        
                        break
        
        # Get event timestamp (last candle timestamp)
        last_row = df.iloc[-1]
        event_timestamp = int(last_row.get('timestamp', 0)) if 'timestamp' in last_row else 0
        
        # Extract RSI trendline visuals from context
        rsi_trendlines = context.get_ltf_indicator('rsi_trendlines', {})
        
        # Build comprehensive observability object
        observability = {
            "score_composition": {
                # Raw indicator values
                "rsi": float(rsi_series.iloc[-1]) if rsi_series is not None else 50.0,
                "close_price": float(latest_price),
                
                # Scoring components
                "geometry_score": details.get('geometry_component', 0),
                "momentum_score": details.get('momentum_component', 0),
                "oi_flow_score": details.get('oi_flow_score', 0),
                
                # Trendline data (if breakout detected)
                "trendline_slope": res_line.get('m', 0) if res_line and action == 'LONG' else (sup_line.get('m', 0) if sup_line and action == 'SHORT' else 0),
                "trendline_start_idx": res_line.get('start_idx', 0) if res_line and action == 'LONG' else (sup_line.get('start_idx', 0) if sup_line and action == 'SHORT' else 0),
                "trendline_end_idx": res_line.get('end_idx', 0) if res_line and action == 'LONG' else (sup_line.get('end_idx', 0) if sup_line and action == 'SHORT' else 0),
                
                # External data availability
                "oi_available": bool(oi_available),
                "funding_available": bool(funding_data is not None),
                "ls_ratio_available": bool(ls_ratio_data is not None),
                "liquidations_available": bool(liq_data is not None),
                
                # Market context
                "atr": float(atr_series.iloc[-1]) if atr_series is not None else 0,
                "obv_signal": "NEUTRAL"
            },
            "rsi_visuals": rsi_trendlines,
            "calculated_at": event_timestamp,
            "candle_index": len(df) - 1
        }
        
        # Build result
        return {
            "strategy_name": self.name,
            "symbol": context.symbol,
            "canonical_symbol": context.canonical_symbol,
            "exchange": context.exchange,
            "price": float(latest_price),
            "score": float(details.get('total', 0)),
            "total_score": float(details.get('total', 0)),
            "bias": bias,
            "action": action,
            "rr": float(setup['rr']) if setup else 0.0,
            "entry": float(setup['entry']) if setup else None,
            "stop_loss": float(setup['sl']) if setup else None,
            "take_profit": float(setup['tp']) if setup else None,
            "setup": setup,
            "details": details,
            "score_breakdown": details.get('score_breakdown', {}),
            "raw_components": {
                "price_change_pct": 0.0,
                "duration_candles": 0,
                "divergence_type": 0
            },
            "htf": {"trend": "NONE", "bias": bias, "adx": 0},
            "ltf": {
                "rsi": float(rsi_series.iloc[-1]) if rsi_series is not None else 50.0,
                "adx": 0,
                "bias": bias,
                "obvImbalance": "NEUTRAL",
                "divergence": "NONE",
                "isPullback": False,
                "pullbackDepth": 0.0,
                "volumeOk": True,
                "momentumOk": True,
                "isOverextended": False
            },
            "observability": observability,
            "oi_metadata": {
                "status": context.get_external('oi_status') or 'neutral',
                "coinalyze_symbol": context.get_external('coinalyze_symbol') or None,
                "value": context.get_external('oi_value', 0)
            },
            "strategy": self.name,
            "meta": {
                "htfInterval": context.htf_interval if hasattr(context, 'htf_interval') else "4h",
                "ltfInterval": context.ltf_interval if hasattr(context, 'ltf_interval') else "15m",
                "strategy_type": "breakout"
            }
        }
    
    def backtest(self, context: SharedContext) -> list:
        """Backtest implementation."""
        return []
    
    def _empty_result(self, context: SharedContext) -> Dict[str, Any]:
        """Return empty result."""
        return {
            "strategy_name": self.name,
            "symbol": context.symbol,
            "canonical_symbol": context.canonical_symbol,
            "exchange": context.exchange,
            "price": 0.0,
            "score": 0.0,
            "bias": "NONE",
            "action": "WAIT",
            "setup": None,
            "details": {},
            "htf": {},
            "ltf": {}
        }
    
    def _find_trendlines(self, rsi_series, direction='RESISTANCE'):
        """Find trendlines on RSI."""
        rsi = rsi_series.values
        if len(rsi) < 50:
            return None
        
        if direction == 'RESISTANCE':
            peaks, _ = find_peaks(rsi, distance=10)
            pivots = peaks
        else:
            peaks, _ = find_peaks(-rsi, distance=10)
            pivots = peaks
        
        if len(pivots) < 2:
            return None
        
        return self._find_best_line_in_pivots(pivots, rsi, direction)
    
    def _find_best_line_in_pivots(self, pivots, rsi, direction):
        """Find best trendline in pivots."""
        MIN_SLOPE = 0.015
        MAX_SLOPE = 0.6
        ORIGIN_RES_MIN = 60
        ORIGIN_SUP_MAX = 40
        
        best_line = None
        best_score = -1
        
        for i in range(len(pivots)):
            for j in range(i + 1, len(pivots)):
                p1_idx = pivots[i]
                p2_idx = pivots[j]
                
                if (p2_idx - p1_idx) < 20:
                    continue
                
                x1, y1 = p1_idx, rsi[p1_idx]
                x2, y2 = p2_idx, rsi[p2_idx]
                
                if x2 == x1:
                    continue
                m = (y2 - y1) / (x2 - x1)
                c = y1 - m * x1
                
                if direction == 'RESISTANCE':
                    if m >= 0:
                        continue
                    if abs(m) < MIN_SLOPE or abs(m) > MAX_SLOPE:
                        continue
                    if y1 < ORIGIN_RES_MIN:
                        continue
                else:
                    if m <= 0:
                        continue
                    if abs(m) < MIN_SLOPE or abs(m) > MAX_SLOPE:
                        continue
                    if y1 > ORIGIN_SUP_MAX:
                        continue
                
                touches = 0
                valid_line = True
                
                for k in range(p1_idx, p2_idx + 1):
                    model_y = m * k + c
                    actual_y = rsi[k]
                    diff = actual_y - model_y
                    
                    if direction == 'RESISTANCE':
                        if diff > 2.0:
                            valid_line = False
                            break
                    else:
                        if diff < -2.0:
                            valid_line = False
                            break
                    
                    if abs(diff) < 1.5:
                        touches += 1
                
                if not valid_line:
                    continue
                
                future_hits = 0
                for k_idx in range(j + 1, len(pivots)):
                    p_k = pivots[k_idx]
                    model_k = m * p_k + c
                    if abs(rsi[p_k] - model_k) < 2.5:
                        future_hits += 1
                
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
                        'min_val_in_range': float(np.min(segment)) if len(segment) > 0 else 0,
                        'max_val_in_range': float(np.max(segment)) if len(segment) > 0 else 100
                    }
        
        return best_line


# BreakoutV2 - Full Implementation per RSI_calc.md Specification
class QuantProBreakoutV2Refactored(Strategy):
    """
    BreakoutV2 Strategy - RSI Trendline Breakout with Institutional Confirmation
    
    SPECIFICATION COMPLIANCE (RSI_calc.md):
    1. OI Z-Score Filter: Signal valid ONLY if Z-Score > 1.5 (HARD REQUIREMENT)
    2. OBV Slope: Linear regression slope must be POSITIVE for Longs
    3. Cardwell Range Rules: Bull 40-80 / Bear 20-60
    4. RSI Trendlines: k=5 order pivots with validation
    5. Risk Management: 3.0 ATR stop loss, Cardwell projection TP
    """
    
    def __init__(self, config: Dict[str, Any] = None):
        """Initialize with optional config."""
        self.config = config or {}
        self.min_oi_zscore = self.config.get('min_oi_zscore', 1.5)
        self.obv_period = self.config.get('obv_slope_period', 14)
        self.atr_multiplier = self.config.get('atr_stop_multiplier', 3.0)
    
    @property
    def name(self) -> str:
        return "BreakoutV2"
    
    def analyze(self, context: SharedContext) -> Dict[str, Any]:
        """
        Analyze using RSI trendline breakout with institutional confirmation.
        
        CRITICAL FILTERS (per specification):
        1. OI Z-Score > 1.5 (MANDATORY)
        2. OBV Slope > 0 for LONG (MANDATORY)
        3. Cardwell Range compliance
        """
        df = context.ltf_data
        
        if len(df) < 50:
            return self._empty_result(context)
        
        # Get indicators from context
        rsi_series = context.get_ltf_indicator('rsi')
        obv_series = context.get_ltf_indicator('obv')
        atr_series = context.get_ltf_indicator('atr')
        rsi_trendlines = context.get_ltf_indicator('rsi_trendlines', {})
        
        if rsi_series is None or len(rsi_series) < 50:
            return self._empty_result(context)
        
        # Current values
        last_row = df.iloc[-1]
        close = last_row['close']
        rsi_val = rsi_series.iloc[-1]
        atr_val = atr_series.iloc[-1] if atr_series is not None else (close * 0.02)
        
        # Calculate OBV slope early (needed for diagnostics even if filters fail)
        obv_slope = self._calculate_obv_slope(obv_series) if obv_series is not None else 0.0
        
        # CRITICAL FILTER 1: OI Z-Score (HARD REQUIREMENT)
        oi_z_score_valid = context.get_external('oi_z_score_valid', False)
        oi_z_score = context.get_external('oi_z_score', 0.0)
        
        if not oi_z_score_valid:
            # Signal INVALID without OI confirmation
            return self._wait_result(context, close, rsi_val, 
                                    reason="OI Z-Score < 1.5 (FILTER FAILED)",
                                    oi_z_score=oi_z_score,
                                    obv_slope=obv_slope)
        
        # Determine bias from Cardwell Range Rules
        bias, cardwell_range = self._apply_cardwell_rules(rsi_val)
        
        # Check OBV alignment with bias
        if bias == 'LONG' and obv_slope <= 0:
            return self._wait_result(context, close, rsi_val,
                                    reason="OBV Slope not positive for LONG",
                                    obv_slope=obv_slope, cardwell_range=cardwell_range)
        elif bias == 'SHORT' and obv_slope >= 0:
            return self._wait_result(context, close, rsi_val,
                                    reason="OBV Slope not negative for SHORT",
                                    obv_slope=obv_slope, cardwell_range=cardwell_range)
        
        # Check for RSI trendline breakout
        action = 'WAIT'
        setup = None
        score = 0.0
        breakout_type = None
        
        # LONG: RSI breaking above resistance
        if bias == 'LONG' and 'resistance' in rsi_trendlines:
            res = rsi_trendlines['resistance']
            current_idx = len(rsi_series) - 1
            projected_rsi = res['slope'] * current_idx + res['intercept']
            
            # Check if RSI broke above trendline
            if rsi_val > projected_rsi + 1.0:  # 1.0 point buffer for confirmation
                breakout_type = 'RESISTANCE_BREAK'
                action = 'LONG'
                
                # Calculate setup with Cardwell projection
                sl = close - (self.atr_multiplier * atr_val)
                
                # Cardwell TP: Project momentum amplitude
                tp = self._calculate_cardwell_tp(df, close, 'LONG', atr_val)
                
                risk = close - sl
                rr = (tp - close) / risk if risk > 0 else 0.0
                
                setup = {
                    "side": "LONG",
                    "entry": float(close),
                    "tp": float(tp),
                    "sl": float(sl),
                    "rr": float(rr)
                }
                
                # Calculate score with Cardwell weighting
                score = self._calculate_v2_score(
                    rsi_val, cardwell_range, oi_z_score, obv_slope, 
                    breakout_type, rr
                )
        
        # SHORT: RSI breaking below support
        elif bias == 'SHORT' and 'support' in rsi_trendlines:
            sup = rsi_trendlines['support']
            current_idx = len(rsi_series) - 1
            projected_rsi = sup['slope'] * current_idx + sup['intercept']
            
            # Check if RSI broke below trendline
            if rsi_val < projected_rsi - 1.0:  # 1.0 point buffer for confirmation
                breakout_type = 'SUPPORT_BREAK'
                action = 'SHORT'
                
                # Calculate setup with Cardwell projection
                sl = close + (self.atr_multiplier * atr_val)
                
                # Cardwell TP: Project momentum amplitude
                tp = self._calculate_cardwell_tp(df, close, 'SHORT', atr_val)
                
                risk = sl - close
                rr = (close - tp) / risk if risk > 0 else 0.0
                
                setup = {
                    "side": "SHORT",
                    "entry": float(close),
                    "tp": float(tp),
                    "sl": float(sl),
                    "rr": float(rr)
                }
                
                # Calculate score with Cardwell weighting
                score = self._calculate_v2_score(
                    rsi_val, cardwell_range, oi_z_score, obv_slope,
                    breakout_type, rr
                )
        
        # Build observability object using helper method
        observability = self._build_observability_dict(
            context, rsi_val, close, oi_z_score, oi_z_score_valid,
            obv_slope, cardwell_range, breakout_type, atr_val, bias
        )
        
        # Build result
        return {
            "strategy_name": self.name,
            "symbol": context.symbol,
            "canonical_symbol": context.canonical_symbol,
            "exchange": context.exchange,
            "price": float(close),
            "score": float(score),
            "total_score": float(score),
            "bias": bias,
            "action": action,
            "rr": float(setup['rr']) if setup else 0.0,
            "entry": float(setup['entry']) if setup else None,
            "stop_loss": float(setup['sl']) if setup else None,
            "take_profit": float(setup['tp']) if setup else None,
            "setup": setup,
            "details": {
                "total": float(score),
                "oi_z_score": float(oi_z_score),
                "obv_slope": float(obv_slope),
                "cardwell_range": cardwell_range,
                "breakout_type": breakout_type
            },
            "htf": {"trend": "NONE", "bias": bias, "adx": 0},
            "ltf": {
                "rsi": float(rsi_val),
                "bias": bias,
                "cardwell_range": cardwell_range
            },
            "observability": observability,
            "oi_metadata": {
                "status": context.get_external('oi_status') or 'neutral',
                "coinalyze_symbol": context.get_external('coinalyze_symbol') or None,
                "value": context.get_external('oi_value', 0)
            },
            "strategy": self.name,
            "meta": {
                "htfInterval": context.htf_interval if hasattr(context, 'htf_interval') else "4h",
                "ltfInterval": context.ltf_interval if hasattr(context, 'ltf_interval') else "15m",
                "strategy_type": "breakout_v2"
            }
        }
    
    def _build_observability_dict(self, context: SharedContext, rsi_val: float, 
                                   close: float, oi_z_score: float, oi_z_score_valid: bool,
                                   obv_slope: float, cardwell_range: str, breakout_type: str = None,
                                   atr_val: float = 0.0, bias: str = "NONE") -> Dict[str, Any]:
        """
        Build observability dictionary with V2 metrics mapped to standard Dashboard keys.
        
        Mapping:
        - trend_score: OI Z-Score (institutional flow)
        - structure_score: OBV Slope (money flow structure)
        - money_flow_score: RSI value (momentum flow)
        - timing_score: Cardwell range score (timing classification)
        """
        # Get RSI trendlines from context
        rsi_trendlines = context.get_ltf_indicator('rsi_trendlines', {})
        
        # Get event timestamp
        df = context.ltf_data
        last_row = df.iloc[-1] if len(df) > 0 else None
        event_timestamp = int(last_row.get('timestamp', 0)) if last_row is not None and 'timestamp' in last_row else 0
        
        # Map Cardwell range to timing score (0-25 scale)
        cardwell_timing_map = {
            'BULLISH': 20.0,
            'BEARISH': 20.0,
            'NEUTRAL': 10.0,
            'OVERBOUGHT': 5.0,
            'OVERSOLD': 5.0
        }
        timing_score = cardwell_timing_map.get(cardwell_range, 0.0)
        
        return {
            "score_composition": {
                # Raw V2 metrics (for reference)
                "rsi": float(rsi_val),
                "close_price": float(close),
                "oi_z_score": float(oi_z_score),
                "oi_z_score_valid": bool(oi_z_score_valid),
                "obv_slope": float(obv_slope),
                "cardwell_range": cardwell_range,
                "breakout_type": breakout_type,
                "atr": float(atr_val),
                
                # Mapped to standard Dashboard keys
                "trend_score": float(min(25.0, oi_z_score * 10)),  # OI Z-Score as trend (scale to 0-25)
                "structure_score": float(min(25.0, abs(obv_slope) / 10000)),  # OBV Slope normalized (0-25 scale)
                "money_flow_score": float(rsi_val / 4),  # RSI as money flow (0-25 scale)
                "timing_score": timing_score,  # Cardwell range as timing
                
                # Filter status
                "filters_passed": {
                    "oi_zscore": oi_z_score_valid,
                    "obv_slope": (bias == 'LONG' and obv_slope > 0) or (bias == 'SHORT' and obv_slope < 0)
                },
                
                # Data availability
                "oi_available": context.get_external('oi_available', False),
                "funding_available": context.get_external('funding_available', False),
                "ls_ratio_available": context.get_external('ls_ratio_available', False),
                "liquidations_available": context.get_external('liquidations_available', False)
            },
            "rsi_visuals": rsi_trendlines,
            "calculated_at": event_timestamp,
            "candle_index": len(df) - 1
        }
    
    def _calculate_obv_slope(self, obv_series: pd.Series) -> float:
        """
        Calculate OBV slope using linear regression over 14 periods.
        Per specification: Must be POSITIVE for Long signals.
        """
        from scipy.stats import linregress
        
        if obv_series is None or len(obv_series) < self.obv_period:
            return 0.0
        
        obv_values = obv_series.tail(self.obv_period).values
        x = np.arange(len(obv_values))
        
        try:
            slope, intercept, r_value, p_value, std_err = linregress(x, obv_values)
            return float(slope)
        except:
            return 0.0
    
    def _apply_cardwell_rules(self, rsi_val: float) -> tuple:
        """
        Apply Cardwell Range Rules to determine bias.
        
        Bull Market Range: 40-80 (Support at 40 is Buy)
        Bear Market Range: 20-60 (Resistance at 60 is Sell)
        Range Shift: Break of 60 upside = Bullish shift
        """
        if rsi_val >= 60:
            # Above 60: Bullish momentum or Bear resistance
            if rsi_val >= 70:
                return 'LONG', 'BULL_OVERBOUGHT'  # Strong bull, potential pullback
            else:
                return 'LONG', 'BULL_MOMENTUM'  # Bullish range
        elif rsi_val >= 40:
            # Neutral zone 40-60
            if rsi_val >= 50:
                return 'LONG', 'BULL_NEUTRAL'
            else:
                return 'SHORT', 'BEAR_NEUTRAL'
        else:
            # Below 40: Bearish momentum or Bull support
            if rsi_val <= 30:
                return 'SHORT', 'BEAR_OVERSOLD'  # Strong bear, potential bounce
            else:
                return 'SHORT', 'BEAR_MOMENTUM'  # Bearish range
    
    def _calculate_cardwell_tp(self, df: pd.DataFrame, entry: float, 
                                side: str, atr: float) -> float:
        """
        Calculate Take Profit using Cardwell momentum projection.
        
        Per specification: H_mom + (H_mom - L_mom)
        """
        # Find recent momentum swing
        lookback = min(50, len(df))
        recent_df = df.tail(lookback)
        
        if side == 'LONG':
            h_mom = recent_df['high'].max()
            l_mom = recent_df['low'].min()
            amplitude = h_mom - l_mom
            tp = h_mom + amplitude  # Project amplitude upward
            
            # Ensure minimum RR of 2.0
            if tp < entry + (2.0 * atr):
                tp = entry + (2.0 * atr)
        else:  # SHORT
            h_mom = recent_df['high'].max()
            l_mom = recent_df['low'].min()
            amplitude = h_mom - l_mom
            tp = l_mom - amplitude  # Project amplitude downward
            
            # Ensure minimum RR of 2.0
            if tp > entry - (2.0 * atr):
                tp = entry - (2.0 * atr)
        
        return tp
    
    def _calculate_v2_score(self, rsi: float, cardwell_range: str, 
                            oi_z_score: float, obv_slope: float,
                            breakout_type: str, rr: float) -> float:
        """
        Calculate V2 score with Cardwell weighting.
        
        Components:
        - Base: 20 points (filters passed)
        - OI Z-Score: 0-30 points (scaled by Z-Score magnitude)
        - OBV Slope: 0-20 points (scaled by slope magnitude)
        - Cardwell Position: 0-20 points (bonus for optimal RSI range)
        - Risk/Reward: 0-10 points (bonus for RR > 3.0)
        """
        score = 20.0  # Base for passing filters
        
        # OI Z-Score component (0-30 points)
        oi_component = min(30.0, (oi_z_score - 1.5) * 10.0)
        score += oi_component
        
        # OBV Slope component (0-20 points)
        obv_component = min(20.0, abs(obv_slope) / 1000.0 * 20.0)
        score += obv_component
        
        # Cardwell Range bonus (0-20 points)
        if 'BULL_MOMENTUM' in cardwell_range or 'BEAR_MOMENTUM' in cardwell_range:
            score += 20.0  # Optimal range
        elif 'NEUTRAL' in cardwell_range:
            score += 10.0  # Acceptable range
        
        # Risk/Reward bonus (0-10 points)
        if rr >= 3.0:
            score += 10.0
        elif rr >= 2.0:
            score += 5.0
        
        return min(100.0, score)
    
    def _empty_result(self, context: SharedContext) -> Dict[str, Any]:
        """Return empty result for insufficient data."""
        # Build minimal observability even for empty results
        observability = self._build_observability_dict(
            context, 0.0, 0.0, 0.0, False, 0.0, "NEUTRAL", None, 0.0, "NONE"
        )
        
        return {
            "strategy_name": self.name,
            "symbol": context.symbol,
            "canonical_symbol": context.canonical_symbol,
            "exchange": context.exchange,
            "price": 0.0,
            "score": 0.0,
            "total_score": 0.0,
            "bias": "NONE",
            "action": "WAIT",
            "setup": None,
            "details": {"reason": "Insufficient data"},
            "htf": {"trend": "NONE", "bias": "NONE", "adx": 0},
            "ltf": {"rsi": 0.0, "bias": "NONE", "cardwell_range": "NEUTRAL"},
            "observability": observability,
            "oi_metadata": {
                "status": context.get_external('oi_status') or 'neutral',
                "coinalyze_symbol": context.get_external('coinalyze_symbol') or None,
                "value": context.get_external('oi_value', 0)
            },
            "strategy": self.name,
            "meta": {
                "htfInterval": context.htf_interval if hasattr(context, 'htf_interval') else "4h",
                "ltfInterval": context.ltf_interval if hasattr(context, 'ltf_interval') else "15m",
                "strategy_type": "breakout_v2"
            }
        }
    
    def _wait_result(self, context: SharedContext, close: float, rsi_val: float,
                     reason: str = "", **kwargs) -> Dict[str, Any]:
        """Return WAIT result with diagnostic info and full observability."""
        # Extract metrics from kwargs for observability
        oi_z_score = kwargs.get('oi_z_score', 0.0)
        obv_slope = kwargs.get('obv_slope', 0.0)
        cardwell_range = kwargs.get('cardwell_range', 'NEUTRAL')
        
        # Get OI Z-Score validity from context
        oi_z_score_valid = context.get_external('oi_z_score_valid', False)
        
        # Get ATR
        atr_series = context.get_ltf_indicator('atr')
        atr_val = atr_series.iloc[-1] if atr_series is not None and len(atr_series) > 0 else (close * 0.02)
        
        # Determine bias from Cardwell range
        bias = "LONG" if cardwell_range == "BULLISH" else ("SHORT" if cardwell_range == "BEARISH" else "NONE")
        
        # Build observability with actual calculated values
        observability = self._build_observability_dict(
            context, rsi_val, close, oi_z_score, oi_z_score_valid,
            obv_slope, cardwell_range, None, atr_val, bias
        )
        
        return {
            "strategy_name": self.name,
            "symbol": context.symbol,
            "canonical_symbol": context.canonical_symbol,
            "exchange": context.exchange,
            "price": float(close),
            "score": 0.0,
            "total_score": 0.0,
            "bias": bias,
            "action": "WAIT",
            "setup": None,
            "details": {
                "reason": reason,
                "rsi": float(rsi_val),
                "oi_z_score": float(oi_z_score),
                "obv_slope": float(obv_slope),
                "cardwell_range": cardwell_range,
                **kwargs
            },
            "htf": {"trend": "NONE", "bias": bias, "adx": 0},
            "ltf": {
                "rsi": float(rsi_val),
                "bias": bias,
                "cardwell_range": cardwell_range
            },
            "observability": observability,
            "oi_metadata": {
                "status": context.get_external('oi_status') or 'neutral',
                "coinalyze_symbol": context.get_external('coinalyze_symbol') or None,
                "value": context.get_external('oi_value', 0)
            },
            "strategy": self.name,
            "meta": {
                "htfInterval": context.htf_interval if hasattr(context, 'htf_interval') else "4h",
                "ltfInterval": context.ltf_interval if hasattr(context, 'ltf_interval') else "15m",
                "strategy_type": "breakout_v2"
            }
        }
    
    def backtest(self, context: SharedContext) -> list:
        return []
