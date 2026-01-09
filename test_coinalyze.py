from data_fetcher import CoinalyzeClient
import time

api_key = "5019d4cc-a330-4132-bac0-18d2b0a1ee38"
client = CoinalyzeClient(api_key)

print("Fetching OI Delta for BTCUSDT...")
# Test with a known big symbol
try:
    # First, let's just inspect raw response by hacking the method or just trusting the method if it works
    # Actually, I'll invoke the method.
    delta = client.get_open_interest_delta("BTCUSDT")
    print(f"OI Delta: {delta}")
except Exception as e:
    print(f"Error: {e}")
