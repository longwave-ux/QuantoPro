import sys
import json
import argparse
import os
import pandas as pd
import numpy as np
import pandas_ta as ta
from strategies import QuantProLegacy, QuantProBreakout

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
    initial_len = len(df)
    df.dropna(subset=['close'], inplace=True)
    dropped = initial_len - len(df)
    if dropped > 0:
        import sys
        print(f"[WARN] Dropped {dropped} rows due to NaN values in {filename}", file=sys.stderr)
    
    return df

def clean_nans(obj):
    """Recursively convert NaN, inf, and numpy types to JSON-serializable values."""
    import numpy as np
    import pandas as pd
    
    # Handle numpy integer types (int64, int32, etc.)
    if isinstance(obj, (np.integer, np.int64, np.int32)):
        return int(obj)
    # Handle numpy float types (float64, float32, etc.)
    elif isinstance(obj, (np.floating, np.float64, np.float32)):
        if pd.isna(obj) or np.isinf(obj):
            return 0.0
        return float(obj)
    # Handle regular Python floats
    elif isinstance(obj, float):
        if pd.isna(obj) or np.isinf(obj):
            return 0.0
        return obj
    # Recursively handle dictionaries
    elif isinstance(obj, dict):
        return {k: clean_nans(v) for k, v in obj.items()}
    # Recursively handle lists
    elif isinstance(obj, list):
        return [clean_nans(v) for v in obj]
    # Return everything else as-is
    return obj

