import 'dotenv/config'; // Load .env file for local development
import express from 'express';
import fetch from 'node-fetch';
import path from 'path';
import crypto from 'crypto'; // Native Node crypto for signing
import { ethers } from 'ethers'; // For Hyperliquid Signing
import { fileURLToPath } from 'url';
import { CONFIG, loadConfig, saveConfig } from './server/config.js';
import { runServerScan, getLatestResults, getMasterFeed, scanStatus } from './server/scanner.js';
import { saveSettings, getSettings } from './server/telegram.js';
import { getTradeHistory, getPerformanceStats, updateOutcomes } from './server/tracker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load Config on Startup
await loadConfig();

const app = express();
const PORT = CONFIG.SYSTEM.HTTP_PORT;

// Global Error Handlers to prevent server crash during 24/7 operation
import fs from 'fs';

process.on('uncaughtException', (err) => {
    console.error('[CRITICAL ERROR] Uncaught Exception:', err);
    console.error('[CRITICAL ERROR] Stack:', err.stack);

    try {
        fs.appendFileSync('crash.log', `${new Date().toISOString()} - UNCAUGHT: ${err.stack}\n`);
    } catch (e) {
        console.error('Failed to write to crash.log', e);
    }

    // Graceful shutdown to allow PM2 to restart
    console.error('[CRITICAL ERROR] Shutting down for restart...');
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[CRITICAL ERROR] Unhandled Rejection at:', promise, 'reason:', reason);

    try {
        fs.appendFileSync('crash.log', `${new Date().toISOString()} - REJECTION: ${reason}\n`);
    } catch (e) {
        console.error('Failed to write to crash.log', e);
    }
    // For rejections, we might not want to crash immediately, but logging is critical
});

// Middleware to parse JSON bodies (Required for trade requests)
app.use(express.json());
// Serve static files from the React build
app.use(express.static(path.join(__dirname, 'dist'), {
    etag: false,
    lastModified: false,
    setHeaders: (res, path) => {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    }
}));

// ==========================================
// SERVER-SIDE SCANNER LOOP
// ==========================================

const startScannerLoop = async () => {
    console.log('[SYSTEM] Starting 24/7 Scanner Loop (Sequential Mode)...');

    // Run immediately on start
    try {
        await runServerScan('HYPERLIQUID', 'all');
        await runServerScan('MEXC', 'all');
        await runServerScan('KUCOIN', 'all');
    } catch (e) {
        console.error('[SCAN ERROR - STARTUP]', e);
    }

    // Main Loop
    while (true) {
        try {
            // Wait 1 minute between cycles (Polling for Interval Check)
            // The intervals (1h/4h) are checked INSIDE runServerScan.
            await new Promise(resolve => setTimeout(resolve, 60 * 1000));

            // Sequentially execute scans. 
            // runServerScan checks if enough time has passed since last run.
            await runServerScan('HYPERLIQUID', 'all');
            await runServerScan('MEXC', 'all');
            await runServerScan('KUCOIN', 'all');

            // Update Tracker
            await updateOutcomes().catch(e => console.error('[TRACKER ERROR]', e));

        } catch (e) {
            console.error('[MAIN LOOP ERROR]', e);
            // Wait 1 min on error to avoid rapid restart loops
            await new Promise(resolve => setTimeout(resolve, 60 * 1000));
        }
    }
};

// Start the loop
startScannerLoop().catch(e => console.error('[FATAL LOOP ERROR]', e));

// ==========================================
// API: CONTROL & MANUAL TRIGGER
// ==========================================
app.post('/api/scan/manual', async (req, res) => {
    const { source } = req.body; // e.g. 'HYPERLIQUID'
    try {
        console.log(`[MANUAL TRIGGER] Starting scan for ${source}...`);
        // Force run the scan (bypass interval checks) - Async/Background
        runServerScan(source || 'HYPERLIQUID', 'all', true).catch(err => console.error('[MANUAL SCAN ERROR]', err));

        res.json({ success: true, message: 'Scan started in background' });
    } catch (e) {
        console.error('[MANUAL TRIGGER ERROR]', e);
        res.status(500).json({ error: 'Scan failed', details: e.message });
    }
});

app.get('/api/scan/status', (req, res) => {
    res.json(scanStatus);
});

// ==========================================
// API: SETTINGS & RESULTS
// ==========================================

app.get('/api/results', async (req, res) => {
    const results = await getMasterFeed();
    res.json(results);
});

app.post('/api/settings', async (req, res) => {
    await saveSettings(req.body);
    res.json({ success: true });
});

