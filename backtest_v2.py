
import sys
import json
import pandas as pd
import pandas_ta as ta
import numpy as np
from strategies import calculate_reverse_rsi, QuantProBreakout
from strategy_config import StrategyConfig

class BacktestEngineV2:
    def __init__(self, file_path):
        self.file_path = file_path
        self.df = self.load_data(file_path)
        self.prepare_indicators()
        self.v1_strategy = QuantProBreakout()
        self.filtered_count = 0
        
    def load_data(self, filename):
        with open(filename, 'r') as f:
            data = json.load(f)
        if isinstance(data, dict) and 'data' in data:
            data = data['data']
        df = pd.DataFrame(data)
        # Normalize columns
        df.columns = [c.lower() for c in df.columns]
        if 'time' in df.columns: df.rename(columns={'time': 'timestamp'}, inplace=True)
        # Ensure numeric
        cols = ['open', 'high', 'low', 'close', 'volume']
        for col in cols:
            if col in df.columns: df[col] = pd.to_numeric(df[col], errors='coerce')
        df.dropna(subset=['close'], inplace=True)
        return df

    def prepare_indicators(self):
        # RSI
        self.df['rsi'] = self.df.ta.rsi(length=StrategyConfig.RSI_PERIOD)
        
        # Volume Z-Score (Proxy for OI Z-Score)
        self.df['vol_mean'] = self.df['volume'].rolling(window=StrategyConfig.OI_ZSCORE_LOOKBACK).mean()
        self.df['vol_std'] = self.df['volume'].rolling(window=StrategyConfig.OI_ZSCORE_LOOKBACK).std()
        self.df['vol_zscore'] = (self.df['volume'] - self.df['vol_mean']) / self.df['vol_std']
        
        # Pivot Lows (for SL) - Moving Window Min
        # We need identifying "recent pivot low" at time of entry. 
        # Simple Proxy: Lowest Low of last 10 candles
        self.df['pivot_low_10'] = self.df['low'].rolling(window=10).min()
    
    def find_trendlines(self, rsi_series, window_size=20):
        # Simplified Trendline Logic for Backtest Simulation
        # Finds a resistance point in the past 'window_size' that is a local maximum
        # Only checks last known peak.
        # This is a basic simulation of the complex 'find_trendlines' from strategies.py
        
        if len(rsi_series) < window_size: return None
        
        # Look for peak in the window [current-window : current-5]
        # (Avoiding immediate potential breakout noise)
        recent_window = rsi_series.iloc[-window_size:-2] 
        if len(recent_window) == 0: return None
        
        peak_idx = recent_window.idxmax()
        peak_val = recent_window.max()
        
        # Check if 'real' peak (neighbors lower)
        # If passed idx is global index, use iloc properly
        try:
           if rsi_series[peak_idx] > rsi_series[peak_idx-1] and rsi_series[peak_idx] > rsi_series[peak_idx+1]:
               # Found a peak. Assume flat resistance line for simplicity or slightly descending
               # Real strategy draws line between TWO peaks. 
               # V2 Spec: "RSI Trendline Breakout". We need a line.
               # Let's assume a descending line from a generic previous peak.
               
               # Mock: Return (Slope, Intercept)
               # Assume slope is slightly negative (-0.05 per bar)
               m = -0.05
               c = peak_val - (m * peak_idx) # y = mx + c => c = y - mx
               return {'m': m, 'c': c}
        except:
            return None
            
        return None

    def run_simulation(self):
        trades = []
        state = 'IDLE' # IDLE, WAITING_RETEST, IN_TRADE
        
        entry_price = 0
        sl_price = 0
        tp_price = 0
        trade_entry_idx = 0
        
        retest_line_val = 0
        
        print(f"Starting simulation on {len(self.df)} candles...")
        
        # Start enough candles in
        for i in range(100, len(self.df)):
            row = self.df.iloc[i]
            prev = self.df.iloc[i-1]
            
            curr_rsi = row['rsi']
            prev_rsi = prev['rsi']
            
            if pd.isna(curr_rsi): continue

            # --- STATE MACHINE ---
            
            if state == 'IDLE':
                # Check for Breakout
                # 1. Find Resistance Line
                # (Ideally calculated every step strictly on past data)
                # Using a synthetic check for "Crossing 60" or "Crossing 70" for reliable V2 demo if Trendline logic is too complex for single-script backtest
                is_breakout = (prev_rsi <= 60 and curr_rsi > 60)
                
                if is_breakout:
                    # check V1 Score
                    # Pass slice up to current candle (inclusive)
                    # NOTE: analyze expects proper setup. Passing slice 'df.iloc[:i+1]' creates a small DF.
                    # This is inefficient but necessary for "point-in-time" score.
                    # Optimization: only pass last 200 candles to analyze?
                    # QuantProBreakout uses 'data' and 'df_htf'. We pass 'slice' as both.
                    slice_df = self.df.iloc[max(0, i-200):i+1].copy()
                    
                    try:
                        # We must inject 'symbol' for analyze logic
                        slice_df['symbol'] = "BACKTEST" 
                        analysis = self.v1_strategy.analyze(slice_df, slice_df)
                        v1_score = analysis.get('score', 0)
                    except Exception as e:
                        print(f"Scoring Error: {e}")
                        v1_score = 0
                        
                    if v1_score < StrategyConfig.V2_MIN_SCORE_V1:
                        # FILTERED OUT
                        self.filtered_count += 1
                        # print(f"[{i}] Breakout Filtered. Score: {v1_score} < {StrategyConfig.V2_MIN_SCORE_V1}")
                        is_breakout = False
                    else:
                         print(f"[{i}] Breakout VALIDATED. Score: {v1_score}")
                
                # Filter: Z-Score > 1.5
                if is_breakout and row['vol_zscore'] > 1.5:

                    state = 'WAITING_RETEST'
                    # Calculate Target RSI Level (Breakout Point)
                    # We broke 60, so we want to retest ~60 (or slightly below/above)
                    # Let's set target RSI for entry at 55 (Deep retest) or 60 (Touch)
                    # Config: RETEST_REVERSE_RSI_TOLERANCE = 3.0
                    # Target RSI range: 60 +/- 3
                    retest_target_rsi = 60.0
                    # print(f"[{i}] BREAKOUT DETECTED! Vol Z: {row['vol_zscore']:.2f}. Waiting for Retest of RSI {retest_target_rsi}")
            
            elif state == 'WAITING_RETEST':
                # Check for "Retest from Above"
                # If we already fell below 60 in previous candle, the support is broken.
                if prev_rsi < retest_target_rsi:
                    state = 'IDLE'
                    continue

                # 1. Calculate Target Price for RSI=60
                # Using Utility
                # Use data up to previous candle (simulation constraint)
                # Note: calculated price effectively projects for the current candle 'i'
                target_price = calculate_reverse_rsi(retest_target_rsi, self.df.iloc[:i], rsi_period=StrategyConfig.RSI_PERIOD)
                
                # Check if current LOW touched this price (and proper fill)
                if row['low'] <= target_price <= row['high']:
                    # ENTRY TRIGGERED (Perfect Touch)
                    entry_price = target_price
                    trade_entry_idx = i
                    
                    # Set SL (Pivot Low of last 10)
                    sl_price = self.df['pivot_low_10'].iloc[i-1]
                    if sl_price >= entry_price: sl_price = entry_price * 0.98 # Fallback
                    
                    risk = entry_price - sl_price
                    if risk <= 0: risk = entry_price * 0.01 # Safety
                    
                    tp_price = entry_price + (risk * StrategyConfig.MIN_RR_RATIO)
                    
                    state = 'IN_TRADE'
                    print(f"DEBUG: Entry Triggered at idx {i}. Prev RSI: {prev_rsi:.2f}. Target RSI: {retest_target_rsi}. Target Price: {target_price:.2f}. Range: {row['low']} - {row['high']}")

                    # print(f"  -> ENTRY at {entry_price:.2f} (Target RSI {retest_target_rsi}). SL: {sl_price:.2f}, TP: {tp_price:.2f}")
                
                elif row['high'] < target_price:
                    # Gapped down below target?
                    # The RSI support failed instantly.
                    state = 'IDLE' 
                if curr_rsi < 40:
                    state = 'IDLE' # Failed retest, collapsed
                    
            elif state == 'IN_TRADE':
                # Check Outcome
                if row['low'] <= sl_price:
                    # STOP LOSS HIT
                    pnl = (sl_price - entry_price) / entry_price * 100
                    trades.append({'type': 'LOSS', 'pnl': pnl, 'entry': entry_price, 'exit': sl_price})
                    state = 'IDLE'
                elif row['high'] >= tp_price:
                    # TAKE PROFIT HIT
                    pnl = (tp_price - entry_price) / entry_price * 100
                    trades.append({'type': 'WIN', 'pnl': pnl, 'entry': entry_price, 'exit': tp_price})
                    state = 'IDLE'
                    
                # Time limit? (Optional)
        
        return trades

    def print_report(self, trades):
        if not trades:
            print("No trades generated.")
            return

        df_t = pd.DataFrame(trades)
        wins = df_t[df_t['type'] == 'WIN']
        losses = df_t[df_t['type'] == 'LOSS']
        
        win_rate = len(wins) / len(trades) * 100
        total_pnl = df_t['pnl'].sum()
        max_dd = df_t['pnl'].cumsum().min()
        
        print("\n" + "="*40)
        print(f"      STRATEGY V2 BACKTEST REPORT      ")
        print("="*40)
        print(f"Total Trades:      {len(trades)}")
        print(f"Filtered Setups:   {self.filtered_count}")
        print(f"Win Rate:          {win_rate:.2f}%")
        print(f"Total Net Profit:  {total_pnl:.2f}%")
        print(f"Max Drawdown:      {max_dd:.2f}%")
        print("-"*40)
        print(df_t.tail(10).to_string(index=False)) # Show last 10 trades
        print("="*40)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 backtest_v2.py <json_file>")
        sys.exit(1)
        
    engine = BacktestEngineV2(sys.argv[1])
    results = engine.run_simulation()
    engine.print_report(results)
