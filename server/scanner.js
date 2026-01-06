import fetch from 'node-fetch';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { sendTelegramAlert } from './telegram.js';
import { fetchCandles, fetchTopVolumePairs } from './marketData.js';
import { registerSignals, updateOutcomes } from './tracker.js';
import { CONFIG } from './config.js';
import { AnalysisEngine } from './analysis.js';
import { Logger } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '../data');

// Ensure data directory exists
await fs.mkdir(DATA_DIR, { recursive: true });

// ==========================================
// STORAGE ADAPTER (FILE SYSTEM)
// ==========================================
const getScanHistory = async () => {
    try {
        const filePath = path.join(DATA_DIR, 'history.json');
        const data = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(data);
    } catch {
        return {};
    }
};

const saveScanHistory = async (history) => {
    try {
        const filePath = path.join(DATA_DIR, 'history.json');
        await fs.writeFile(filePath, JSON.stringify(history, null, 2));
    } catch (e) {
        Logger.error(`[STORAGE ERROR] Failed to save history`, e);
    }
};

export const saveLatestResults = async (results, source = 'KUCOIN') => {
    try {
        const filePath = path.join(DATA_DIR, `latest_results_${source}.json`);
        await fs.writeFile(filePath, JSON.stringify(results, null, 2));
    } catch (e) {
        Logger.error(`[STORAGE ERROR] Failed to save latest results for ${source}`, e);
    }
};

export const getLatestResults = async (source = 'KUCOIN') => {
    try {
        // Fallback for backward compatibility or if specific file doesn't exist
        let filePath = path.join(DATA_DIR, `latest_results_${source}.json`);

        // Check if file exists, if not try the old generic file
        try {
            await fs.access(filePath);
        } catch {
            filePath = path.join(DATA_DIR, 'latest_results.json');
        }

        const data = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(data);
    } catch {
        return [];
    }
};

const appendSignalLog = async (results) => {
    try {
        const filePath = path.join(DATA_DIR, 'signal_log.jsonl');
        const highQuality = results.filter(r => r.score >= 80);

        if (highQuality.length === 0) return;

        const lines = highQuality.map(r => JSON.stringify({
            timestamp: new Date().toISOString(),
            symbol: r.symbol,
            score: r.score,
            price: r.price,
            bias: r.htf.bias,
            setup: r.setup
        })).join('\n') + '\n';

        await fs.appendFile(filePath, lines);
    } catch (e) {
        Logger.error(`[STORAGE ERROR] Failed to append signal log`, e);
    }
};



// ==========================================
// WORKFLOW
// ==========================================
const processBatch = async (pairs, htf, ltf, source, now, history, nextHistory) => {
    const promises = pairs.map(async (symbol) => {
        const [htfData, ltfData] = await Promise.all([
            fetchCandles(symbol, htf, source),
            fetchCandles(symbol, ltf, source)
        ]);

        if (htfData.length === 0 || ltfData.length === 0) return null;

        const resultBase = AnalysisEngine.analyzePair(symbol, htfData, ltfData, htf, ltf, now, source);

        let historyEntry = { consecutiveScans: 1, prevScore: 0, status: 'NEW' };

        if (history[symbol]) {
            const prev = history[symbol];
            const isRecent = (now - prev.timestamp) < (45 * 60 * 1000);

            if (isRecent) {
                let status = 'STABLE';
                if (resultBase.score > prev.score + 5) status = 'STRENGTHENING';
                else if (resultBase.score < prev.score - 5) status = 'WEAKENING';

                historyEntry = {
                    consecutiveScans: prev.consecutiveScans + 1,
                    prevScore: prev.score,
                    status
                };
            }
        }

        if (resultBase.score > CONFIG.THRESHOLDS.MIN_SCORE_TRENDING || (history[symbol] && resultBase.score > CONFIG.THRESHOLDS.MIN_SCORE_TO_SAVE)) {
            // PRO TRADER LOGIC:
            // If score > 50: Trend is active, increment consistency (prev + 1).
            // If score 30-50: Trend is consolidating/pulling back. PAUSE consistency (keep prev), don't reset.
            // This allows a trend to breathe without losing its "seniority".
            let nextConsecutive = 1;
            if (history[symbol]) {
                if (resultBase.score > CONFIG.THRESHOLDS.MIN_SCORE_TRENDING) {
                    nextConsecutive = historyEntry.consecutiveScans; // Already incremented above
                } else {
                    nextConsecutive = history[symbol].consecutiveScans; // Pause (no increment)
                }
            }

            nextHistory[symbol] = {
                score: resultBase.score,
                timestamp: now,
                consecutiveScans: nextConsecutive
            };
        }

        return {
            ...resultBase,
            history: historyEntry
        };
    });

    const results = await Promise.all(promises);
    return results.filter(r => r !== null);
};

export const runServerScan = async (source = 'KUCOIN') => {
    Logger.info(`[SERVER SCAN] Starting scan for ${source}...`);

    // 1. Update outcomes of previous signals (Foretesting)
    await updateOutcomes();

    const topPairs = await fetchTopVolumePairs(source);
    const results = [];
    const htf = CONFIG.SCANNERS.HTF;
    const ltf = CONFIG.SCANNERS.LTF;

    const history = await getScanHistory();
    const nextHistory = {};
    const now = Date.now();

    const BATCH_SIZE = CONFIG.SYSTEM.BATCH_SIZE;
    for (let i = 0; i < topPairs.length; i += BATCH_SIZE) {
        const batchPairs = topPairs.slice(i, i + BATCH_SIZE);
        const batchResults = await processBatch(batchPairs, htf, ltf, source, now, history, nextHistory);
        results.push(...batchResults);

        if (i + BATCH_SIZE < topPairs.length) {
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    await saveScanHistory(nextHistory);

    const finalResults = results.sort((a, b) => b.score - a.score).slice(0, 20);
    await saveLatestResults(finalResults, source);

    // Log high-quality signals for historical consistency analysis
    await appendSignalLog(finalResults);

    // Register for Foretesting
    await registerSignals(finalResults);

    // Send Telegram Alerts
    await sendTelegramAlert(finalResults);

    Logger.info(`[SERVER SCAN] Complete. Found ${finalResults.length} results.`);
    return finalResults;
};
