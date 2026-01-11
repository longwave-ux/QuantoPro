import { fetchTopVolumePairs } from './server/marketData.js';
import { CONFIG } from './server/config.js';

const test = async () => {
    try {
        console.log("Fetching top pairs for MEXC...");
        const pairs = await fetchTopVolumePairs('MEXC');
        console.log(`Found ${pairs.length} pairs for MEXC`);
        if (pairs.length > 0) {
            console.log("Sample:", pairs.slice(0, 5));
        }
    } catch (e) {
        console.error("Error fetching pairs:", e);
    }
};

test();
