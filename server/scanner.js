import { execFile } from 'child_process';
import util from 'util';
const execFilePromise = util.promisify(execFile);
import fetch from 'node-fetch';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { sendTelegramAlert } from './telegram.js';
import { fetchCandles, fetchTopVolumePairs } from './marketData.js';
import { registerSignals, updateOutcomes } from './tracker.js';
import { CONFIG } from './config.js';
import { AnalysisEngine } from './analysis.js';
import { Logger } from './logger.js';
import { McapService } from './mcapService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '../data');

// Ensure data directory exists
await fs.mkdir(DATA_DIR, { recursive: true });

// ==========================================
// STORAGE ADAPTER (FILE SYSTEM)
// ==========================================
const getScanHistory = async () => {
    try {
        const filePath = path.join(DATA_DIR, 'history.json');
        const data = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(data);
    } catch {
        return {};
    }
};

const saveScanHistory = async (history) => {
    try {
        const filePath = path.join(DATA_DIR, 'history.json');
        await fs.writeFile(filePath, JSON.stringify(history, null, 2));
    } catch (e) {
        Logger.error(`[STORAGE ERROR] Failed to save history`, e);
    }
};

export const getMasterFeed = async () => {
    try {
        const filePath = path.join(DATA_DIR, 'master_feed.json');
        const data = await fs.readFile(filePath, 'utf-8');
        const parsed = JSON.parse(data);

        // Handle new structured format: { last_updated, signals }
        if (parsed && typeof parsed === 'object' && 'signals' in parsed) {
            return parsed; // Return the full object with timestamp
        }

        // Handle legacy flat array format
        if (Array.isArray(parsed)) {
            return parsed;
        }

        return [];
    } catch {
        return [];
    }
};

const appendSignalLog = async (results) => {
    try {
        const filePath = path.join(DATA_DIR, 'signal_log.jsonl');
        const highQuality = results.filter(r => r.score >= 80);

        if (highQuality.length === 0) return;

        const lines = highQuality.map(r => JSON.stringify({
            timestamp: new Date().toISOString(),
            symbol: r.symbol,
            score: r.score,
            price: r.price,
            bias: r.htf.bias,
            setup: r.setup
        })).join('\n') + '\n';

        await fs.appendFile(filePath, lines);
    } catch (e) {
        Logger.error(`[STORAGE ERROR] Failed to append signal log`, e);
    }
};


// ==========================================
// WORKFLOW
// ==========================================

// Global Scan Progress Tracker
export let scanStatus = { status: 'IDLE', progress: 0, total: 0, current: 0, eta: 0 };

let isScanning = false;

// Persistent timestamp storage (survives PM2 restarts)
const getLastScanTimestamps = async () => {
    try {
        const filePath = path.join(DATA_DIR, 'scanner_timestamps.json');
        const data = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(data);
    } catch {
        return {};
    }
};

const saveLastScanTimestamps = async (timestamps) => {
    try {
        const filePath = path.join(DATA_DIR, 'scanner_timestamps.json');
        await fs.writeFile(filePath, JSON.stringify(timestamps, null, 2));
    } catch (e) {
        Logger.error(`[STORAGE ERROR] Failed to save scanner timestamps`, e);
    }
};

// Load timestamps on startup
let lastLegacyScan = {};
let lastBreakoutScan = {};

(async () => {
    const timestamps = await getLastScanTimestamps();
    lastLegacyScan = timestamps.legacy || {};
    lastBreakoutScan = timestamps.breakout || {};
    Logger.info(`[SCANNER] Loaded timestamps: Legacy=${JSON.stringify(lastLegacyScan)}, Breakout=${JSON.stringify(lastBreakoutScan)}`);
})();

