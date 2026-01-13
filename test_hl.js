
import fetch from 'node-fetch';

const testHyperliquid = async () => {
    try {
        // Test Meta and Asset Contexts (for volume)
        const res = await fetch('https://api.hyperliquid.xyz/info', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'metaAndAssetCtxs' })
        });
        const data = await res.json();
        console.log('Universe size:', data[0].universe.length);
        console.log('Asset Ctxs size:', data[1].length);
        console.log('First Coin:', data[0].universe[0]);
        console.log('First Ctx:', data[1][0]);

        // Test Candles
        const coin = data[0].universe[0].name; // e.g. BTC
        const candleRes = await fetch('https://api.hyperliquid.xyz/info', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'candleSnapshot',
                req: {
                    coin: coin,
                    interval: '15m',
                    startTime: Date.now() - 24 * 60 * 60 * 1000 // 1 day ago
                }
            })
        });
        const candles = await candleRes.json();
        console.log('Candles:', candles.slice(0, 2));

    } catch (e) {
        console.error(e);
    }
};

testHyperliquid();
