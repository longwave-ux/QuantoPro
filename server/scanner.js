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

    // --- PERSISTENCE LOGIC START ---
    // Load Previous Results to find "Sticky" signals (Breakout > 80, < 24h old)
    let previousResults = [];
    try {
        const prevFile = path.join(DATA_DIR, `latest_results_${source}.json`);
        const data = await fs.readFile(prevFile, 'utf8');
        previousResults = JSON.parse(data);
    } catch (e) {
        // Ignore file not found
    }

    // Filter for Sticky Signals
    const STICKY_THRESHOLD = 80;
    const STICKY_DURATION = 24 * 60 * 60 * 1000; // 24 Hours
    const stickySignals = previousResults.filter(r => {
        if (r.strategy_name !== 'Breakout') return false;
        if (r.score < STICKY_THRESHOLD) return false;
        const age = now - (r.timestamp || 0);
        return age < STICKY_DURATION;
    });

    Logger.info(`[SERVER SCAN] Found ${stickySignals.length} sticky signals to preserve.`);

    // Merge Logic:
    // 1. Create a Map of New Results key = Symbol + Strategy
    // 2. Add Sticky Signals if they aren't in New Results (or if New Result score is lower? User wants display)
    // POLICY: If Sticky exists, we keep the Sticky version? Or just ensure it's in the list?
    // User said: "displayed for 24h".
    // Let's add them to the pool. If duplicate (Symbol+Strategy), use the Higher Score one?
    // Actually, if New Scan says Score 0 (Wait), but Old was 95, we want to see the 95.
    // So Max(Old, New) seems appropriate for visibility.

    const resultMap = new Map();

    // 1. Add All New Results
    results.forEach(r => {
        const key = `${r.symbol}_${r.strategy_name}`;
        resultMap.set(key, r);
    });

    // 2. Merge Sticky
    stickySignals.forEach(s => {
        const key = `${s.symbol}_${s.strategy_name}`;
        const existing = resultMap.get(key);

        if (!existing) {
            // New scan didn't find this (was filtered out or failed), restore sticky
            resultMap.set(key, s);
        } else {
            // Conflict. Existing is New Scan. Sticky is Old.
            // If New Scan score < Sticky, revert to Sticky to keep it visible?
            // "displayed for 24h" implies we show the signal.
            if (existing.score < s.score) {
                resultMap.set(key, s);
            }
        }
    });

    const mergedResults = Array.from(resultMap.values());
    // --- PERSISTENCE LOGIC END ---

    await saveScanHistory(nextHistory);

    // --- QUOTA LOGIC START ---
    // User Requirement: "Keep top 10 Legacy and top 5 Breakout"
    // Plus: "Breakout > 80 displayed for 24h" (Sticky)

    // 1. Separate by Strategy
    const legacyAll = mergedResults.filter(r => r.strategy_name === 'Legacy').sort((a, b) => b.score - a.score);
    const breakoutAll = mergedResults.filter(r => r.strategy_name === 'Breakout').sort((a, b) => b.score - a.score);

    // 2. Select Legacy (Top 20)
    const legacySelected = legacyAll.slice(0, 20);

    // 3. Select Breakout (Top 20 + All Sticky > 80)
    // Sticky signals are already in 'mergedResults' due to previous step.
    // We just need to ensure we select:
    //  a) The Top 20 (regardless of score)
    //  b) Any others with Score > 80 (which are effectively "Sticky" high quality)

    const breakoutSelected = breakoutAll.filter((r, index) => {
        const isTop20 = index < 20;
        const isHighValue = r.score > 80;
        return isTop20 || isHighValue;
    });

    // 4. Combine & Final Sort
    const finalResults = [...legacySelected, ...breakoutSelected].sort((a, b) => b.score - a.score);

    // Safety Limit: If for some reason we have 1000 > 80 score breakouts (unlikely), 
    // we might want a hard cap, but 50 is safe for the UI.
    // finalResults is effectively Limited by (10 + max(5, count(>80))).
    // --- QUOTA LOGIC END ---

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
