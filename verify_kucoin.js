
import fetch from 'node-fetch';

const BASE_URL = 'https://api-futures.kucoin.com';

const test = async () => {
    try {
        // 1. Get Contracts/Top Pairs
        console.log('Fetching active contracts...');
        const contractsRes = await fetch(`${BASE_URL}/api/v1/contracts/active`);
        const contractsData = await contractsRes.json();

        if (contractsData.code !== '200000') {
            console.error('Failed to fetch contracts:', contractsData);
            return;
        }

        const contracts = contractsData.data;
        console.log(`Found ${contracts.length} contracts.`);

        // Find a USDT pair
        const pair = contracts.find(c => c.symbol === 'XBTUSDTM') || contracts[0];
        console.log('Selected Pair:', pair.symbol);
        console.log('Volume/Turnover keys:', Object.keys(pair).filter(k => k.toLowerCase().includes('volume') || k.toLowerCase().includes('turnover')));
        console.log('Sample Contract Data:', JSON.stringify(pair, null, 2));

        // 2. Fetch Candles
        console.log(`Fetching 15m candles for ${pair.symbol}...`);
        // Granularity: 15 (minutes) or 15m? Docs say minutes (int) for some endpoints, '15min' for others.
        // Let's try 15 first (common for futures)

        let klineUrl = `${BASE_URL}/api/v1/kline/query?symbol=${pair.symbol}&granularity=15`;
        let klineRes = await fetch(klineUrl);
        let klineData = await klineRes.json();

        if (klineData.code !== '200000') {
            console.log('Retrying with granularity="15min" (Spot style)...');
            klineUrl = `${BASE_URL}/api/v1/kline/query?symbol=${pair.symbol}&granularity=15min`;
            klineRes = await fetch(klineUrl);
            klineData = await klineRes.json();
        }

        if (klineData.code !== '200000') {
            console.error('Failed to fetch candles:', klineData);
            return;
        }

        const candles = klineData.data;
        console.log(`Fetched ${candles.length} candles.`);
        if (candles.length > 0) {
            console.log('Sample Candle (Raw):', candles[0]);
            // Check mapping
            // Usually: [time, open, high, low, close, volume]
            const [time, open, high, low, close, volume] = candles[0];
            console.log('Time:', new Date(time).toISOString());
            console.log('Open:', open, 'High:', high, 'Low:', low, 'Close:', close, 'Vol:', volume);
        }

    } catch (e) {
        console.error('Error:', e);
    }
};

test();
