
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HISTORY_FILE = path.join(__dirname, 'data/trade_history.json');

const deduplicate = async () => {
    try {
        console.log("Reading history...");
        const data = await fs.readFile(HISTORY_FILE, 'utf-8');
        let history = JSON.parse(data);
        
        console.log(`Original Total Trades: ${history.length}`);

        // 1. Sort by timestamp
        history.sort((a, b) => a.signalTimestamp - b.signalTimestamp);

        const finalHistory = [];
        const activeTrades = new Map(); // Symbol -> Trade

        for (const trade of history) {
            const symbol = trade.symbol;
            const active = activeTrades.get(symbol);

            if (!active) {
                // No active trade for this symbol, add it
                activeTrades.set(symbol, trade);
                finalHistory.push(trade);
                continue;
            }

            // Check if the active trade is actually finished before this new one starts
            // We use exitDate if available.
            let activeIsFinished = false;
            if (active.status === 'CLOSED' && active.exitDate) {
                const exitTime = new Date(active.exitDate).getTime();
                if (exitTime < trade.signalTimestamp) {
                    activeIsFinished = true;
                }
            }

            if (activeIsFinished) {
                // Active trade finished, this is a new valid trade
                activeTrades.set(symbol, trade);
                finalHistory.push(trade);
            } else {
                // Conflict: Active trade is still running or pending
                
                // Case 1: Active is OPEN (Pending) -> Replace it
                // We assume OPEN trades that are NOT filled are pending.
                // Even if isFilled is true, if it's OPEN, it's "running".
                // But wait, if it's OPEN and FILLED, we should NOT replace it (it's active).
                // If it's OPEN and NOT FILLED, we REPLACE it.
                
                if (active.status === 'OPEN' && !active.isFilled) {
                    // Replace the pending setup with the newer one
                    // Remove active from finalHistory
                    const index = finalHistory.indexOf(active);
                    if (index > -1) {
                        finalHistory.splice(index, 1);
                    }
                    // Set new trade
                    activeTrades.set(symbol, trade);
                    finalHistory.push(trade);
                } 
                // Case 2: Active is CLOSED (Finished) or OPEN+FILLED (Running)
                // We ignore the new trade (Stacking protection)
                else {
                    // Drop 'trade'. Do nothing.
                }
            }
        }

        console.log(`Cleaned Total Trades: ${finalHistory.length}`);
        console.log(`Removed: ${history.length - finalHistory.length} duplicates/stacked trades.`);

        await fs.writeFile(HISTORY_FILE, JSON.stringify(finalHistory, null, 2));
        console.log("Deduplication complete.");

    } catch (e) {
        console.error("Error during deduplication:", e);
    }
};

deduplicate();
