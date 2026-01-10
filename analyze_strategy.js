import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { AnalysisEngine } from './server/analysis.js';
import { CONFIG } from './server/config.js';
import { execFile } from 'child_process';
import util from 'util';

const execFilePromise = util.promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, 'data');

// 1 Day = 96 candles (15m)
const getCandlesFromDays = (days) => Math.ceil(days * 24 * 4);

const parseFilename = (filename) => {
    const parts = filename.split('_');
    const source = parts[0];
    const timeframe = parts[parts.length - 1].replace('.json', '');
    const symbolParts = parts.slice(1, parts.length - 1);
    const symbol = symbolParts.join('_');
    return { source, symbol, timeframe };
};

const getFutureOutcome = (candles, startIndex, entry, tp, sl, side, config) => {
    // Look ahead up to 24 hours (96 candles of 15m)
    const LOOKAHEAD = 96;
    const timeLimit = (config?.RISK?.ENABLE_TIME_BASED_STOP && config?.RISK?.TIME_BASED_STOP_CANDLES)
        ? config.RISK.TIME_BASED_STOP_CANDLES
        : LOOKAHEAD;

    let isFilled = false;
    let fillIndex = -1;

    for (let i = startIndex + 1; i < Math.min(candles.length, startIndex + LOOKAHEAD); i++) {
        const c = candles[i];

        // 1. Check for Fill (Limit Order Logic)
        if (!isFilled) {
            // Expiry Check (Signal Valid for X hours?)
            // For now, let's say signal is valid for entire lookahead, but in reality tracker expires it.
            // Tracker default is MAX_TRADE_AGE_HOURS. Let's assume 24h validity.

            if (side === 'LONG') {
                if (c.low <= entry) {
                    // POTENTIAL FILL
                    if (config?.RISK?.ENTRY_ON_CANDLE_CLOSE) {
                        // CONFIRMATION LOGIC: Wait for Close
                        if (c.close <= sl) {
                            // Invalidated! Wicks triggered entry but Close stopped out.
                            // Do NOT enter. Treated as missed/cancelled trade.
                            // console.log(`[DEBUG] Trade Invalidated at ${c.time} (Close < SL)`); 
                        } else {
                            // Confirmed! Enter at CLOSE (conservative).
                            isFilled = true;
                            fillIndex = i;
                            entry = c.close; // Update entry to close price
                        }
                    } else {
                        // CLASSIC LIMIT LOGIC (Instant Match)
                        isFilled = true;
                        fillIndex = i;
                    }
                }
            } else { // SHORT
                if (c.high >= entry) {
                    // POTENTIAL FILL
                    if (config?.RISK?.ENTRY_ON_CANDLE_CLOSE) {
                        // CONFIRMATION LOGIC: Wait for Close
                        if (c.close >= sl) {
                            // Invalidated!
                        } else {
                            // Confirmed! Enter at CLOSE
                            isFilled = true;
                            fillIndex = i;
                            entry = c.close; // Update entry to close price
                        }
                    } else {
                        // CLASSIC LIMIT LOGIC
                        isFilled = true;
                        fillIndex = i;
                    }
                }
            }

            // Check expiry if not filled logic could go here
            // If we reach end of loop without fill -> NO TRADE
            if (!isFilled && i === Math.min(candles.length, startIndex + LOOKAHEAD) - 1) {
                return { result: 'EXPIRED', pnl: 0, candles: i - startIndex, meta: 'NEVER_FILLED' };
            }

            if (!isFilled) continue; // Keep looking for fill
        }

        // 2. If Filled, check TP/SL
        const barsSinceFill = i - fillIndex;

        // Crash Protection (Same candle as fill)
        if (side === 'LONG') {
            if (c.low <= sl) return { result: 'LOSS', pnl: (sl - entry) / entry, candles: barsSinceFill }; // Hit SL
            if (c.high >= tp) return { result: 'WIN', pnl: (tp - entry) / entry, candles: barsSinceFill }; // Hit TP
        } else {
            if (c.high >= sl) return { result: 'LOSS', pnl: (entry - sl) / entry, candles: barsSinceFill }; // Hit SL
            if (c.low <= tp) return { result: 'WIN', pnl: (entry - tp) / entry, candles: barsSinceFill }; // Hit TP
        }

        // Time-Based Stop (relative to Fill Time)
        if (barsSinceFill >= timeLimit) {
            const exitPrice = c.close;
            let pnlPct = (side === 'LONG') ? (exitPrice - entry) / entry : (entry - exitPrice) / entry;

            let result = 'EXPIRED';
            if (pnlPct > 0) result = 'WIN';
            else if (pnlPct < 0) result = 'LOSS';

            return { result, pnl: pnlPct, candles: barsSinceFill, isTimeExit: true };
        }
    }
    return { result: 'EXPIRED', pnl: 0, candles: LOOKAHEAD, meta: 'TIMEOUT' };
};

