
import fs from 'fs/promises';
import path from 'path';
import fetch from 'node-fetch';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SETTINGS_FILE = path.join(__dirname, 'data/settings.json');

const MAINNET_URL = 'https://api.hyperliquid.xyz/info';
const TESTNET_URL = 'https://api.hyperliquid-testnet.xyz/info';

async function debugAgent() {
    console.log("--- STARTING HYPERLIQUID AGENT DEBUG ---");

    // 1. Load Settings
    let settings;
    try {
        const raw = await fs.readFile(SETTINGS_FILE, 'utf-8');
        settings = JSON.parse(raw);
        console.log("1. Settings Loaded:");
        console.log("   - Master Address:", settings.hyperliquidMasterAddress || "(NOT SET)");
        console.log("   - Private Key:", settings.hyperliquidPrivateKey ? "(SET)" : "(MISSING)");
    } catch (e) {
        console.log("1. ERROR Loading Settings:", e.message);
        return;
    }

    const userAddress = settings.hyperliquidMasterAddress;

    if (!userAddress) {
        console.log("\n!!! CRITICAL: Master Address is NOT set in settings.json. The fix relies on this !!!!");
        return;
    }

    // 2. Query MAINNET Futures
    console.log(`\n2. Querying MAINNET Futures [${MAINNET_URL}] for ${userAddress}...`);
    try {
        const res = await fetch(MAINNET_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'clearinghouseState', user: userAddress })
        });
        const data = await res.json();
        console.log("   - Response Status:", res.status);
        if (data && data.marginSummary) {
            console.log("   - Account Value:", data.marginSummary.accountValue);
            console.log("   - Total Margin Used:", data.marginSummary.totalMarginUsed);
        } else {
            console.log("   - No 'marginSummary' in response. Raw Data:", JSON.stringify(data).substring(0, 200));
        }
    } catch (e) {
        console.log("   - ERROR:", e.message);
    }

    // 3. Query MAINNET Spot
    console.log(`\n3. Querying MAINNET Spot [${MAINNET_URL}]...`);
    try {
        const res = await fetch(MAINNET_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'spotClearinghouseState', user: userAddress })
        });
        const data = await res.json();
        if (data && data.balances) {
            console.log("   - Spot Balances:", JSON.stringify(data.balances));
        } else {
            console.log("   - No Spot Balances found.");
        }
    } catch (e) {
        console.log("   - ERROR:", e.message);
    }

    // 4. Query TESTNET Futures
    console.log(`\n4. Querying TESTNET Futures [${TESTNET_URL}]...`);
    try {
        const res = await fetch(TESTNET_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'clearinghouseState', user: userAddress })
        });
        const data = await res.json();
        if (data && data.marginSummary) {
            console.log("   - Account Value:", data.marginSummary.accountValue);
        } else {
            console.log("   - No data. (Expected if using Mainnet)");
        }
    } catch (e) {
        console.log("   - ERROR:", e.message);
    }

    console.log("\n--- DEBUG COMPLETE ---");
}

debugAgent();
