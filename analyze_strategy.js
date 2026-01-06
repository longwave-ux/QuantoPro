import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { AnalysisEngine } from './server/analysis.js';
import { CONFIG } from './server/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, 'data');

// Simulation settings
const BACKTEST_CANDLES = 1200; // Look back ~1200 candles (12 days) for deeper simulation

const parseFilename = (filename) => {
    const parts = filename.split('_');
    const source = parts[0];
    const timeframe = parts[parts.length - 1].replace('.json', '');
    const symbolParts = parts.slice(1, parts.length - 1);
    const symbol = symbolParts.join('_');
    return { source, symbol, timeframe };
};

const getFutureOutcome = (candles, startIndex, entry, tp, sl, side) => {
    // Look ahead up to 24 hours (96 candles of 15m)
    const LOOKAHEAD = 96;

    for (let i = startIndex + 1; i < Math.min(candles.length, startIndex + LOOKAHEAD); i++) {
        const c = candles[i];
        if (side === 'LONG') {
            if (c.low <= sl) return { result: 'LOSS', pnl: -1, candles: i - startIndex };
            if (c.high >= tp) return { result: 'WIN', pnl: 1, candles: i - startIndex };
        } else {
            if (c.high >= sl) return { result: 'LOSS', pnl: -1, candles: i - startIndex };
            if (c.low <= tp) return { result: 'WIN', pnl: 1, candles: i - startIndex };
        }
    }
    return { result: 'EXPIRED', pnl: 0, candles: LOOKAHEAD };
};

export const runBacktest = async (customConfig = null, options = { limit: 0, verbose: false }) => {
    // If running in standalone mode (no custom config), look for global CONFIG
    // Otherwise use provided config, merging checks if needed.
    const activeConfig = customConfig || CONFIG;
    const { limit, verbose } = options;

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
        byScore: {}, // { "80-90": { wins: 0, total: 0 } }
        byIndicator: {
            rsiOverboughtWin: 0, rsiOverboughtLoss: 0,
            divergenceWin: 0, divergenceLoss: 0,
            pullbackWin: 0, pullbackLoss: 0
        },
        weak_signals: []
    };

    if (verbose) console.log(`[BACKTEST] Analyzing ${ltfFiles.length} pairs ...`);

    for (const ltfFile of ltfFiles) {
        const { source, symbol } = parseFilename(ltfFile);
        const htfFile = ltfFile.replace('_15m.json', '_4h.json');

        try {
            const ltfRaw = JSON.parse(await fs.readFile(path.join(DATA_DIR, ltfFile), 'utf-8'));
            const htfPath = path.join(DATA_DIR, htfFile);

            // Check if HTF file exists
            try {
                await fs.access(htfPath);
            } catch { continue; }

            const htfRaw = JSON.parse(await fs.readFile(htfPath, 'utf-8'));

            if (!htfRaw || ltfRaw.length < BACKTEST_CANDLES) continue;

            // Map to standard format
            let ltfData = Array.isArray(ltfRaw[0]) ? ltfRaw.map(d => ({ time: d[0], open: parseFloat(d[1]), high: parseFloat(d[2]), low: parseFloat(d[3]), close: parseFloat(d[4]), volume: parseFloat(d[5]) })) : ltfRaw;
            let htfData = Array.isArray(htfRaw[0]) ? htfRaw.map(d => ({ time: d[0], open: parseFloat(d[1]), high: parseFloat(d[2]), low: parseFloat(d[3]), close: parseFloat(d[4]), volume: parseFloat(d[5]) })) : htfRaw;

            // Optimize: HTF is sorted. Maintain an index.
            let htfIndex = 0;

            // Run Backtest Loop
            for (let i = ltfData.length - BACKTEST_CANDLES; i < ltfData.length - 100; i++) {
                // Slice data to simulate "now"
                const currentLtf = ltfData.slice(0, i + 1);
                const currentTimestamp = currentLtf[currentLtf.length - 1].time;

                // Efficient HTF Slicing
                // Advance htfIndex until we pass the currentTimestamp
                while (htfIndex < htfData.length && htfData[htfIndex].time <= currentTimestamp) {
                    htfIndex++;
                }
                // We want everything UP TO htfIndex (exclusive of the one that passed, inclusive of the one equal)
                // Actually the loop goes passed. htfIndex points to first candle > currentTimestamp.
                const currentHtf = htfData.slice(0, htfIndex);

                if (currentHtf.length < 50) continue;

                // Run Strategy with injected config
                const analysis = AnalysisEngine.analyzePair(symbol, currentHtf, currentLtf, '4h', '15m', currentTimestamp, source, activeConfig);

                if (analysis.score >= activeConfig.THRESHOLDS.MIN_SCORE_SIGNAL && analysis.setup) {
                    // We found a signal!
                    stats.totalSignals++;

                    const outcome = getFutureOutcome(ltfData, i, analysis.setup.entry, analysis.setup.tp, analysis.setup.sl, analysis.setup.side);

                    // Categorize Score
                    const scoreRange = Math.floor(analysis.score / 10) * 10;
                    const key = `${scoreRange}-${scoreRange + 9}`;
                    if (!stats.byScore[key]) stats.byScore[key] = { wins: 0, losses: 0, total: 0 };
                    stats.byScore[key].total++;

                    if (outcome.result === 'WIN') {
                        stats.wins++;
                        stats.byScore[key].wins++;
                    } else if (outcome.result === 'LOSS') {
                        stats.losses++;
                        stats.byScore[key].losses++;
                    } else {
                        stats.expired++;
                    }

                    // Indicator Analysis
                    if (analysis.ltf.momentumOk) {
                        if (outcome.result === 'WIN') stats.byIndicator.rsiOverboughtWin++;
                        else if (outcome.result === 'LOSS') stats.byIndicator.rsiOverboughtLoss++;
                    }
                    if (analysis.ltf.divergence !== 'NONE') {
                        if (outcome.result === 'WIN') stats.byIndicator.divergenceWin++;
                        else if (outcome.result === 'LOSS') stats.byIndicator.divergenceLoss++;
                    }
                    if (analysis.ltf.isPullback) {
                        if (outcome.result === 'WIN') stats.byIndicator.pullbackWin++;
                        else if (outcome.result === 'LOSS') stats.byIndicator.pullbackLoss++;
                    }
                }
            }

        } catch (e) {
            console.error(`Error processing ${symbol}:`, e.message);
        }
    }

    return stats;
};

// Check if run directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    runBacktest().then(stats => console.log(JSON.stringify(stats, null, 2)));
}
