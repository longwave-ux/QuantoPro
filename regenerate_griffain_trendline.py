"""Quick test to generate fresh GRIFFAIN trendline data"""
import json
import pandas as pd
from shared_context import FeatureFactory, create_default_config

# Load data
with open('data/HYPERLIQUID_GRIFFAINUSDT_4h.json', 'r') as f:
    data = json.load(f)

df = pd.DataFrame(data)

# Create context
config = create_default_config()
factory = FeatureFactory(config)

context = factory.build_context(
    symbol='GRIFFAINUSDT',
    exchange='HYPERLIQUID',
    ltf_data=df,
    htf_data=df
)

# Get trendlines
rsi_trendlines = context.get_htf_indicator('rsi_trendlines', {})

print("Fresh Trendline Data:")
print(json.dumps(rsi_trendlines, indent=2))

# Save to temp file for visualization
output = [{
    'symbol': 'GRIFFAINUSDT',
    'exchange': 'HYPERLIQUID',
    'observability': {
        'rsi_visuals': rsi_trendlines
    }
}]

with open('data/temp_griffain_output.json', 'w') as f:
    json.dump(output, f, indent=2)

print("\nSaved to data/temp_griffain_output.json")
