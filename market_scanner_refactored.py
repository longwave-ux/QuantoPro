"""
Market Scanner - Refactored with Canonical Architecture
Orchestrates: Symbol Normalization → Feature Calculation → Strategy Execution
"""

import sys
import json
import argparse
import os
import time
import pandas as pd
import numpy as np
from typing import Dict, Any, List, Optional

# Load environment variables from .env file
from dotenv import load_dotenv
load_dotenv()

# Import canonical architecture components
from symbol_mapper import to_canonical, get_mapper
from shared_context import SharedContext, FeatureFactory, create_default_config


def json_serializable(obj):
    """
    Convert numpy types and other problematic types to JSON-serializable Python types.
    This handles numpy.bool_, numpy.int64, numpy.float64, sets, etc.
    """
    if isinstance(obj, np.bool_):
        return bool(obj)
    elif isinstance(obj, np.integer):
        return int(obj)
    elif isinstance(obj, np.floating):
        return float(obj)
    elif isinstance(obj, np.ndarray):
        return obj.tolist()
    elif isinstance(obj, set):
        return list(obj)
    elif isinstance(obj, dict):
        return {key: json_serializable(value) for key, value in obj.items()}
    elif isinstance(obj, list):
        return [json_serializable(item) for item in obj]
    else:
        return obj


def sanitize_for_json(data):
    """
    Recursively sanitize data structure to ensure all values are JSON-serializable.
    """
    return json_serializable(data)


def atomic_save_json(data: Dict[str, Any], filename: str) -> None:
    """
    Atomically save JSON data to file.
    Writes to temporary file first, then replaces the target file.
    This ensures the dashboard sees old data until scan is 100% complete.
    """
    # Ensure directory exists
    os.makedirs(os.path.dirname(filename), exist_ok=True)
    
    # Create temporary file
    temp_file = filename + '.tmp'
    
    try:
        # Sanitize and save to temporary file
        sanitized_data = sanitize_for_json(data)
        with open(temp_file, 'w') as f:
            json.dump(sanitized_data, f, indent=2)
        
        # Atomically replace the target file
        os.replace(temp_file, filename)
        
    except Exception as e:
        # Clean up temp file on error
        if os.path.exists(temp_file):
            os.remove(temp_file)
        raise e


