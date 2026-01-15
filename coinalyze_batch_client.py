"""
Coinalyze Batch Client
High-performance batch API client for Coinalyze data.
Reduces 1100+ individual calls to ~55 batch calls (20x improvement).
"""

import requests
import time
import logging
import json
import os
import hashlib
from typing import Dict, List, Optional, Any

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


class CoinalyzeBatchClient:
    """
    Batch-enabled Coinalyze API client.
    Supports fetching data for up to 20 symbols per request.
    """
    
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.base_url = "https://api.coinalyze.net/v1"
        self.last_req_time = 0
        self.req_interval = 2.2  # Rate limit: 40 requests/min
        self.cache_dir = "data/coinalyze_cache"
        self.cache_ttl = 900  # 15 minutes
        
        os.makedirs(self.cache_dir, exist_ok=True)
    
    def _wait_for_rate_limit(self):
        """Enforce rate limit."""
        elapsed = time.time() - self.last_req_time
        if elapsed < self.req_interval:
            time.sleep(self.req_interval - elapsed)
        self.last_req_time = time.time()
    
    def _get_cache_key(self, prefix: str, symbols: List[str], **kwargs) -> str:
        """Generate cache key for batch request."""
        symbols_str = ','.join(sorted(symbols))
        param_str = json.dumps(kwargs, sort_keys=True)
        param_hash = hashlib.md5((symbols_str + param_str).encode()).hexdigest()[:8]
        return f"{prefix}_batch_{param_hash}.json"
    
    def _get_from_cache(self, filename: str) -> Optional[Any]:
        """Retrieve from cache if valid."""
        path = os.path.join(self.cache_dir, filename)
        if not os.path.exists(path):
            return None
        
        try:
            mtime = os.path.getmtime(path)
            if (time.time() - mtime) > self.cache_ttl:
                return None
            
            with open(path, 'r') as f:
                return json.load(f)
        except Exception as e:
            logger.warning(f"Cache read error ({filename}): {e}")
            return None
    
    def _save_to_cache(self, filename: str, data: Any):
        """Save to cache."""
        path = os.path.join(self.cache_dir, filename)
        try:
            with open(path, 'w') as f:
                json.dump(data, f)
        except Exception as e:
            logger.warning(f"Cache write error ({filename}): {e}")
    
    def get_open_interest_history_batch(
        self,
        symbols: List[str],
        hours: int = 24
    ) -> Dict[str, List[Dict]]:
        """
        Fetch OI history for multiple symbols in one request.
        
        Args:
            symbols: List of Coinalyze symbols (max 20)
            hours: Lookback period
        
        Returns:
            Dict mapping symbol -> history data
        """
        if len(symbols) > 20:
            raise ValueError("Maximum 20 symbols per batch request")
        
        now = int(time.time())
        to_ts = now - (now % 900)
        from_ts = to_ts - (hours * 3600)
        
        cache_filename = self._get_cache_key("oi_hist", symbols, hours=hours, t=to_ts)
        cached_data = self._get_from_cache(cache_filename)
        
        if cached_data:
            return cached_data
        
        # Make batch API request
        self._wait_for_rate_limit()
        endpoint = f"{self.base_url}/open-interest-history"
        params = {
            'symbols': ','.join(symbols),
            'interval': '15min',
            'from': from_ts,
            'to': to_ts,
            'api_key': self.api_key
        }
        
        try:
            response = requests.get(endpoint, params=params, timeout=30)
            if response.status_code != 200:
                logger.error(f"OI Batch API Error {response.status_code}: {response.text}")
                return {}
            
            data = response.json()
            
            # Parse batch response
            result = {}
            if isinstance(data, list):
                for item in data:
                    symbol = item.get('symbol', '')
                    if not symbol or 'history' not in item:
                        continue
                    
                    history_data = []
                    for h in item['history']:
                        history_data.append({
                            'timestamp': h['t'],
                            'value': float(h['c'])
                        })
                    
                    result[symbol] = history_data
            
            # Cache the result
            self._save_to_cache(cache_filename, result)
            return result
        
        except Exception as e:
            logger.error(f"OI Batch Request Failed: {e}")
            return {}
    
    def get_funding_rate_batch(self, symbols: List[str]) -> Dict[str, float]:
        """
        Fetch funding rates for multiple symbols.
        
        Args:
            symbols: List of Coinalyze symbols (max 20)
        
        Returns:
            Dict mapping symbol -> funding rate
        """
        if len(symbols) > 20:
            raise ValueError("Maximum 20 symbols per batch request")
        
        cache_filename = self._get_cache_key("funding", symbols)
        cached_data = self._get_from_cache(cache_filename)
        
        if cached_data:
            return cached_data
        
        # Make batch API request
        self._wait_for_rate_limit()
        endpoint = f"{self.base_url}/predicted-funding-rate"
        params = {
            'symbols': ','.join(symbols),
            'api_key': self.api_key
        }
        
        try:
            response = requests.get(endpoint, params=params, timeout=30)
            if response.status_code != 200:
                logger.error(f"Funding Batch API Error {response.status_code}")
                return {}
            
            data = response.json()
            
            # Parse batch response
            result = {}
            if isinstance(data, list):
                for item in data:
                    symbol = item.get('symbol', '')
                    if symbol:
                        result[symbol] = float(item.get('pf', 0))
            
            # Cache the result
            self._save_to_cache(cache_filename, result)
            return result
        
        except Exception as e:
            logger.error(f"Funding Batch Request Failed: {e}")
            return {}
    
    def get_ls_ratio_batch(self, symbols: List[str]) -> Dict[str, float]:
        """
        Fetch Long/Short ratios for multiple symbols.
        
        Args:
            symbols: List of Coinalyze symbols (max 20)
        
        Returns:
            Dict mapping symbol -> L/S ratio
        """
        if len(symbols) > 20:
            raise ValueError("Maximum 20 symbols per batch request")
        
        now = int(time.time())
        to_ts = now - (now % 900)
        from_ts = to_ts - 3600
        
        cache_filename = self._get_cache_key("ls_ratio", symbols, t=to_ts)
        cached_data = self._get_from_cache(cache_filename)
        
        if cached_data:
            return cached_data
        
        # Make batch API request
        self._wait_for_rate_limit()
        endpoint = f"{self.base_url}/long-short-ratio-history"
        params = {
            'symbols': ','.join(symbols),
            'interval': '15min',
            'from': from_ts,
            'to': to_ts,
            'api_key': self.api_key
        }
        
        try:
            response = requests.get(endpoint, params=params, timeout=30)
            if response.status_code != 200:
                logger.error(f"L/S Batch API Error {response.status_code}")
                return {}
            
            data = response.json()
            
            # Parse batch response
            result = {}
            if isinstance(data, list):
                for item in data:
                    symbol = item.get('symbol', '')
                    if not symbol or 'history' not in item:
                        continue
                    
                    hist = item['history']
                    if hist:
                        last = hist[-1]
                        l = float(last.get('l', 0))
                        s = float(last.get('s', 0))
                        if s > 0:
                            result[symbol] = l / s
                        else:
                            result[symbol] = 1.0
            
            # Cache the result
            self._save_to_cache(cache_filename, result)
            return result
        
        except Exception as e:
            logger.error(f"L/S Batch Request Failed: {e}")
            return {}
    
    def get_liquidations_batch(
        self,
        symbols: List[str],
        hours: int = 24
    ) -> Dict[str, Dict[str, float]]:
        """
        Fetch liquidation data for multiple symbols.
        
        Args:
            symbols: List of Coinalyze symbols (max 20)
            hours: Lookback period
        
        Returns:
            Dict mapping symbol -> {'longs': float, 'shorts': float}
        """
        if len(symbols) > 20:
            raise ValueError("Maximum 20 symbols per batch request")
        
        now = int(time.time())
        to_ts = now - (now % 900)
        from_ts = to_ts - (hours * 3600)
        
        cache_filename = self._get_cache_key("liquidations", symbols, hours=hours, t=to_ts)
        cached_data = self._get_from_cache(cache_filename)
        
        if cached_data:
            return cached_data
        
        # Make batch API request
        self._wait_for_rate_limit()
        endpoint = f"{self.base_url}/liquidation-history"
        params = {
            'symbols': ','.join(symbols),
            'interval': '15min',
            'from': from_ts,
            'to': to_ts,
            'api_key': self.api_key
        }
        
        try:
            response = requests.get(endpoint, params=params, timeout=30)
            if response.status_code != 200:
                logger.error(f"Liquidations Batch API Error {response.status_code}")
                return {}
            
            data = response.json()
            
            # Parse batch response
            result = {}
            if isinstance(data, list):
                for item in data:
                    symbol = item.get('symbol', '')
                    if not symbol or 'history' not in item:
                        continue
                    
                    history = item['history']
                    lookback = min(len(history), 4)  # Last 4 periods (1 hour)
                    relevant = history[-lookback:]
                    
                    total_longs = sum(float(h.get('l', 0)) for h in relevant)
                    total_shorts = sum(float(h.get('s', 0)) for h in relevant)
                    
                    result[symbol] = {
                        'longs': total_longs,
                        'shorts': total_shorts
                    }
            
            # Cache the result
            self._save_to_cache(cache_filename, result)
            return result
        
        except Exception as e:
            logger.error(f"Liquidations Batch Request Failed: {e}")
            return {}
    
    def fetch_all_data_batch(
        self,
        symbols: List[str]
    ) -> Dict[str, Dict[str, Any]]:
        """
        Fetch all data types for a batch of symbols in parallel.
        
        Args:
            symbols: List of Coinalyze symbols (max 20)
        
        Returns:
            Dict mapping symbol -> {oi_history, funding_rate, ls_ratio, liquidations}
        """
        if len(symbols) > 20:
            raise ValueError("Maximum 20 symbols per batch request")
        
        # Fetch all data types
        oi_data = self.get_open_interest_history_batch(symbols)
        funding_data = self.get_funding_rate_batch(symbols)
        ls_data = self.get_ls_ratio_batch(symbols)
        liq_data = self.get_liquidations_batch(symbols)
        
        # Combine results
        result = {}
        for symbol in symbols:
            result[symbol] = {
                'oi_history': oi_data.get(symbol, []),
                'funding_rate': funding_data.get(symbol),
                'ls_ratio': ls_data.get(symbol),
                'liquidations': liq_data.get(symbol, {'longs': 0, 'shorts': 0})
            }
        
        return result


# Global singleton instance
_batch_client_instance: Optional[CoinalyzeBatchClient] = None


def get_batch_client(api_key: Optional[str] = None) -> CoinalyzeBatchClient:
    """Get or create the global batch client instance."""
    global _batch_client_instance
    if _batch_client_instance is None:
        if api_key is None:
            api_key = os.getenv('COINALYZE_API_KEY')
        if not api_key:
            raise ValueError("COINALYZE_API_KEY not found")
        _batch_client_instance = CoinalyzeBatchClient(api_key)
    return _batch_client_instance
