import { fetchCandles } from './server/marketData.js';

async function test() {
    console.log("Fetching HL Candles for LINK...");
    const data = await fetchCandles('LINKUSDT', '15m', 'HYPERLIQUID');
    console.log("Result Length:", data.length);
    if (data.length > 0) {
        console.log("Sample:", data[data.length - 1]);
    } else {
        console.error("No candles fetched!");
    }
}

test();
