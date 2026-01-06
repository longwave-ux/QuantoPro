import { runBacktest } from '../analyze_strategy.js';
import { CONFIG } from './config.js';
import { fileURLToPath } from 'url';

// Max pairs to test per optimization run
const ITERATIONS = 30;

export const optimizeStrategy = async (baseConfig, options = {}) => {
    // options currently includes { onProgress: (pct, eta) => void, days: number }
    console.log('[OPTIMIZER] Starting Grid Search...');

    if (!baseConfig || !baseConfig.THRESHOLDS) {
        console.error('[OPTIMIZER ERROR] Invalid Base Config:', JSON.stringify(baseConfig, null, 2));
        throw new Error(`Invalid Configuration: Missing THRESHOLDS. Keys received: ${Object.keys(baseConfig || {}).join(', ')}`);
    }

    const days = options.days || 12;

    // Define Search Space
    // Expanded to include Indicators for better accuracy
    const GRID = {
        THRESHOLDS: {
            MIN_SCORE_SIGNAL: [65, 75],
        },

        RISK: {
            ATR_MULTIPLIER: [2.0, 3.0],
            SL_BUFFER: [0.005, 0.01]
        },
        INDICATORS: {
            RSI: { PERIOD: [14, 9] }, // Standard vs Fast
            ADX: { STRONG_TREND: [20, 25] } // Sensitive vs Strong
        }
    };

    const results = [];

    // Calculate total iterations for progress tracking
    const totalCombinations =
        GRID.THRESHOLDS.MIN_SCORE_SIGNAL.length *
        GRID.RISK.ATR_MULTIPLIER.length *
        GRID.RISK.SL_BUFFER.length *
        GRID.INDICATORS.RSI.PERIOD.length *
        GRID.INDICATORS.ADX.STRONG_TREND.length;

    let completed = 0;
    const startTime = Date.now();

    // Generate Combinations
    for (const minScore of GRID.THRESHOLDS.MIN_SCORE_SIGNAL) {
        for (const atrMult of GRID.RISK.ATR_MULTIPLIER) {
            for (const slBuf of GRID.RISK.SL_BUFFER) {
                for (const rsiPeriod of GRID.INDICATORS.RSI.PERIOD) {
                    for (const adxTrend of GRID.INDICATORS.ADX.STRONG_TREND) {

                        // Deep Copy Config
                        // Use structuredClone for a true deep copy (Node 17+)
                        // Fallback to JSON for older nodes if needed, but structuredClone is safer for undefined
                        const runConfig = global.structuredClone ? structuredClone(baseConfig) : JSON.parse(JSON.stringify(baseConfig));

                        // Validations for deep properties
                        if (!runConfig.THRESHOLDS) runConfig.THRESHOLDS = {};
                        if (!runConfig.RISK) runConfig.RISK = {};
                        if (!runConfig.INDICATORS) runConfig.INDICATORS = { RSI: {}, ADX: {} };

                        // Apply Overrides
                        runConfig.THRESHOLDS.MIN_SCORE_SIGNAL = minScore;
                        runConfig.RISK.ATR_MULTIPLIER = atrMult;
                        runConfig.RISK.SL_BUFFER = slBuf;
                        runConfig.INDICATORS.RSI.PERIOD = rsiPeriod;
                        runConfig.INDICATORS.ADX.STRONG_TREND = adxTrend;

                        // Run fast backtest on subset of files
                        // Pass 'days' to limit the history depth if needed, or stick to validationLimit for pairs
                        const validationLimit = 30;
                        const stats = await runBacktest(runConfig, { limit: validationLimit, verbose: false, days: days });

                        const winRate = stats.totalSignals > 0 ? stats.wins / (stats.wins + stats.losses) : 0;

                        results.push({
                            config: runConfig,
                            stats,
                            winRate,
                            params: { minScore, atrMult, slBuf, rsiPeriod, adxTrend }
                        });

                        completed++;

                        // Progress Update
                        if (options.onProgress) {
                            const now = Date.now();
                            const elapsed = now - startTime;
                            const msPerItem = elapsed / completed;
                            const remaining = totalCombinations - completed;
                            const etaSeconds = Math.round((remaining * msPerItem) / 1000);

                            // 90% is the grid search, last 10% is the deep validation
                            const progress = Math.round((completed / totalCombinations) * 90);
                            options.onProgress(progress, etaSeconds);
                        }
                    }
                }
            }
        }
    }

    // Sort by Win Rate (primary) and Net Wins (secondary)
    results.sort((a, b) => {
        if (b.winRate !== a.winRate) return b.winRate - a.winRate;
        return b.stats.wins - a.stats.wins;
    });

    let bestResult = results[0];

    // ==========================================
    // DEEP VALIDATION STEP
    // ==========================================
    // Run the Winner against ALL data to be "Super Accurate"
    console.log('[OPTIMIZER] Validating best candidate on FULL history...');

    if (options.onProgress) options.onProgress(95, 10); // Fake 10s ETA for final step

    // Validate the best
    const bestStats = await runBacktest(bestResult.config, { limit: 0, verbose: false, days: days }); // 0 = All files
    const bestWinRate = bestStats.totalSignals > 0 ? bestStats.wins / (bestStats.wins + bestStats.losses) : 0;

    // Update the result with the deep validation stats
    bestResult.stats = bestStats;
    bestResult.winRate = bestWinRate;

    // Also run baseline on full history for fair comparison
    console.log('[OPTIMIZER] Validating baseline on FULL history...');
    const baselineStats = await runBacktest(baseConfig, { limit: 0, verbose: false, days: days });
    const baselineWinRate = baselineStats.totalSignals > 0 ? baselineStats.wins / (baselineStats.wins + baselineStats.losses) : 0;

    if (options.onProgress) options.onProgress(100, 0);

    const baseline = {
        config: baseConfig,
        stats: baselineStats,
        winRate: baselineWinRate
    };

    return {
        best: bestResult,
        baseline: baseline,
        totalRuns: results.length,
        top5: results.slice(0, 5)
    };
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    optimizeStrategy(CONFIG).then(results => {
        console.log(JSON.stringify(results, null, 2));
    });
}
