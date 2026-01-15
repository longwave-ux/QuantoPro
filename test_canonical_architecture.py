"""
Test Script for Canonical Architecture
Validates symbol mapping, feature factory, and strategy execution.
"""

import sys
import json
import pandas as pd
import numpy as np
from symbol_mapper import SymbolMapper, to_canonical
from shared_context import SharedContext, FeatureFactory, create_default_config
from strategies_refactored import QuantProLegacyRefactored, QuantProBreakoutRefactored


def test_symbol_mapper():
    """Test symbol normalization."""
    print("\n=== Testing SymbolMapper ===")
    
    mapper = SymbolMapper()
    
    test_cases = [
        ('BTCUSDT', 'BINANCE', 'BTC'),
        ('XBTUSDTM', 'KUCOIN', 'BTC'),
        ('ETH-USDT', 'MEXC', 'ETH'),
        ('SOLUSD_PERP', 'HYPERLIQUID', 'SOL'),
        ('AAVEUSDT', 'BINANCE', 'AAVE'),
        ('1000PEPEUSDT', 'BINANCE', '1000PEPE'),
    ]
    
    passed = 0
    failed = 0
    
    for symbol, exchange, expected in test_cases:
        result = mapper.to_canonical(symbol, exchange)
        status = "✓" if result == expected else "✗"
        if result == expected:
            passed += 1
        else:
            failed += 1
        print(f"  {status} {symbol} ({exchange}) → {result} (expected: {expected})")
    
    print(f"\nSymbolMapper: {passed} passed, {failed} failed")
    return failed == 0


def create_mock_dataframe(length=100):
    """Create mock candle data for testing."""
    np.random.seed(42)
    
    base_price = 100.0
    prices = base_price + np.cumsum(np.random.randn(length) * 0.5)
    
    df = pd.DataFrame({
        'timestamp': range(length),
        'open': prices,
        'high': prices + np.random.rand(length) * 2,
        'low': prices - np.random.rand(length) * 2,
        'close': prices + np.random.randn(length) * 0.5,
        'volume': np.random.randint(1000, 10000, length)
    })
    
    return df


def test_feature_factory():
    """Test feature factory indicator calculation."""
    print("\n=== Testing FeatureFactory ===")
    
    # Create mock data
    df_ltf = create_mock_dataframe(200)
    df_htf = create_mock_dataframe(100)
    
    # Create factory
    config = create_default_config()
    factory = FeatureFactory(config)
    
    # Build context
    context = factory.build_context(
        symbol='BTCUSDT',
        exchange='BINANCE',
        ltf_data=df_ltf,
        htf_data=df_htf,
        metadata={'mcap': 1000000000}
    )
    
    print(f"  ✓ Context created for {context.canonical_symbol}")
    print(f"  ✓ LTF data: {len(context.ltf_data)} candles")
    print(f"  ✓ HTF data: {len(context.htf_data)} candles")
    
    # Check LTF indicators
    ltf_indicators = ['rsi', 'ema_fast', 'ema_slow', 'adx', 'atr', 'obv']
    ltf_passed = 0
    ltf_failed = 0
    
    print("\n  LTF Indicators:")
    for indicator in ltf_indicators:
        value = context.get_ltf_indicator(indicator)
        if value is not None and len(value) > 0:
            last_val = value.iloc[-1]
            status = "✓" if not pd.isna(last_val) else "✗"
            if not pd.isna(last_val):
                ltf_passed += 1
            else:
                ltf_failed += 1
            print(f"    {status} {indicator}: {last_val:.2f}" if not pd.isna(last_val) else f"    {status} {indicator}: NaN")
        else:
            ltf_failed += 1
            print(f"    ✗ {indicator}: Not calculated")
    
    # Check HTF indicators
    htf_indicators = ['ema_fast', 'ema_slow', 'adx']
    htf_passed = 0
    htf_failed = 0
    
    print("\n  HTF Indicators:")
    for indicator in htf_indicators:
        value = context.get_htf_indicator(indicator)
        if value is not None and len(value) > 0:
            last_val = value.iloc[-1]
            status = "✓" if not pd.isna(last_val) else "✗"
            if not pd.isna(last_val):
                htf_passed += 1
            else:
                htf_failed += 1
            print(f"    {status} {indicator}: {last_val:.2f}" if not pd.isna(last_val) else f"    {status} {indicator}: NaN")
        else:
            htf_failed += 1
            print(f"    ✗ {indicator}: Not calculated")
    
    print(f"\nFeatureFactory: LTF {ltf_passed}/{len(ltf_indicators)} passed, HTF {htf_passed}/{len(htf_indicators)} passed")
    return ltf_failed == 0 and htf_failed == 0


