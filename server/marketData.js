
import fetch from 'node-fetch';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '../data');

// Ensure data directory exists
await fs.mkdir(DATA_DIR, { recursive: true });

const BASE_URLS = {
    KUCOIN: 'https://api-futures.kucoin.com',
    MEXC: 'https://api.mexc.com',
    HYPERLIQUID: 'https://api.hyperliquid.xyz'
};

// ==========================================
// STORAGE ADAPTER (FILE SYSTEM)
// ==========================================
const getCachedCandles = async (symbol, interval, source) => {
    try {
        const filePath = path.join(DATA_DIR, `${source}_${symbol}_${interval}.json`);
        const data = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(data);
    } catch {
        return null;
    }
};

const saveCachedCandles = async (symbol, interval, source, data) => {
    try {
        const filePath = path.join(DATA_DIR, `${source}_${symbol}_${interval}.json`);
        await fs.writeFile(filePath, JSON.stringify(data));
    } catch (e) {
        console.error(`[STORAGE ERROR] Failed to save candles for ${symbol}`, e);
    }
};

// ==========================================
// DATA FETCHING
// ==========================================
const parseInterval = (interval) => {
    const num = parseInt(interval);
    if (interval.endsWith('m')) return num * 60 * 1000;
    if (interval.endsWith('h')) return num * 60 * 60 * 1000;
    if (interval.endsWith('d')) return num * 24 * 60 * 60 * 1000;
    return 15 * 60 * 1000;
};

// Helper to convert '15m', '4h' to KuCoin granularity (minutes)
const getKuCoinGranularity = (interval) => {
    const num = parseInt(interval);
    if (interval.endsWith('m')) return num;
    if (interval.endsWith('h')) return num * 60;
    if (interval.endsWith('d')) return num * 1440;
    return 15;
};

const mapData = (data) => {
    return data.map((d) => ({
        time: d[0],
        open: parseFloat(d[1]),
        high: parseFloat(d[2]),
        low: parseFloat(d[3]),
        close: parseFloat(d[4]),
        volume: parseFloat(d[5])
    }));
};

const mapHyperliquidData = (data) => {
    return data.map((d) => ({
        time: d.t,
        open: parseFloat(d.o),
        high: parseFloat(d.h),
        low: parseFloat(d.l),
        close: parseFloat(d.c),
        volume: parseFloat(d.v)
    }));
};

