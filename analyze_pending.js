
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HISTORY_FILE = path.join(__dirname, 'data/trade_history.json');

const analyzePending = async () => {
    try {
        const data = await fs.readFile(HISTORY_FILE, 'utf-8');
        const history = JSON.parse(data);
        
        const pending = history.filter(t => t.status === 'OPEN' && !t.isFilled);
        const now = Date.now();
        
        console.log(`Total Pending Setups: ${pending.length}`);
        
        if (pending.length === 0) return;

        // Sort by age (oldest first)
        pending.sort((a, b) => a.signalTimestamp - b.signalTimestamp);

        console.log("\n--- Age Distribution of Pending Setups ---");
        const ages = pending.map(t => {
            const ageMs = now - t.signalTimestamp;
            const ageHours = ageMs / (1000 * 60 * 60);
            return ageHours;
        });

        const olderThan24h = ages.filter(a => a > 24).length;
        const olderThan12h = ages.filter(a => a > 12).length;
        const olderThan4h = ages.filter(a => a > 4).length;

        console.log(`> 24 Hours: ${olderThan24h}`);
        console.log(`> 12 Hours: ${olderThan12h}`);
        console.log(`> 4 Hours: ${olderThan4h}`);
        console.log(`Oldest: ${Math.max(...ages).toFixed(1)} hours`);
        console.log(`Newest: ${Math.min(...ages).toFixed(1)} hours`);

        console.log("\n--- Sample Old Pending Setups ---");
        pending.slice(0, 5).forEach(t => {
            const age = ((now - t.signalTimestamp) / (1000 * 60 * 60)).toFixed(1);
            console.log(`${t.symbol} (${t.side}): ${age} hours old. Score at creation: ${t.score}`);
        });

    } catch (e) {
        console.error(e);
    }
};

analyzePending();
