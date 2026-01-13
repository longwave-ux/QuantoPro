from data_fetcher import CoinalyzeClient
import sys

def test_coinalyze():
    # Key from strategies.py
    api_key = "5019d4cc-a330-4132-bac0-18d2b0a1ee38"
    client = CoinalyzeClient(api_key)
    
    symbol = "BTCUSDT"
    print(f"Testing Coinalyze for {symbol}...")
    
    # 1. Test OI History
    print("\n[1] Testing get_open_interest_history...")
    oi = client.get_open_interest_history(symbol, hours=4)
    if oi:
        print(f"PASS: Received {len(oi)} records.")
        print(f"Sample: {oi[-1]}")
    else:
        print("FAIL: No OI data.")

    # 2. Test Funding Rate
    print("\n[2] Testing get_funding_rate...")
    fr = client.get_funding_rate(symbol)
    if fr is not None:
        print(f"PASS: Funding Rate = {fr}")
    else:
        print("FAIL: Funding Rate is None.")

    # 3. Test Top Traders L/S
    print("\n[3] Testing get_ls_ratio_top_traders...")
    ls = client.get_ls_ratio_top_traders(symbol)
    if ls is not None:
        print(f"PASS: L/S Ratio = {ls}")
    else:
        print("FAIL: L/S Ratio is None.")
        
if __name__ == "__main__":
    try:
        test_coinalyze()
    except Exception as e:
        print(f"CRITICAL ERROR: {e}")