const fetchFromApi = async (source, baseUrl, symbol, interval, limit, startTime = null) => {
    if (source === 'HYPERLIQUID') {
        const coin = symbol.replace('USDT', '');
        // Hyperliquid candleSnapshot
        const body = {
            type: 'candleSnapshot',
            req: {
                coin: coin,
                interval: interval,
                startTime: startTime || (Date.now() - (limit * parseInterval(interval)))
            }
        };

        const res = await fetch(`${baseUrl}/info`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data)) return mapHyperliquidData(data);
        }
        return [];
    } else if (source === 'KUCOIN') {
        const granularity = getKuCoinGranularity(interval);
        // KuCoin Futures: /api/v1/kline/query
        let url = `${baseUrl}/api/v1/kline/query?symbol=${symbol}&granularity=${granularity}`;

        // Note: KuCoin takes 'from' and 'to' in milliseconds
        // If startTime is provided, use it as 'from'
        if (startTime) {
            url += `&from=${startTime}`;
            // If fetching delta, we might want 'to' as now, which is default if omitted
        }

        const res = await fetch(url);
        if (res.ok) {
            const json = await res.json();
            if (json.code === '200000' && Array.isArray(json.data)) {
                // KuCoin returns [time, open, high, low, close, volume]
                // Need to sort ascending because some APIs return descending
                // Check sample: usually descending? verify_kucoin output didn't specify order, 
                // but standard klines are often new to old.
                // Let's sort just in case.
                const data = mapData(json.data);
                return data.sort((a, b) => a.time - b.time);
            }
        }
        return [];
    } else {
        // MEXC
        let url = `${baseUrl}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
        if (startTime) url += `&startTime=${startTime}`;

        const res = await fetch(url);
        if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data)) return mapData(data);
        }
        return [];
    }
};

export const fetchCandles = async (symbol, interval, source, limit = 1000) => {
    try {
        const baseUrl = BASE_URLS[source];

        // 1. Try Cache
        const cached = await getCachedCandles(symbol, interval, source);
        let finalData = [];

        if (cached && cached.length > 0) {
            const lastCandle = cached[cached.length - 1];
            const intervalMs = parseInterval(interval);
            const gap = Date.now() - lastCandle.time;

            // 1. Cache is too old (gap > 1000 candles) OR
            // 2. Cache is too shallow (we increased depth to 1000, but cache might only have 200)
            if (gap > 1000 * intervalMs || cached.length < 800) {
                finalData = await fetchFromApi(source, baseUrl, symbol, interval, limit);
                if (finalData.length > 0) {
                    await saveCachedCandles(symbol, interval, source, finalData);
                }
                return finalData;
            }

            // Fetch Delta
            const startTime = lastCandle.time;
            const newCandles = await fetchFromApi(source, baseUrl, symbol, interval, 1000, startTime);

            if (newCandles.length > 0) {
                const firstNewTime = newCandles[0].time;
                const keptCached = cached.filter(c => c.time < firstNewTime);

                finalData = [...keptCached, ...newCandles];

                // Keep last 1500 (Increased for better EMA accuracy)
                if (finalData.length > 1500) finalData = finalData.slice(-1500);

                await saveCachedCandles(symbol, interval, source, finalData);
            } else {
                finalData = cached;
            }
        } else {
            // No cache, fetch fresh
            finalData = await fetchFromApi(source, baseUrl, symbol, interval, limit);
            if (finalData.length > 0) {
                await saveCachedCandles(symbol, interval, source, finalData);
            }
        }

        return finalData;
    } catch (e) {
        console.error(`Error fetching candles for ${symbol}:`, e.message);
        return [];
    }
};

export const fetchTopVolumePairs = async (source) => {
    try {
        const baseUrl = BASE_URLS[source];

        if (source === 'HYPERLIQUID') {
            const res = await fetch(`${baseUrl}/info`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'metaAndAssetCtxs' })
            });
            if (!res.ok) throw new Error(res.statusText);
            const data = await res.json();

            const universe = data[0]?.universe;
            const assetCtxs = data[1];

            if (!universe || !Array.isArray(universe)) {
                console.error('Hyperliquid Universe not found or invalid:', data);
                return [];
            }

            // Combine universe and ctxs
            const pairs = universe.map((u, i) => ({
                symbol: u.name,
                volume: parseFloat(assetCtxs[i].dayNtlVlm)
            }));

            return pairs
                .sort((a, b) => b.volume - a.volume)
                .slice(0, 200)
                .map(p => p.symbol + 'USDT'); // Append USDT
        }

        if (source === 'KUCOIN') {
            // KuCoin Futures: /api/v1/contracts/active
            const res = await fetch(`${baseUrl}/api/v1/contracts/active`);
            if (!res.ok) throw new Error(res.statusText + ' fetching KuCoin active contracts');
            const json = await res.json();

            if (json.code !== '200000') throw new Error(`KuCoin Error: ${json.msg}`);

            const contracts = json.data;
            return contracts
                .filter(c => c.rootSymbol === 'USDT' && c.turnoverOf24h) // USDT Margined
                .sort((a, b) => (b.turnoverOf24h || 0) - (a.turnoverOf24h || 0)) // Sort by Turnover (Volume)
                .slice(0, 200)
                .map(c => c.symbol);
        }

        // Default Fallback (MEXC or others)
        const res = await fetch(`${baseUrl}/api/v3/ticker/24hr`);
        if (!res.ok) throw new Error(res.statusText);
        const data = await res.json();

        // 1. Filter: USDT only & Min Volume 1M (to avoid absolute garbage)
        const validPairs = data.filter((t) => t.symbol.endsWith('USDT') && parseFloat(t.quoteVolume) > 1000000);

        // 2. Top 200 by Volume
        const topVolume = validPairs
            .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
            .slice(0, 200)
            .map((t) => t.symbol);

        // 3. Top 50 by Gainers (Price Change %)
        const topGainers = validPairs
            .sort((a, b) => parseFloat(b.priceChangePercent) - parseFloat(a.priceChangePercent))
            .slice(0, 50)
            .map((t) => t.symbol);

        // 4. Merge & Dedupe
        const combined = [...new Set([...topVolume, ...topGainers])];

        return combined;
    } catch (error) {
        console.error(`Error fetching top pairs from ${source}:`, error);
        return ['XBTUSDTM', 'ETHUSDTM', 'SOLUSDTM']; // KuCoin Fallbacks
    }
};
