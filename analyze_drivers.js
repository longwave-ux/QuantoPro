
import { runBacktest } from './analyze_strategy.js';
import { CONFIG } from './server/config.js';

const main = async () => {
    console.log("============================================");
    console.log("       QUANTPRO LEGACY STRATEGY ANALYSIS     ");
    console.log("============================================");
    console.log("Objective: Identify characteristic drivers of Winners vs Losers.");

    // 1. RUN BASELINE (Standard Config)
    console.log("\n[1/4] Running Baseline Backtest (Top 100 Pairs)...");
    const baseConfig = JSON.parse(JSON.stringify(CONFIG));
    // Ensure "Features" are off for baseline comparison if we want to isolate them? 
    // Or just check the current config state.
    // Let's rely on standard config as baseline.

    const stats = await runBacktest(baseConfig, { limit: 20, verbose: true, strategy: 'legacy' });
    const trades = stats.allTrades;
    const wins = trades.filter(t => t.result === 'WIN');
    const losses = trades.filter(t => t.result === 'LOSS');
    const timeExits = trades.filter(t => t.isTimeExit);

    console.log(`\nTotal Trades: ${trades.length} | Wins: ${wins.length} | Losses: ${losses.length}`);
    console.log(`Win Rate: ${((wins.length / trades.length) * 100).toFixed(2)}%`);

    // --- METRIC: MARKET CAP ---
    const getAvgMcap = (list) => list.length ? list.reduce((a, b) => a + (b.mcap || 0), 0) / list.length : 0;
    const winMcap = getAvgMcap(wins);
    const lossMcap = getAvgMcap(losses);

    console.log("\n--- MARKET CAP ANALYSIS ---");
    console.log(`Avg MCap (Winners): $${(winMcap / 1e6).toFixed(2)}M`);
    console.log(`Avg MCap (Losers):  $${(lossMcap / 1e6).toFixed(2)}M`);
    console.log(`Interpretation: ${winMcap > lossMcap ? "Higher Cap tends to Win" : "Lower Cap tends to Win"}`);

    // --- METRIC: VOLUME ---
    // Note: Volume is raw from the 15m candle.
    const getAvgVol = (list) => list.length ? list.reduce((a, b) => a + (b.volume || 0), 0) / list.length : 0;
    const winVol = getAvgVol(wins);
    const lossVol = getAvgVol(losses);

    console.log("\n--- VOLUME ANALYSIS (Signal Candle) ---");
    console.log(`Avg Vol (Winners): ${winVol.toFixed(0)}`);
    console.log(`Avg Vol (Losers):  ${lossVol.toFixed(0)}`);

    // --- METRIC: VOLATILITY (ATR Proxy) ---
    // Proxy: Distance from Entry to PnL (Risk Magnitude)
    // Actually, (Entry - SL) / Entry is the stop loss % distance.
    // If ATR Multiplier is constant, larger % distance = Higher Volatility.
    // We don't have SL directly in allTrades (we have pnl).
    // But we know PnL of a Loss is roughly -1.0 R ? No, PnL is %.
    // Let's assume volatility correlates with abs(score)? No.
    // Let's skip ATR exact value for now unless we patch it, 
    // but we can infer "Deep Losses" vs "Small Losses".

    // --- SCENARIO: ENTRY ON CLOSE ---
    console.log("\n[2/4] Testing 'Entry on Candle Close' Impact...");
    const closeConfig = JSON.parse(JSON.stringify(CONFIG));
    if (!closeConfig.RISK) closeConfig.RISK = {};
    closeConfig.RISK.ENTRY_ON_CANDLE_CLOSE = true;

    const statsClose = await runBacktest(closeConfig, { limit: 20, verbose: false, strategy: 'legacy' });
    const wrClose = (statsClose.wins / statsClose.totalSignals) * 100;
    console.log(`Win Rate (Entry on Close): ${wrClose.toFixed(2)}% (Baseline: ${((wins.length / trades.length) * 100).toFixed(2)}%)`);
    console.log(`Trades Taken: ${statsClose.totalSignals} (Baseline: ${trades.length})`);

    // --- SCENARIO: TIME EXIT ---
    console.log("\n[3/4] Testing 'Time Based Force Exit' Impact...");
    const timeConfig = JSON.parse(JSON.stringify(CONFIG));
    if (!timeConfig.RISK) timeConfig.RISK = {};
    timeConfig.RISK.ENABLE_TIME_BASED_STOP = true;
    timeConfig.RISK.TIME_BASED_STOP_CANDLES = 24; // 6 Hours (24 * 15m)

    const statsTime = await runBacktest(timeConfig, { limit: 20, verbose: false, strategy: 'legacy' });
    const wrTime = (statsTime.wins / statsTime.totalSignals) * 100;
    console.log(`Win Rate (Time Exit): ${wrTime.toFixed(2)}%`);
    console.log(`Total PnL: ${(statsTime.totalPnL * 100).toFixed(2)}% (Baseline: ${(stats.totalPnL * 100).toFixed(2)}%)`);

    // --- CONCLUSION ---
    console.log("\n============================================");
    console.log("             OPTIMIZATION HINTS              ");
    console.log("============================================");
    if (winMcap > lossMcap * 1.5) console.log("HINT: Enable Min Market Cap Filter (> $100M).");
    if (winMcap < lossMcap * 0.7) console.log("HINT: Focus on Low Cap Gems.");

    if (wrClose > ((wins.length / trades.length) * 100)) console.log("HINT: ENABLE 'Entry on Candle Close' (Reduces Fakeouts).");
    else console.log("HINT: DISABLE 'Entry on Candle Close' (Misses too many good moves).");

    if (statsTime.totalPnL > stats.totalPnL) console.log("HINT: ENABLE 'Time Based Stop' (Cuts stagnation).");
    else console.log("HINT: DISABLE 'Time Based Stop' (Let winners run).");
};

main();