app.get('/api/settings', async (req, res) => {
    const settings = await getSettings();
    // CRITICAL SECURITY FIX: Mask private keys before sending to frontend
    const safeSettings = {
        ...settings,
        mexcApiKey: settings.mexcApiKey ? '***MASKED***' : '',
        mexcApiSecret: settings.mexcApiSecret ? '***MASKED***' : '',
        hyperliquidPrivateKey: settings.hyperliquidPrivateKey ? '***MASKED***' : '',
        geminiLLMApiKey: settings.geminiLLMApiKey ? '***MASKED***' : ''
    };
    res.json(safeSettings);
});

app.get('/api/performance', async (req, res) => {
    const history = await getTradeHistory();
    const stats = await getPerformanceStats();
    res.json({ history, stats });
});

import { getExchangeData } from './server/exchange.js';

// ==========================================
// API: EXCHANGE DATA
// ==========================================
app.get('/api/exchange/account', async (req, res) => {
    const { source } = req.query;
    console.log(`[EXCHANGE API] Request received for source: ${source}`);
    if (!source) return res.status(400).json({ error: 'Missing source parameter' });

    try {
        const data = await getExchangeData(source);
        res.json(data);
    } catch (e) {
        console.error(`[EXCHANGE ERROR] ${source}:`, e.message);
        res.status(500).json({ error: e.message });
    }
});

// ==========================================
// API: CONFIGURATION
// ==========================================
app.get('/api/config', (req, res) => {
    res.json(CONFIG);
});

app.post('/api/config', async (req, res) => {
    try {
        await saveConfig(req.body);
        res.json({ success: true, config: CONFIG });
    } catch (e) {
        res.status(500).json({ error: 'Failed to save config' });
    }
});

import { runBacktest } from './analyze_strategy.js';

// Global Backtest Status Tracker
global.backtestStatus = {
    status: 'IDLE', // IDLE, RUNNING, COMPLETED, ERROR
    progress: 0,
    eta: 0,
    result: null,
    error: null
};

app.get('/api/backtest/status', (req, res) => {
    res.json(global.backtestStatus);
});

app.post('/api/backtest', async (req, res) => {
    if (global.backtestStatus.status === 'RUNNING') {
        return res.status(409).json({ error: 'Backtest already running' });
    }

    const { config, days } = req.body;
    // Handle both direct config (legacy) and wrapped { config, days } format
    const activeConfig = config || req.body;
    const backtestDays = days || activeConfig.SYSTEM?.FORETEST_DAYS || 10;

    console.log(`[BACKTEST] Starting simulation (Days: ${backtestDays})...`);

    // Reset Status
    global.backtestStatus = {
        status: 'RUNNING',
        progress: 0,
        eta: 0,
        result: null,
        error: null
    };

    // Return immediately
    res.json({ success: true, message: 'Backtest started' });

    // Run Async
    runBacktest(activeConfig, {
        days: backtestDays,
        verbose: false,
        onProgress: (pct, eta) => {
            global.backtestStatus.progress = pct;
            global.backtestStatus.eta = eta;
        }
    })
        .then(stats => {
            global.backtestStatus.status = 'COMPLETED';
            global.backtestStatus.progress = 100;
            global.backtestStatus.result = stats;
            console.log('[BACKTEST] Completed');
        })
        .catch(e => {
            console.error('[BACKTEST ERROR]', e);
            global.backtestStatus.status = 'ERROR';
            global.backtestStatus.error = e.message;
        });
});

import { optimizeStrategy } from './server/optimizer.js';

// ==========================================
// OPTIMIZATION & BACKTESTING
// ==========================================

// Global Status Tracker (Simple in-memory for single user)
global.optimizationStatus = {
    status: 'IDLE', // IDLE, RUNNING, COMPLETED, ERROR
    progress: 0,
    eta: 0, // Seconds
    result: null,
    error: null
};

app.get('/api/optimize/status', (req, res) => {
    res.json(global.optimizationStatus);
});

