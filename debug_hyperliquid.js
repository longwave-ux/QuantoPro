import { ethers } from 'ethers';
import fetch from 'node-fetch';
import { getSettings } from './server/telegram.js';

async function test() {
    console.log("--- Starting Hyperliquid Debug ---");
    try {
        const settings = await getSettings();
        if (!settings.hyperliquidPrivateKey) {
            console.error("ERROR: No Private Key found.");
            return;
        }

        const wallet = new ethers.Wallet(settings.hyperliquidPrivateKey);
        const address = wallet.address;
        console.log("Derived Address:", address);

        // SPOT CHECK (Mainnet)
        console.log("\nFetching Mainnet SPOT state...");
        const resSpot = await fetch('https://api.hyperliquid.xyz/info', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'spotClearinghouseState', user: address })
        });

        if (resSpot.ok) {
            const dataSpot = await resSpot.json();
            console.log("--- RAW SPOT DATA ---");
            console.log(JSON.stringify(dataSpot, null, 2));
        } else {
            console.log("Spot API Error:", resSpot.status);
        }

    } catch (e) {
        console.error("--- ERROR ---");
        console.error(e);
    }
}

test();
