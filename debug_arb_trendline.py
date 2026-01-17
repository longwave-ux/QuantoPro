
import pandas as pd
import json
import os
import sys

# Ensure project root is in path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from shared_context import FeatureFactory, create_default_config

def debug_arb():
    # Load ARB 4h data
    file_path = 'data/HYPERLIQUID_ARBUSDT_4h.json'
    print(f"Loading data from {file_path}")
    
    with open(file_path, 'r') as f:
        raw_data = json.load(f)
    
    if not raw_data:
        print("Error: Empty data file")
        return

    # Convert to DataFrame
    df = pd.DataFrame(raw_data)
    
    # Ensure numeric columns
    cols = ['open', 'high', 'low', 'close', 'volume']
    for col in cols:
        df[col] = pd.to_numeric(df[col], errors='coerce')
    
    # Ensure timestamp/time structure
    if 'time' in df.columns and 'timestamp' not in df.columns:
        df['timestamp'] = df['time']
    
    # Initialize FeatureFactory
    config = create_default_config()
    factory = FeatureFactory(config)
    
    # Build Context (calculates RSI, etc.)
    print("Building context...")
    context = factory.build_context('ARBUSDT', 'HYPERLIQUID', df, df) # Pass same DF for LTF/HTF for this test
    
    # Extract RSI trendlines
    result = context.htf_indicators.get('rsi_trendline', {})
    
    print("\nTrendline Result:")
    print(json.dumps(result, indent=2))
    
    # Also print RSI values for context if result is empty
    # context is an object, access attributes directly
    rsi = context.ltf_indicators.get('rsi')
    if rsi is not None:
        last_rsi = rsi.iloc[-1]
        print(f"\nCurrent RSI: {last_rsi}")
        print(f"RSI min/max last 150: {rsi.tail(150).min():.2f} - {rsi.tail(150).max():.2f}")

if __name__ == "__main__":
    debug_arb()
