import requests
import time
import logging
import json
import os

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class CoinalyzeClient:
    def __init__(self, api_key):
        self.api_key = api_key
        self.base_url = "https://api.coinalyze.net/v1"
        self.last_req_time = 0
        self.req_interval = 2.0  # 30 requests/min max to be safe (limit is 40)
        self.cache_file = "data/coinalyze_cache.json"
        self.cache_ttl = 900  # 15 minutes in seconds
        self._cache = self._load_cache()

    def _load_cache(self):
        """Load cache from disk"""
        try:
            if os.path.exists(self.cache_file):
                with open(self.cache_file, 'r') as f:
                    return json.load(f)
        except Exception as e:
            logger.error(f"Cache load error: {e}")
        return {}

    def _save_cache(self):
        """Save cache to disk"""
        try:
            os.makedirs(os.path.dirname(self.cache_file), exist_ok=True)
            with open(self.cache_file, 'w') as f:
                json.dump(self._cache, f)
        except Exception as e:
            logger.error(f"Cache save error: {e}")

    def _get_cached(self, key):
        """Get cached data if valid"""
        if key in self._cache:
            entry = self._cache[key]
            if time.time() - entry.get('timestamp', 0) < self.cache_ttl:
                return entry.get('data')
        return None

    def _set_cached(self, key, data):
        """Set cache entry"""
        self._cache[key] = {
            'timestamp': time.time(),
            'data': data
        }
        self._save_cache()

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
        clean = symbol.upper().replace('.csv', '').replace('_15m', '')
        
        if not clean.endswith('_PERP.A'):
            return f"{clean}_PERP.A"
        return clean

    def get_open_interest_history(self, symbol, interval='15m', lookback_hours=24):
        """
        Fetch Open Interest history and return time series for slope calculation.
        Uses cache to reduce API calls.
        
        Returns:
            list: OI history [{'t': timestamp, 'o': oi_open, 'c': oi_close}, ...]
            None: If request failed
        """
        cache_key = f"{symbol}_{interval}_oi"
        
        # Check cache first
        cached = self._get_cached(cache_key)
        if cached:
            logger.info(f"Using cached OI for {symbol}")
            return cached
        
        self._wait_for_rate_limit()
        
        mapped_symbol = self.convert_symbol(symbol)
        
        # Map Interval
        interval_map = {'15m': '15min', '1h': '1hour', '4h': '4hour'}
        mapped_interval = interval_map.get(interval, interval)
        if mapped_interval == '15m': mapped_interval = '15min'
        
        endpoint = f"{self.base_url}/open-interest-history"
        
        # Calculate 'from' timestamp
        to_ts = int(time.time())
        from_ts = to_ts - (lookback_hours * 3600)
        
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
            
            # Parse response
            history = []
            if isinstance(data, list) and len(data) > 0:
                first_item = data[0]
                if 'history' in first_item:
                    history = first_item['history']
                elif 'o' in first_item and 'c' in first_item:
                    history = data
            
            if not history:
                return None
            
            # Cache the result
            self._set_cached(cache_key, history)
            
            return history
            
        except Exception as e:
            logger.error(f"Coinalyze OI Request Failed: {e}")
            return None

    def get_open_interest_delta(self, symbol, interval='15m'):
        """
        Fetch OI and return % change over last 3 periods.
        DEPRECATED: Use get_open_interest_history() for slope calculations.
        """
        history = self.get_open_interest_history(symbol, interval, lookback_hours=1)
        
        if not history or len(history) < 3:
            return 0.0
            
        latest_oi = float(history[-1]['c'])
        start_oi = float(history[-3]['o'])
        
        if start_oi == 0: return 0.0
        
        delta_pct = ((latest_oi - start_oi) / start_oi) * 100
        return delta_pct

    # ... rest of liquidation methods unchanged ...
