
import { runBacktest } from './analyze_strategy.js';
import { CONFIG } from './server/config.js';

const compareTrades = async () => {
    // 1. Run Baseline (No Time Exit)
    const configBaseline = JSON.parse(JSON.stringify(CONFIG));
    configBaseline.RISK.ENABLE_TIME_BASED_STOP = false;

    console.log('Running Baseline...');
    const statsBaseline = await runBacktest(configBaseline, { days: 12, limit: 50, verbose: false });

    // Find a Loss
    const lossTrade = statsBaseline.trades.find(t => t.result === 'LOSS');
    if (!lossTrade) {
        console.log('No losses found in baseline to debug!');
        return;
    }

    console.log('Found Baseline Loss:', lossTrade);

    // 2. Run TimeExit
    const configTime = JSON.parse(JSON.stringify(CONFIG));
    configTime.RISK.ENABLE_TIME_BASED_STOP = true;

    console.log('Running TimeExit...');
    const statsTime = await runBacktest(configTime, { days: 12, limit: 50, verbose: false });

    const sameTrade = statsTime.trades.find(t => t.symbol === lossTrade.symbol && t.time === lossTrade.time);

    if (sameTrade) {
        console.log('Matched Trade in TimeExit Mode:', sameTrade);

        console.log('\n--- ANALYSIS ---');
        console.log(`Baseline Outcome: ${lossTrade.result} (${(lossTrade.pnl * 100).toFixed(2)}%) after ${lossTrade.duration * 15} mins`);
        console.log(`TimeExit Outcome: ${sameTrade.result} (${(sameTrade.pnl * 100).toFixed(2)}%) after ${sameTrade.duration * 15} mins`);

        if (sameTrade.isTimeExit) {
            console.log('CONFIRMED: Trade was force-closed by Time Exit before hitting SL.');
        } else {
            console.log('SURPRISE: Trade was NOT a Time Exit?');
        }
    } else {
        console.log('Could not find the same trade in TimeExit mode (maybe limits shifted?)');
    }
}

compareTrades();
