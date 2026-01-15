"""
Coinalyze Symbol Resolver
Fetches and caches the official symbol mappings from Coinalyze API.
Provides intelligent fallback to aggregated symbols when exchange-specific data is unavailable.
"""

import os
import json
import time
import requests
from typing import Dict, Optional, Tuple
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables
load_dotenv()


class CoinalyzeResolver:
    """
    Resolves local symbols to Coinalyze symbols with intelligent fallback.
    
    Priority:
    1. Exchange-specific symbol (e.g., BTCUSDT.6 for MEXC)
    2. Aggregated symbol (e.g., BTCUSDT_PERP.A)
    3. Neutral (no data available)
    """
    
    CACHE_FILE = "data/coinalyze_symbols.json"
    CACHE_DURATION = 24 * 60 * 60  # 24 hours in seconds
    API_URL = "https://api.coinalyze.net/v1/future-markets"
    
    # Exchange ID mapping (from Coinalyze docs)
    EXCHANGE_IDS = {
        'BINANCE': '.4',
        'BYBIT': '.5',
        'MEXC': '.6',
        'KUCOIN': '.8',
        'HYPERLIQUID': '.C',
        'OKX': '.3',
        'BITGET': '.B',
        'DERIBIT': '.2',
        'BITMEX': '.1'
    }
    
    def __init__(self):
        self.symbol_map: Dict[str, Dict] = {}
        self.aggregated_symbols: Dict[str, str] = {}
        self.exchange_symbols: Dict[str, Dict[str, str]] = {}
        self.cache_timestamp: Optional[float] = None
        
        # Load from cache if available
        self._load_cache()
    
    def _load_cache(self) -> bool:
        """Load symbol mappings from cache if valid."""
        if not os.path.exists(self.CACHE_FILE):
            return False
        
        try:
            with open(self.CACHE_FILE, 'r') as f:
                cache_data = json.load(f)
            
            cache_age = time.time() - cache_data.get('timestamp', 0)
            
            if cache_age < self.CACHE_DURATION:
                self.symbol_map = cache_data.get('symbol_map', {})
                self.aggregated_symbols = cache_data.get('aggregated_symbols', {})
                self.exchange_symbols = cache_data.get('exchange_symbols', {})
                self.cache_timestamp = cache_data.get('timestamp')
                
                print(f"[RESOLVER] Loaded {len(self.symbol_map)} symbols from cache (age: {cache_age/3600:.1f}h)")
                return True
            else:
                print(f"[RESOLVER] Cache expired (age: {cache_age/3600:.1f}h)")
                return False
        
        except Exception as e:
            print(f"[RESOLVER] Failed to load cache: {e}")
            return False
    
    def _save_cache(self):
        """Save symbol mappings to cache."""
        try:
            os.makedirs(os.path.dirname(self.CACHE_FILE), exist_ok=True)
            
            cache_data = {
                'timestamp': time.time(),
                'symbol_map': self.symbol_map,
                'aggregated_symbols': self.aggregated_symbols,
                'exchange_symbols': self.exchange_symbols
            }
            
            temp_file = self.CACHE_FILE + '.tmp'
            with open(temp_file, 'w') as f:
                json.dump(cache_data, f, indent=2)
            
            os.replace(temp_file, self.CACHE_FILE)
            print(f"[RESOLVER] Saved {len(self.symbol_map)} symbols to cache")
        
        except Exception as e:
            print(f"[RESOLVER] Failed to save cache: {e}")
    
    def fetch_symbols(self) -> bool:
        """
        Fetch symbol mappings from Coinalyze API.
        Returns True if successful, False otherwise.
        """
        try:
            api_key = os.environ.get('COINALYZE_API_KEY')
            if not api_key:
                print(f"[RESOLVER] No API key found, cannot fetch symbols")
                return False
            
            print(f"[RESOLVER] Fetching symbols from {self.API_URL}")
            
            headers = {'api_key': api_key}
            response = requests.get(self.API_URL, headers=headers, timeout=30)
            response.raise_for_status()
            
            markets = response.json()
            print(f"[RESOLVER] Received {len(markets)} markets from API")
            
            # Process markets
            for market in markets:
                symbol = market.get('symbol', '')
                base = market.get('base_asset', '')
                quote = market.get('quote_asset', '')
                exchange_id = market.get('exchange', '')
                
                if not symbol or not base:
                    continue
                
                # Build normalized base symbol (e.g., BTCUSDT)
                normalized = f"{base}{quote}" if quote else base
                
                # Store full market info
                self.symbol_map[symbol] = {
                    'symbol': symbol,
                    'base': base,
                    'quote': quote,
                    'normalized': normalized,
                    'exchange_id': exchange_id
                }
                
                # Track aggregated symbols (suffix .A)
                if symbol.endswith('.A'):
                    self.aggregated_symbols[normalized] = symbol
                
                # Track exchange-specific symbols
                if exchange_id:
                    if normalized not in self.exchange_symbols:
                        self.exchange_symbols[normalized] = {}
                    self.exchange_symbols[normalized][exchange_id] = symbol
            
            print(f"[RESOLVER] Processed {len(self.aggregated_symbols)} aggregated symbols")
            print(f"[RESOLVER] Processed {len(self.exchange_symbols)} unique base symbols")
            
            # Save to cache
            self._save_cache()
            
            return True
        
        except Exception as e:
            print(f"[RESOLVER] Failed to fetch symbols: {e}")
            return False
    
    def resolve(self, symbol: str, exchange: str) -> Tuple[Optional[str], str]:
        """
        Resolve a local symbol to Coinalyze symbol.
        
        Args:
            symbol: Local symbol (e.g., BTCUSDT, MAVUSDT)
            exchange: Exchange name (e.g., BINANCE, MEXC)
        
        Returns:
            Tuple of (coinalyze_symbol, status)
            status: "resolved" | "aggregated" | "neutral"
        """
        # Normalize symbol (remove common suffixes)
        normalized = symbol.upper().replace('USDT', 'USDT').replace('USDTM', 'USDT')
        exchange_upper = exchange.upper()
        
        # Priority 1: Exchange-specific symbol
        exchange_id = self.EXCHANGE_IDS.get(exchange_upper)
        if exchange_id and normalized in self.exchange_symbols:
            if exchange_id in self.exchange_symbols[normalized]:
                coinalyze_symbol = self.exchange_symbols[normalized][exchange_id]
                return coinalyze_symbol, "resolved"
        
        # Priority 2: Aggregated symbol
        if normalized in self.aggregated_symbols:
            coinalyze_symbol = self.aggregated_symbols[normalized]
            return coinalyze_symbol, "aggregated"
        
        # Priority 3: Neutral (no data)
        return None, "neutral"
    
    def resolve_batch(self, symbols: list) -> Dict[str, Tuple[Optional[str], str]]:
        """
        Resolve multiple symbols at once.
        
        Args:
            symbols: List of (symbol, exchange) tuples
        
        Returns:
            Dict mapping (symbol, exchange) -> (coinalyze_symbol, status)
        """
        results = {}
        for symbol, exchange in symbols:
            key = f"{symbol}_{exchange}"
            results[key] = self.resolve(symbol, exchange)
        return results
    
    def get_batch_symbols(self, symbols: list, max_batch_size: int = 20) -> list:
        """
        Get Coinalyze symbols for batch API requests.
        
        Args:
            symbols: List of (symbol, exchange) tuples
            max_batch_size: Maximum symbols per batch
        
        Returns:
            List of batches, where each batch is a list of resolved Coinalyze symbols
        """
        resolved = []
        metadata = []
        
        for symbol, exchange in symbols:
            coinalyze_symbol, status = self.resolve(symbol, exchange)
            if coinalyze_symbol:
                resolved.append(coinalyze_symbol)
                metadata.append({
                    'local_symbol': symbol,
                    'exchange': exchange,
                    'coinalyze_symbol': coinalyze_symbol,
                    'status': status
                })
        
        # Split into batches
        batches = []
        for i in range(0, len(resolved), max_batch_size):
            batch_symbols = resolved[i:i + max_batch_size]
            batch_metadata = metadata[i:i + max_batch_size]
            batches.append({
                'symbols': batch_symbols,
                'metadata': batch_metadata
            })
        
        return batches
    
    def ensure_initialized(self) -> bool:
        """
        Ensure resolver is initialized with symbol mappings.
        Fetches from API if cache is invalid.
        
        Returns:
            True if initialized successfully, False otherwise.
        """
        if self.symbol_map:
            return True
        
        # Try to load from cache
        if self._load_cache():
            return True
        
        # Fetch from API
        return self.fetch_symbols()


# Global singleton instance
_resolver_instance: Optional[CoinalyzeResolver] = None


def get_resolver() -> CoinalyzeResolver:
    """Get or create the global resolver instance."""
    global _resolver_instance
    if _resolver_instance is None:
        _resolver_instance = CoinalyzeResolver()
        _resolver_instance.ensure_initialized()
    return _resolver_instance
