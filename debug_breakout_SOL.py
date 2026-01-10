
import json
import pandas as pd
import pandas_ta as ta
import numpy as np
from scipy.signal import find_peaks
import sys
import datetime

# Mocking the missing CoinalyzeClient to avoid API issues during debug
# or we can import the real one if we want.
# Let's import the real base class but mock the client if needed.
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
        
        # print(f"  [DEBUG] {direction} Pivots/Peaks indices: {pivots[-5:]} ...")

        last_pivot_idx = pivots[-1]
        best_line = None
        
        # Iterate backwards
        for i in range(len(pivots)-2, -1, -1):
            p1_idx = pivots[i]
            p2_idx = last_pivot_idx
            
            x1, y1 = p1_idx, rsi[p1_idx]
            x2, y2 = p2_idx, rsi[p2_idx]
            
            if x2 == x1: continue
            m = (y2 - y1) / (x2 - x1)
            c = y1 - m * x1
            
            # Constraints
            if direction == 'RESISTANCE' and m > 0.1: continue
            if direction == 'SUPPORT' and m < -0.1: continue
            if abs(m) > 1.5: continue
            
            # Validation
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
                print(f"  [DEBUG] Found Valid {direction} Trendline: y = {m:.4f}x + {c:.2f} (Touches: {touches})")
                break
        
        if not best_line:
            # print(f"  [DEBUG] No valid {direction} trendline found after scanning pivots.")
            pass
            
        return best_line

    def analyze(self, df, df_htf=None, mcap=0):
        print(f"4H Candles fetched: {len(df)}")
        
        df['rsi'] = df.ta.rsi(length=self.rsi_len)
        df['mfi'] = df.ta.mfi(length=14)
        df['obv'] = df.ta.obv()
        
        rsi_val = df['rsi'].iloc[-1]
        print(f"RSI Calculated. Current Value: {rsi_val:.2f}")

        rsi_series = df['rsi'].fillna(0)
        if len(rsi_series) < 50:
            print("Not enough RSI data.")
            return self.empty_result(df)

        valid_breakout_found = False
        
        # Scan end
        scan_end = len(df)
        scan_start = max(50, scan_end - 6)
        
        print(f"Scanning for breakouts in the last 6 candles (Index {scan_start} to {scan_end-1})...")

        for i in range(scan_end - 1, scan_start - 1, -1):
            curr_rsi = rsi_series.iloc[i] 
            prev_rsi = rsi_series.iloc[i-1]
            
            # Debugging the most recent candle specifically
            is_latest = (i == scan_end - 1)
            
            if is_latest:
                print(f"\nChecking Current Candle (Index {i}): RSI={curr_rsi:.2f}, PrevRSI={prev_rsi:.2f}")

            # Resistance
            res_line = self.find_trendlines(rsi_series[:i], 'RESISTANCE')
            
            if res_line:
                threshold = res_line['m'] * i + res_line['c']
                threshold_prev = res_line['m'] * (i-1) + res_line['c']
                
                if is_latest:
                    print(f"  Projection (RES): At val={curr_rsi:.2f}, Line is at {threshold:.2f}. Need > {threshold + self.breakout_threshold:.2f}")
                
                if prev_rsi <= (threshold_prev + self.breakout_threshold) and curr_rsi > (threshold + self.breakout_threshold):
                     print(f"  [MATCH] Breakout Detected (Resistance) at index {i}!")
                     # MFI Logic
                     mfi_curr = df['mfi'].iloc[i]
                     mfi_prev = df['mfi'].iloc[i-1]
                     if (mfi_curr <= 80) or (mfi_curr > mfi_prev):
                         valid_breakout_found = True
                         print("  [PASS] MFI Filter Passed.")
                         
                         # Check Invalidation
                         # ...
                         # For now just confirming detection logic
                         print("  [SUCCESS] Valid Breakout Found.")
                         # (Skipping invalidation loop for brief debug, assuming live check)
                         break
                     else:
                         print(f"  [FAIL] MFI Filter Failed: {mfi_curr}")
            else:
                if is_latest:
                    print("  Reason for WAIT: No valid Resistance Trendline found.")

            
            # Support (if no res)
            if not valid_breakout_found:
                sup_line = self.find_trendlines(rsi_series[:i], 'SUPPORT')
                if sup_line:
                    threshold = sup_line['m'] * i + sup_line['c']
                    if is_latest:
                        print(f"  Projection (SUP): At val={curr_rsi:.2f}, Line is at {threshold:.2f}")
                    
                    if prev_rsi >= (threshold - self.breakout_threshold) and curr_rsi < (threshold - self.breakout_threshold):
                        print(f"  [MATCH] Breakdown Detected (Support) at index {i}!")
                        valid_breakout_found = True
                        break
                else:
                    if is_latest:
                        print("  Reason for WAIT: No valid Support Trendline found.")

            if valid_breakout_found: break

        if not valid_breakout_found:
             print("\nFinal Result: WAIT")
             # Print details for most recent attempt
             pass
        else:
             print("\nFinal Result: ACTION SIGNAL GENERATED")

        return {} # Dummy return

def main():
    # Load Data
    with open('data/HYPERLIQUID_SOLUSDT_4h.json', 'r') as f:
        data = json.load(f)
        if isinstance(data, dict) and 'data' in data: data = data['data']
        
    df = pd.DataFrame(data)
    df.columns = [c.lower() for c in df.columns]
    if 'time' in df.columns: df.rename(columns={'time': 'timestamp'}, inplace=True)
    cols = ['open', 'high', 'low', 'close', 'volume']
    for col in cols: df[col] = pd.to_numeric(df[col], errors='coerce')
    df.dropna(subset=['close'], inplace=True)
    
    # Run
    strategy = DebugBreakout()
    strategy.analyze(df)

if __name__ == "__main__":
    main()
