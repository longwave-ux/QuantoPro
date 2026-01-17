
import json
import pandas as pd
import numpy as np
import pandas_ta as ta

def calculate_rsi_js_logic(prices, period=14):
    # Porting the JS logic from `services/indicators.ts`
    rsi_array = [float('nan')] * len(prices)
    
    # Needs at least period + 1 points to start calculation as per JS loop starting at 1
    if len(prices) < period + 1:
        return rsi_array

    gains = 0.0
    losses = 0.0

    # Initial SMA loop (indices 1 to period)
    # JS: for (let i = 1; i < period + 1 && i < data.length; i++)
    for i in range(1, period + 1):
        if i >= len(prices): break
        diff = prices[i] - prices[i-1]
        if diff >= 0:
            gains += diff
        else:
            losses += abs(diff)
            
    avg_gain = gains / period
    avg_loss = losses / period
    
    # Main loop
    # JS: for (let i = 0; i < data.length; i++)
    for i in range(len(prices)):
        if i < period:
            # rsi_array[i] remains NaN
            continue
            
        if i > period: # Note: JS logic has specific condition i > period. 
            # What happens at i == period?
            # In JS code:
            # if (i < period) continue;
            # if (i > period) { update avgGain/Loss }
            # then calc RSI.
            # So at i == period, it uses the initial avgGain/Loss directly.
            
            diff = prices[i] - prices[i-1]
            current_gain = diff if diff > 0 else 0
            current_loss = abs(diff) if diff < 0 else 0
            
            avg_gain = (avg_gain * (period - 1) + current_gain) / period
            avg_loss = (avg_loss * (period - 1) + current_loss) / period
            
        # Calculation
        if avg_loss == 0:
            rsi_array[i] = 100
        else:
            rs = avg_gain / avg_loss
            rsi_array[i] = 100 - (100 / (1 + rs))
            
    return rsi_array

def main():
    # Load Data
    try:
        with open('data/HYPERLIQUID_GRIFFAINUSDT_4h.json', 'r') as f:
            data = json.load(f)
    except FileNotFoundError:
        print("Data file not found")
        return

    df = pd.DataFrame(data)
    closes = df['close'].values

    # 1. Pandas TA RSI (Backend)
    df['rsi_ta'] = ta.rsi(df['close'], length=14)

    # 2. JS Logic RSI (Frontend)
    df['rsi_js'] = calculate_rsi_js_logic(closes, 14)

    # Compare
    comparison = df[['time', 'close', 'rsi_ta', 'rsi_js']].tail(20)
    comparison['diff'] = comparison['rsi_ta'] - comparison['rsi_js']
    
    print("RSI Comparison (Last 20 candles):")
    print(comparison)
    
    max_diff = comparison['diff'].abs().max()
    print(f"\nMax Difference in last 20: {max_diff}")
    
    if max_diff > 1.0:
        print("MAJOR MISMATCH DETECTED")
    else:
        print("RSI Logic matches reasonably well.")

if __name__ == "__main__":
    main()
