from data_fetcher import CoinalyzeClient
import sys

def check_symbols():
    api_key = "5019d4cc-a330-4132-bac0-18d2b0a1ee38"
    client = CoinalyzeClient(api_key)
    
    symbols_to_check = ["BTCUSDT", "HYPEUSDT", "YGGUSDT", "XAIUSDT", "MANTAUSDT"]
    
    print(f"{'SYMBOL':<15} | {'CONVERTED':<20} | {'OI LEN':<10} | {'FUNDING':<10}")
    print("-" * 65)
    
    for sym in symbols_to_check:
        converted = client.convert_symbol(sym)
        oi = client.get_open_interest_history(sym, hours=4)
        fr = client.get_funding_rate(sym)
        
        oi_len = len(oi) if oi else "NONE"
        fr_val = f"{fr:.6f}" if fr is not None else "NONE"
        
        print(f"{sym:<15} | {converted:<20} | {oi_len:<10} | {fr_val:<10}")

if __name__ == "__main__":
    check_symbols()
