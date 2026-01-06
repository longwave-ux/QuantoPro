import { runBacktest } from '../analyze_strategy.js';
import { CONFIG } from './config.js';

const ITERATIONS = 30; // Max pairs to test per optimization run to keep it fast

export const optimizeStrategy = async (baseConfig) => {
    console.log('[OPTIMIZER] Starting Grid Search...');

    // Define Search Space
    // Expanded to include Indicators for better accuracy
    const GRID = {
        THRESHOLDS: {
            MIN_SCORE_SIGNAL: [65, 75], // Reduced steps to save time for other params
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

    // Generate Combinations
    // 2 x 2 x 2 x 2 x 2 = 32 combinations
    for (const minScore of GRID.THRESHOLDS.MIN_SCORE_SIGNAL) {
        for (const atrMult of GRID.RISK.ATR_MULTIPLIER) {
            for (const slBuf of GRID.RISK.SL_BUFFER) {
                for (const rsiPeriod of GRID.INDICATORS.RSI.PERIOD) {
                    for (const adxTrend of GRID.INDICATORS.ADX.STRONG_TREND) {

                        // Deep Copy Config
                        const runConfig = JSON.parse(JSON.stringify(baseConfig));

                        // Apply Overrides
                        runConfig.THRESHOLDS.MIN_SCORE_SIGNAL = minScore;
                        runConfig.RISK.ATR_MULTIPLIER = atrMult;
                        runConfig.RISK.SL_BUFFER = slBuf;
                        runConfig.INDICATORS.RSI.PERIOD = rsiPeriod;
                        runConfig.INDICATORS.ADX.STRONG_TREND = adxTrend;

                        // Run fast backtest on subset of files
                        const validationLimit = 30; // Analyze 30 pairs for speed
                        const stats = await runBacktest(runConfig, { limit: validationLimit, verbose: false });

                        const winRate = stats.totalSignals > 0 ? stats.wins / (stats.wins + stats.losses) : 0;

                        results.push({
                            config: runConfig,
                            stats,
                            winRate,
                            params: {
                                minScore,
                                atrMult,
                                slBuf,
                                rsiPeriod,
                                adxTrend
                            }
                        });
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

    // Validate the best
    const bestStats = await runBacktest(bestResult.config, { limit: 0, verbose: false }); // 0 = All files
    const bestWinRate = bestStats.totalSignals > 0 ? bestStats.wins / (bestStats.wins + bestStats.losses) : 0;

    // Update the result with the deep validation stats
    bestResult.stats = bestStats;
    bestResult.winRate = bestWinRate;

    // Also run baseline on full history for fair comparison
    console.log('[OPTIMIZER] Validating baseline on FULL history...');
    const baselineStats = await runBacktest(baseConfig, { limit: 0, verbose: false });
    const baselineWinRate = baselineStats.totalSignals > 0 ? baselineStats.wins / (baselineStats.wins + baselineStats.losses) : 0;

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
