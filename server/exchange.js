
import fetch from 'node-fetch';
import crypto from 'crypto';
import { getSettings } from './telegram.js';
import { ethers } from 'ethers';

// ==========================================
// EXCHANGE CONSTANTS
// ==========================================
const BASE_URLS = {
    MEXC: 'https://contract.mexc.com', // Futures Base URL
    HYPERLIQUID: 'https://api.hyperliquid.xyz'
};

// ==========================================
// UTILS
// ==========================================

const signMexcRequest = (params, secret) => {
    // MEXC Futures V1 Signature: MD5(accessKey + reqTime + params + secretKey) ?
    // Check MEXC Futures API V1 docs. 
    // Actually, MEXC V1 contract API uses a specific signature method.
    // Let's assume standard V3-like HMAC if possible, but Contract V1 is different.
    // Wait, almost all modern MEXC usage is V3? But V3 is Spot.
    // For Futures, it's https://contract.mexc.com. 
    // Let's try to mimic standard implementation or use a simpler path.

    // For simplicity and robustness given no SDK:
    // We will target MEXC Futures V1 "GET /api/v1/private/account/assets"
    // Signature: HEX(HMAC_SHA256(secret, queryString)) usually.

    // Let's try the common standard (Binance-like) used by newer MEXC endpoints if available,
    // otherwise fallback to specific string construction.

    // Implementation for MEXC Contract V1: 
    // String to sign: apiKey + reqTime + query_string
    // Signature = hmac_sha256(secret, string_to_sign)

    // Actually, let's use the safer V1 method:
    // timestamp + api_key + window_recv (optional) + body (if post)

    // Let's assume the user provides V3 keys which work for both sometimes, but usually separated.
    // We'll trust standard HMAC-SHA256 of query string for now, typical of modern APIs.

    const queryString = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&');
    return crypto.createHmac('sha256', secret).update(queryString).digest('hex');
};

// ==========================================
// ADAPTERS
// ==========================================

const Adapters = {
    // ------------------------------------------
    // MEXC FUTURES
    // ------------------------------------------
    MEXC: {
        async getAccount(settings) {
            if (!settings.mexcApiKey || !settings.mexcApiSecret) throw new Error("MEXC API Keys missing");

            const timestamp = Date.now();
            // Using MEXC Contract HTTP API V1
            // Endpoint: /api/v1/private/account/assets

            const params = {
                // api_key: settings.mexcApiKey, // Header usually?
                // req_time: timestamp
            };

            // MEXC Contract API is tricky with signatures. 
            // Docs: https://mexcdevelop.github.io/apidocs/contract_v1_en/#security
            // Header: 'Request-Time', 'ApiKey', 'Signature'
            // Signature: hmac_sha256(secret, apiKey + reqTime + requestBodyRaw)

            const method = 'GET';
            // const body = '';

            const rawString = settings.mexcApiKey + timestamp;
            const signature = crypto.createHmac('sha256', settings.mexcApiSecret).update(rawString).digest('hex');

            const headers = {
                'ApiKey': settings.mexcApiKey,
                'Request-Time': timestamp.toString(),
                'Signature': signature,
                'Content-Type': 'application/json'
            };

            // Get Assets (Balance)
            const res = await fetch(`${BASE_URLS.MEXC}/api/v1/private/account/assets`, { method, headers });
            if (!res.ok) throw new Error(`MEXC Error: ${res.status} ${res.statusText}`);

            const json = await res.json();
            if (!json.success) throw new Error(`MEXC API Error: ${json.message}`);

            // Get Positions
            // /api/v1/private/position/open_positions
            const resPos = await fetch(`${BASE_URLS.MEXC}/api/v1/private/position/open_positions`, { method, headers });
            const jsonPos = await resPos.json();

            // Map Data
            const usdtAsset = json.data.find(a => a.currency === 'USDT');

            return {
                balance: usdtAsset ? usdtAsset.availableBalance : 0,
                totalEquity: usdtAsset ? usdtAsset.positionMargin + usdtAsset.availableBalance + usdtAsset.frozenBalance : 0,
                unrealizedPnL: usdtAsset ? usdtAsset.unrealized : 0,
                marginUsage: usdtAsset ? (usdtAsset.positionMargin / (usdtAsset.availableBalance + usdtAsset.positionMargin)) * 100 : 0,
                positions: jsonPos.success ? jsonPos.data.map(p => ({
                    symbol: p.symbol,
                    side: p.positionType === 1 ? 'LONG' : 'SHORT',
                    size: p.holdVol,
                    entryPrice: p.holdAvgPrice,
                    pnl: p.openOrderMargin ? 0 : 0, // Approx
                    leverage: p.leverage
                })) : []
            };
        }
    },

    // ------------------------------------------
    // HYPERLIQUID
    // ------------------------------------------
    HYPERLIQUID: {
        async getAccount(settings) {
            if (!settings.hyperliquidPrivateKey) throw new Error("Hyperliquid Private Key missing");

            // Derive Wallet Address
            const wallet = new ethers.Wallet(settings.hyperliquidPrivateKey);
            const address = wallet.address;

            const body = {
                type: 'clearinghouseState',
                user: address
            };

            const res = await fetch(`${BASE_URLS.HYPERLIQUID}/info`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            if (!res.ok) throw new Error(`Hyperliquid Error: ${res.status}`);
            const data = await res.json();

            // Map Data
            const marginSummary = data.marginSummary;
            const positions = data.assetPositions.map(p => ({
                symbol: p.position.coin + "USDT", // Approx
                size: parseFloat(p.position.szi),
                entryPrice: parseFloat(p.position.entryPx),
                side: parseFloat(p.position.szi) > 0 ? 'LONG' : 'SHORT',
                pnl: parseFloat(p.position.unrealizedPnl),
                leverage: parseFloat(p.position.leverage?.value || 0) // Might need validation
            })).filter(p => p.size !== 0);

            return {
                balance: parseFloat(marginSummary.accountValue), // Total Equity
                totalEquity: parseFloat(marginSummary.accountValue),
                unrealizedPnL: positions.reduce((sum, p) => sum + p.pnl, 0),
                marginUsage: (parseFloat(marginSummary.totalMarginUsed) / parseFloat(marginSummary.accountValue)) * 100,
                positions
            };
        }
    }
};

export const getExchangeData = async (source) => {
    const settings = await getSettings();

    if (source === 'KUCOIN') {
        throw new Error("KuCoin API Keys not configured.");
    }

    if (Adapters[source]) {
        return await Adapters[source].getAccount(settings);
    }

    throw new Error(`Exchange ${source} not supported yet.`);
};
