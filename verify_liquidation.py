from data_fetcher import CoinalyzeClient
client = CoinalyzeClient(api_key="5019d4cc-a330-4132-bac0-18d2b0a1ee38")

print("Checking Liquidations for BTCUSDT...")
liqs = client.get_liquidation_history("BTCUSDT")
print(f"Result: {liqs}")

if liqs and liqs['longs'] >= 0 and liqs['shorts'] >= 0:
    print("SUCCESS: Valid data structure.")
else:
    print("FAILURE: Invalid data.")
