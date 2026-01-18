#!/usr/bin/env python3
"""
V2 Zero Score Debug Test
Tests V2 strategy on 3 coins to identify why all scores are 0.0
"""
import json
import sys
from strategies_refactored import QuantProBreakoutV2Refactored
from shared_context import FeatureFactory, create_default_config
import pandas as pd

# Load config
with open('data/strategy_config.json') as f:
    config = json.load(f)

print('=' * 80)
print('V2 STRATEGY DEBUG - Testing 3 Coins')
print('=' * 80)

# Test coins
test_coins = [
    ('MEXC_BTCUSDT', 'BTCUSDT'),
    ('MEXC_ETHUSDT', 'ETHUSDT'),
    ('HYPERLIQUID_SOLUSDT', 'SOLUSDT')
]

for file_prefix, symbol in test_coins:
    print(f'\n{"=" * 80}')
    print(f'Testing: {symbol} ({file_prefix})')
    print('=' * 80)
    
    try:
        # Load data
        with open(f'data/{file_prefix}_4h.json') as f:
            data = json.load(f)
            df_htf = pd.DataFrame(data['data'] if isinstance(data, dict) else data)
        
        with open(f'data/{file_prefix}_15m.json') as f:
            data = json.load(f)
            df_ltf = pd.DataFrame(data['data'] if isinstance(data, dict) else data)
        
        print(f'✅ Data loaded: HTF={len(df_htf)} bars, LTF={len(df_ltf)} bars')
        
        # Build context
        factory = FeatureFactory(create_default_config())
        context = factory.build_context(
            symbol=symbol,
            exchange=file_prefix.split('_')[0],
            ltf_data=df_ltf,
            htf_data=df_htf,
            metadata={},
            external_data={'oi_z_score_valid': True, 'oi_z_score': 2.0}
        )
        
        print(f'✅ Context built successfully')
        
        # Initialize V2 with config
        strategy = QuantProBreakoutV2Refactored(config['BREAKOUTV2'])
        print(f'✅ Strategy initialized with config:')
        print(f'   K-Candle: {strategy.k_candle_enabled}')
        print(f'   MTF: {strategy.mtf_filter_enabled}')
        print(f'   Cardwall TP: {strategy.cardwall_tp_enabled}')
        
        # Run analysis
        result = strategy.analyze(context)
        
        print(f'\n📊 RESULT:')
        print(f'   Action: {result["action"]}')
        print(f'   Score: {result.get("score", 0)}')
        print(f'   Total Score: {result.get("total_score", 0)}')
        print(f'   Bias: {result.get("bias", "NONE")}')
        
        if result['action'] != 'WAIT':
            print(f'   Entry: {result.get("setup", {}).get("entry", "N/A")}')
            print(f'   TP: {result.get("setup", {}).get("tp", "N/A")}')
            print(f'   SL: {result.get("setup", {}).get("sl", "N/A")}')
            print(f'   R:R: {result.get("setup", {}).get("rr", "N/A")}')
        else:
            reason = result.get('details', {}).get('reason', 'Unknown')
            print(f'   Reason: {reason}')
            
    except FileNotFoundError as e:
        print(f'❌ Data file not found: {e}')
    except Exception as e:
        print(f'❌ Error: {e}')
        import traceback
        traceback.print_exc()

print(f'\n{"=" * 80}')
print('DEBUG COMPLETE')
print('=' * 80)
