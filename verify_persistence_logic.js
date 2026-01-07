
import fetch from 'node-fetch';

const UPDATE_KEY = 'RISK';
const UPDATE_FIELD = 'ATR_MULTIPLIER';
const TEST_VALUE = 9.99; // Distinctive value

async function verifyPersistence() {
    console.log('--- STARTING PERSISTENCE CHECK ---');
    const baseUrl = 'http://localhost:3000/api';

    // 1. Fetch Current Config
    console.log('1. Fetching current config...');
    const res1 = await fetch(`${baseUrl}/config`);
    const config1 = await res1.json();

    const originalValue = config1[UPDATE_KEY][UPDATE_FIELD];
    console.log(`   Current ${UPDATE_FIELD}: ${originalValue}`);

    // 2. Modify Logic (mimic frontend)
    const newConfig = JSON.parse(JSON.stringify(config1));
    newConfig[UPDATE_KEY][UPDATE_FIELD] = TEST_VALUE;

    // 3. Save Config
    console.log(`2. Saving new value: ${TEST_VALUE}...`);
    const resSave = await fetch(`${baseUrl}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newConfig)
    });

    if (!resSave.ok) {
        console.error('   SAVE FAILED:', resSave.status, resSave.statusText);
        return;
    }
    console.log('   Save acknowledged by server.');

    // 4. Fetch Again (Verify Persistence)
    console.log('3. Fetching config again to verify...');
    const res2 = await fetch(`${baseUrl}/config?t=${Date.now()}`); // Bust cache
    const config2 = await res2.json();

    const savedValue = config2[UPDATE_KEY][UPDATE_FIELD];
    console.log(`   New ${UPDATE_FIELD}: ${savedValue}`);

    if (savedValue === TEST_VALUE) {
        console.log('✅ SUCCESS: Value persisted correctly.');
        // Restore
        console.log('4. Restoring original value...');
        newConfig[UPDATE_KEY][UPDATE_FIELD] = originalValue;
        await fetch(`${baseUrl}/config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newConfig)
        });
        console.log('   Restored.');
    } else {
        console.error('❌ FAILURE: Value did not persist!');
        console.error(`   Expected: ${TEST_VALUE}, Got: ${savedValue}`);
    }
}

verifyPersistence().catch(console.error);
