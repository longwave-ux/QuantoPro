
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HISTORY_FILE = path.join(__dirname, 'data/trade_history.json');

const cleanup = async () => {
    try {
        console.log("Reading history...");
        const data = await fs.readFile(HISTORY_FILE, 'utf-8');
        const history = JSON.parse(data);
        
        const total = history.length;
        const closed = history.filter(t => t.status === 'CLOSED').length;
        
        // Keep only OPEN trades
        // Also, for OPEN trades, ensure 'isFilled' is initialized to false if undefined
        const cleanHistory = history.filter(t => t.status === 'OPEN').map(t => ({
            ...t,
            isFilled: t.isFilled || false
        }));
        
        console.log(`Total Trades: ${total}`);
        console.log(`Closed (Unsure/Deleted): ${closed}`);
        console.log(`Remaining (Open/Reset): ${cleanHistory.length}`);
        
        await fs.writeFile(HISTORY_FILE, JSON.stringify(cleanHistory, null, 2));
        console.log("Cleanup complete.");
        
    } catch (e) {
        console.error("Error during cleanup:", e);
    }
};

cleanup();
