
import { fetchCandles, fetchTopVolumePairs } from './server/marketData.js';

const verify = async () => {
    try {
        console.log('--- Verifying KuCoin Futures Integration ---');

        // 1. Top Pairs
        console.log('\nFetching Top Volume Pairs (KUCOIN)...');
        const pairs = await fetchTopVolumePairs('KUCOIN');
        console.log(`Received ${pairs.length} pairs.`);
        if (pairs.length > 0) {
            console.log('Top 3:', pairs.slice(0, 3));
            if (pairs[0].endsWith('M')) {
                console.log('SUCCESS: Symbol format looks correct (Ends with M for USDT Margined on KuCoin if mapped? Wait, KuCoin symbol is XBTUSDTM usually).');
            } else {
                console.log('WARNING: Symbol format might be different than expected:', pairs[0]);
            }
        } else {
            console.error('FAILURE: No pairs returned.');
        }

        // 2. Candles
        const testSymbol = pairs.length > 0 ? pairs[0] : 'XBTUSDTM';
        console.log(`\nFetching 15m Candles for ${testSymbol}...`);
        const candles = await fetchCandles(testSymbol, '15m', 'KUCOIN', 50);

        console.log(`Received ${candles.length} candles.`);
        if (candles.length > 0) {
            const last = candles[candles.length - 1];
            console.log('Last Candle:', last);
            if (last.close > 0 && last.volume >= 0) {
                console.log('SUCCESS: Candle data looks valid.');
            }
        } else {
            console.error('FAILURE: No candles returned.');
        }

    } catch (e) {
        console.error('VERIFICATION FAILED:', e);
    }
};

verify();
