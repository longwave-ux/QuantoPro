import { OHLCV, AnalysisResult, TradeSetup, DataSource } from '../types';

// ==========================================
// 1. SYSTEM LOGGER (VPS DEBUGGING)
// ==========================================
export interface LogEntry {
    timestamp: string;
    level: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS';
    message: string;
}

const MAX_LOGS = 100;
let systemLogs: LogEntry[] = [];

export const addLog = (level: LogEntry['level'], message: string) => {
    const entry: LogEntry = {
        timestamp: new Date().toLocaleTimeString(),
        level,
        message
    };
    systemLogs.unshift(entry);
    if (systemLogs.length > MAX_LOGS) systemLogs.pop();
};

export const getSystemLogs = () => [...systemLogs];

// ==========================================
// 2. STORAGE ADAPTER
// ==========================================
interface StorageAdapter {
    get: (key: string) => any;
    set: (key: string, value: any) => void;
}

const BrowserStorage: StorageAdapter = {
    get: (key: string) => {
        try {
            const item = localStorage.getItem(key);
            return item ? JSON.parse(item) : null;
        } catch { return null; }
    },
    set: (key: string, value: any) => {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (e) { console.error("Storage Error", e); }
    }
};

const HISTORY_KEY = 'CRYPTO_SCAN_HISTORY_V1';
const DB = BrowserStorage;

// ==========================================
// 2.1 INDEXED DB CACHE (PERSISTENT STORAGE)
// ==========================================
const DB_NAME = 'CryptoQuantCache';
const DB_VERSION = 1;
const STORE_NAME = 'candles';

const openDB = (): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' }); // id: symbol_interval
            }
        };
    });
};

const getCachedCandles = async (symbol: string, interval: string, source: string): Promise<OHLCV[] | null> => {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const request = store.get(`${source}_${symbol}_${interval}`);
            request.onsuccess = () => resolve(request.result ? request.result.data : null);
            request.onerror = () => reject(request.error);
        });
    } catch (e) {
        // console.error("IDB Read Error", e); // Silent fail
        return null;
    }
};

const saveCachedCandles = async (symbol: string, interval: string, source: string, data: OHLCV[]) => {
    try {
        const db = await openDB();
        return new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const request = store.put({ id: `${source}_${symbol}_${interval}`, data, timestamp: Date.now() });
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    } catch (e) {
        console.error("IDB Write Error", e);
    }
};

const parseInterval = (interval: string): number => {
    const num = parseInt(interval);
    if (interval.endsWith('m')) return num * 60 * 1000;
    if (interval.endsWith('h')) return num * 60 * 60 * 1000;
    if (interval.endsWith('d')) return num * 24 * 60 * 60 * 1000;
    return 15 * 60 * 1000;
};

const mapData = (data: any[]): OHLCV[] => {
    return data.map((d: any) => ({
        time: d[0],
        open: parseFloat(d[1]),
        high: parseFloat(d[2]),
        low: parseFloat(d[3]),
        close: parseFloat(d[4]),
        volume: parseFloat(d[5])
    }));
};

const mapHyperliquidData = (data: any[]): OHLCV[] => {
    if (!Array.isArray(data)) return [];
    return data.filter(d => d && typeof d === 'object').map((d: any) => ({
        time: d.t,
        open: parseFloat(d.o || '0'),
        high: parseFloat(d.h || '0'),
        low: parseFloat(d.l || '0'),
        close: parseFloat(d.c || '0'),
        volume: parseFloat(d.v || '0')
    }));
};

// ==========================================
// 3. DATA FETCHING LAYER
// ==========================================


const BASE_URLS = {
    KUCOIN: 'https://api-futures.kucoin.com',
    MEXC: 'https://api.mexc.com',
    HYPERLIQUID: 'https://api.hyperliquid.xyz'
};

// Intelligent Fetcher: Tries Local Proxy (VPS) -> Direct -> Public Proxy
const smartFetch = async (url: string): Promise<any> => {
    // 1. Try Local Node.js Proxy (Best for VPS)
    try {
        // We construct a path to our own server.js endpoint
        const targetUrl = `/api/proxy?url=${encodeURIComponent(url)}`;
        const localRes = await fetch(targetUrl);

        // If our server responds with 200, use it. 
        // If it returns 404 (not running on server) or 500, fall through.
        if (localRes.ok) {
            return await localRes.json();
        }
    } catch (e) {
        // Local proxy not available, ignore
    }

    // 2. Try Direct (Will fail for CORS usually, but good for local/mobile apps)
    try {
        const res = await fetch(url);
        if (res.ok) return await res.json();
    } catch (e) {
        // Direct failed
    }

    // 3. Fallback: Public CORS Proxy (Slow, unreliable, but works in browser)
    try {
        const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
        const proxyRes = await fetch(proxyUrl);
        if (!proxyRes.ok) throw new Error(`Proxy fetch failed: ${proxyRes.status}`);
        return await proxyRes.json();
    } catch (proxyError: any) {
        throw new Error(`Connection Failed: ${proxyError.message || 'Unknown Error'}. Ensure your VPS server is running or check your internet connection.`);
    }
};

