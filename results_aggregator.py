import json
import os
import glob
import pandas as pd
import sys

# Configuration
DATA_DIR = os.path.join(os.path.dirname(__file__), 'data')
OUTPUT_FILE = os.path.join(DATA_DIR, 'master_feed.json')

SOURCE_TAGS = {
    'HYPERLIQUID': 'HL',
    'BINANCE': 'BIN',
    'KUCOIN': 'KUC',
    'MEXC': 'MEX',
    'BYBIT': 'BYB',
    'OKX': 'OKX'
}

SOURCE_PRIORITY = {
    'HYPERLIQUID': 100,
    'BINANCE': 90,
    'BYBIT': 80,
    'OKX': 70,
    'KUCOIN': 60,
    'MEXC': 50
}

def sanitize_result(item):
    """
    Enforces strict schema compliance to prevent frontend crashes.
    Injects missing fields with safe defaults.
    """
    import copy
    
    # 1. Top Level Defaults
    base = {
        'price': 0.0,
        'score': 0.0,
        'bias': 'NONE',
        'action': 'WAIT',
        'rr': 0.0,
        'entry': None,
        'stop_loss': None,
        'take_profit': None,
        'setup': None,
        'timestamp': 0,
        'strategy_name': 'Unknown',
        'symbol': 'Unknown',
        'mcap': 0.0,
        'pnl': 0.0
    }
    
    sanitized = base.copy()
    sanitized.update(item)
    
    # 2. Nested Objects - Raw Components
    if 'raw_components' not in sanitized:
        sanitized['raw_components'] = {}
    
    rc_defaults = {
        'price_change_pct': 0.0,
        'duration_candles': 0,
        'divergence_type': 0
    }
    for k, v in rc_defaults.items():
        if k not in sanitized['raw_components']:
            sanitized['raw_components'][k] = v
            
    # 3. Nested Objects - LTF
    if 'ltf' not in sanitized:
        sanitized['ltf'] = {}
        
    ltf_defaults = {
        'rsi': 50.0,
        'adx': 0.0,
        'bias': 'NONE',
        'obvImbalance': 'NEUTRAL',
        'divergence': 'NONE',
        'isPullback': False,
        'pullbackDepth': 0.0,
        'volumeOk': True,
        'momentumOk': True,
        'isOverextended': False
    }
    for k, v in ltf_defaults.items():
        if k not in sanitized['ltf']:
            sanitized['ltf'][k] = v

    # 4. Nested Objects - Details & Metadata
    if 'details' not in sanitized:
        sanitized['details'] = {'total': 0.0}
        
    meta_defaults = {
        'oi_meta': {'oi_slope': 0.0, 'oi_points': 0, 'oi_avg': 0.0},
        'sentiment_meta': {
            "liq_longs": 0, "liq_shorts": 0, "liq_ratio": 0.0, 
            "top_ls_ratio": 0.0
        }
    }
    
    for meta_key, meta_def in meta_defaults.items():
        if meta_key not in sanitized['details']:
            sanitized['details'][meta_key] = meta_def
        else:
            # Ensure keys exist INSIDE the meta object if it exists but is empty
            if not isinstance(sanitized['details'][meta_key], dict):
                 sanitized['details'][meta_key] = meta_def
            else:
                for k, v in meta_def.items():
                    if k not in sanitized['details'][meta_key]:
                         sanitized['details'][meta_key][k] = v
                         
    return sanitized

def get_canonical_symbol(signal):
    """
    Extract canonical symbol from signal.
    Prioritizes canonical_symbol field from new scanner, falls back to deriving from symbol.
    """
    # Use canonical_symbol if present (from canonical architecture)
    if 'canonical_symbol' in signal and signal['canonical_symbol']:
        return signal['canonical_symbol']
    
    # Fallback: derive from symbol (legacy compatibility)
    symbol = signal.get('symbol', 'UNKNOWN')
    for suffix in ['USDTM', 'PERP', 'USDT', 'USDC', 'USD']:
        if symbol.endswith(suffix):
            return symbol[:-len(suffix)]
    return symbol

def load_all_results():
    all_signals = []
    pattern = os.path.join(DATA_DIR, 'latest_results_*.json')
    files = glob.glob(pattern)
    
    print(f"[*] Found {len(files)} result files.")
    
    for fpath in files:
        try:
            filename = os.path.basename(fpath)
            # Extract exchange name from file (e.g. latest_results_MEXC.json -> MEXC)
            source_guess = "UNKNOWN"
            if "latest_results_" in filename:
                source_guess = filename.replace("latest_results_", "").replace(".json", "")
            
            with open(fpath, 'r') as f:
                data = json.load(f)
                
            if isinstance(data, list):
                for item in data:
                    # Enrich with source if missing or ensure consistency with filename
                    # Prefer item['source'] if it matches known keys, otherwise use filename
                    item_source = item.get('source', str(source_guess)).upper()
                    item['source'] = item_source
                    all_signals.append(item)
        except Exception as e:
            print(f"[!] Error reading {fpath}: {e}")
            
    return all_signals

