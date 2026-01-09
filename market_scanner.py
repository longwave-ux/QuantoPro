
import sys
import json
import argparse
import pandas as pd
import numpy as np
import pandas_ta as ta
from strategies import QuantProLegacy

def load_data(filename):
    with open(filename, 'r') as f:
        data = json.load(f)
    
    # Handle { "success": true, "data": [...] } wrapper if present
    if isinstance(data, dict) and 'data' in data:
        data = data['data']
        
    df = pd.DataFrame(data)
    
    # Rename 'time' to 'timestamp' standard
    df.columns = [c.lower() for c in df.columns]
    
    if 'time' in df.columns:
        df.rename(columns={'time': 'timestamp'}, inplace=True)
        
    # Ensure numeric
    cols = ['open', 'high', 'low', 'close', 'volume']
    for col in cols:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors='coerce')
            
    # Drop rows with NaN in critical columns
    df.dropna(subset=['close'], inplace=True)
    
    return df

def clean_nans(obj):
    if isinstance(obj, float):
        if pd.isna(obj) or np.isinf(obj):
            return None
        return obj
    elif isinstance(obj, dict):
        return {k: clean_nans(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [clean_nans(v) for v in obj]
    return obj

def main():
    parser = argparse.ArgumentParser(description='QuantPro Market Scanner')
    parser.add_argument('file', help='JSON Data file path')
    parser.add_argument('--strategy', default='legacy', help='Strategy name (default: legacy)')
    parser.add_argument('--config', help='JSON Configuration string', default='{}')
    parser.add_argument('--backtest', action='store_true', help='Run in backtest mode')
    
    args = parser.parse_args()
    
    try:
        df = load_data(args.file)
        
        # Extract symbol
        import os
        filename = os.path.basename(args.file)
        parts = filename.split('_')
        symbol = "UNKNOWN"
        if len(parts) >= 3:
            symbol = parts[1]
        
        # Load HTF
        htf_filename = args.file.replace('15m.json', '4h.json')
        df_htf = None
        
        if os.path.exists(htf_filename) and htf_filename != args.file:
            try:
                df_htf = load_data(htf_filename)
                if len(df_htf) < 50:
                    df_htf = None
            except Exception:
                pass 

        # Load Mcap
        mcap = 0
        try:
             mcap_file = os.path.join(os.path.dirname(args.file), 'mcap_cache.json')
             if not os.path.exists(mcap_file):
                  mcap_file = "data/mcap_cache.json"
             
             if os.path.exists(mcap_file):
                  with open(mcap_file, 'r') as f:
                       mcaps = json.load(f)
                       if symbol in mcaps:
                            mcap = mcaps[symbol]
        except Exception:
             pass

        # Parse config
        config = {}
        if args.config:
            try:
                config = json.loads(args.config)
            except Exception:
                pass

        strategy = None
        if args.strategy.lower() == 'legacy':
            strategy = QuantProLegacy(config)
        else:
            raise ValueError(f"Unknown strategy: {args.strategy}")
            
        if args.backtest:
            # BACKTEST MODE
            signals = strategy.backtest(df, df_htf, mcap=mcap)
            print(json.dumps(clean_nans(signals), indent=2))
        else:
            # LIVE MODE
            result = strategy.analyze(df, df_htf, mcap=mcap)
            result['symbol'] = symbol
            print(json.dumps(clean_nans(result), indent=2))
        
    except Exception as e:
        import traceback
        traceback.print_exc(file=sys.stderr)
        error_out = {
            "error": str(e),
            "strategy": args.strategy
        }
        print(json.dumps(error_out))
        sys.exit(1)

if __name__ == "__main__":
    main()