export const runBacktest = async (customConfig = null, options = { limit: 0, verbose: false, days: 12, onProgress: null, strategy: 'legacy' }) => {
    // If running in standalone mode (no custom config), look for global CONFIG
    // Otherwise use provided config, merging checks if needed.
    const activeConfig = customConfig || CONFIG;
    const { limit, verbose, strategy = 'legacy' } = options;
    const backtestCandles = getCandlesFromDays(options.days || 12);

    // In API mode, we might need absolute path if CWD differs, but here assuming same DIR structure
    const files = await fs.readdir(DATA_DIR);
    let ltfFiles = files.filter(f => f.endsWith('_15m.json'));

    // Shuffle or sort? Let's just take top N if limit is set. 
    // Ideally we want random or volume weighted, but for now simple slicing.
    if (limit > 0) {
        ltfFiles = ltfFiles.slice(0, limit);
    }

    const stats = {
        totalSignals: 0,
        wins: 0,
        losses: 0,
        expired: 0,
        timeExits: 0,
        totalPnL: 0, // Sum of PnL percentages
        pnlHistory: [], // Array of individual trade PnLs
        byScore: {}, // { "80-90": { wins: 0, total: 0 } }
        byIndicator: {
            rsiOverboughtWin: 0, rsiOverboughtLoss: 0,
            divergenceWin: 0, divergenceLoss: 0,
            pullbackWin: 0, pullbackLoss: 0
        },
        weak_signals: [],
        allTrades: []
    };

    // Load Mcap Cache
    let mcapCache = {};
    try {
        const cachePath = path.join(DATA_DIR, 'mcap_cache.json');
        mcapCache = JSON.parse(await fs.readFile(cachePath, 'utf-8')).data || {};
    } catch (e) {
        if (verbose) console.warn('[BACKTEST] No mcap_cache.json found. MCap scoring disabled.');
    }

    if (verbose) console.log(`[BACKTEST] Analyzing ${ltfFiles.length} pairs ...`);

    let completed = 0;
    const startTime = Date.now();

    for (const ltfFile of ltfFiles) {
        // Progress Reporting
        completed++;
        if (options.onProgress) {
            const pct = Math.round((completed / ltfFiles.length) * 100);
            const elapsed = (Date.now() - startTime) / 1000; // seconds
            const avgTime = elapsed / completed;
            const eta = Math.round((ltfFiles.length - completed) * avgTime);
            options.onProgress(pct, eta);
        }

        // UNBLOCK EVENT LOOP: Yield every iteration
        await new Promise(resolve => setImmediate(resolve));

        const { source, symbol } = parseFilename(ltfFile);

        try {
            // Load Data for Simulation (Outcome Calculation)
            const ltfPath = path.join(DATA_DIR, ltfFile);
            const ltfRaw = JSON.parse(await fs.readFile(ltfPath, 'utf-8'));

            // Map to standard format
            let ltfData = Array.isArray(ltfRaw[0]) ? ltfRaw.map(d => ({ time: d[0], open: parseFloat(d[1]), high: parseFloat(d[2]), low: parseFloat(d[3]), close: parseFloat(d[4]), volume: parseFloat(d[5]) })) : ltfRaw;

            // --- CALL PYTHON ENGINE ---
            const pythonScript = path.join(process.cwd(), 'market_scanner.py');
            const venvPython = path.join(process.cwd(), 'venv/bin/python');
            const configStr = JSON.stringify(activeConfig);

            // We only need to run Python. Python handles HTF loading internally based on filename pattern.
            // If Python fails (e.g. no HTF data), it returns empty array or error (handled in catch).

            const { stdout } = await execFilePromise(venvPython, [
                pythonScript,
                ltfPath,
                '--strategy', strategy,
                '--backtest',
                '--config', configStr
            ]);

            let signals = [];
            try {
                signals = JSON.parse(stdout);
                if (!Array.isArray(signals)) signals = [];
            } catch (e) {
                // If stdout is not JSON, it might be an error message or empty
                // console.warn(`[BACKTEST] Failed to parse Python output for ${symbol}:`, stdout.substring(0, 100));
                continue;
            }

            // --- PROCESS SIGNALS ---
            // Create a map for fast lookup if needed, but linear scan is fine since signals are sorted
            // ltfData is sorted by time.

            // Optimization: Create a timestamp -> index map
            // const timeMap = new Map();
            // ltfData.forEach((c, i) => timeMap.set(c.time, i));

            // Actually, signals are sparse. Binary search or simple lookup is fine.
            // Let's use simple find for robustness against minor timestamp misalignments (though exact match expected)

            for (const signal of signals) {
                // Determine Entry Index key
                // Note: Signal is generated at 'timestamp' (Open Time of candle).
                // But usually we trade at CLOSE of that candle or OPEN of next.
                // Python strategy returns 'timestamp' of the candle that generated the signal.
                // Logic: We enter at CLOSE of that candle (Market) or Limit within next N candles.

                // Find candle with this timestamp
                // Optimization: Search only near expected index?
                // Just use find for now.
                const idx = ltfData.findIndex(c => c.time === signal.timestamp);

                if (idx !== -1) {
                    stats.totalSignals++;

                    const outcome = getFutureOutcome(ltfData, idx, signal.setup.entry, signal.setup.tp, signal.setup.sl, signal.setup.side, activeConfig);

                    // Categorize Score
                    const scoreRange = Math.floor(signal.score / 10) * 10;
                    const key = `${scoreRange}-${scoreRange + 9}`;
                    if (!stats.byScore[key]) stats.byScore[key] = { wins: 0, losses: 0, total: 0 };
                    stats.byScore[key].total++;

                    if (outcome.isTimeExit) stats.timeExits++;

                    if (outcome.result !== 'EXPIRED') {
                        stats.totalPnL += outcome.pnl;
                        stats.pnlHistory.push(outcome.pnl);

                        // Capture Trade Metadata
                        stats.allTrades.push({
                            symbol: symbol,
                            result: outcome.result,
                            pnl: outcome.pnl,
                            candles: outcome.candles,
                            isTimeExit: outcome.isTimeExit || false,
                            score: signal.score, // Signal Score
                            mcap: mcapCache[symbol] || 0, // Market Cap
                            volume: signal.volume || 0, // Needs Python to return volume, checking...
                            timestamp: signal.timestamp
                        });
                    }

                    if (outcome.result === 'WIN') {
                        stats.wins++;
                        stats.byScore[key].wins++;
                    } else if (outcome.result === 'LOSS') {
                        stats.losses++;
                        stats.byScore[key].losses++;
                    } else {
                        stats.expired++;
                    }

                    // Indicator Analysis (from Python details)
                    // signal.indicators.rsi etc.
                    // Note: JS logic differed slightly on names (rsiOverboughtWin vs just rsi)
                    // We can map if needed, or update stats object.
                    // For now, let's track basic indicator stats if available.

                    /* 
                    // Need to map Python indicator structure to JS stats structure if we want deep analytics
                    if (signal.indicators.divergence !== 'NONE') {
                         if (outcome.result === 'WIN') stats.byIndicator.divergenceWin++;
                         else if (outcome.result === 'LOSS') stats.byIndicator.divergenceLoss++;
                    } 
                    */
                }
            }

        } catch (e) {
            // console.error(`Error processing ${symbol}:`, e.message);
            // Python execution fail or file read fail
        }
    }

    return stats;
};

// Check if run directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    runBacktest().then(stats => console.log(JSON.stringify(stats, null, 2)));
}