app.post('/api/optimize', async (req, res) => {
    try {
        if (global.optimizationStatus.status === 'RUNNING') {
            return res.status(409).json({ error: 'Optimization already running' });
        }

        const currentConfig = req.body.config || req.body; // Handle wrapped config
        const options = {
            days: req.body.days || 12 // Default 12 days
        };

        console.log(`[OPTIMIZER] Starting job. Days: ${options.days}`);

        // Reset Status
        global.optimizationStatus = {
            status: 'RUNNING',
            progress: 0,
            eta: 0,
            result: null,
            error: null
        };

        // Send immediate response
        res.json({ success: true, message: 'Optimization started' });

        // Run Async
        optimizeStrategy(currentConfig, {
            days: options.days,
            onProgress: (pct, eta) => {
                global.optimizationStatus.progress = pct;
                global.optimizationStatus.eta = eta;
            }
        })
            .then(result => {
                global.optimizationStatus.status = 'COMPLETED';
                global.optimizationStatus.progress = 100;
                global.optimizationStatus.result = result;
                console.log('[OPTIMIZER] Job Completed');
            })
            .catch(e => {
                console.error('[OPTIMIZER] Job Failed:', e);
                global.optimizationStatus.status = 'ERROR';
                global.optimizationStatus.error = e.message;
            });

    } catch (e) {
        console.error('Optimization request failed:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// ==========================================
// LOCAL PROXY ENDPOINT
// ==========================================
app.get('/api/proxy', async (req, res) => {
    const { url, method = 'GET', body } = req.query;
    if (!url) return res.status(400).json({ error: 'Missing url parameter' });

    try {
        console.log(`[PROXY] Fetching: ${url} [${method}]`);

        const options = {
            method: method,
            headers: { 'Content-Type': 'application/json' }
        };

        if (method === 'POST' && body) {
            options.body = body;
        }

        const response = await fetch(url, options);
        if (!response.ok) return res.status(response.status).json({ error: `Upstream error: ${response.statusText}` });
        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error(`[PROXY ERROR]`, error);
        res.status(500).json({ error: 'Failed to fetch data' });
    }
});

// ==========================================
// MEXC TRADING ENDPOINT (SECURE)
// ==========================================
app.post('/api/trade/mexc', async (req, res) => {
    const { symbol, side, price, quantity, type, marketType } = req.body; // Added marketType

    // 1. Try Environment Variables first
    let apiKey = process.env.MEXC_API_KEY;
    let apiSecret = process.env.MEXC_SECRET_KEY;

    // 2. Fallback to Saved Settings
    if (!apiKey || !apiSecret) {
        const settings = await getSettings();
        if (settings.mexcApiKey && settings.mexcApiSecret) {
            apiKey = settings.mexcApiKey;
            apiSecret = settings.mexcApiSecret;
        }
    }

    if (!apiKey || !apiSecret) {
        return res.status(500).json({ error: 'Server missing MEXC API Credentials. Configure them in App Settings or .env file.' });
    }

    try {
        const baseUrl = 'https://api.mexc.com'; // Spot Base URL
        const futuresBaseUrl = 'https://contract.mexc.com'; // Futures Base URL

        const timestamp = Date.now();

        if (marketType === 'FUTURES') {
            // MEXC FUTURES API LOGIC
            // Note: Futures API signature and endpoints differ slightly from Spot
            // This is a simplified implementation for V1 Contract API

            const body = {
                symbol,
                price: parseFloat(price),
                vol: parseFloat(quantity), // Futures uses 'vol' for quantity (cont)
                side: side === 'BUY' ? 1 : 3, // 1: Open Long, 3: Open Short (Simplified mapping)
                type: 1, // 1: Limit Order
                openType: 2, // 2: Isolated Margin
            };

            // Signature Logic for Futures (Usually Header based or different param structure)
            // For simplicity, we'll assume standard V1 signature pattern:
            // String to sign: apiKey + timestamp + bodyString
            const bodyString = JSON.stringify(body);
            const signString = apiKey + timestamp + bodyString;
            const signature = crypto.createHmac('sha256', apiSecret).update(signString).digest('hex');

            const url = `${futuresBaseUrl}/api/v1/private/order/submit`;

            console.log(`[TRADE FUTURES] Placing order on MEXC: ${symbol} ${side} ${quantity} @ ${price}`);

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Request-Time': timestamp.toString(),
                    'ApiKey': apiKey,
                    'Signature': signature,
                    'Content-Type': 'application/json'
                },
                body: bodyString
            });

            const data = await response.json();
            if (!data.success) {
                console.error('[TRADE ERROR FUTURES]', data);
                return res.status(400).json(data);
            }
            res.json(data);

        } else {
            // SPOT API LOGIC (Existing)
            let queryString = `symbol=${symbol}&side=${side}&type=${type}&quantity=${quantity}&price=${price}&timestamp=${timestamp}&recvWindow=5000`;

            const signature = crypto
                .createHmac('sha256', apiSecret)
                .update(queryString)
                .digest('hex');

            queryString += `&signature=${signature}`;

            const url = `${baseUrl}/api/v3/order?${queryString}`;

            console.log(`[TRADE SPOT] Placing order on MEXC: ${symbol} ${side} ${quantity} @ ${price}`);

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'X-MEXC-APIKEY': apiKey,
                    'Content-Type': 'application/json'
                }
            });

            const data = await response.json();

            if (!response.ok) {
                console.error('[TRADE ERROR SPOT]', data);
                return res.status(400).json(data);
            }
            res.json(data);
        }

    } catch (error) {
        console.error('[TRADE SERVER ERROR]', error);
        res.status(500).json({ error: 'Internal Server Error during Trade Execution' });
    }
});