def ensure_data_contract(signals: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Ensure every signal has required fields according to data contract.
    """
    for signal in signals:
        # Ensure total_score field exists (copy from score if missing)
        if 'score' in signal and 'total_score' not in signal:
            signal['total_score'] = signal['score']
        
        # Ensure strategy field is populated
        if 'strategy_name' in signal and 'strategy' not in signal:
            signal['strategy'] = signal['strategy_name']
    
    return signals
from strategies_refactored import (
    QuantProLegacyRefactored,
    QuantProBreakoutRefactored,
    QuantProBreakoutV2Refactored,
    clean_nans
)
from batch_processor import get_batch_processor

# DEBUG: Check API Key visibility
print(f"[ENV-DEBUG] Coinalyze Key Present: {bool(os.getenv('COINALYZE_API_KEY'))}", file=sys.stderr)
print(f"[ENV-DEBUG] Coinalyze Key (first 10 chars): {os.getenv('COINALYZE_API_KEY', '')[:10]}...", file=sys.stderr)


def load_data(filename: str) -> pd.DataFrame:
    """Load candle data from JSON file."""
    with open(filename, 'r') as f:
        data = json.load(f)
    
    # Handle wrapper format
    if isinstance(data, dict) and 'data' in data:
        data = data['data']
    
    df = pd.DataFrame(data)
    
    # Normalize column names
    df.columns = [c.lower() for c in df.columns]
    
    if 'time' in df.columns:
        df.rename(columns={'time': 'timestamp'}, inplace=True)
    
    # Ensure numeric types
    cols = ['open', 'high', 'low', 'close', 'volume']
    for col in cols:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors='coerce')
    
    # Drop rows with NaN in critical columns
    initial_len = len(df)
    df.dropna(subset=['close'], inplace=True)
    dropped = initial_len - len(df)
    if dropped > 0:
        print(f"[WARN] Dropped {dropped} rows due to NaN values in {filename}", file=sys.stderr)
    
    return df


def extract_exchange_from_filename(filename: str) -> str:
    """Extract exchange name from filename."""
    basename = os.path.basename(filename)
    parts = basename.split('_')
    if len(parts) > 0:
        return parts[0].upper()
    return 'UNKNOWN'


def extract_symbol_from_filename(filename: str) -> str:
    """Extract symbol from filename."""
    basename = os.path.basename(filename)
    parts = basename.split('_')
    if len(parts) >= 2:
        return parts[1]
    return 'UNKNOWN'


def build_feature_config(user_config: Dict[str, Any]) -> Dict[str, Any]:
    """Build feature factory configuration from user config."""
    # Start with defaults
    feature_config = create_default_config()
    
    # Override with user config if provided
    if 'INDICATORS' in user_config:
        indicators = user_config['INDICATORS']
        if 'RSI' in indicators:
            feature_config['rsi_period'] = indicators['RSI'].get('PERIOD', 14)
        if 'EMA' in indicators:
            feature_config['ema_fast'] = indicators['EMA'].get('FAST', 50)
            feature_config['ema_slow'] = indicators['EMA'].get('SLOW', 200)
        if 'ADX' in indicators:
            feature_config['adx_period'] = indicators['ADX'].get('PERIOD', 14)
        if 'BOL_BANDS' in indicators:
            feature_config['bb_period'] = indicators['BOL_BANDS'].get('PERIOD', 20)
            feature_config['bb_std'] = indicators['BOL_BANDS'].get('STD_DEV', 2)
    
    return feature_config


def analyze_symbol(
    symbol: str,
    exchange: str,
    df_ltf: pd.DataFrame,
    df_htf: Optional[pd.DataFrame],
    strategies: List[Any],
    feature_factory: FeatureFactory,
    metadata: Optional[Dict[str, Any]] = None,
    external_data: Optional[Dict[str, Any]] = None
) -> List[Dict[str, Any]]:
    """
    Analyze a symbol using the canonical architecture.
    
    Flow:
    1. Normalize symbol to canonical form
    2. Build SharedContext with pre-calculated features
    3. Execute strategies using SharedContext
    4. Return results with canonical metadata
    
    Args:
        external_data: Pre-fetched external data from batch processor (optional)
    """
    
    # Step 1: Normalize symbol
    canonical_symbol = to_canonical(symbol, exchange)
    
    # Create display_symbol by stripping USDT/USDTM suffixes
    display_symbol = symbol
    if symbol.endswith('USDTM'):
        display_symbol = symbol[:-5] + 'USDT'  # Convert USDTM to USDT for charts
    elif symbol.endswith('USDT'):
        display_symbol = symbol  # Keep as is
    
    print(f"[CANONICAL] {symbol} ({exchange}) → {canonical_symbol} (Display: {display_symbol})", file=sys.stderr)
    
    # Step 2: Build SharedContext
    context = feature_factory.build_context(
        symbol=symbol,
        exchange=exchange,
        ltf_data=df_ltf,
        htf_data=df_htf,
        metadata=metadata or {},
        external_data=external_data
    )
    
    print(f"[CONTEXT] Built for {canonical_symbol} | LTF: {len(df_ltf)} candles | HTF: {len(df_htf) if df_htf is not None else 0} candles", file=sys.stderr)
    
    # Step 3: Execute strategies
    results = []
    for strategy in strategies:
        try:
            result = strategy.analyze(context)
            
            # Enrich with canonical metadata
            result['canonical_symbol'] = canonical_symbol
            result['exchange'] = exchange
            result['symbol'] = symbol
            result['display_symbol'] = display_symbol
            
            # Map exchange to DataSource for frontend chart fetching
            exchange_to_source = {
                'BINANCE': 'MEXC',      # Use MEXC as fallback for Binance
                'MEXC': 'MEXC',
                'KUCOIN': 'KUCOIN',
                'HYPERLIQUID': 'HYPERLIQUID'
            }
            result['source'] = exchange_to_source.get(exchange.upper(), 'MEXC')
            
            # Add metadata
            if metadata:
                result['metadata'] = metadata
            
            results.append(result)
            
            print(f"[STRATEGY] {strategy.name} → Score: {result.get('score', 0):.1f} | Action: {result.get('action', 'WAIT')}", file=sys.stderr)
        
        except Exception as e:
            print(f"[ERROR] Strategy {strategy.name} failed for {symbol}: {e}", file=sys.stderr)
            import traceback
            traceback.print_exc(file=sys.stderr)
    
    return results


def main():
    parser = argparse.ArgumentParser(description='QuantPro Market Scanner (Canonical Architecture)')
    parser.add_argument('file', help='Input JSON data file or directory')
    parser.add_argument('--strategy', default='all', help='Strategy name (default: all)')
    parser.add_argument('--config', help='JSON Configuration string', default='{}')
    parser.add_argument('--backtest', action='store_true', help='Run in backtest mode')
    parser.add_argument('--plot', action='store_true', help='Generate debug plots')
    parser.add_argument('--limit', type=int, help='Limit data rows', default=0)
    parser.add_argument('--symbol', help='Specific symbol to scan', default=None)
    parser.add_argument('--htf-file', help='HTF data file path', default=None)
    parser.add_argument('--output', help='Output file for master feed', default='data/master_feed.json')
    
    args = parser.parse_args()
    
    try:
        # Parse user config
        user_config = {}
        if args.config:
            try:
                user_config = json.loads(args.config)
            except Exception as e:
                print(f"[WARN] Failed to parse config: {e}", file=sys.stderr)
        
        # Build feature factory config
        feature_config = build_feature_config(user_config)
        feature_factory = FeatureFactory(feature_config)
        
        # Initialize strategies
        strategies_to_run = []
        if args.strategy.lower() == 'all':
            strategies_to_run = [
                QuantProBreakoutRefactored(user_config),
                QuantProLegacyRefactored(user_config),
                QuantProBreakoutV2Refactored(user_config)
            ]
        elif args.strategy.lower() == 'legacy':
            strategies_to_run = [QuantProLegacyRefactored(user_config)]
        elif args.strategy.lower() == 'breakout':
            strategies_to_run = [QuantProBreakoutRefactored(user_config)]
        elif args.strategy.lower() == 'breakoutv2':
            strategies_to_run = [QuantProBreakoutV2Refactored(user_config)]
        else:
            print(f"[ERROR] Unknown strategy: {args.strategy}", file=sys.stderr)
            sys.exit(1)
        
        # Check if directory mode
        if os.path.isdir(args.file):
            print(f"[DIRECTORY MODE] Scanning all JSON files in {args.file}", file=sys.stderr)
            
            # Find all JSON files in directory
            json_files = []
            symbols_list = []  # For batch processing
            
            for filename in os.listdir(args.file):
                if filename.endswith('.json') and '_15m.json' in filename:
                    data_file = os.path.join(args.file, filename)
                    
                    # Extract symbol and exchange for batch processing
                    symbol = extract_symbol_from_filename(data_file)
                    exchange = extract_exchange_from_filename(data_file)
                    
                    # Filter by symbol if requested
                    if args.symbol and args.symbol.upper() not in symbol.upper():
                        continue
                    
                    json_files.append(data_file)
                    symbols_list.append((symbol, exchange))
                    
                    # Apply limit during scanning phase to avoid loading unnecessary files
                    if args.limit > 0 and len(json_files) >= args.limit:
                        print(f"[DIRECTORY MODE] Limit reached: {args.limit} files", file=sys.stderr)
                        break
            
            print(f"[DIRECTORY MODE] Found {len(json_files)} data files", file=sys.stderr)
            print(f"[DIRECTORY MODE] Processing {len(symbols_list)} symbols", file=sys.stderr)
            
            # BATCH PROCESSING: Fetch all external data in batches
            print(f"[BATCH] Initializing batch processor...", file=sys.stderr)
            batch_processor = get_batch_processor()
            batch_data = batch_processor.process_symbols(symbols_list)
            
            # Now process each file with pre-fetched data
            all_results = []
            processed = 0
            
            for data_file in json_files:
                try:
                    # Extract symbol and exchange
                    symbol = extract_symbol_from_filename(data_file)
                    exchange = extract_exchange_from_filename(data_file)
                    
                    # Filter by symbol if requested
                    if args.symbol and args.symbol.upper() not in symbol.upper():
                        continue
                    
                    # Load LTF data
                    df_ltf = load_data(data_file)
                    
                    # Load HTF data
                    htf_filename = data_file.replace('15m.json', '4h.json')
                    df_htf = None
                    if os.path.exists(htf_filename):
                        try:
                            df_htf = load_data(htf_filename)
                            if len(df_htf) < 50:
                                df_htf = None
                        except:
                            pass
                    
                    # Get pre-fetched external data
                    external_data = batch_processor.get_data_for_symbol(symbol, exchange, batch_data)
                    
                    # Analyze with pre-fetched data
                    results = analyze_symbol(
                        symbol=symbol,
                        exchange=exchange,
                        df_ltf=df_ltf,
                        df_htf=df_htf,
                        strategies=strategies_to_run,
                        feature_factory=feature_factory,
                        metadata={'mcap': 0},
                        external_data=external_data
                    )
                    
                    all_results.extend(results)
                    processed += 1
                    
                    if processed % 10 == 0:
                        current_time = time.strftime('%H:%M:%S')
                        print(f"[PROGRESS] {current_time} | Processed {processed}/{len(json_files)} files", flush=True)
                
                except Exception as e:
                    print(f"[ERROR] Processing {data_file}: {e}", file=sys.stderr)
            
            print(f"[DIRECTORY MODE] Processed {processed} files, generated {len(all_results)} signals", file=sys.stderr)
            
            # Ensure data contract compliance
            all_results = ensure_data_contract(all_results)
            
            # Create structured master feed with timestamp
            master_feed = {
                'last_updated': int(time.time() * 1000),
                'signals': clean_nans(all_results)
            }
            
            # Atomic save to master feed file
            output_file = args.output
            atomic_save_json(master_feed, output_file)
            
            print(f"[SUCCESS] Saved {len(all_results)} signals to {output_file}", file=sys.stderr)
            print(f"[TIMESTAMP] Last Updated: {master_feed['last_updated']}", file=sys.stderr)
            
            # Also output to stdout for compatibility
            sanitized_feed = sanitize_for_json(master_feed)
            print(json.dumps(sanitized_feed))
            sys.exit(0)
        
        # Check if batch mode (text file with list of symbols)
        elif args.file.endswith('.txt'):
            with open(args.file, 'r') as f:
                symbols = [line.strip() for line in f if line.strip()]
            
            all_batch_results = []
            total_symbols = len(symbols)
            
            for i, symbol in enumerate(symbols):
                # Progress heartbeat with timestamp and batch info
                current_time = time.strftime('%H:%M:%S')
                batch_size = min(5, total_symbols - i)  # Show next 5 symbols
                symbols_list = ', '.join(symbols[i:i+batch_size])
                print(f"[PROGRESS] {current_time} | Processing Batch {i+1}/{total_symbols} | Symbols: {symbols_list}", flush=True)
                
                try:
                    # Filter by symbol if requested
                    if args.symbol and args.symbol.upper() not in symbol.upper():
                        continue
                    
                    # Construct data file paths
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
                        continue
                    
                    # Load LTF data
                    df_ltf = load_data(data_file)
                    if args.limit > 0:
                        df_ltf = df_ltf.tail(args.limit)
                    
                    # Load HTF data
                    htf_filename = data_file.replace('15m.json', '4h.json')
                    df_htf = None
                    if os.path.exists(htf_filename):
                        try:
                            df_htf = load_data(htf_filename)
                            if len(df_htf) < 50:
                                df_htf = None
                        except:
                            pass
                    
                    # Extract exchange
                    exchange = extract_exchange_from_filename(data_file)
                    
                    # Analyze
                    results = analyze_symbol(
                        symbol=symbol,
                        exchange=exchange,
                        df_ltf=df_ltf,
                        df_htf=df_htf,
                        strategies=strategies_to_run,
                        feature_factory=feature_factory,
                        metadata={'mcap': 0}
                    )
                    
                    # Filter results (keep signals with RR >= 2 and all WAITs)
                    for r in results:
                        if r['action'] != 'WAIT':
                            if (r.get('rr', 0) or 0) >= 2.0:
                                all_batch_results.append(r)
                        else:
                            all_batch_results.append(r)
                
                except Exception as e:
                    print(f"[ERROR] Processing {symbol}: {e}", file=sys.stderr)
                    pass
            
            # Output batch results with sanitization
            sanitized_results = sanitize_for_json(clean_nans(all_batch_results))
            print(json.dumps(sanitized_results))
            sys.exit(0)
        
        # Single file mode
        df_ltf = load_data(args.file)
        if args.limit > 0:
            df_ltf = df_ltf.tail(args.limit)
        
        # Extract symbol and exchange from filename
        symbol = extract_symbol_from_filename(args.file)
        exchange = extract_exchange_from_filename(args.file)
        
        # Load HTF data if available
        df_htf = None
        if args.htf_file:
            if os.path.exists(args.htf_file):
                df_htf = load_data(args.htf_file)
        else:
            # Auto-detect HTF file
            htf_filename = args.file.replace('15m.json', '4h.json')
            if os.path.exists(htf_filename):
                try:
                    df_htf = load_data(htf_filename)
                    if len(df_htf) < 50:
                        df_htf = None
                except:
                    pass
        
        # Backtest mode
        if args.backtest:
            print("[ERROR] Backtest mode not yet implemented in canonical architecture", file=sys.stderr)
            sys.exit(1)
        
        # Live analysis mode
        results = analyze_symbol(
            symbol=symbol,
            exchange=exchange,
            df_ltf=df_ltf,
            df_htf=df_htf,
            strategies=strategies_to_run,
            feature_factory=feature_factory,
            metadata={'mcap': 0}
        )
        
        # Output results with sanitization
        sanitized_results = sanitize_for_json(clean_nans(results))
        print(json.dumps(sanitized_results))
    
    except Exception as e:
        print(f"[FATAL ERROR] {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