export const runServerScan = async (source = 'KUCOIN', strategy = 'all', force = false) => {
    if (isScanning) {
        Logger.info(`[SERVER SCAN] Skipped: Scan already in progress.`);
        return [];
    }
    isScanning = true;

    // Determine which strategies to run based on Last Run Time
    let targetStrategy = strategy;
    const now = Date.now();

    if (strategy === 'all' && !force) {
        const lastLeg = lastLegacyScan[source] || 0;
        const lastBrk = lastBreakoutScan[source] || 0;

        const runLegacy = (now - lastLeg) > CONFIG.SYSTEM.LEGACY_INTERVAL;
        const runBreakout = (now - lastBrk) > CONFIG.SYSTEM.BREAKOUT_INTERVAL;

        if (runLegacy && runBreakout) targetStrategy = 'all';
        else if (runBreakout) targetStrategy = 'breakout';
        else if (runLegacy) targetStrategy = 'legacy';
        else {
            Logger.info(`[SERVER SCAN] Skipped ${source}: No strategies due for execution.`);
            isScanning = false;
            return [];
        }

        if (runLegacy) lastLegacyScan[source] = now;
        if (runBreakout) lastBreakoutScan[source] = now;

        await saveLastScanTimestamps({
            legacy: lastLegacyScan,
            breakout: lastBreakoutScan
        });
    } else if (force) {
        Logger.info(`[SERVER SCAN] Force mode enabled - bypassing interval checks`);
        lastLegacyScan[source] = now;
        lastBreakoutScan[source] = now;
        await saveLastScanTimestamps({
            legacy: lastLegacyScan,
            breakout: lastBreakoutScan
        });
    }

    Logger.info(`[SERVER SCAN] Starting unified scan (Strategy: ${targetStrategy})...`);

    try {
        // 1. Update outcomes of previous signals (Foretesting)
        await updateOutcomes();

        // 2. Refresh MCap Cache
        await McapService.init();
        const topPairs = await fetchTopVolumePairs(source);
        await McapService.refreshIfNeeded(topPairs);

        // 3. Run Scanner in Directory Mode (Unified Processing)
        const pythonScript = path.join(process.cwd(), 'market_scanner_refactored.py');
        const venvPython = path.join(process.cwd(), 'venv/bin/python');
        const dataDir = path.join(process.cwd(), 'data');

        Logger.info(`[SERVER SCAN] Executing: ${pythonScript} ${dataDir} --strategy ${targetStrategy}`);

        scanStatus = { status: 'RUNNING', progress: 50, total: 1, current: 0, eta: 0 };

        const { stdout, stderr } = await execFilePromise(venvPython, [
            pythonScript,
            dataDir,
            '--strategy', targetStrategy
        ], {
            timeout: 600000, // 10 minute timeout for full scan
            maxBuffer: 10 * 1024 * 1024, // 10MB buffer
            env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
        });

        if (stderr) {
            const lines = stderr.split('\n');
            lines.forEach(line => {
                if (line.includes('[SUCCESS]') ||
                    line.includes('[DIRECTORY MODE]') ||
                    line.includes('[BATCH]') ||
                    line.includes('[CANONICAL]')) {
                    Logger.info(`[SCANNER] ${line}`);
                }
                if (line.includes('[ERROR]') || line.includes('[WARN]')) {
                    Logger.error(`[SCANNER] ${line}`);
                }
            });
        }

        // 4. Read master_feed.json (already written by scanner)
        const masterFeed = await getMasterFeed();
        const signals = masterFeed.signals || (Array.isArray(masterFeed) ? masterFeed : []);

        Logger.info(`[SERVER SCAN] Scanner completed. Master feed has ${signals.length} signals.`);

        // 5. Update History for Tracking
        const history = await getScanHistory();
        const nextHistory = {};

        signals.forEach(s => {
            const symbol = s.symbol;
            if (s.score > CONFIG.THRESHOLDS.MIN_SCORE_TRENDING || history[symbol]) {
                nextHistory[symbol] = {
                    score: s.score,
                    timestamp: now,
                    consecutiveScans: (history[symbol]?.consecutiveScans || 0) + 1
                };
            }
        });

        await saveScanHistory(nextHistory);

        // 6. Signal Tracking & Alerts
        await appendSignalLog(signals);
        await registerSignals(signals);
        await sendTelegramAlert(signals);

        Logger.info(`[SERVER SCAN] Complete. Processed ${signals.length} signals.`);
        isScanning = false;
        scanStatus = { status: 'IDLE', progress: 100, total: 0, current: 0, eta: 0 };

        return signals;

    } catch (e) {
        Logger.error(`[SERVER SCAN] Failed for ${source}:`, e.message);
        if (e.stderr) {
            Logger.error(`[SCANNER STDERR]`, e.stderr);
        }
        isScanning = false;
        scanStatus = { status: 'IDLE', progress: 0, total: 0, current: 0, eta: 0 };
        return [];
    }
};
