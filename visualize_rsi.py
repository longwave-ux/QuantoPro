
import json
import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
import os
import sys

def visualize_rsi_trendlines():
    # 1. Load Master Feed
    # 1. Load Master Feed (or temp output)
    try:
        # We try to read from the temp file first if it exists, as it contains our specific run
        with open('data/temp_griffain_output.json', 'r') as f:
             content = f.read()
             # Find the start of the JSON list
             start_idx = content.find('[{')
             if start_idx != -1:
                 json_str = content[start_idx:]
                 feed = {'signals': json.loads(json_str)}
             else:
                 # Fallback to pure json load if no prefix found
                 f.seek(0)
                 feed = json.load(f)
                 if isinstance(feed, dict) and 'signals' not in feed: 
                     feed = {'signals': [feed]}
    except:
        print("Falling back to master_feed.json")
        with open('data/master_feed.json', 'r') as f:
            feed = json.load(f)

    # 2. Find a symbol with RSI trendlines
    target_signal = None
    target_symbol = "GRIFFAINUSDT"
    
    # Handle both list and dict formats
    signals = feed if isinstance(feed, list) else feed.get('signals', [])
    
    for signal in signals:
        if signal['symbol'] == target_symbol:
             if 'observability' in signal and 'rsi_visuals' in signal['observability']:
                visuals = signal['observability']['rsi_visuals']
                if visuals.get('resistance') or visuals.get('support'):
                    target_signal = signal
                    break
    
    if not target_signal:
        print(f"No RSI lines found for {target_symbol}")
        return
    
    if not target_signal:
        print("No signals with RSI trendlines found in master feed.")
        return

    symbol = target_signal['symbol']
    exchange = target_signal.get('exchange', 'HYPERLIQUID') # Default to HYPERLIQUID if missing
    print(f"Found trendline data for {symbol} ({exchange})")

    # 3. Load 4H Data (HTF)
    # Construct filename pattern
    filename = f"data/{exchange}_{symbol}_4h.json"
    if not os.path.exists(filename):
        # Try without exchange prefix if needed, but standard is EXCHANGE_SYMBOL_TIMEFRAME
        print(f"Error: Data file {filename} not found.")
        return

    print(f"Loading data from {filename}...")
    with open(filename, 'r') as f:
        raw_data = json.load(f)
    
    df = pd.DataFrame(raw_data)
    # Ensure timestamp is datetime
    if 'time' in df.columns:
        df.rename(columns={'time': 'timestamp'}, inplace=True)
    
    # Handle timestamp conversion (ms to datetime)
    df['datetime'] = pd.to_datetime(df['timestamp'], unit='ms')
    df.set_index('datetime', inplace=True)
    
    # Calculate RSI (if not in data, but usually it is pre-calculated or we need to calc)
    # The JSON data might just be OHLCV. Let's check if we need to calc RSI.
    # Usually the data file is just OHLCV. We should calculate RSI using 'ta' or simple pandas.
    # Manual RSI Calculation (Wilder's Smoothing)
    delta = df['close'].diff()
    gain = (delta.where(delta > 0, 0)).ewm(alpha=1/14, adjust=False).mean()
    loss = (-delta.where(delta < 0, 0)).ewm(alpha=1/14, adjust=False).mean()
    rs = gain / loss
    df['rsi'] = 100 - (100 / (1 + rs))

    # 4. Extract Trendline Info
    visuals = target_signal['observability']['rsi_visuals']
    resistance = visuals.get('resistance')
    support = visuals.get('support')

    # 5. Plot
    plt.figure(figsize=(12, 6))
    
    # Plot RSI
    # We'll plot the last 100 candles for visibility, or enough to cover the trendline
    # Find min/max time from trendlines to decide range
    
    # Better zoom: start ~20 candles before P1
    if resistance:
        p1_idx = resistance['pivot_1']['index']
        start_idx = max(0, p1_idx - 20)  # 20 candles before P1
        plot_df = df.iloc[start_idx:].copy()
    else:
        plot_df = df.iloc[-100:].copy()  # Default: last 100 candles
    
    plt.plot(plot_df.index, plot_df['rsi'], label='RSI (14)', color='purple', linewidth=1.5)
    
    # Plot Trendlines
    if resistance:
        p1_idx = resistance['pivot_1']['index']
        p2_idx = resistance['pivot_2']['index']
        
        # Use absolute indices from original df (before slicing)
        if resistance['pivot_1']['time'] > 0:
            p1_time = pd.to_datetime(resistance['pivot_1']['time'], unit='ms')
        else:
            p1_time = df.index[p1_idx]  # Use original df, not plot_df
            
        if resistance['pivot_2']['time'] > 0:
            p2_time = pd.to_datetime(resistance['pivot_2']['time'], unit='ms')
        else:
            p2_time = df.index[p2_idx]  # Use original df, not plot_df
            
        p1_val = resistance['pivot_1']['value']
        p2_val = resistance['pivot_2']['value']
        
        # Get slope and intercept (index-based from backend)
        slope = resistance['slope']
        intercept = resistance['intercept']
        
        # PROJECT THE LINE FORWARD, but clamp to valid RSI range
        current_idx = len(df) - 1
        current_rsi_projected = slope * current_idx + intercept
        
        # If projection goes out of range (0-100), stop at boundary
        if current_rsi_projected < 0:
            # Find where line crosses 0
            end_idx = int(-intercept / slope) if slope != 0 else current_idx
            end_idx = max(p2_idx + 1, min(end_idx, len(df) - 1))
            end_time = df.index[end_idx]  # Use df, not plot_df
            end_rsi = max(0, slope * end_idx + intercept)
        elif current_rsi_projected > 100:
            # Find where line crosses 100
            end_idx = int((100 - intercept) / slope) if slope != 0 else current_idx
            end_idx = max(p2_idx + 1, min(end_idx, len(df) - 1))
            end_time = df.index[end_idx]  # Use df, not plot_df
            end_rsi = min(100, slope * end_idx + intercept)
        else:
            # Normal case: project to current
            end_time = df.index[-1]  # Use df, not plot_df
            end_rsi = current_rsi_projected
        
        # Draw line from P1 to endpoint
        plt.plot([p1_time, end_time], [p1_val, end_rsi], 
                'r-', linewidth=2, label='Resistance Trendline (Projected)', alpha=0.8)
        
        # Mark pivots - P2 should show PROJECTED value (on the line), not actual
        p2_projected = slope * p2_idx + intercept
        plt.plot([p1_time], [p1_val], 'ro', markersize=10, label='Pivot Points', zorder=5)
        plt.plot([p2_time], [p2_projected], 'ro', markersize=10, zorder=5)  # P2 on the line
        
        # Annotate
        plt.annotate(f"P1", (p1_time, p1_val), xytext=(0, 10), textcoords='offset points', ha='center')
        plt.annotate(f"P2", (p2_time, p2_val), xytext=(0, 10), textcoords='offset points', ha='center')

    # Add reference lines
    plt.axhline(70, color='gray', linestyle='--', alpha=0.5)
    plt.axhline(30, color='gray', linestyle='--', alpha=0.5)
    
    plt.title(f"RSI Trendline Analysis: {symbol} (4h)")
    plt.ylabel("RSI")
    plt.legend()
    plt.grid(True, alpha=0.3)
    
    # Format x-axis
    plt.gca().xaxis.set_major_formatter(mdates.DateFormatter('%Y-%m-%d %H:%M'))
    plt.gcf().autofmt_xdate()

    output_file = 'rsi_trendline_verification.png'
    plt.savefig(output_file)
    print(f"Saved plot to {output_file}")

if __name__ == "__main__":
    visualize_rsi_trendlines()
