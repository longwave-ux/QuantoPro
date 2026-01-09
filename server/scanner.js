import { execFile } from 'child_process';
import util from 'util';
const execFilePromise = util.promisify(execFile);

// ... existing imports ...
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
import { McapService } from './mcapService.js';

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

        const mcap = McapService.getMcap(symbol);
        // --- LIVE MODE: PYTHON ---
        // We need the filename of the 15m data (LTF)
        // Format: data/{SOURCE}_{SYMBOL}_{INTERVAL}.json
        const ltfFilename = `${source}_${symbol}_${ltf}.json`;
        const ltfFilePath = path.join(DATA_DIR, ltfFilename);

        // Serialize Current Config for Python
        const configStr = JSON.stringify(CONFIG);

        let resultBase = null;

        try {
            const pythonScript = path.join(process.cwd(), 'market_scanner.py');
            const venvPython = path.join(process.cwd(), 'venv/bin/python');

            // Execute Python Script
            const { stdout } = await execFilePromise(venvPython, [pythonScript, ltfFilePath, '--strategy', 'all', '--config', configStr]);

            try {
                // Parse Python Output
                const pyResult = JSON.parse(stdout);

                // Handle Array (Multi-Strategy) or Object (Single)
                const pyResArray = Array.isArray(pyResult) ? pyResult : [pyResult];

                // Map Python Results to JS Structure
                resultBase = pyResArray.map(res => ({
                    ...res,
                    strategy_name: res.strategy_name || 'Legacy', // Explicit Fallback
                    timestamp: now,
                    source: source,
                    meta: { htfInterval: htf, ltfInterval: ltf },
                    details: { ...res.details, mcap: mcap }
                }));

                // Log first result for debug
                if (resultBase.length > 0) {
                    console.log(`[PYTHON-LIVE] ${symbol} | Score: ${resultBase[0].score?.toFixed(1)} | Bias: ${resultBase[0].htf?.bias}`);
                }

            } catch (jsonErr) {
                console.error(`[PYTHON PARSE ERROR] ${symbol}`, stdout);
                return null; // Skip if parse fails
            }

        } catch (pyErr) {
            console.error(`[PYTHON EXEC ERROR] ${symbol}`, pyErr.message);
            return null; // Skip if exec fails
        }

        if (!resultBase) return [];

        const resultsArray = Array.isArray(resultBase) ? resultBase : [resultBase];
        const processedResults = [];

        resultsArray.forEach(res => {
            // History Logic per result?
            // Note: History is keyed by Symbol. If multiple strategies for same symbol, 
            // they share/overwrite history. This is acceptable for now.
            // Ideally unique key like "Symbol-Strategy" but sticking to user request.

            let historyEntry = { consecutiveScans: 1, prevScore: 0, status: 'NEW' };

            if (history[symbol]) {
                const prev = history[symbol];
                const isRecent = (now - prev.timestamp) < (45 * 60 * 1000);

                if (isRecent) {
                    let status = 'STABLE';
                    if (res.score > prev.score + 5) status = 'STRENGTHENING';
                    else if (res.score < prev.score - 5) status = 'WEAKENING';

                    historyEntry = {
                        consecutiveScans: prev.consecutiveScans + 1,
                        prevScore: prev.score,
                        status
                    };
                }
            }

            if (res.score > CONFIG.THRESHOLDS.MIN_SCORE_TRENDING || (history[symbol] && res.score > CONFIG.THRESHOLDS.MIN_SCORE_TO_SAVE)) {
                let nextConsecutive = 1;
                if (history[symbol]) {
                    if (res.score > CONFIG.THRESHOLDS.MIN_SCORE_TRENDING) {
                        nextConsecutive = historyEntry.consecutiveScans;
                    } else {
                        nextConsecutive = history[symbol].consecutiveScans;
                    }
                }

                // Warn: Overwrite risk for same symbol
                nextHistory[symbol] = {
                    score: res.score,
                    timestamp: now,
                    consecutiveScans: nextConsecutive
                };
            }

            processedResults.push({
                ...res,
                history: historyEntry
            });
        });

        return processedResults;
    });

    const results = await Promise.all(promises);
    // Each promise now returns Array or Null
    return results.filter(r => r !== null).flat();
};

export const runServerScan = async (source = 'KUCOIN') => {
    Logger.info(`[SERVER SCAN] Starting scan for ${source}...`);

    // 1. Update outcomes of previous signals (Foretesting)
    await updateOutcomes();

    // 2. Refresh MCap Cache
    await McapService.init();
    const topPairs = await fetchTopVolumePairs(source);
    await McapService.refreshIfNeeded(topPairs);

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
        // batchResults is Array of Arrays of Objects (since we now return processedResults array)
        // Flatten 1 level (promises) -> Array of (Array|Null)
        // Filter Nulls (processed in processBatch usually returns null if error)
        // Actually processBatch returns results.filter(r => r!== null) at line 206.
        // Wait, line 206 inside processBatch needs update too!

        results.push(...batchResults.flat());

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
