import pandas as pd
from strategies import QuantProBreakout

print("Instantiating Strategy...")
strategy = QuantProBreakout()

symbol = "BTCUSDT"
print(f"Testing API Integration for {symbol}...")
passed, bonus, metadata = strategy.check_coinalyze_confirmation(symbol, 'LONG')

print("\n--- RESULT ---")
print(f"Passed: {passed}")
print(f"Bonus: {bonus}")
print(f"Metadata: {metadata}")

import json
# Simulate what would be in the final JSON
output = {
    "analysis": metadata
}
print("\nJSON Segment:")
print(json.dumps(output, indent=2))
