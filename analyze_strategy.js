import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { AnalysisEngine } from './server/analysis.js';
import { CONFIG } from './server/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, 'data');

// Simulation settings
const BACKTEST_CANDLES = 500; // Look back 500 candles for simulation

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

const runAnalysis = async () => {
    const files = await fs.readdir(DATA_DIR);
    const ltfFiles = files.filter(f => f.endsWith('_15m.json'));

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

    console.log(`Found ${ltfFiles.length} pairs to analyze...`);

    for (const ltfFile of ltfFiles) {
        const { source, symbol } = parseFilename(ltfFile);
        const htfFile = ltfFile.replace('_15m.json', '_4h.json');

        try {
            const ltfRaw = JSON.parse(await fs.readFile(path.join(DATA_DIR, ltfFile), 'utf-8'));
            const htfRaw = await fs.readFile(path.join(DATA_DIR, htfFile), 'utf-8').then(JSON.parse).catch(() => null);

            if (!htfRaw || ltfRaw.length < BACKTEST_CANDLES) continue;

            // Map to standard format
            // marketData.js maps raw arrays to objects { time, open, high, low, close, volume }
            // We need to ensure we map them correctly based on structure
            // Usually local files are stored as objects if from cache, check format
            let ltfData = Array.isArray(ltfRaw[0]) ? ltfRaw.map(d => ({ time: d[0], open: parseFloat(d[1]), high: parseFloat(d[2]), low: parseFloat(d[3]), close: parseFloat(d[4]), volume: parseFloat(d[5]) })) : ltfRaw;
            let htfData = Array.isArray(htfRaw[0]) ? htfRaw.map(d => ({ time: d[0], open: parseFloat(d[1]), high: parseFloat(d[2]), low: parseFloat(d[3]), close: parseFloat(d[4]), volume: parseFloat(d[5]) })) : htfRaw;

            // Run Backtest Loop
            for (let i = ltfData.length - BACKTEST_CANDLES; i < ltfData.length - 100; i++) {
                // Slice data to simulate "now"
                const currentLtf = ltfData.slice(0, i + 1);
                const currentTimestamp = currentLtf[currentLtf.length - 1].time;

                // Find matching HTF data (everything before currentTimestamp)
                const currentHtf = htfData.filter(c => c.time <= currentTimestamp);

                if (currentHtf.length < 50) continue;

                // Run Strategy
                const analysis = AnalysisEngine.analyzePair(symbol, currentHtf, currentLtf, '4h', '15m', currentTimestamp, source);

                if (analysis.score >= CONFIG.THRESHOLDS.MIN_SCORE_SIGNAL && analysis.setup) {
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

                    // Capture Weak Signals (High score but loss)
                    if (analysis.score > 85 && outcome.result === 'LOSS') {
                        stats.weak_signals.push({
                            symbol,
                            time: new Date(currentTimestamp).toISOString(),
                            side: analysis.setup.side,
                            score: analysis.score,
                            reason: 'High Score Loss',
                            indicators: analysis.ltf
                        });
                    }
                }
            }

        } catch (e) {
            // console.error(`Error processing ${symbol}:`, e.message);
        }
    }

    console.log(JSON.stringify(stats, null, 2));
};

runAnalysis();
