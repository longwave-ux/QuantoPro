import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_FILE = path.join(__dirname, '../data/config.json');

export const CONFIG = {
    SYSTEM: {
        SCAN_INTERVAL: 15 * 60 * 1000, // 15 Minutes
        TRACKER_INTERVAL: 1 * 60 * 1000, // 1 Minute
        BATCH_SIZE: 5,
        HTTP_PORT: process.env.PORT || 3000
    },
    SCANNERS: {
        HTF: '4h',
        LTF: '15m',
        MIN_HISTORY_HTF: 50,
        MIN_HISTORY_LTF: 50,
    },
    THRESHOLDS: {
        MIN_SCORE_TO_SAVE: 30,
        MIN_SCORE_TRENDING: 50,
        MIN_SCORE_SIGNAL: 70,
        MAX_TRADE_AGE_HOURS: 24,
    },
    INDICATORS: {
        RSI: { PERIOD: 14, OVERBOUGHT: 70, OVERSOLD: 30 },
        ADX: { PERIOD: 14, STRONG_TREND: 25, MIN_TREND: 20 },
        EMA: { FAST: 50, SLOW: 200 },
        BOL_BANDS: { PERIOD: 20, STD_DEV: 2 },
        OBV: { LOOKBACK: 20, THRESHOLD: 0.25 },
        PULLBACK: { MIN_DEPTH: 0.3, MAX_DEPTH: 0.8 },
        PIVOT_LOOKBACK: 40
    },
    SCORING: {
        TREND: { BASE: 15, STRONG_ADX: 10, WEAK_BIAS: 5 },
        STRUCTURE: { FIB: 25, LEVEL: 15, POOR_RR_PENALTY: 30, MED_RR_PENALTY: 10 },
        MONEY_FLOW: { OBV: 25, DIVERGENCE: 0 },
        TIMING: { PULLBACK: 5, REJECTION: 5 },
        PENALTIES: { CONTRARIAN_OBV: 40, CONTRARIAN_DIV: 20, OVEREXTENDED: 20, HIGH_VOL_PULLBACK: 20 }
    },
    RISK: {
        ATR_MULTIPLIER: 2.5,
        SL_BUFFER: 0.005,
        TP_RR_MIN: 1.5
    }
};

export const loadConfig = async () => {
    try {
        const data = await fs.readFile(CONFIG_FILE, 'utf-8');
        const savedConfig = JSON.parse(data);

        // Deep merge to ensure structure is preserved
        const merge = (target, source) => {
            for (const key in source) {
                if (source[key] instanceof Object && key in target) {
                    Object.assign(source[key], merge(target[key], source[key]));
                }
            }
            Object.assign(target || {}, source);
            return target;
        };

        merge(CONFIG, savedConfig);
        console.log('[CONFIG] Configuration loaded from disk.');
    } catch (e) {
        console.log('[CONFIG] No saved config found, using defaults.');
    }
};

export const saveConfig = async (newConfig) => {
    try {
        // Update in-memory config
        Object.assign(CONFIG, newConfig);

        // Save to disk
        await fs.writeFile(CONFIG_FILE, JSON.stringify(CONFIG, null, 2));
        console.log('[CONFIG] Configuration saved to disk.');
    } catch (e) {
        console.error('[CONFIG] Failed to save config:', e);
        throw e;
    }
};
