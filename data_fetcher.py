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
            
            return {'longs': total_longs, 'shorts': total_shorts}
            
        except Exception as e:
            logger.error(f"Coinalyze Liq Request Failed: {e}")
            return None

    def get_open_interest_history(self, symbol, hours=24):
        """
        Fetch full Open Interest history compatible with Strategies.py
        Returns list of dicts: [{'timestamp': 123, 'value': 456}, ...]
        """
        self._wait_for_rate_limit()
        mapped_symbol = self.convert_symbol(symbol)
        endpoint = f"{self.base_url}/open-interest-history"
        
        to_ts = int(time.time())
        from_ts = to_ts - (int(hours) * 3600)
        
        params = {
            'symbols': mapped_symbol,
            'interval': '15min', # Defaulting to 15m resolution
            'from': from_ts,
            'to': to_ts,
            'api_key': self.api_key
        }
        
        try:
            response = requests.get(endpoint, params=params, timeout=5)
            if response.status_code != 200:
                logger.error(f"Coinalyze OI Hist Error {response.status_code}: {response.text}")
                return None
                
            data = response.json()
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
            
        except Exception as e:
            logger.error(f"Coinalyze OI Hist Request Failed: {e}")
            return None

    def get_funding_rate(self, symbol):
        """
        Fetch current predicted/avg funding rate.
        Returns float (e.g., 0.0001 for 0.01%) or None.
        """
        self._wait_for_rate_limit()
        mapped_symbol = self.convert_symbol(symbol)
        endpoint = f"{self.base_url}/funding-rate" # Check endpoint if history or current
        # Coinalyze has /predicted-funding-rate and /funding-rate-history
        
        # We'll use predicted for live check
        endpoint = f"{self.base_url}/predicted-funding-rate"
        
        try:
            response = requests.get(endpoint, params={'symbols': mapped_symbol, 'api_key': self.api_key}, timeout=5)
            if response.status_code != 200:
                return None
            
            data = response.json()
            # Format: [{"symbol":"BTCUSDT_PERP.A","pf":0.000100,...}]
            if isinstance(data, list) and len(data) > 0:
                return float(data[0].get('pf', 0))
            return None
        except:
             return None

    def get_ls_ratio_top_traders(self, symbol):
        """
        Fetch Long/Short Ratio of Top Traders.
        Returns float (e.g. 1.5) or None.
        """
        self._wait_for_rate_limit()
        mapped_symbol = self.convert_symbol(symbol)
        # Verify specific endpoint. 'long-short-ratio-history' usually.
        endpoint = f"{self.base_url}/long-short-ratio-history"
        
        to_ts = int(time.time())
        from_ts = to_ts - 3600 # Last hour
        
        params = {
            'symbols': mapped_symbol,
            'interval': '15min',
            'from': from_ts,
            'to': to_ts,
            'api_key': self.api_key
        }
        
        try:
            response = requests.get(endpoint, params=params, timeout=5)
            if response.status_code != 200: return None
            
            data = response.json()
            # Need ratio. Usually 'l' (longs) and 's' (shorts) % or ratio directly?
            # Coinalyze documentation usually returns ratio in 'v' or separate l/s.
            # Let's assume ratio is implicitly l/s or provided.
            # Actually, standard LS endpoint gives: ratio.
            
            if isinstance(data, list) and len(data) > 0 and 'history' in data[0]:
                hist = data[0]['history']
                if hist:
                    last = hist[-1]
                    # 'l' and 's' are ratios or percentages?
                    # Usually it's: l: 60.5, s: 39.5.
                    l = float(last.get('l', 0))
                    s = float(last.get('s', 0))
                    if s > 0:
                        return l / s
                    return 1.0
            return None
        except:
            return None
