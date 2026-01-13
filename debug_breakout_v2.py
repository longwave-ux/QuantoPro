
import json
import pandas as pd
import pandas_ta as ta
import numpy as np
from scipy.signal import find_peaks
import sys
import os

from strategies import QuantProBreakout

class DebugBreakout(QuantProBreakout):
    def find_trendlines(self, rsi_series, direction='RESISTANCE'):
        rsi = rsi_series.values
        if len(rsi) < 50:
            print(f"  [DEBUG] Not enough data for trendlines: {len(rsi)}")
            return None
        
        # 1. Find Pivots
        if direction == 'RESISTANCE':
            peaks, _ = find_peaks(rsi, distance=10)
            pivots = peaks
            if len(pivots) < 3:
                print(f"  [DEBUG] Not enough peaks for RESISTANCE: found {len(pivots)}")
                return None
        else:
            peaks, _ = find_peaks(-rsi, distance=10)
            pivots = peaks
            if len(pivots) < 3:
                print(f"  [DEBUG] Not enough valleys for SUPPORT: found {len(pivots)}")
                return None
        
        last_pivot_idx = pivots[-1]
        best_line = None
        
        for i in range(len(pivots)-2, -1, -1):
            p1_idx = pivots[i]
            p2_idx = last_pivot_idx
            
            x1, y1 = p1_idx, rsi[p1_idx]
            x2, y2 = p2_idx, rsi[p2_idx]
            
            if x2 == x1: continue
            m = (y2 - y1) / (x2 - x1)
            c = y1 - m * x1
            
            if direction == 'RESISTANCE' and m > 0.1: continue
            if direction == 'SUPPORT' and m < -0.1: continue
            if abs(m) > 1.5: continue
            
            touches = 0
            violation = False
            
            for k in range(p1_idx, len(rsi)):
                model_y = m * k + c
                actual_y = rsi[k]
                
                if direction == 'RESISTANCE':
                    if actual_y > model_y + 1.0:
                        if k < len(rsi) - 1:
                            violation = True
                            break
                else: 
                    if actual_y < model_y - 1.0:
                        if k < len(rsi) - 1:
                            violation = True
                            break

                if abs(actual_y - model_y) < 2.0:
                    touches += 1
            
            if not violation and touches >= 3:
                best_line = {'m': float(m), 'c': float(c), 'touches': int(touches), 'start': int(p1_idx)}
                break
        
        return best_line

    def analyze(self, df, df_htf=None, mcap=0):
        print(f"\n--- Analyzing {df['symbol'].iloc[0] if 'symbol' in df else 'UNKNOWN'} ---")
        print(f"Candles fetched: {len(df)}")
        
        df['rsi'] = df.ta.rsi(length=self.rsi_len).fillna(0) # FIXED LOGIC
        df['mfi'] = df.ta.mfi(length=14)
        df['obv'] = df.ta.obv()
        
        rsi_val = df['rsi'].iloc[-1]
        print(f"RSI Calculated. Current Value: {rsi_val:.2f}")

        rsi_series = df['rsi']
        if len(rsi_series) < 50:
            print("Not enough RSI data.")
            return

        # Check Current State ONLY (Simulating 'Live' check)
        i = len(df) - 1
        curr_rsi = rsi_series.iloc[i]
        prev_rsi = rsi_series.iloc[i-1]
        
        print(f"Checking Current Candle (Index {i}): RSI={curr_rsi:.2f}")

        # Resistance Check
        res_line = self.find_trendlines(rsi_series.iloc[:i], 'RESISTANCE')
        if res_line:
            threshold = res_line['m'] * i + res_line['c']
            dist = threshold - curr_rsi
            print(f"  [RESISTANCE FOUND] y = {res_line['m']:.4f}x + {res_line['c']:.2f}")
            print(f"  Projection: Trendline at {threshold:.2f} (RSI is {curr_rsi:.2f})")
            print(f"  Distance to Breakout: {dist:.2f} pts")
            
            if prev_rsi <= (threshold - dist + self.breakout_threshold) and curr_rsi > (threshold + self.breakout_threshold):
                 print("  [SIGNAL] BREAKOUT DETECTED!")
            else:
                 print("  [WAIT] Price is below Breakout Threshold.")
        else:
            print("  [DEBUG] No peaks found for Resistance Trendline construction.")

        # Support Check
        sup_line = self.find_trendlines(rsi_series.iloc[:i], 'SUPPORT')
        if sup_line:
            threshold = sup_line['m'] * i + sup_line['c']
            dist = curr_rsi - threshold
            print(f"  [SUPPORT FOUND] y = {sup_line['m']:.4f}x + {sup_line['c']:.2f}")
            print(f"  Projection: Trendline at {threshold:.2f} (RSI is {curr_rsi:.2f})")
            print(f"  Distance to Breakdown: {dist:.2f} pts")
            
            if prev_rsi >= (threshold + dist - self.breakout_threshold) and curr_rsi < (threshold - self.breakout_threshold):
                 print("  [SIGNAL] BREAKDOWN DETECTED!")
            else:
                 print("  [WAIT] Price is above Breakdown Threshold.")
        else:
             print("  [DEBUG] No valleys found for Support Trendline construction.")

def load_and_debug(symbol, filename):
    if not os.path.exists(filename):
        print(f"File not found: {filename}")
        return

    with open(filename, 'r') as f:
        data = json.load(f)
        if isinstance(data, dict) and 'data' in data: data = data['data']
        
    df = pd.DataFrame(data)
    df.columns = [c.lower() for c in df.columns]
    if 'time' in df.columns: df.rename(columns={'time': 'timestamp'}, inplace=True)
    cols = ['open', 'high', 'low', 'close', 'volume']
    for col in cols: df[col] = pd.to_numeric(df[col], errors='coerce')
    df.dropna(subset=['close'], inplace=True)
    df['symbol'] = symbol
    
    strategy = DebugBreakout()
    strategy.analyze(df)

def main():
    # SOL
    load_and_debug("SOLUSDT", 'data/HYPERLIQUID_SOLUSDT_4h.json')
    
    # BTC (Try to find file)
    btc_files = ['data/HYPERLIQUID_BTCUSDT_4h.json', 'data/BTCUSDT_4h.json', 'data/BTC_4h.json']
    found = False
    for f in btc_files:
        if os.path.exists(f):
            load_and_debug("BTCUSDT", f)
            found = True
            break
    
    if not found:
        print("BTC 4H data not found for debug.")

if __name__ == "__main__":
    main()