def test_strategy_execution():
    """Test strategy execution with SharedContext."""
    print("\n=== Testing Strategy Execution ===")
    
    # Create mock data
    df_ltf = create_mock_dataframe(200)
    df_htf = create_mock_dataframe(100)
    
    # Create factory and context
    config = create_default_config()
    factory = FeatureFactory(config)
    
    context = factory.build_context(
        symbol='BTCUSDT',
        exchange='BINANCE',
        ltf_data=df_ltf,
        htf_data=df_htf,
        metadata={'mcap': 1000000000}
    )
    
    # Test Legacy strategy
    print("\n  Testing QuantProLegacyRefactored:")
    try:
        strategy = QuantProLegacyRefactored()
        result = strategy.analyze(context)
        
        # Validate result structure
        required_fields = ['strategy_name', 'symbol', 'canonical_symbol', 'exchange', 'price', 'score', 'bias', 'action']
        missing_fields = [f for f in required_fields if f not in result]
        
        if not missing_fields:
            print(f"    ✓ Result structure valid")
            print(f"    ✓ Canonical symbol: {result['canonical_symbol']}")
            print(f"    ✓ Score: {result['score']:.2f}")
            print(f"    ✓ Bias: {result['bias']}")
            print(f"    ✓ Action: {result['action']}")
            legacy_passed = True
        else:
            print(f"    ✗ Missing fields: {missing_fields}")
            legacy_passed = False
    except Exception as e:
        print(f"    ✗ Error: {e}")
        import traceback
        traceback.print_exc()
        legacy_passed = False
    
    # Test Breakout strategy
    print("\n  Testing QuantProBreakoutRefactored:")
    try:
        strategy = QuantProBreakoutRefactored()
        result = strategy.analyze(context)
        
        # Validate result structure
        missing_fields = [f for f in required_fields if f not in result]
        
        if not missing_fields:
            print(f"    ✓ Result structure valid")
            print(f"    ✓ Canonical symbol: {result['canonical_symbol']}")
            print(f"    ✓ Score: {result['score']:.2f}")
            print(f"    ✓ Bias: {result['bias']}")
            print(f"    ✓ Action: {result['action']}")
            breakout_passed = True
        else:
            print(f"    ✗ Missing fields: {missing_fields}")
            breakout_passed = False
    except Exception as e:
        print(f"    ✗ Error: {e}")
        import traceback
        traceback.print_exc()
        breakout_passed = False
    
    print(f"\nStrategy Execution: {'All tests passed' if legacy_passed and breakout_passed else 'Some tests failed'}")
    return legacy_passed and breakout_passed


def test_output_compatibility():
    """Test output JSON compatibility with Node.js consumer."""
    print("\n=== Testing Output Compatibility ===")
    
    # Create mock data
    df_ltf = create_mock_dataframe(200)
    df_htf = create_mock_dataframe(100)
    
    # Create factory and context
    config = create_default_config()
    factory = FeatureFactory(config)
    
    context = factory.build_context(
        symbol='BTCUSDT',
        exchange='BINANCE',
        ltf_data=df_ltf,
        htf_data=df_htf,
        metadata={'mcap': 1000000000}
    )
    
    # Execute strategy
    strategy = QuantProLegacyRefactored()
    result = strategy.analyze(context)
    
    # Test JSON serialization
    try:
        json_str = json.dumps(result)
        print(f"  ✓ JSON serialization successful")
        
        # Test deserialization
        parsed = json.loads(json_str)
        print(f"  ✓ JSON deserialization successful")
        
        # Check for NaN/Inf values
        json_str_lower = json_str.lower()
        if 'nan' in json_str_lower or 'inf' in json_str_lower:
            print(f"  ✗ JSON contains NaN or Inf values")
            return False
        else:
            print(f"  ✓ No NaN or Inf values in JSON")
        
        # Validate canonical fields are present
        if 'canonical_symbol' in parsed and 'exchange' in parsed:
            print(f"  ✓ Canonical metadata present")
            print(f"    - canonical_symbol: {parsed['canonical_symbol']}")
            print(f"    - exchange: {parsed['exchange']}")
        else:
            print(f"  ✗ Missing canonical metadata")
            return False
        
        return True
    
    except Exception as e:
        print(f"  ✗ JSON serialization error: {e}")
        return False


def main():
    """Run all tests."""
    print("=" * 60)
    print("Canonical Architecture Validation Tests")
    print("=" * 60)
    
    results = {
        'SymbolMapper': test_symbol_mapper(),
        'FeatureFactory': test_feature_factory(),
        'StrategyExecution': test_strategy_execution(),
        'OutputCompatibility': test_output_compatibility()
    }
    
    print("\n" + "=" * 60)
    print("Test Summary")
    print("=" * 60)
    
    for test_name, passed in results.items():
        status = "✓ PASSED" if passed else "✗ FAILED"
        print(f"  {status}: {test_name}")
    
    all_passed = all(results.values())
    
    print("\n" + "=" * 60)
    if all_passed:
        print("✓ All tests passed! Canonical architecture is ready.")
    else:
        print("✗ Some tests failed. Review errors above.")
    print("=" * 60)
    
    return 0 if all_passed else 1


if __name__ == '__main__':
    sys.exit(main())