// ==========================================
// HYPERLIQUID TRADING ENDPOINT
// ==========================================
app.post('/api/trade/hyperliquid', async (req, res) => {
    const { symbol, side, price, quantity } = req.body;

    // 1. Get Private Key
    let privateKey = process.env.HYPERLIQUID_PRIVATE_KEY;
    if (!privateKey) {
        const settings = await getSettings();
        if (settings.hyperliquidPrivateKey) {
            privateKey = settings.hyperliquidPrivateKey;
        }
    }

    if (!privateKey) {
        return res.status(500).json({ error: 'Server missing Hyperliquid Private Key.' });
    }

    try {
        // 2. Fetch Meta to get Asset Index
        console.log(`[HYPERLIQUID] Fetching metadata for ${symbol}...`);
        const metaResponse = await fetch('https://api.hyperliquid.xyz/info', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: "meta" })
        });

        if (!metaResponse.ok) throw new Error('Failed to fetch Hyperliquid metadata');

        const meta = await metaResponse.json();
        // Hyperliquid symbols are like 'BTC', 'ETH', 'SOL' (no USDT suffix)
        const cleanSymbol = symbol.replace('USDT', '');
        const asset = meta.universe.find(a => a.name === cleanSymbol);

        if (!asset) {
            return res.status(400).json({ error: `Asset ${cleanSymbol} not found on Hyperliquid` });
        }

        const assetIndex = meta.universe.indexOf(asset);
        console.log(`[HYPERLIQUID] Found ${cleanSymbol} at index ${assetIndex}`);

        // 3. Prepare Order
        const wallet = new ethers.Wallet(privateKey);
        const isBuy = side === 'BUY';
        const limitPx = parseFloat(price);
        const sz = parseFloat(quantity);

        // NOTE: In a real production environment, we would construct the full EIP-712 signature here.
        // Due to the complexity of Hyperliquid's custom EIP-712 types, we are simulating the successful signing
        // and logging the exact payload that WOULD be sent.

        const orderPayload = {
            asset: assetIndex,
            isBuy: isBuy,
            limitPx: limitPx,
            sz: sz,
            reduceOnly: false,
            orderType: { limit: { tif: "Gtc" } }
        };

        console.log(`[HYPERLIQUID] 🟢 SIMULATED ORDER EXECUTION`);
        console.log(`[HYPERLIQUID] Payload:`, JSON.stringify(orderPayload, null, 2));
        console.log(`[HYPERLIQUID] Signed by: ${wallet.address}`);

        // Simulate API delay
        await new Promise(resolve => setTimeout(resolve, 500));

        res.json({
            success: true,
            orderId: `HL-${Date.now()}-${assetIndex}`,
            message: `Order Placed (Simulated) for ${cleanSymbol}`
        });

    } catch (error) {
        console.error('[HYPERLIQUID ERROR]', error);
        res.status(500).json({ error: 'Hyperliquid Trade Failed: ' + error.message });
    }
});

// ==========================================
// GEMINI LLM ANALYSIS ENDPOINT
// ==========================================
app.post('/api/ai/analyze', async (req, res) => {
    const { prompt } = req.body;

    let apiKey = process.env.GEMINI_LLM_API_KEY;

    if (!apiKey) {
        const settings = await getSettings();
        if (settings.geminiLLMApiKey) {
            apiKey = settings.geminiLLMApiKey;
        }
    }

    if (!apiKey) {
        return res.status(500).json({ error: 'Server missing Gemini LLM API Key.' });
    }

    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`;

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }]
            })
        });

        const data = await response.json();

        if (!response.ok) {
            console.error('[GEMINI LLM ERROR]', data);
            return res.status(400).json(data);
        }

        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "No analysis generated.";
        res.json({ text });

    } catch (error) {
        console.error('[GEMINI LLM SERVER ERROR]', error);
        res.status(500).json({ error: 'Internal Server Error during AI Analysis' });
    }
});

// Handle React routing
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`
    🚀 Server running on http://localhost:${PORT}
    
    - Frontend: Serving /dist
    - Proxy:    Active at /api/proxy
    - Trading:  Active at /api/trade/mexc
    - AI:       Active at /api/ai/analyze
    `);
});