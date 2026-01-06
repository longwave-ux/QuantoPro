
import fs from 'fs';
import { calculateATR, getSwingHighLow, findKeyLevels } from './server/indicators.js';

// Mock Config
const CONFIG = {
    INDICATORS: {
        ATR: { PERIOD: 14 },
    },
    SCANNERS: {
        MIN_HISTORY_LTF: 50
    }
};

const data = JSON.parse(fs.readFileSync('data/HYPERLIQUID_VIRTUALUSDT_15m.json'));
const ltfData = data; // Use ALL data to catch old supports like 0.66

const currentPrice = ltfData[ltfData.length - 1].close;
console.log('Current Price:', currentPrice);

const atr = calculateATR(ltfData, 14);
console.log('ATR (Last):', atr);


// Swing High Low
const { high: majorHigh, low: majorLow } = getSwingHighLow(ltfData, 120);
const { high: swingHigh, low: swingLow } = getSwingHighLow(ltfData, 50);

console.log('Major High/Low (120):', majorHigh, majorLow);
console.log('Swing High/Low (50):', swingHigh, swingLow);


// Simulate High ADX (Parabolic Pump)
// In the live code this comes from HTF Data, but here we force it to test the logic
const adx = 60; // Parabolic

console.log('Simulated ADX:', adx);

// ADAPTIVE LOGIC
let lookbackWindow = 50;
if (adx > 50) lookbackWindow = 10;
else if (adx > 25) lookbackWindow = 20;

console.log('Adaptive Lookback Window:', lookbackWindow);

const levels = findKeyLevels(ltfData, lookbackWindow);
console.log('Supports:', levels.supports);
console.log('Resistances:', levels.resistances);

// Dynamic Fib
const range = swingHigh - swingLow;
const fibRatio = adx > 40 ? 0.382 : 0.618;
const fibLevel = swingHigh - (range * fibRatio);
console.log('Dynamic Fib Ratio:', fibRatio);
console.log('Fib Level:', fibLevel);

// Simulation Logic
let entry = currentPrice;
let confluenceType = 'ATR_REVERSION';

const validSupports = levels.supports.filter(s => s < currentPrice && s >= fibLevel * 0.95);
const bestSupport = validSupports.sort((a, b) => Math.abs(a - fibLevel) - Math.abs(b - fibLevel))[0];

if (bestSupport) {
    entry = bestSupport;
    confluenceType = 'FIB_STRUCTURE';
    console.log('Selected Best Support:', bestSupport);
} else {
    const anySupport = levels.supports.filter(s => s < currentPrice).sort((a, b) => b - a)[0];
    if (anySupport) {
        entry = anySupport;
        confluenceType = 'STRUCTURE_ONLY';
        console.log('Fallback Any Support:', anySupport);
    } else {
        entry = currentPrice - (1 * atr);
        confluenceType = 'ATR_REVERSION';
        console.log('Fallback ATR Reversion');
    }
}

console.log('Final Entry:', entry);
console.log('Confluence Type:', confluenceType);
