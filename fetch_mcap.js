
import fetch from 'node-fetch';
import fs from 'fs/promises';
import path from 'path';

const API_KEY = 'e86a7a5e-c95e-4f20-b137-72a9ef78fa93';
const DATA_DIR = './data';

const run = async () => {
    // 1. Get List of Symbols from Data Directory
    const files = await fs.readdir(DATA_DIR);
    const symbols = new Set();

    files.forEach(f => {
        if (f.includes('_15m.json')) {
            const parts = f.split('_');
            // Format: SOURCE_SYMBOL_15m.json
            // We want the SYMBOL (e.g., BTCUSDT)
            // But CMC expects symbols like "BTC"
            const sym = parts[1].replace('USDT', '').replace('USDC', '').replace('PERP', '');
            symbols.add(sym);
        }
    });

    const symbolList = Array.from(symbols);
    console.log(`Found ${symbolList.length} unique symbols.`);

    // 2. Batch Fetch from CMC
    // Endpoint: /v1/cryptocurrency/quotes/latest?symbol=BTC,ETH...
    // Max 100 symbols per request usually? Or massive string.
    // Let's do batches of 50.

    const mcaps = {};

    for (let i = 0; i < symbolList.length; i += 50) {
        const batch = symbolList.slice(i, i + 50);
        const url = `https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?symbol=${batch.join(',')}`;

        try {
            const res = await fetch(url, {
                headers: { 'X-CMC_PRO_API_KEY': API_KEY }
            });

            if (!res.ok) {
                console.error(`Error fetching batch ${i}:`, res.statusText);
                continue;
            }

            const json = await res.json();
            if (json.data) {
                Object.values(json.data).forEach(coin => {
                    if (coin.quote && coin.quote.USD) {
                        mcaps[coin.symbol] = coin.quote.USD.market_cap;
                    }
                });
            }
        } catch (e) {
            console.error(`Exception fetching batch ${i}:`, e.message);
        }

        // Polite delay
        await new Promise(r => setTimeout(r, 1000));
    }

    console.log(`Fetched MCap for ${Object.keys(mcaps).length} symbols.`);
    await fs.writeFile('mcap_cache.json', JSON.stringify(mcaps, null, 2));
};

run();