def main():
    parser = argparse.ArgumentParser(description='QuantPro Market Scanner')
    parser.add_argument('file', help='Input JSON data file')
    parser.add_argument('--strategy', default='all', help='Strategy name (default: all)')
    parser.add_argument('--config', help='JSON Configuration string', default='{}')
    parser.add_argument('--backtest', action='store_true', help='Run in backtest mode')
    parser.add_argument('--plot', action='store_true', help='Generate debug plots (Breakout strategy)')
    parser.add_argument('--limit', type=int, help='Limit data rows (backtest only)', default=0)
    parser.add_argument('--symbol', help='Specific symbol to scan (e.g., BTCUSDT)', default=None)
    
    args = parser.parse_args()
    
    try:
        # Check if batch mode (text file with list of symbols)
        if args.file.endswith('.txt'):
            with open(args.file, 'r') as f:
                symbols = [line.strip() for line in f if line.strip()]
            
            all_batch_results = []
            
            for symbol in symbols:
                try:
                    # Construct expected data path
                    # Try both current dir and data/ dir
                    candidates = [
                        f"data/HYPERLIQUID_{symbol}_15m.json",
                        f"HYPERLIQUID_{symbol}_15m.json"
                    ]
                    
                    data_file = None
                    for c in candidates:
                         if os.path.exists(c):
                             data_file = c
                             break
                    
                    if not data_file:
                        continue # Skip if no data found
                    
                    # Filter by symbol if requested
                    if args.symbol and args.symbol.upper() not in symbol.upper():
                        continue

                    # Process this file
                    df = load_data(data_file)
                    # No limit for batch scan typically, or apply same limit
                    
                    # HTF loading
                    htf_filename = data_file.replace('15m.json', '4h.json')
                    df_htf = None
                    if os.path.exists(htf_filename):
                         try:
                             df_htf = load_data(htf_filename)
                             if len(df_htf) < 50: df_htf = None
                         except: pass
                    
                    df['symbol'] = symbol
                    
                    # Config/Strategy Setup (Reusable)
                    config = {}
                    if args.config:
                        try:
                            config = json.loads(args.config)
                        except: pass
                    
                    strategies_to_run = []
                    if args.strategy.lower() == 'all':
                         strategies_to_run = [QuantProBreakout(config), QuantProLegacy(config)]
                    elif args.strategy.lower() == 'legacy':
                        strategies_to_run = [QuantProLegacy(config)]
                    elif args.strategy.lower() == 'breakout':
                        strategies_to_run = [QuantProBreakout(config)]
                    
                    # Analyze
                    # Assume LIVE mode for batch typically
                    batch_res = []
                    for stra in strategies_to_run:
                        # Logic Split: Breakout runs on HTF (4H), Legacy runs on LTF (15m)
                        if isinstance(stra, QuantProBreakout):
                             # Pass df_htf as the primary 'df' for Breakout
                             r = stra.analyze(df_htf, df_htf, mcap=0) 
                             r['strategy_name'] = "Breakout"
                        elif isinstance(stra, QuantProLegacy):
                             r = stra.analyze(df, df_htf, mcap=0)
                             r['strategy_name'] = "Legacy"
                        else:
                             r = stra.analyze(df, df_htf, mcap=0)
                             r['strategy_name'] = stra.name()

                        r['symbol'] = symbol
                        batch_res.append(r)
                    
                    # Filter: Keep all valid Signals (RR>=2) and all WAITs
                    for r in batch_res:
                        if r['action'] != 'WAIT':
                            # Check RR
                            if (r.get('rr', 0) or 0) >= 2.0:
                                all_batch_results.append(r)
                        else:
                            # Keep WAITs
                            all_batch_results.append(r)
                    
                except Exception as e:
                    # print(f"Error processing {symbol}: {e}", file=sys.stderr)
                    pass
            
            # Print Final Array
            print(json.dumps(clean_nans(all_batch_results), indent=2))
            return

        # Normal Single File Mode
        df = load_data(args.file)
        
        # Apply Limit if Backtest and Limit > 0
        if args.backtest and args.limit > 0:
             if len(df) > args.limit + 200: # Ensure warm-up if possible, or just exact tail?
                 # User asked for "Last 1000 candles".
                 df = df.iloc[-args.limit:]
        
        # Extract symbol
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
        
        # Inject symbol for strategy use (plotting)
        df['symbol'] = symbol

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
        
        if args.plot:
            config['plot'] = True

        if args.plot:
            config['plot'] = True

        strategies_to_run = []
        if args.strategy.lower() == 'all':
             strategies_to_run = [QuantProBreakout(config), QuantProLegacy(config)]
        elif args.strategy.lower() == 'legacy':
            strategies_to_run = [QuantProLegacy(config)]
        elif args.strategy.lower() == 'breakout':
            strategies_to_run = [QuantProBreakout(config)]
        else:
            raise ValueError(f"Unknown strategy: {args.strategy}")
        
        # DEBUG PRINT
        import sys
        print(f"DEBUG: Selected Strategies: {[s.name() for s in strategies_to_run]}", file=sys.stderr)
            
        if args.backtest:
            # BACKTEST MODE -> Accumulate all
            all_signals = []
            for stra in strategies_to_run:
                 sigs = stra.backtest(df, df_htf, mcap=mcap)
                 # Inject strategy name
                 for s in sigs: s['strategy_name'] = stra.name()
                 all_signals.extend(sigs)
            
            # Quality Control: Filter Low RR
            # Only apply to active signals. WAITs have RR=0 usually.
            filtered_signals = [s for s in all_signals if s['action'] == 'WAIT' or (s.get('rr', 0) or 0) >= 2.0]
            
            print(json.dumps(clean_nans(filtered_signals), indent=2))
        else:
            # LIVE MODE
            results = []
            for stra in strategies_to_run:
                r = stra.analyze(df, df_htf, mcap=mcap)
                r['symbol'] = symbol
                
                # FORCE Name Injection
                if isinstance(stra, QuantProLegacy):
                    r['strategy_name'] = "Legacy"
                elif isinstance(stra, QuantProBreakout):
                    r['strategy_name'] = "Breakout"
                    # DEBUG
                    print("DEBUG: SET BREAKOUT NAME", file=sys.stderr)
                else:
                    r['strategy_name'] = stra.name()
                
                print(f"DEBUG: Strategy {stra} -> {r['strategy_name']}", file=sys.stderr)

                results.append(r)
            
            # Filter: Keep all valid Signals (RR>=2) and all WAITs
            # Note: For single file mode which feeds the server loop, 
            # returning ALL results (array) is safer so Server can log them.
            # DEBUG
            # print(f"DEBUG RAW RESULTS: {results}", file=sys.stderr)
            final_res = []
            for r in results:
                if r['action'] != 'WAIT':
                    if (r.get('rr', 0) or 0) >= 2.0:
                        final_res.append(r)
                else:
                    final_res.append(r)

            print(json.dumps(clean_nans(final_res), indent=2))
        
    except Exception as e:
        import traceback
        import sys
        traceback.print_exc(file=sys.stderr)
        error_out = {
            "error": str(e),
            "strategy": args.strategy
        }
        print(json.dumps(error_out))
        sys.exit(1)

if __name__ == "__main__":
    main()
