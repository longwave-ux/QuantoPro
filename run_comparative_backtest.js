
import { runBacktest } from './analyze_strategy.js';
import { CONFIG } from './server/config.js';

const runScenario = async (name, adaptive, timeExit) => {
    console.log(`\n==========================================`);
    console.log(`RUNNING SCENARIO: ${name}`);
    console.log(`Settings: Adaptive=${adaptive}, TimeExit=${timeExit}`);
    console.log(`==========================================`);

    // Clone Config
    const testConfig = JSON.parse(JSON.stringify(CONFIG));

    // Apply Overrides
    testConfig.SYSTEM.ENABLE_ADAPTIVE = adaptive;
    testConfig.RISK.ENABLE_TIME_BASED_STOP = timeExit;

    const stats = await runBacktest(testConfig, { days: 12, verbose: false, limit: 50 }); // 12 Days, 50 Pairs

    const totalTrades = stats.totalSignals;
    const wins = stats.wins;
    const losses = stats.losses; // Includes Time Exits that were losses
    const winRate = totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(1) + '%' : '0%';
    const totalPnL = (stats.totalPnL * 100).toFixed(2) + '%';
    const avgPnL = totalTrades > 0 ? ((stats.totalPnL / totalTrades) * 100).toFixed(2) + '%' : '0%';

    // PnL breakdown
    const avgWin = stats.wins > 0 ?
        (stats.pnlHistory.filter(p => p > 0).reduce((a, b) => a + b, 0) / stats.wins * 100).toFixed(2) + '%'
        : '0%';

    const avgLoss = (stats.losses + stats.expired) > 0 ?
        (stats.pnlHistory.filter(p => p <= 0).reduce((a, b) => a + b, 0) / (stats.losses + stats.expired) * 100).toFixed(2) + '%'
        : '0%';

    return {
        Scenario: name,
        Trades: totalTrades,
        'W/L': `${wins}/${stats.losses}`,
        'Win Rate': winRate,
        'Total PnL': totalPnL,
        'Avg PnL': avgPnL,
        'Avg Win': avgWin,
        'Avg Loss': avgLoss
    };
};

const main = async () => {
    const results = [];

    // 1. Adaptive OFF, TimeExit OFF (Baseline)
    results.push(await runScenario('Baseline (Both OFF)', false, false));

    // 2. Adaptive ON, TimeExit OFF
    results.push(await runScenario('Adaptive ONLY', true, false));

    // 3. Adaptive OFF, TimeExit ON
    results.push(await runScenario('TimeExit ONLY', false, true));

    // 4. Adaptive ON, TimeExit ON
    results.push(await runScenario('BOTH ON (Pro)', true, true));

    console.table(results);
};

main();
