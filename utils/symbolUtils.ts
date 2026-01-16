/**
 * Central Symbol Utility Functions
 * Used across the entire UI for consistent symbol handling
 */

/**
 * Clean symbol for display and TradingView charts
 * Strips USDT, USDTM, -USDT, -USDTM suffixes and trailing hyphens
 * 
 * Examples:
 * - ETHFIUSDTM -> ETHFI
 * - ETHFIUSDT -> ETHFI
 * - BTC-USDT -> BTC
 * - ARBUSDT -> ARB
 */
export const cleanSymbol = (symbol: string): string => {
    if (!symbol) return '';
    
    let cleaned = symbol;
    
    // Remove -USDTM suffix
    if (cleaned.endsWith('-USDTM')) {
        cleaned = cleaned.slice(0, -7);
    }
    // Remove -USDT suffix
    else if (cleaned.endsWith('-USDT')) {
        cleaned = cleaned.slice(0, -6);
    }
    // Remove USDTM suffix
    else if (cleaned.endsWith('USDTM')) {
        cleaned = cleaned.slice(0, -5);
    }
    // Remove USDT suffix
    else if (cleaned.endsWith('USDT')) {
        cleaned = cleaned.slice(0, -4);
    }
    
    // Remove any trailing hyphens
    cleaned = cleaned.replace(/-+$/, '');
    
    return cleaned;
};

/**
 * Get TradingView compatible symbol
 * For TradingView charts, we need the base asset + USDT (not USDTM)
 * 
 * Examples:
 * - ETHFIUSDTM -> ETHFIUSDT
 * - ETHFIUSDT -> ETHFIUSDT
 * - BTC-USDT -> BTCUSDT
 */
export const getTradingViewSymbol = (symbol: string): string => {
    if (!symbol) return '';
    
    const cleaned = cleanSymbol(symbol);
    return `${cleaned}USDT`;
};

/**
 * Format symbol for display with optional exchange prefix
 * 
 * Examples:
 * - formatSymbolDisplay('ETHFIUSDTM', 'BINANCE') -> 'BINANCE:ETHFI'
 * - formatSymbolDisplay('ARBUSDT') -> 'ARB'
 */
export const formatSymbolDisplay = (symbol: string, exchange?: string): string => {
    const cleaned = cleanSymbol(symbol);
    return exchange ? `${exchange}:${cleaned}` : cleaned;
};