def main():
    raw_signals = load_all_results()
    print(f"[*] Total raw signals loaded: {len(raw_signals)}")
    
    # 1. Volume Map (Symbol + Source -> Volume)
    # Some strategies might not have volume populated, so we try to find it from others
    vol_map = {} # Key: source_symbol, Value: vol24h
    
    for s in raw_signals:
        src = s.get('source', 'UNKNOWN')
        sym = s.get('symbol', 'UNKNOWN')
        key = f"{src}_{sym}"
        
        vol = 0
        if 'details' in s and 'vol24h' in s['details']:
            vol = float(s['details']['vol24h'] or 0)
        
        if vol > 0:
            if key not in vol_map or vol > vol_map[key]:
                vol_map[key] = vol

    # 2. Enrichment & Tagging
    processed_signals = []
    for s in raw_signals:
        src = s.get('source', 'UNKNOWN').upper()
        sym = s.get('symbol', 'UNKNOWN')
        key = f"{src}_{sym}"
        
        # Recover volume
        vol = 0
        if 'details' in s and 'vol24h' in s['details'] and s['details']['vol24h']:
             vol = float(s['details']['vol24h'])
        
        if vol == 0 and key in vol_map:
            vol = vol_map[key]
            
        canonical_sym = get_canonical_symbol(s)
        
        # Add Tags
        s['enrich_vol'] = vol
        s['canonical_symbol'] = canonical_sym  # Ensure canonical_symbol is set
        s['base_symbol'] = canonical_sym  # Keep for backward compatibility
        s['priority_score'] = SOURCE_PRIORITY.get(src, 0)
        s['exchange_tag'] = SOURCE_TAGS.get(src, src[:3]) # Fallback to first 3 chars
        
        # [NEW] Extract Components for UI
        # Priority: Top Level 'components' > Top Level 'raw_components' > 'details.raw_components'
        if s.get('components'):
            # Already set by strategy (V2)
            pass
        elif s.get('raw_components'):
            s['components'] = s.get('raw_components')
        elif 'details' in s and s['details'].get('raw_components'):
            s['components'] = s['details'].get('raw_components')
        else:
            s['components'] = None
            
        # [NEW] Extract Score Breakdown
        if 'details' in s:
            s['score_breakdown'] = s['details'].get('score_breakdown')
        else:
            s['score_breakdown'] = None
        
        processed_signals.append(s)

    # 3. Strategy Merge: Group by Canonical Symbol
    # For each canonical symbol, preserve ALL strategies in a combined structure
    canonical_groups = {}
    
    for s in processed_signals:
        canonical = s['canonical_symbol']
        
        if canonical not in canonical_groups:
            canonical_groups[canonical] = []
        canonical_groups[canonical].append(s)
    
    # 4. Build Final List with Strategy Merge
    final_list = []
    
    for canonical, signals in canonical_groups.items():
        # Group by strategy within this canonical symbol
        strategy_groups = {}
        for s in signals:
            strat = s.get('strategy_name', 'Unknown')
            if strat not in strategy_groups:
                strategy_groups[strat] = []
            strategy_groups[strat].append(s)
        
        # For each strategy, pick the best signal (highest volume/priority/score)
        strategy_signals = []
        for strat, candidates in strategy_groups.items():
            candidates.sort(key=lambda x: (x['enrich_vol'], x['priority_score'], x['score']), reverse=True)
            winner = candidates[0]
            winner = sanitize_result(winner)
            strategy_signals.append(winner)
        
        # Add all strategy signals for this canonical symbol
        final_list.extend(strategy_signals)

    print(f"[*] Final unique signals: {len(final_list)}")
    
    # 5. Save to Master Feed
    try:
        abs_path = os.path.abspath(OUTPUT_FILE)
        print(f"[FILESYSTEM-DEBUG] Saving {len(final_list)} symbols to {abs_path}")
        # Atomic Write
        temp_file = OUTPUT_FILE + ".tmp"
        with open(temp_file, 'w') as f:
            json.dump(final_list, f, indent=2)
            
        os.replace(temp_file, OUTPUT_FILE) # Atomic rename
        print(f"[SUCCESS] Saved to {OUTPUT_FILE} (Automically)")
    except Exception as e:
        print(f"[ERROR] Failed to save master feed: {e}")

if __name__ == "__main__":
    main()
