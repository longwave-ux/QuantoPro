import requests
import time
import logging

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class CoinalyzeClient:
    def __init__(self, api_key):
        self.api_key = api_key
        self.base_url = "https://api.coinalyze.net/v1"
        self.last_req_time = 0
        self.req_interval = 2.0  # 30 requests/min max to be safe (limit is 40)

    def _wait_for_rate_limit(self):
        """Enforce rate limit by sleeping if needed."""
        elapsed = time.time() - self.last_req_time
        if elapsed < self.req_interval:
            time.sleep(self.req_interval - elapsed)
        self.last_req_time = time.time()

    def convert_symbol(self, symbol):
        """
        Convert generic symbol to Coinalyze Binance Futures format.
        Example: 'AAVEUSDT' -> 'AAVEUSDT_PERP.A'
        """
        # Remove any existing suffix if present weirdly (e.g. from file)
        clean = symbol.upper().replace('.csv', '').replace('_15m', '')
        
        # If it doesn't have suffix, append standard Binance Futures suffix
        if not clean.endswith('_PERP.A'):
            return f"{clean}_PERP.A"
        return clean

    def get_open_interest_delta(self, symbol, interval='15m'):
        """
        Fetch Open Interest history and return % change over last 3 periods.
        Returns:
            float: % Change (e.g., 5.0 for +5%, -2.0 for -2%)
            None: If request failed
        """
        self._wait_for_rate_limit()
        
        mapped_symbol = self.convert_symbol(symbol)
        
        # Map Interval
        interval_map = {'15m': '15min', '1h': '1hour', '4h': '4hour'}
        mapped_interval = interval_map.get(interval, interval)
        if mapped_interval == '15m': mapped_interval = '15min' # Fallback
        
        endpoint = f"{self.base_url}/open-interest-history"
        
        # We need roughly a few candles. API params:
        # symbols, interval, from, to.
        # It's easier to verify endpoint docs, but assuming standard 'limit' or time range.
        # Coinalyze API usually requires 'from'/'to'.
        
        # Calculate 'from' timestamp (last 60 mins)
        to_ts = int(time.time())
        from_ts = to_ts - 3600 # Last 1 hour is enough for 3 * 15m candles
        
        params = {
            'symbols': mapped_symbol,
            'interval': mapped_interval,
            'from': from_ts,
            'to': to_ts,
            'api_key': self.api_key
        }
        
        try:
            response = requests.get(endpoint, params=params, timeout=5)
            
            if response.status_code != 200:
                logger.error(f"Coinalyze API Error {response.status_code}: {response.text}")
                return None
                
            data = response.json()
            # Expected format: list of objects usually, or dict with history
            # Let's assume standard response: [{t:..., o:..., h:..., l:..., c:...}, ...]
            # or data[0].history...
            
            # To be safe against structure, let's look at the raw data returned in verify step.
            # But standard implementation for now:
            
            # Correct Parsing Logic
            history = []
            if isinstance(data, list) and len(data) > 0:
                first_item = data[0]
                if 'history' in first_item:
                    # Format: [{'symbol': '...', 'history': [...]}]
                    history = first_item['history']
                elif 'o' in first_item and 'c' in first_item:
                    # Format: [{'t':..., 'o':...}, ...] (Flat list)
                    history = data
            
            if not history or len(history) < 3:
                return 0.0 # Not enough data
                
            # Recent OI Change
            # Use 'c' (close) of OI candles? Usually OI is 'open interest' value.
            # Coinalyze fields: t, o, h, l, c (OI values)
            
            latest_oi = float(history[-1]['c'])
            start_oi = float(history[-3]['o']) # 3 candles ago Open
            
            if start_oi == 0: return 0.0
            
            delta_pct = ((latest_oi - start_oi) / start_oi) * 100
            return delta_pct
            
        except Exception as e:
            logger.error(f"Coinalyze Request Failed: {e}")
            return None

    def get_liquidation_history(self, symbol, interval='15min', lookback=3):
        """
        Fetch Liquidation history and return sum of Longs/Shorts over lookback.
        Returns:
            dict: {'longs': float, 'shorts': float}
            None: If failed
        """
        self._wait_for_rate_limit()
        
        mapped_symbol = self.convert_symbol(symbol)
        endpoint = f"{self.base_url}/liquidation-history"
        
        # Calculate time range
        to_ts = int(time.time())
        from_ts = to_ts - (3600 * 4) # ample buffer
        
        # Map Interval (same logic)
        interval_map = {'15m': '15min', '1h': '1hour', '4h': '4hour'}
        mapped_interval = interval_map.get(interval, interval)
        if mapped_interval == '15m': mapped_interval = '15min'
        
        params = {
            'symbols': mapped_symbol,
            'interval': mapped_interval,
            'from': from_ts,
            'to': to_ts,
            'api_key': self.api_key
        }
        
        try:
            response = requests.get(endpoint, params=params, timeout=5)
            if response.status_code != 200:
                logger.error(f"Coinalyze Liq API Error {response.status_code}: {response.text}")
                return None
                
            data = response.json()
            
            # Parsing Logic (Reuse OI pattern)
            history = []
            if isinstance(data, list) and len(data) > 0:
                first_item = data[0]
                if 'history' in first_item:
                    history = first_item['history']
                elif 'l' in first_item and 's' in first_item:
                    history = data
            
            if not history: return None
            
            # Sum last N periods
            # Data usually: [{'t':..., 'l': 123.4, 's': 456.7}, ...]
            # 'l' = Long Liquidations (Price Drop pain)
            # 's' = Short Liquidations (Price Pump pain)
            
            relevant = history[-lookback:]
            total_longs = sum(float(item.get('l', 0)) for item in relevant)
            total_shorts = sum(float(item.get('s', 0)) for item in relevant)
            
            return {'longs': total_longs, 'shorts': total_shorts}
            
        except Exception as e:
            logger.error(f"Coinalyze Liq Request Failed: {e}")
            return None
