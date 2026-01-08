
import { runBacktest } from './analyze_strategy.js';
import { CONFIG } from './server/config.js';

// Helper to deep copy config to avoid mutation pollution
const cloneConfig = (c) => JSON.parse(JSON.stringify(c));

const runTest = async (name, mods) => {
    const config = cloneConfig(CONFIG);

    // Apply modifications
    if (mods.adaptive !== undefined) config.SYSTEM.ENABLE_ADAPTIVE = mods.adaptive;
    if (mods.timeStop !== undefined) config.RISK.ENABLE_TIME_BASED_STOP = mods.timeStop;

    console.log(`\n\n--- TEST: ${name} ---`);
    console.log(`Adaptive: ${config.SYSTEM.ENABLE_ADAPTIVE}, TimeStop: ${config.RISK.ENABLE_TIME_BASED_STOP}`);

    const start = Date.now();
    const stats = await runBacktest(config, { limit: 50, days: 5, verbose: true }); // Limit 50 pairs for speed, 5 days history
    const duration = (Date.now() - start) / 1000;

    const totalTrades = stats.wins + stats.losses;
    const winRate = totalTrades > 0 ? (stats.wins / totalTrades * 100).toFixed(2) : "0.00";
    const totalPnL_Pct = (stats.totalPnL * 100).toFixed(2);
    const avgPnL_Pct = totalTrades > 0 ? ((stats.totalPnL * 100) / totalTrades).toFixed(2) : "0.00";

    console.log(`RESULTS FOR ${name}:`);
    console.log(`Total Trades: ${totalTrades}`);
    console.log(`Win Rate: ${winRate}%`);
    console.log(`Wins: ${stats.wins}`);
    console.log(`Losses: ${stats.losses}`);
    console.log(`PNL Total: ${totalPnL_Pct}%`);
    console.log(`PNL Avg: ${avgPnL_Pct}%`);

    return { name, winRate, wins: stats.wins, losses: stats.losses, totalPnL: totalPnL_Pct, avgPnL: avgPnL_Pct };
};

const main = async () => {
    await runTest("BASELINE (Both OFF)", { adaptive: false, timeStop: false });
    await runTest("ADAPTIVE ONLY", { adaptive: true, timeStop: false });
    await runTest("TIME STOP ONLY", { adaptive: false, timeStop: true });
    await runTest("BOTH ON", { adaptive: true, timeStop: true });
};

main();
