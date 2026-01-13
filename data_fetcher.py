import requests
import time
import logging

# Configure logging
import logging
import json
import os
import hashlib

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class CoinalyzeClient:
    def __init__(self, api_key):
        self.api_key = api_key
        self.base_url = "https://api.coinalyze.net/v1"
        self.last_req_time = 0
        self.req_interval = 2.2  # Slightly increased to be safer (limit is 40/min)
        self.cache_dir = "data/coinalyze_cache"
        self.cache_ttl = 900  # 15 minutes in seconds

        # Ensure cache directory exists
        if not os.path.exists(self.cache_dir):
            os.makedirs(self.cache_dir, exist_ok=True)

    def _get_cache_key(self, prefix, symbol, **kwargs):
        """Generate a unique cache filename based on parameters."""
        # Create a stable string representation of kwargs
        param_str = json.dumps(kwargs, sort_keys=True)
        # Hash it to keep filename short
        param_hash = hashlib.md5(param_str.encode()).hexdigest()[:8]
        # Clean symbol
        safe_symbol = symbol.replace('/', '').replace(':', '')
        return f"{prefix}_{safe_symbol}_{param_hash}.json"

    def _get_from_cache(self, filename):
        """Retrieve data from cache if valid."""
        path = os.path.join(self.cache_dir, filename)
        if not os.path.exists(path):
            return None
            
        try:
            # Check modification time
            mtime = os.path.getmtime(path)
            if (time.time() - mtime) > self.cache_ttl:
                return None # Expired
                
            with open(path, 'r') as f:
                return json.load(f)
        except Exception as e:
            logger.warning(f"Cache Read Error ({filename}): {e}")
            return None

    def _save_to_cache(self, filename, data):
        """Save data to cache."""
        path = os.path.join(self.cache_dir, filename)
        try:
            with open(path, 'w') as f:
                json.dump(data, f)
        except Exception as e:
            logger.warning(f"Cache Write Error ({filename}): {e}")


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
        """
        # Note: This method reuses get_open_interest_history logic implicitly or explicitly.
        # But for now I'll wrap the existing logic with a simple cache since it doesn't call the other method?
        # Actually, let's cache the RESULT of this calculation or the raw request?
        # Raw request is better for reusability.
        
        # This method duplicates a lot of request logic. 
        # For simplicity and robust caching, I will cache the RAW REQUEST response.
        
        mapped_symbol = self.convert_symbol(symbol)
        
        # Map Interval
        interval_map = {'15m': '15min', '1h': '1hour', '4h': '4hour'}
        mapped_interval = interval_map.get(interval, interval)
        if mapped_interval == '15m': mapped_interval = '15min'
        
        # Calculate 'from' timestamp (rounded to hour to improve cache hit rate?)
        # No, 'from' depends on 'now'. This makes caching hard if 'now' changes every second.
        # FIX: Align 'to_ts' to the nearest 15-minute block?
        # If we align timestamps, we get cache hits.
        
        now = int(time.time())
        # snap to previous 15m candle close
        to_ts = now - (now % 900) 
        from_ts = to_ts - 3600
        
        cache_filename = self._get_cache_key("oi_delta", mapped_symbol, interval=mapped_interval, t=to_ts)
        cached_data = self._get_from_cache(cache_filename)
        
        data = None
        if cached_data:
             data = cached_data
        else:
             self._wait_for_rate_limit()
             endpoint = f"{self.base_url}/open-interest-history"
             params = {
                'symbols': mapped_symbol,
                'interval': mapped_interval,
                'from': from_ts,
                'to': to_ts,
                'api_key': self.api_key
             }
             try:
                response = requests.get(endpoint, params=params, timeout=5)
                if response.status_code == 200:
                    data = response.json()
                    self._save_to_cache(cache_filename, data)
                else:
                    logger.error(f"Coinalyze API Error {response.status_code}: {response.text}")
                    return None
             except Exception as e:
                logger.error(f"Coinalyze Request Failed: {e}")
                return None

        # Process Data (unchanged logic)
        try:
             # Expected format processing...
                

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
        mapped_symbol = self.convert_symbol(symbol)
        
        # Align time to improve caching
        now = int(time.time())
        to_ts = now - (now % 900)
        from_ts = to_ts - (3600 * 4)
        
        # Map Interval
        interval_map = {'15m': '15min', '1h': '1hour', '4h': '4hour'}
        mapped_interval = interval_map.get(interval, interval)
        if mapped_interval == '15m': mapped_interval = '15min'

        cache_filename = self._get_cache_key("liqs", mapped_symbol, interval=mapped_interval, t=to_ts)
        cached_data = self._get_from_cache(cache_filename)
        
        data = None
        if cached_data:
            data = cached_data
        else:
            self._wait_for_rate_limit()
            endpoint = f"{self.base_url}/liquidation-history"
            params = {
                'symbols': mapped_symbol,
                'interval': mapped_interval,
                'from': from_ts,
                'to': to_ts,
                'api_key': self.api_key
            }
            try:
                response = requests.get(endpoint, params=params, timeout=5)
                if response.status_code == 200:
                    data = response.json()
                    self._save_to_cache(cache_filename, data)
                else:
                    logger.error(f"Coinalyze Liq API Error {response.status_code}: {response.text}")
                    return None
            except Exception as e:
                logger.error(f"Coinalyze Liq Request Failed: {e}")
                return None
            
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
            


    def get_open_interest_history(self, symbol, hours=24):
        mapped_symbol = self.convert_symbol(symbol)
        
        now = int(time.time())
        to_ts = now - (now % 900)
        from_ts = to_ts - (int(hours) * 3600)
        
        cache_filename = self._get_cache_key("oi_hist", mapped_symbol, hours=hours, t=to_ts)
        cached_data = self._get_from_cache(cache_filename)
        
        data = None
        if cached_data:
            data = cached_data
        else:
            self._wait_for_rate_limit()
            endpoint = f"{self.base_url}/open-interest-history"
            params = {
                'symbols': mapped_symbol,
                'interval': '15min',
                'from': from_ts,
                'to': to_ts,
                'api_key': self.api_key
            }
            try:
                response = requests.get(endpoint, params=params, timeout=5)
                if response.status_code == 200:
                    data = response.json()
                    self._save_to_cache(cache_filename, data)
                else:
                    logger.error(f"Coinalyze OI Hist Error {response.status_code}: {response.text}")
                    return None
            except Exception as e:
                logger.error(f"Coinalyze OI Hist Request Failed: {e}")
                return None
            history_data = []
            
            # Parsing Logic
            if isinstance(data, list) and len(data) > 0:
                first_item = data[0]
                if 'history' in first_item:
                    # Format: [{'t': 123, 'o':..., 'c':...}, ...]
                    # We use 'c' (close) as the OI value
                    for h in first_item['history']:
                        history_data.append({
                            'timestamp': h['t'],
                            'value': float(h['c']) 
                        })
                        
            return history_data
            


    def get_funding_rate(self, symbol):
        """
        Fetch current predicted/avg funding rate.
        """
        mapped_symbol = self.convert_symbol(symbol)
        # Predicted funding is usually very volatile, but 15m cache is likely acceptable for "filtering".
        # If user wants STRICT LIVE funding, we might lower TTL for this specific call, or keep simple 15m.
        # Given the "Funding > 0.05%" rule, 15m old data is probably safe.
        
        cache_filename = self._get_cache_key("funding", mapped_symbol)
        cached_data = self._get_from_cache(cache_filename)
        
        data = None
        if cached_data:
            data = cached_data
        else:
            self._wait_for_rate_limit()
            endpoint = f"{self.base_url}/predicted-funding-rate"
            try:
                response = requests.get(endpoint, params={'symbols': mapped_symbol, 'api_key': self.api_key}, timeout=5)
                if response.status_code == 200:
                    data = response.json()
                    self._save_to_cache(cache_filename, data)
                else:
                    return None
            except:
                return None
            
        if isinstance(data, list) and len(data) > 0:
            return float(data[0].get('pf', 0))
        return None

    def get_ls_ratio_top_traders(self, symbol):
        """
        Fetch Long/Short Ratio of Top Traders.
        Returns float (e.g. 1.5) or None.
        """
        mapped_symbol = self.convert_symbol(symbol)
        
        now = int(time.time())
        to_ts = now - (now % 900)
        from_ts = to_ts - 3600
        
        cache_filename = self._get_cache_key("ls_top", mapped_symbol, t=to_ts)
        cached_data = self._get_from_cache(cache_filename)
        
        data = None
        if cached_data:
            data = cached_data
        else:
            self._wait_for_rate_limit()
            endpoint = f"{self.base_url}/long-short-ratio-history"
            params = {
                'symbols': mapped_symbol,
                'interval': '15min',
                'from': from_ts,
                'to': to_ts,
                'api_key': self.api_key
            }
            try:
                response = requests.get(endpoint, params=params, timeout=5)
                if response.status_code == 200:
                    data = response.json()
                    self._save_to_cache(cache_filename, data)
                else:
                    return None
            except:
                return None
        
        # Process Data
        if data is None: return None

        try:
            if isinstance(data, list) and len(data) > 0:
                first = data[0] # Coinalyze returns list of objects
                if 'history' in first:
                    hist = first['history']
                    if hist:
                        last = hist[-1]
                        l = float(last.get('l', 0))
                        s = float(last.get('s', 0))
                        if s > 0:
                            return l / s
                        return 1.0
            return None
        except:
            return None
