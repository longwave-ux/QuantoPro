
import fetch from 'node-fetch';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { CONFIG } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CACHE_FILE = path.join(__dirname, '../data/mcap_cache.json');

// Cache structure: { timestamp: 123456789, data: { "BTC": 1000000, ... } }
let memoryCache = { timestamp: 0, data: {} };

export const McapService = {
    // Initialize: Load from disk
    init: async () => {
        try {
            const data = await fs.readFile(CACHE_FILE, 'utf-8');
            memoryCache = JSON.parse(data);
            console.log(`[MCAP] Loaded cache with ${Object.keys(memoryCache.data || {}).length} symbols.`);
        } catch {
            console.log('[MCAP] No cache found, starting fresh.');
        }
    },

    // Get Mcap for a symbol (e.g. BTC)
    getMcap: (symbol) => {
        const base = symbol.replace('USDT', '').replace('USDC', '').replace('PERP', '');
        return memoryCache.data?.[base] || 0;
    },

    // Refresh data if needed (e.g., older than 4 hours)
    refreshIfNeeded: async (symbols) => {
        const now = Date.now();
        // 4 hours cache duration
        if (now - memoryCache.timestamp < 4 * 60 * 60 * 1000 && Object.keys(memoryCache.data).length > 0) {
            return;
        }

        console.log('[MCAP] Refreshing Market Cap data...');
        const uniqueSymbols = [...new Set(symbols.map(s => s.replace('USDT', '').replace('USDC', '').replace('PERP', '')))];

        try {
            const newData = {};
            // Batch requests (50 at a time) to avoid URL length limits
            const BATCH_SIZE = 50;

            for (let i = 0; i < uniqueSymbols.length; i += BATCH_SIZE) {
                const batch = uniqueSymbols.slice(i, i + BATCH_SIZE);
                const url = `https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?symbol=${batch.join(',')}`;

                try {
                    const res = await fetch(url, {
                        headers: { 'X-CMC_PRO_API_KEY': CONFIG.SYSTEM.CMC_API_KEY }
                    });

                    if (res.ok) {
                        const json = await res.json();
                        if (json.data) {
                            Object.values(json.data).forEach(coin => {
                                if (coin.quote?.USD?.market_cap) {
                                    newData[coin.symbol] = coin.quote.USD.market_cap;
                                }
                            });
                        }
                    } else {
                        console.error(`[MCAP ERROR] Batch failed: ${res.statusText}`);
                    }
                } catch (e) {
                    console.error(`[MCAP ERROR] Batch exception: ${e.message}`);
                }

                // Rate limit politeness
                await new Promise(r => setTimeout(r, 1000));
            }

            memoryCache = {
                timestamp: now,
                data: { ...memoryCache.data, ...newData } // Merge to keep old data if fetch fails partial
            };

            await fs.writeFile(CACHE_FILE, JSON.stringify(memoryCache, null, 2));
            console.log(`[MCAP] Refreshed complete. Covered ${Object.keys(newData).length} symbols.`);

        } catch (e) {
            console.error('[MCAP] Global refresh failed', e);
        }
    }
};
