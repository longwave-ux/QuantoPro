"""
Batch Processor for Market Scanner
Orchestrates batch fetching of external data using resolver and batch client.
"""

import sys
from typing import Dict, List, Tuple, Any, Optional
from coinalyze_resolver import get_resolver
from coinalyze_batch_client import get_batch_client


class BatchProcessor:
    """
    Orchestrates batch processing of external data for market scanning.
    
    Workflow:
    1. Collect all symbols to process
    2. Resolve symbols using CoinalyzeResolver
    3. Group into batches of 20
    4. Fetch data using CoinalyzeBatchClient
    5. Distribute results back to individual symbols
    """
    
    def __init__(self):
        self.resolver = get_resolver()
        self.batch_client = get_batch_client()
        self.batch_size = 20
    
    def process_symbols(
        self,
        symbols: List[Tuple[str, str]]
    ) -> Dict[str, Dict[str, Any]]:
        """
        Process a list of symbols and fetch all external data in batches.
        
        Args:
            symbols: List of (symbol, exchange) tuples
        
        Returns:
            Dict mapping (symbol, exchange) -> external data
        """
        if not symbols:
            return {}
        
        print(f"[BATCH] Processing {len(symbols)} symbols", file=sys.stderr)
        
        # Step 1: Resolve all symbols
        resolved_map = {}  # (symbol, exchange) -> (coinalyze_symbol, status)
        coinalyze_symbols = []  # List of unique Coinalyze symbols
        symbol_to_locals = {}  # Coinalyze symbol -> list of (symbol, exchange)
        
        for symbol, exchange in symbols:
            coinalyze_symbol, status = self.resolver.resolve(symbol, exchange)
            key = f"{symbol}_{exchange}"
            resolved_map[key] = (coinalyze_symbol, status)
            
            if coinalyze_symbol:
                if coinalyze_symbol not in symbol_to_locals:
                    symbol_to_locals[coinalyze_symbol] = []
                    coinalyze_symbols.append(coinalyze_symbol)
                symbol_to_locals[coinalyze_symbol].append((symbol, exchange))
        
        resolved_count = sum(1 for _, status in resolved_map.values() if status == "resolved")
        aggregated_count = sum(1 for _, status in resolved_map.values() if status == "aggregated")
        neutral_count = sum(1 for _, status in resolved_map.values() if status == "neutral")
        
        print(f"[BATCH] Resolved: {resolved_count} | Aggregated: {aggregated_count} | Neutral: {neutral_count}", file=sys.stderr)
        
        # Step 2: Fetch data in batches
        all_data = {}
        total_batches = (len(coinalyze_symbols) + self.batch_size - 1) // self.batch_size
        
        for i in range(0, len(coinalyze_symbols), self.batch_size):
            batch_symbols = coinalyze_symbols[i:i + self.batch_size]
            batch_num = (i // self.batch_size) + 1
            
            print(f"[BATCH] Fetching batch {batch_num}/{total_batches} ({len(batch_symbols)} symbols)", file=sys.stderr)
            
            try:
                batch_data = self.batch_client.fetch_all_data_batch(batch_symbols)
                all_data.update(batch_data)
            except Exception as e:
                print(f"[BATCH] Error fetching batch {batch_num}: {e}", file=sys.stderr)
        
        print(f"[BATCH] Fetched data for {len(all_data)} Coinalyze symbols", file=sys.stderr)
        
        # Step 3: Distribute results back to local symbols
        results = {}
        injected_count = 0
        for symbol, exchange in symbols:
            key = f"{symbol}_{exchange}"
            coinalyze_symbol, status = resolved_map.get(key, (None, "neutral"))
            
            if coinalyze_symbol and coinalyze_symbol in all_data:
                data = all_data[coinalyze_symbol]
                oi_history = data.get('oi_history', [])
                
                results[key] = {
                    'oi_history': oi_history,
                    'funding_rate': data.get('funding_rate'),
                    'ls_ratio': data.get('ls_ratio'),
                    'liquidations': data.get('liquidations', {'longs': 0, 'shorts': 0}),
                    'oi_status': status,
                    'coinalyze_symbol': coinalyze_symbol
                }
                
                # Log successful injection
                if oi_history and len(oi_history) > 0:
                    injected_count += 1
                    latest_oi = oi_history[-1].get('value', 0) if oi_history else 0
                    print(f"[BATCH] ✓ Injecting OI data for {symbol} (Local: {key}, Remote: {coinalyze_symbol}, Latest OI: {latest_oi:.0f})", file=sys.stderr)
            else:
                # Neutral - no data available
                results[key] = {
                    'oi_history': [],
                    'funding_rate': None,
                    'ls_ratio': None,
                    'liquidations': {'longs': 0, 'shorts': 0},
                    'oi_status': 'neutral',
                    'coinalyze_symbol': None
                }
        
        print(f"[BATCH] Successfully injected OI data for {injected_count}/{len(symbols)} symbols", file=sys.stderr)
        
        # Display API statistics
        stats = self.batch_client.get_stats()
        print(f"[BATCH] API Statistics: {stats['successful']} successful, {stats['failed']} failed, {stats['total']} total requests", file=sys.stderr)
        
        return results
    
    def get_data_for_symbol(
        self,
        symbol: str,
        exchange: str,
        batch_data: Dict[str, Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        Get external data for a specific symbol from batch results.
        
        Args:
            symbol: Local symbol
            exchange: Exchange name
            batch_data: Results from process_symbols()
        
        Returns:
            External data dict
        """
        key = f"{symbol}_{exchange}"
        return batch_data.get(key, {
            'oi_history': [],
            'funding_rate': None,
            'ls_ratio': None,
            'liquidations': {'longs': 0, 'shorts': 0},
            'oi_status': 'neutral',
            'coinalyze_symbol': None
        })


# Global singleton instance
_batch_processor_instance: Optional[BatchProcessor] = None


def get_batch_processor() -> BatchProcessor:
    """Get or create the global batch processor instance."""
    global _batch_processor_instance
    if _batch_processor_instance is None:
        _batch_processor_instance = BatchProcessor()
    return _batch_processor_instance
