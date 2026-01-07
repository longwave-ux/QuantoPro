
import { runBacktest } from './analyze_strategy.js';
import { CONFIG } from './server/config.js';

const verifyConfigOverride = async () => {
    console.log('--- STARTING VERIFICATION ---');

    // 1. Run with Defaults
    console.log('1. Running with Default Config...');
    const resultDefault = await runBacktest(null, { days: 2, verbose: false, limit: 10 });
    console.log(`Default Results: ${resultDefault.totalSignals} signals`);

    // 2. Run with Custom Config (Impossible Threshold)
    console.log('2. Running with Custom Config (Min Score = 99)...');

    // Deep copy config to avoid mutating global
    const customConfig = JSON.parse(JSON.stringify(CONFIG));
    customConfig.THRESHOLDS.MIN_SCORE_SIGNAL = 99;

    const resultCustom = await runBacktest(customConfig, { days: 2, verbose: false, limit: 10 });
    console.log(`Custom Results: ${resultCustom.totalSignals} signals`);

    if (resultDefault.totalSignals > 0 && resultCustom.totalSignals === 0) {
        console.log('✅ SUCCES: Custom Config was respected.');
    } else if (resultDefault.totalSignals === 0) {
        console.log('⚠️ WARNING: Default config produced 0 signals, so verification is inconclusive.');
    } else {
        console.log('❌ FAILURE: Custom Config was IGNORED.');
    }

    console.log('--- VERIFICATION COMPLETE ---');
};

verifyConfigOverride();
