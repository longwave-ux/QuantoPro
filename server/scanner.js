import { execFile } from 'child_process';
import util from 'util';
const execFilePromise = util.promisify(execFile);
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
        const tempPath = path.join(DATA_DIR, `latest_results_${source}.tmp`);

        // Atomic Write: Write to temp file, then rename
        if (results.length === 0) {
            Logger.warn(`[STORAGE WARNING] Attempted to save empty results for ${source}. Aborting to preserve previous data.`);
            return; // Abort save
        }

        // Atomic Write: Write to temp file, then rename
        await fs.writeFile(tempPath, JSON.stringify(results, null, 2));
        await fs.rename(tempPath, filePath);
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

export const getMasterFeed = async () => {
    try {
        const filePath = path.join(DATA_DIR, 'master_feed.json');
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

const processBatch = async (pairs, htf, ltf, source, now, history, nextHistory, strategy = 'all') => {
    // BATCH PROCESSING TO PREVENT CPU THRASHING
    const CHUNK_SIZE = 10;
    const chunks = [];
    for (let i = 0; i < pairs.length; i += CHUNK_SIZE) {
        chunks.push(pairs.slice(i, i + CHUNK_SIZE));
    }

    const allResults = [];

    for (const chunk of chunks) {
        const promises = chunk.map(async (symbol) => {
            const [htfData, ltfData] = await Promise.all([
                fetchCandles(symbol, htf, source),
                fetchCandles(symbol, ltf, source)
            ]);

            if (htfData.length === 0 || ltfData.length === 0) return null;

            const mcap = McapService.getMcap(symbol);
            const ltfFilename = `${source}_${symbol}_${ltf}.json`;
            const ltfFilePath = path.join(DATA_DIR, ltfFilename);
            const configStr = JSON.stringify(CONFIG);

            let resultBase = null;

            try {
                const pythonScript = path.join(process.cwd(), 'market_scanner.py');
                const venvPython = path.join(process.cwd(), 'venv/bin/python');

                // Pass the requested strategy to Python with TIMEOUT and ENV
                const { stdout, stderr } = await execFilePromise(venvPython, [pythonScript, ltfFilePath, '--strategy', strategy, '--symbol', symbol, '--config', configStr], {
                    timeout: 60000,
                    env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
                });

                if (stderr) {
                    const lines = stderr.split('\n');
                    lines.forEach(line => {
                        // Pass through critical debug info
                        if (line.includes('[SCORE-DEBUG]') ||
                            line.includes('[V2') ||
                            line.includes('Coinalyze') ||
                            line.includes(' - INFO - ') ||
                            line.includes('[DATA-DEBUG]')) {
                            // Use Logger to ensure it hits the log file
                            Logger.info(`[PY] ${line}`);
                        }
                        // Log 429 errors explicitly
                        if (line.includes('429')) {
                            Logger.error(line);
                        }
                    });
                }

                try {
                    const pyResult = JSON.parse(stdout);
                    const pyResArray = Array.isArray(pyResult) ? pyResult : [pyResult];

                    resultBase = pyResArray.map(res => ({
                        ...res,
                        strategy_name: res.strategy_name || 'Legacy',
                        timestamp: now,
                        source: source,
                        meta: { htfInterval: htf, ltfInterval: ltf },
                        details: { ...res.details, mcap: mcap }
                    }));

                } catch (jsonErr) {
                    console.error(`[PYTHON PARSE ERROR] ${symbol}`, stdout);
                    return null;
                }

            } catch (pyErr) {
                console.error(`[PYTHON EXEC ERROR] ${symbol}`, pyErr.message);
                return null;
            }

            if (!resultBase) return [];

            const resultsArray = Array.isArray(resultBase) ? resultBase : [resultBase];
            const processedResults = [];

            resultsArray.forEach(res => {
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

        const chunkResults = await Promise.all(promises);
        allResults.push(...chunkResults.filter(r => r !== null).flat());
    }

    return allResults;
};

// Global Scan Progress Tracker
export let scanStatus = { status: 'IDLE', progress: 0, total: 0, current: 0, eta: 0 };

let isScanning = false;

// Persistent timestamp storage (survives PM2 restarts)
const getLastScanTimestamps = async () => {
    try {
        const filePath = path.join(DATA_DIR, 'scanner_timestamps.json');
        const data = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(data);
    } catch {
        return {};
    }
};

const saveLastScanTimestamps = async (timestamps) => {
    try {
        const filePath = path.join(DATA_DIR, 'scanner_timestamps.json');
        await fs.writeFile(filePath, JSON.stringify(timestamps, null, 2));
    } catch (e) {
        Logger.error(`[STORAGE ERROR] Failed to save scanner timestamps`, e);
    }
};

// Load timestamps on startup
let lastLegacyScan = {};
let lastBreakoutScan = {};

(async () => {
    const timestamps = await getLastScanTimestamps();
    lastLegacyScan = timestamps.legacy || {};
    lastBreakoutScan = timestamps.breakout || {};
    Logger.info(`[SCANNER] Loaded timestamps: Legacy=${JSON.stringify(lastLegacyScan)}, Breakout=${JSON.stringify(lastBreakoutScan)}`);
})();

export const runServerScan = async (source = 'KUCOIN', strategy = 'all', force = false) => {
    if (isScanning) {
        Logger.info(`[SERVER SCAN] Skipped: Scan already in progress.`);
        return [];
    }
    isScanning = true;

    // Determine which strategies to run based on Last Run Time (if 'all' is requested)
    // If specific strategy requested (manual override), run it.
    // If force=true, skip interval checks and run immediately
    let targetStrategy = strategy;
    const now = Date.now();

    if (strategy === 'all' && !force) {
        const lastLeg = lastLegacyScan[source] || 0;
        const lastBrk = lastBreakoutScan[source] || 0;

        const runLegacy = (now - lastLeg) > CONFIG.SYSTEM.LEGACY_INTERVAL;
        const runBreakout = (now - lastBrk) > CONFIG.SYSTEM.BREAKOUT_INTERVAL;

        if (runLegacy && runBreakout) targetStrategy = 'all';
        else if (runBreakout) targetStrategy = 'Breakout';
        else if (runLegacy) targetStrategy = 'Legacy';
        else {
            // Nothing due yet
            Logger.info(`[SERVER SCAN] Skipped ${source}: No strategies due for execution.`);
            isScanning = false;
            return [];
        }

        if (runLegacy) lastLegacyScan[source] = now;
        if (runBreakout) lastBreakoutScan[source] = now;

        // Persist to disk
        await saveLastScanTimestamps({
            legacy: lastLegacyScan,
            breakout: lastBreakoutScan
        });
    } else if (force) {
        // Force mode: Update both timestamps to current time
        Logger.info(`[SERVER SCAN] Force mode enabled - bypassing interval checks`);
        lastLegacyScan[source] = now;
        lastBreakoutScan[source] = now;
        await saveLastScanTimestamps({
            legacy: lastLegacyScan,
            breakout: lastBreakoutScan
        });
    }

    Logger.info(`[SERVER SCAN] Starting scan for ${source} (Strategy: ${targetStrategy})...`);

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

    const BATCH_SIZE = 5; // Reduced from Config for Stability (Parallel V1/V2 execution)

    // Initialize Progress
    scanStatus = { status: 'RUNNING', progress: 0, total: topPairs.length, current: 0, eta: 0 };
    const startTime = Date.now();

    for (let i = 0; i < topPairs.length; i += BATCH_SIZE) {
        const batchPairs = topPairs.slice(i, i + BATCH_SIZE);
        const batchResults = await processBatch(batchPairs, htf, ltf, source, now, history, nextHistory, strategy);
        results.push(...batchResults.flat());

        // Update Progress
        const processed = Math.min(i + BATCH_SIZE, topPairs.length);
        const progress = Math.round((processed / topPairs.length) * 100);

        // Calculate ETA
        const elapsed = (Date.now() - startTime) / 1000; // seconds
        const rate = processed / (elapsed || 1); // symbols per second
        const remaining = topPairs.length - processed;
        const eta = Math.round(remaining / (rate || 0.1));

        scanStatus = {
            status: 'RUNNING',
            progress: progress,
            total: topPairs.length,
            current: processed,
            eta: eta
        };

        if (i + BATCH_SIZE < topPairs.length) {
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    await saveScanHistory(nextHistory);

    // --- PERSISTENCE & MERGE LOGIC ---
    let previousResults = [];
    try {
        const prevFile = path.join(DATA_DIR, `latest_results_${source}.json`);
        const data = await fs.readFile(prevFile, 'utf8');
        previousResults = JSON.parse(data);
    } catch (e) {
        // Ignore file not found
    }

    const resultMap = new Map();

    // 0. Preserve OTHER strategies if we are doing a partial update
    if (strategy !== 'all') {
        const preserved = previousResults.filter(r => r.strategy_name.toLowerCase() !== strategy.toLowerCase());
        preserved.forEach(r => {
            const key = `${r.symbol}_${r.strategy_name}`;
            resultMap.set(key, r);
        });
        Logger.info(`[SERVER SCAN] Preserved ${preserved.length} results from other strategies.`);
    }

    // 1. Add All New Results
    results.forEach(r => {
        const key = `${r.symbol}_${r.strategy_name}`;
        resultMap.set(key, r);
    });

    // 2. Merge Sticky Signals (Breakout > 80, < 24h)
    // Only if we are running Breakout or All? Or always check sticky?
    // Always check sticky from previousResults to ensure they persist.

    const STICKY_THRESHOLD = 80;
    const STICKY_DURATION = 24 * 60 * 60 * 1000; // 24 Hours
    const stickySignals = previousResults.filter(r => {
        if (r.strategy_name !== 'Breakout') return false;
        if (r.score < STICKY_THRESHOLD) return false;
        const age = now - (r.timestamp || 0);
        return age < STICKY_DURATION;
    });

    stickySignals.forEach(s => {
        const key = `${s.symbol}_${s.strategy_name}`;
        const existing = resultMap.get(key);

        if (!existing) {
            resultMap.set(key, s);
        } else {
            // Keep the one with higher score (Max Visibility)
            if (existing.score < s.score) {
                resultMap.set(key, s);
            }
        }
    });

    const mergedResults = Array.from(resultMap.values());

    // [MERGE FIX] Load previous results to preserve strategies not updated in this run
    let existingFeedData = [];
    try {
        const prevPath = path.join(DATA_DIR, `latest_results_${source}.json`);
        const prevData = await fs.readFile(prevPath, 'utf-8');
        existingFeedData = JSON.parse(prevData);
    } catch (e) { }

    const preservedResults = existingFeedData.filter(r => {
        if (targetStrategy === 'all') return false;
        if (targetStrategy === 'Legacy') return r.strategy_name !== 'Legacy';
        if (targetStrategy === 'Breakout') return r.strategy_name !== 'Breakout'; // Preserves V2 if only V1 ran
        if (targetStrategy === 'BreakoutV2') return r.strategy_name !== 'BreakoutV2';
        return true;
    });

    // Combine new and preserved
    const allCandidates = [...preservedResults, ...mergedResults];

    await saveScanHistory(nextHistory);

    // --- QUOTA LOGIC (Applied to Unified List) ---
    const legacyAll = allCandidates.filter(r => r.strategy_name === 'Legacy').sort((a, b) => b.score - a.score);
    const breakoutAll = allCandidates.filter(r => r.strategy_name === 'Breakout').sort((a, b) => b.score - a.score);
    const breakoutV2All = allCandidates.filter(r => r.strategy_name === 'BreakoutV2').sort((a, b) => b.score - a.score);

    Logger.info(`[SCAN DEBUG] Candidates Count: Legacy=${legacyAll.length}, Breakout=${breakoutAll.length}, BreakoutV2=${breakoutV2All.length}`);

    const legacySelected = legacyAll.slice(0, 20);
    const breakoutSelected = breakoutAll.filter((r, index) => {
        const isTop20 = index < 20;
        const isHighValue = r.score > 80;
        return isTop20 || isHighValue;
    });

    // Select V2 with same logic as Breakout
    const breakoutV2Selected = breakoutV2All.filter((r, index) => {
        const isTop20 = index < 20;
        const isHighValue = r.score > 80;
        return isTop20 || isHighValue;
    });

    const finalResults = [...legacySelected, ...breakoutSelected, ...breakoutV2Selected].sort((a, b) => b.score - a.score);

    await saveLatestResults(finalResults, source);

    // [NEW] Trigger Master Aggregator
    try {
        const aggregatorScript = path.join(process.cwd(), 'results_aggregator.py');
        const venvPython = path.join(process.cwd(), 'venv/bin/python'); // Use venv python
        await execFilePromise(venvPython, [aggregatorScript]);
        Logger.info('[AGGREGATOR] Master feed updated.');
    } catch (e) {
        Logger.error('[AGGREGATOR] Failed to update master feed', e);
    }

    await appendSignalLog(finalResults);
    await registerSignals(finalResults);
    await sendTelegramAlert(finalResults);

    Logger.info(`[SERVER SCAN] Complete. Saved ${finalResults.length} results.`);
    isScanning = false;
    scanStatus = { status: 'IDLE', progress: 100, total: 0, current: 0, eta: 0 };
    return finalResults;
};
