"""
Symbol Mapper - Canonical Symbol Normalization
Converts exchange-specific tickers to canonical symbols for unified analysis.
"""

import re
from typing import Dict, Optional


class SymbolMapper:
    """
    Normalizes exchange-specific symbols to canonical base symbols.
    
    Examples:
        BTCUSDT -> BTC
        BTCUSD_PERP -> BTC
        XBTUSDTM -> BTC
        ETH-USDT -> ETH
    """
    
    # Special mappings for non-standard symbols
    SPECIAL_MAPPINGS = {
        'XBT': 'BTC',
        'XBTUSDTM': 'BTC',
        'XBTUSDM': 'BTC',
    }
    
    # Common quote currencies to strip
    QUOTE_CURRENCIES = [
        'USDT', 'USDC', 'USD', 'BUSD', 'DAI', 'TUSD',
        'PERP', 'PERPETUAL', 'SWAP'
    ]
    
    # Common suffixes to strip
    SUFFIXES = ['M', '_PERP', '-PERP', 'PERP', '_SWAP', '-SWAP']
    
    def __init__(self):
        """Initialize the symbol mapper with caching."""
        self._cache: Dict[str, str] = {}
    
    def to_canonical(self, symbol: str, exchange: Optional[str] = None) -> str:
        """
        Convert an exchange-specific symbol to its canonical form.
        
        Args:
            symbol: Exchange-specific symbol (e.g., 'BTCUSDT', 'XBTUSDTM')
            exchange: Optional exchange name for exchange-specific logic
            
        Returns:
            Canonical symbol (e.g., 'BTC')
        """
        # Check cache first
        cache_key = f"{exchange}:{symbol}" if exchange else symbol
        if cache_key in self._cache:
            return self._cache[cache_key]
        
        # Normalize input
        original = symbol
        symbol = symbol.upper().strip()
        
        # Check special mappings first
        if symbol in self.SPECIAL_MAPPINGS:
            canonical = self.SPECIAL_MAPPINGS[symbol]
            self._cache[cache_key] = canonical
            return canonical
        
        # Remove common separators
        symbol = symbol.replace('-', '').replace('_', '')
        
        # Strip suffixes
        for suffix in self.SUFFIXES:
            if symbol.endswith(suffix):
                symbol = symbol[:-len(suffix)]
        
        # Strip quote currencies
        for quote in self.QUOTE_CURRENCIES:
            if symbol.endswith(quote):
                symbol = symbol[:-len(quote)]
                break
        
        # Handle edge cases
        if not symbol or len(symbol) < 2:
            # Fallback: try to extract first word-like token
            match = re.match(r'^([A-Z]{2,10})', original.upper())
            if match:
                symbol = match.group(1)
            else:
                symbol = original.upper()
        
        # Final check for special mappings
        if symbol in self.SPECIAL_MAPPINGS:
            symbol = self.SPECIAL_MAPPINGS[symbol]
        
        # Cache and return
        self._cache[cache_key] = symbol
        return symbol
    
    def get_base_symbol(self, symbol: str, exchange: Optional[str] = None) -> str:
        """
        Alias for to_canonical for backward compatibility.
        """
        return self.to_canonical(symbol, exchange)
    
    def clear_cache(self):
        """Clear the internal cache."""
        self._cache.clear()


# Global singleton instance
_mapper_instance = None


def get_mapper() -> SymbolMapper:
    """Get or create the global SymbolMapper instance."""
    global _mapper_instance
    if _mapper_instance is None:
        _mapper_instance = SymbolMapper()
    return _mapper_instance


# Convenience functions
def to_canonical(symbol: str, exchange: Optional[str] = None) -> str:
    """Convert symbol to canonical form using the global mapper."""
    return get_mapper().to_canonical(symbol, exchange)


def get_base_symbol(symbol: str, exchange: Optional[str] = None) -> str:
    """Get base symbol using the global mapper."""
    return get_mapper().get_base_symbol(symbol, exchange)
