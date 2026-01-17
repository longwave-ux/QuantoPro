import fs from 'fs/promises';
import fetch from 'node-fetch';
import path from 'path';

/**
 * Coinalyze Symbol Resolver
 * Maps local symbols (BTCUSDT) to Coinalyze symbols (BTCUSDT_PERP.A)
 * with intelligent fallback to aggregated symbols.
 */
export class CoinalyzeResolver {
    constructor() {
        this.cacheFile = 'data/coinalyze_symbols.json';
        this.cacheDuration = 24 * 60 * 60 * 1000; // 24 hours
        this.apiUrl = 'https://api.coinalyze.net/v1/future-markets';

        // Exchange ID mapping (from Coinalyze docs)
        this.exchangeIds = {
            'BINANCE': '.4',
            'BYBIT': '.5',
            'MEXC': '.6',
            'KUCOIN': '.8',
            'HYPERLIQUID': '.C',
            'OKX': '.3',
            'BITGET': '.B',
            'DERIBIT': '.2',
            'BITMEX': '.1'
        };

        this.symbolMap = {};
        this.aggregatedSymbols = {};
        this.exchangeSymbols = {};
        this.cacheTimestamp = null;
    }

    /**
     * Load symbol mappings from cache if valid
     */
    async _loadCache() {
        try {
            const stats = await fs.stat(this.cacheFile);
            const cacheAge = Date.now() - stats.mtimeMs;

            if (cacheAge >= this.cacheDuration) {
                console.log(`[RESOLVER] Cache expired (age: ${(cacheAge / 3600000).toFixed(1)}h)`);
                return false;
            }

            const data = await fs.readFile(this.cacheFile, 'utf-8');
            const cacheData = JSON.parse(data);

            this.symbolMap = cacheData.symbol_map || {};
            this.aggregatedSymbols = cacheData.aggregated_symbols || {};
            this.exchangeSymbols = cacheData.exchange_symbols || {};
            this.cacheTimestamp = cacheData.timestamp;

            console.log(`[RESOLVER] Loaded ${Object.keys(this.symbolMap).length} symbols from cache (age: ${(cacheAge / 3600000).toFixed(1)}h)`);
            return true;

        } catch (error) {
            if (error.code !== 'ENOENT') {
                console.error(`[RESOLVER] Failed to load cache:`, error.message);
            }
            return false;
        }
    }

    /**
     * Save symbol mappings to cache
     */
    async _saveCache() {
        try {
            const cacheData = {
                timestamp: Date.now(),
                symbol_map: this.symbolMap,
                aggregated_symbols: this.aggregatedSymbols,
                exchange_symbols: this.exchangeSymbols
            };

            const tempFile = this.cacheFile + '.tmp';
            await fs.writeFile(tempFile, JSON.stringify(cacheData, null, 2));
            await fs.rename(tempFile, this.cacheFile);

            console.log(`[RESOLVER] Saved ${Object.keys(this.symbolMap).length} symbols to cache`);
        } catch (error) {
            console.error(`[RESOLVER] Failed to save cache:`, error.message);
        }
    }

    /**
     * Fetch symbol mappings from Coinalyze API
     */
    async fetchSymbols(apiKey) {
        try {
            console.log(`[RESOLVER] Fetching symbols from ${this.apiUrl}`);

            const response = await fetch(this.apiUrl, {
                headers: { 'api_key': apiKey },
                timeout: 30000
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const markets = await response.json();
            console.log(`[RESOLVER] Received ${markets.length} markets from API`);

            // Process markets
            for (const market of markets) {
                const symbol = market.symbol || '';
                const base = market.base_asset || '';
                const quote = market.quote_asset || '';
                const exchangeId = market.exchange || '';

                if (!symbol || !base) continue;

                // Build normalized base symbol (e.g., BTCUSDT)
                const normalized = quote ? `${base}${quote}` : base;

                // Store full market info
                this.symbolMap[symbol] = {
                    symbol,
                    base,
                    quote,
                    normalized,
                    exchange_id: exchangeId
                };

                // Track aggregated symbols (suffix .A)
                if (symbol.endsWith('.A')) {
                    this.aggregatedSymbols[normalized] = symbol;
                }

                // Track exchange-specific symbols
                if (exchangeId) {
                    if (!this.exchangeSymbols[normalized]) {
                        this.exchangeSymbols[normalized] = {};
                    }
                    this.exchangeSymbols[normalized][exchangeId] = symbol;
                }
            }

            console.log(`[RESOLVER] Processed ${Object.keys(this.aggregatedSymbols).length} aggregated symbols`);
            console.log(`[RESOLVER] Processed ${Object.keys(this.exchangeSymbols).length} unique base symbols`);

            // Save to cache
            await this._saveCache();

            return true;

        } catch (error) {
            console.error(`[RESOLVER] Failed to fetch symbols:`, error.message);
            return false;
        }
    }

    /**
     * Resolve a local symbol to Coinalyze symbol
     * Returns [coinalyzeSymbol, status]
     * status: "resolved" | "aggregated" | "neutral"
     */
    resolve(symbol, exchange) {
        // Normalize symbol (remove common suffixes)
        const normalized = symbol.toUpperCase()
            .replace('USDTM', 'USDT')
            .replace('PERP', '');
        const exchangeUpper = exchange.toUpperCase();

        // Priority 1: Exchange-specific symbol
        const exchangeId = this.exchangeIds[exchangeUpper];
        if (exchangeId && this.exchangeSymbols[normalized]) {
            if (this.exchangeSymbols[normalized][exchangeId]) {
                const coinalyzeSymbol = this.exchangeSymbols[normalized][exchangeId];
                return [coinalyzeSymbol, 'resolved'];
            }
        }

        // Priority 2: Aggregated symbol
        if (this.aggregatedSymbols[normalized]) {
            const coinalyzeSymbol = this.aggregatedSymbols[normalized];
            return [coinalyzeSymbol, 'aggregated'];
        }

        // Priority 3: Neutral (no data)
        return [null, 'neutral'];
    }

    /**
     * Ensure resolver is initialized with symbol mappings
     */
    async ensureInitialized(apiKey) {
        if (Object.keys(this.symbolMap).length > 0) {
            return true;
        }

        // Try to load from cache
        if (await this._loadCache()) {
            return true;
        }

        // Fetch from API
        return await this.fetchSymbols(apiKey);
    }
}

// Global singleton instance
let _resolverInstance = null;

export function getResolver() {
    if (!_resolverInstance) {
        _resolverInstance = new CoinalyzeResolver();
    }
    return _resolverInstance;
}
