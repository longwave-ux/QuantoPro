import json
import os
import sys

def verify_integrity():
    """
    Verifies the integrity of the QuantPro dashboard data feed.
    Checks for:
    1. File existence (master_feed.json)
    2. BTCUSDT presence (Critical)
    3. Strict Schema Compliance (No missing keys that cause frontend crashes)
    """
    
    # Configuration
    ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    DATA_FILE = os.path.join(ROOT_DIR, 'data', 'master_feed.json')
    
    print(f"[*] Verifying integrity of: {DATA_FILE}")
    
    if not os.path.exists(DATA_FILE):
        print(f"[FAIL] Data file not found: {DATA_FILE}")
        return False
        
    try:
        with open(DATA_FILE, 'r') as f:
            data = json.load(f)
    except json.JSONDecodeError as e:
        print(f"[FAIL] Invalid JSON: {e}")
        return False
        
    if not isinstance(data, list):
        print(f"[FAIL] Root element is not a list")
        return False
        
    print(f"[*] Loaded {len(data)} signals.")
    
    # 1. Critical Symbol Check
    btc_found = False
    for item in data:
        if item.get('symbol') == 'BTCUSDT':
            btc_found = True
            break
    
    if not btc_found:
        print(f"[FAIL] CRITICAL: BTCUSDT not found in feed!")
        return False
    else:
        print(f"[PASS] BTCUSDT present.")

    # 2. Strict Schema Validation
    required_keys = [
        'symbol', 'strategy_name', 'price', 'score', 'action', 
        'ltf', 'details', 'raw_components', 'mcap', 'pnl'
    ]
    
    ltf_keys = ['rsi', 'adx', 'pullbackDepth']
    
    errors = 0
    max_errors_to_show = 5
    
    for i, item in enumerate(data):
        sym = item.get('symbol', f'Item #{i}')
        strat = item.get('strategy_name', 'Unknown')
        context = f"[{sym}|{strat}]"
        
        # Check Top Level Keys
        for key in required_keys:
            if key not in item:
                print(f"[FAIL] {context} Missing key: {key}")
                errors += 1
                
        # Check LTF Object
        if 'ltf' in item:
            if not isinstance(item['ltf'], dict):
                print(f"[FAIL] {context} 'ltf' is not a dict")
                errors += 1
            else:
                for k in ltf_keys:
                    if k not in item['ltf']:
                        print(f"[FAIL] {context} Missing 'ltf.{k}'")
                        errors += 1
        
        # Check Meta Objects
        if 'details' in item:
            if 'oi_meta' not in item['details']:
                print(f"[FAIL] {context} Missing 'details.oi_meta'")
                errors += 1
            if 'sentiment_meta' not in item['details']:
                print(f"[FAIL] {context} Missing 'details.sentiment_meta'")
                errors += 1
                
        if errors >= max_errors_to_show:
            print(f"[...] Too many errors, stopping check.")
            break
            
    if errors > 0:
        print(f"[FAIL] Found {errors} schema violations.")
        return False
        
    print(f"[SUCCESS] Integrity Check Passed. System is stable.")
    return True

if __name__ == "__main__":
    success = verify_integrity()
    sys.exit(0 if success else 1)
