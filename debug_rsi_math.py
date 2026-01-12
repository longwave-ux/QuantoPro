
import json
import pandas as pd
import pandas_ta as ta
import numpy as np
from strategies import calculate_reverse_rsi, clean_nans

def load_data(filename):
    with open(filename, 'r') as f:
        data = json.load(f)
    if isinstance(data, dict) and 'data' in data:
        data = data['data']
    df = pd.DataFrame(data)
    df.columns = [c.lower() for c in df.columns]
    cols = ['open', 'high', 'low', 'close', 'volume']
    for col in cols:
        if col in df.columns: df[col] = pd.to_numeric(df[col], errors='coerce')
    df.dropna(subset=['close'], inplace=True)
    return df

def verify_math():
    # 1. Load Data
    df = load_data('data/HYPERLIQUID_BTCUSDT_4h.json')
    # Use last 200 candles to stabilize RSI
    df = df.iloc[-200:].copy().reset_index(drop=True)
    
    # 2. Calculate Base RSI
    df['rsi'] = df.ta.rsi(length=14)
    
    last_idx = len(df) - 1
    last_close = df['close'].iloc[last_idx]
    last_rsi = df['rsi'].iloc[last_idx]
    
    print(f"Current Close: {last_close}")
    print(f"Current RSI: {last_rsi}")
    
    # 3. Target: Current RSI - 5.0 (Test Bearish Projection)
    target_rsi = last_rsi - 5.0
    if target_rsi < 5: target_rsi = last_rsi + 5.0
    
    print(f"Target RSI: {target_rsi}")
    
    # 4. Calculate Required Price using Utility
    # We pass the dataframe up to the current point. 
    # The function should return the price for the NEXT candle (or current candle if we are replacing it? 
    # Usually Reverse RSI predicts the CLOSE of the CURRENT forming candle given previous info, 
    # OR the close of the NEXT candle.
    # The function implementation assumes we are calculating for the "next" update based on "data".
    
    calculated_price = calculate_reverse_rsi(target_rsi, df, rsi_period=14)
    print(f"Calculated Price to hit {target_rsi}: {calculated_price}")
    
    # 5. Verify by appending a new candle
    new_row = df.iloc[-1].copy()
    new_row['close'] = calculated_price
    # We must append this row
    df_verify = pd.concat([df, pd.DataFrame([new_row])], ignore_index=True)
    
    # Recalculate RSI
    df_verify['rsi_new'] = df_verify.ta.rsi(length=14)
    
    resulting_rsi = df_verify['rsi_new'].iloc[-1]
    
    print(f"Resulting RSI after Price Injection: {resulting_rsi}")
    print(f"Diff: {abs(resulting_rsi - target_rsi):.4f}")
    
    if abs(resulting_rsi - target_rsi) < 0.1:
        print("[SUCCESS] Math is accurate.")
    else:
        print("[FAILURE] Math mismatch.")

if __name__ == "__main__":
    verify_math()