export const fetchTopVolumePairs = async (source: DataSource): Promise<string[]> => {
    try {
        addLog('INFO', `Fetching top 200 pairs from ${source}...`);
        const baseUrl = BASE_URLS[source];

        if (source === 'HYPERLIQUID') {
            // Hyperliquid uses a POST request to /info
            const targetUrl = `/api/proxy?url=${encodeURIComponent(`${baseUrl}/info`)}&method=POST&body=${encodeURIComponent(JSON.stringify({ type: 'metaAndAssetCtxs' }))}`;

            // We need to bypass smartFetch's simple GET logic for this POST via proxy
            // Or we can just use the proxy directly since we know we are in the app
            const res = await fetch(targetUrl);
            if (!res.ok) throw new Error(`Hyperliquid fetch failed: ${res.statusText}`);

            const data = await res.json();
            if (!Array.isArray(data) || data.length < 2) throw new Error("Invalid Hyperliquid response format");

            const universe = data[0].universe;
            const assetCtxs = data[1];

            if (!Array.isArray(universe) || !Array.isArray(assetCtxs)) throw new Error("Invalid Hyperliquid data structure");

            const pairs = universe.map((u: any, i: number) => ({
                symbol: u.name,
                volume: parseFloat(assetCtxs[i]?.dayNtlVlm || '0')
            }));

            const topPairs = pairs
                .sort((a: any, b: any) => b.volume - a.volume)
                .slice(0, 200)
                .map((p: any) => p.symbol + 'USDT'); // Append USDT for consistency with other exchanges

            addLog('SUCCESS', `Successfully fetched ${topPairs.length} pairs.`);
            return topPairs;
        }

        if (source === 'KUCOIN') {
            // KuCoin Futures: /api/v1/contracts/active
            const json = await smartFetch(`${baseUrl}/api/v1/contracts/active`);
            if (json.code !== '200000') throw new Error(`KuCoin Error: ${json.msg}`);

            const contracts = json.data;
            const topPairs = contracts
                .filter((c: any) => c.rootSymbol === 'USDT' && c.turnoverOf24h)
                .sort((a: any, b: any) => (b.turnoverOf24h || 0) - (a.turnoverOf24h || 0))
                .slice(0, 200)
                .map((c: any) => c.symbol);

            addLog('SUCCESS', `Successfully fetched ${topPairs.length} pairs.`);
            return topPairs;
        }

        // Default Fallback (MEXC)
        const data = await smartFetch(`${baseUrl}/api/v3/ticker/24hr`);

        const topPairs = data
            .filter((t: any) => t.symbol.endsWith('USDT') && parseFloat(t.quoteVolume) > 1000000)
            .sort((a: any, b: any) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
            .slice(0, 200)
            .map((t: any) => t.symbol);

        addLog('SUCCESS', `Successfully fetched ${topPairs.length} pairs.`);
        return topPairs;
    } catch (error: any) {
        addLog('ERROR', `Failed to fetch top pairs: ${error.message}`);
        console.error(`Error fetching top pairs from ${source}:`, error);
        if (error.message.includes("Connection Failed")) throw error;
        return ['XBTUSDTM', 'ETHUSDTM', 'SOLUSDTM', 'ADAUSDTM', 'DOGEUSDTM'];
    }
};

const getIntervals = (selection: string) => {
    switch (selection) {
        case '1h': return { htf: '1h', ltf: '5m' };
        case '1d': return { htf: '1d', ltf: '1h' };
        case '4h':
        default: return { htf: '4h', ltf: '15m' };
    }
};

const getKuCoinGranularity = (interval: string): number => {
    const num = parseInt(interval);
    if (interval.endsWith('m')) return num;
    if (interval.endsWith('h')) return num * 60;
    if (interval.endsWith('d')) return num * 1440;
    return 15;
};

export const fetchCandles = async (symbol: string, interval: string, source: DataSource, limit: number = 1000): Promise<OHLCV[]> => {
    try {
        const baseUrl = BASE_URLS[source];
        
        // CRITICAL: Validate baseUrl before proceeding
        if (!baseUrl || baseUrl === 'undefined') {
            addLog('ERROR', `Invalid baseUrl for source ${source}: ${baseUrl}`);
            console.error(`[FETCH ERROR] Invalid baseUrl for ${source}. Check BASE_URLS configuration.`);
            return [];
        }
        
        // Validate symbol
        if (!symbol || symbol === 'undefined') {
            addLog('ERROR', `Invalid symbol: ${symbol}`);
            console.error(`[FETCH ERROR] Invalid symbol: ${symbol}`);
            return [];
        }

        // 1. Try Cache
        const cached = await getCachedCandles(symbol, interval, source);
        let finalData: OHLCV[] = [];

        if (cached && cached.length > 0) {
            const lastCandle = cached[cached.length - 1];
            const intervalMs = parseInterval(interval);
            const gap = Date.now() - lastCandle.time;

            // 1. Cache is too old (gap > 1000 candles) OR
            // 2. Cache is too shallow (we increased depth to 1000, but cache might only have 200)
            if (gap > 1000 * intervalMs || cached.length < 800) {
                if (source === 'HYPERLIQUID') {
                    const coin = symbol.replace('USDT', '');
                    const body = JSON.stringify({
                        type: 'candleSnapshot',
                        req: { coin, interval, startTime: Date.now() - (limit * intervalMs) }
                    });
                    const targetUrl = `/api/proxy?url=${encodeURIComponent(`${baseUrl}/info`)}&method=POST&body=${encodeURIComponent(body)}`;
                    const res = await fetch(targetUrl);
                    if (res.ok) {
                        const data = await res.json();
                        if (Array.isArray(data)) {
                            finalData = mapHyperliquidData(data);
                            await saveCachedCandles(symbol, interval, source, finalData);
                        }
                    }
                } else if (source === 'KUCOIN') {
                    const granularity = getKuCoinGranularity(interval);
                    const json = await smartFetch(`${baseUrl}/api/v1/kline/query?symbol=${symbol}&granularity=${granularity}`);
                    if (json.code === '200000' && Array.isArray(json.data)) {
                        finalData = mapData(json.data);
                        finalData.sort((a, b) => a.time - b.time);
                        await saveCachedCandles(symbol, interval, source, finalData);
                    }
                } else {
                    const data = await smartFetch(`${baseUrl}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
                    if (Array.isArray(data)) {
                        finalData = mapData(data);
                        await saveCachedCandles(symbol, interval, source, finalData);
                    }
                }
                return finalData;
            }

            // Fetch Delta
            const startTime = lastCandle.time;

            if (source === 'HYPERLIQUID') {
                const coin = symbol.replace('USDT', '');
                const body = JSON.stringify({
                    type: 'candleSnapshot',
                    req: { coin, interval, startTime }
                });
                const targetUrl = `/api/proxy?url=${encodeURIComponent(`${baseUrl}/info`)}&method=POST&body=${encodeURIComponent(body)}`;
                const res = await fetch(targetUrl);
                if (res.ok) {
                    const data = await res.json();
                    if (Array.isArray(data) && data.length > 0) {
                        const newCandles = mapHyperliquidData(data);
                        const firstNewTime = newCandles[0].time;
                        const keptCached = cached.filter(c => c.time < firstNewTime);
                        finalData = [...keptCached, ...newCandles];
                        if (finalData.length > 1500) finalData = finalData.slice(-1500);
                        await saveCachedCandles(symbol, interval, source, finalData);
                    } else {
                        finalData = cached;
                    }
                } else {
                    finalData = cached;
                }
            } else if (source === 'KUCOIN') {
                const granularity = getKuCoinGranularity(interval);
                const json = await smartFetch(`${baseUrl}/api/v1/kline/query?symbol=${symbol}&granularity=${granularity}&from=${startTime}`);
                if (json.code === '200000' && Array.isArray(json.data) && json.data.length > 0) {
                    const newCandles = mapData(json.data);
                    newCandles.sort((a, b) => a.time - b.time);

                    const firstNewTime = newCandles[0].time;
                    const keptCached = cached.filter(c => c.time < firstNewTime);
                    finalData = [...keptCached, ...newCandles];
                    if (finalData.length > 1500) finalData = finalData.slice(-1500);
                    await saveCachedCandles(symbol, interval, source, finalData);
                } else {
                    finalData = cached;
                }
            } else {
                const data = await smartFetch(`${baseUrl}/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${startTime}&limit=1000`);
                if (Array.isArray(data) && data.length > 0) {
                    const newCandles = mapData(data);
                    const firstNewTime = newCandles[0].time;
                    const keptCached = cached.filter(c => c.time < firstNewTime);

                    finalData = [...keptCached, ...newCandles];

                    // Keep last 1500 to ensure enough history for indicators
                    if (finalData.length > 1500) finalData = finalData.slice(-1500);

                    await saveCachedCandles(symbol, interval, source, finalData);
                } else {
                    finalData = cached;
                }
            }
        } else {
            // No cache, fetch fresh
            if (source === 'HYPERLIQUID') {
                const coin = symbol.replace('USDT', '');
                const intervalMs = parseInterval(interval);
                const body = JSON.stringify({
                    type: 'candleSnapshot',
                    req: { coin, interval, startTime: Date.now() - (limit * intervalMs) }
                });
                const targetUrl = `/api/proxy?url=${encodeURIComponent(`${baseUrl}/info`)}&method=POST&body=${encodeURIComponent(body)}`;
                const res = await fetch(targetUrl);
                if (res.ok) {
                    const data = await res.json();
                    if (Array.isArray(data)) {
                        finalData = mapHyperliquidData(data);
                        await saveCachedCandles(symbol, interval, source, finalData);
                    }
                }
            } else if (source === 'KUCOIN') {
                const granularity = getKuCoinGranularity(interval);
                const json = await smartFetch(`${baseUrl}/api/v1/kline/query?symbol=${symbol}&granularity=${granularity}`);
                if (json.code === '200000' && Array.isArray(json.data)) {
                    finalData = mapData(json.data);
                    finalData.sort((a, b) => a.time - b.time);
                    await saveCachedCandles(symbol, interval, source, finalData);
                }
            } else {
                const data = await smartFetch(`${baseUrl}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
                if (Array.isArray(data)) {
                    finalData = mapData(data);
                    await saveCachedCandles(symbol, interval, source, finalData);
                }
            }
        }

        return finalData;
    } catch (e) {
        console.error(`Error fetching candles for ${symbol}:`, e);
        return [];
    }
};


export const getChartData = async (symbol: string, htf: string, ltf: string, source: DataSource) => {
    const [htfData, ltfData] = await Promise.all([
        fetchCandles(symbol, htf, source),
        fetchCandles(symbol, ltf, source)
    ]);
    return { htf: htfData, ltf: ltfData };
};

// ==========================================
// 4. ANALYSIS ENGINE (SERVER-SIDE ONLY)
// ==========================================
// Logic moved to server/analysis.js to prevent duplication/desync.

// ==========================================
// 5. WORKFLOW ORCHESTRATOR
// ==========================================

interface ScanHistoryEntry {
    score: number;
    timestamp: number;
    consecutiveScans: number;
}

export const getScanHistory = (): Record<string, ScanHistoryEntry> => {
    return DB.get(HISTORY_KEY) || {};
};

export const saveScanHistory = (history: Record<string, ScanHistoryEntry>) => {
    DB.set(HISTORY_KEY, history);
};

export const exportHistoryJSON = () => {
    const data = getScanHistory();
    return JSON.stringify(data, null, 2);
}

export const restoreHistoryJSON = (jsonString: string) => {
    try {
        const data = JSON.parse(jsonString);
        saveScanHistory(data);
        return true;
    } catch (e) {
        return false;
    }
}

export const runScannerWorkflow = async (
    timeframe: string,
    source: DataSource,
    onProgress?: (msg: string) => void
): Promise<AnalysisResult[]> => {

    addLog('INFO', `Requesting server scan for ${source} (${timeframe})...`);
    if (onProgress) onProgress(`Contacting server for ${source} scan...`);

    try {
        // Trigger Manual Scan on Server
        const res = await fetch('/api/scan/manual', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source }) // Server uses config for timeframe, so we send source
        });

        if (!res.ok) {
            throw new Error(`Server scan failed: ${res.statusText}`);
        }

        const data = await res.json();
        const results = data.results || [];

        addLog('SUCCESS', `Server scan complete. Received ${results.length} results.`);
        return results;

    } catch (e: any) {
        addLog('ERROR', `Scan Request Failed: ${e.message}`);
        console.error("Scan Workflow Error", e);
        throw e;
    }
};
