
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchCandles } from './marketData.js';
import { sendEntryAlert, sendExitAlert, getSettings } from './telegram.js';
import { CONFIG } from './config.js';
import { Logger } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '../data');
const HISTORY_FILE = path.join(DATA_DIR, 'trade_history.json');

// ==========================================
// TRADE TRACKER (FORWARD TESTING)
// ==========================================

const loadHistory = async () => {
    try {
        const data = await fs.readFile(HISTORY_FILE, 'utf-8');
        return JSON.parse(data);
    } catch {
        return [];
    }
};

export const getTradeHistory = loadHistory;

const saveHistory = async (history) => {
    try {
        await fs.writeFile(HISTORY_FILE, JSON.stringify(history, null, 2));
    } catch (e) {
        Logger.error("Failed to save trade history", e);
    }
};

export const registerSignals = async (results) => {
    console.log(`[TRACKER] ========== registerSignals called ==========`);
    console.log(`[TRACKER] Received ${results.length} total results`);

    let history = await loadHistory();
    console.log(`[TRACKER] Current history length: ${history.length}`);

    // Filter for high quality signals
    const highQuality = results.filter(r => r.score >= CONFIG.THRESHOLDS.MIN_SCORE_SIGNAL && r.setup);
    console.log(`[TRACKER] High quality signals (score >= ${CONFIG.THRESHOLDS.MIN_SCORE_SIGNAL} AND has setup): ${highQuality.length}`);

    if (highQuality.length > 0) {
        console.log(`[TRACKER] Sample high quality signal:`, {
            symbol: highQuality[0].symbol,
            score: highQuality[0].score,
            strategy: highQuality[0].strategy,
            hasSetup: !!highQuality[0].setup,
            hasBias: !!highQuality[0].htf?.bias
        });
    }

    let addedCount = 0;
    let replacedCount = 0;

    for (const signal of highQuality) {
        // Find any existing OPEN trade for this symbol
        const existingIndex = history.findIndex(h => h.symbol === signal.symbol && h.status === 'OPEN');

        if (existingIndex !== -1) {
            const existingTrade = history[existingIndex];

            // If the trade is already filled (active), we DO NOT replace it.
            // We also DO NOT add a new one (prevent stacking).
            if (existingTrade.isFilled) {
                console.log(`[TRACKER] Skipping ${signal.symbol} - already has filled trade`);
                continue;
            }

            // If the trade is NOT filled (pending), we REPLACE it with the new, fresher setup.
            // Remove the old one
            history.splice(existingIndex, 1);
            replacedCount++;
            console.log(`[TRACKER] Replaced pending trade for ${signal.symbol}`);
        }

        // Add the new signal
        // NOTE: Signals use 'calculated_at' field, not 'timestamp'
        const signalTime = signal.calculated_at || signal.timestamp || Date.now();

        const trade = {
            id: `${signal.symbol}_${signalTime}`,
            symbol: signal.symbol,
            exchange: signal.source,
            strategy: signal.strategy || 'Legacy', // Track which strategy generated this signal
            signalTimestamp: signalTime,  // Use calculated_at from signal
            entryDate: new Date().toISOString(),
            status: 'OPEN', // OPEN, CLOSED
            result: 'PENDING', // PENDING, WIN, LOSS
            side: signal.htf.bias,
            entryPrice: signal.setup.entry,
            tp: signal.setup.tp,
            sl: signal.setup.sl,
            score: signal.score,
            exitPrice: null,
            exitDate: null,
            pnl: null,
            isFilled: false,
            fillDate: null
        };

        history.push(trade);
        console.log(`[TRACKER] Added new trade: ${signal.symbol} (${signal.strategy}) score=${signal.score} timestamp=${signalTime}`);
        addedCount++;
    }

    if (addedCount > 0 || replacedCount > 0) {
        await saveHistory(history);
        Logger.info(`[TRACKER] Registered ${addedCount} new signals (${replacedCount} replaced) for forward testing.`);
        console.log(`[TRACKER] Total trades in history after save: ${history.length}`);
    } else {
        console.log(`[TRACKER] No trades added or replaced`);
    }
    console.log(`[TRACKER] ========== registerSignals complete ==========`);
};

export const updateOutcomes = async () => {
    const history = await loadHistory();
    const settings = await getSettings();
    const openTrades = history.filter(t => t.status === 'OPEN');

    if (openTrades.length === 0) return;

    Logger.info(`[TRACKER] Checking outcomes for ${openTrades.length} open trades...`);
    let updatedCount = 0;

    // Group by unique key (symbol + exchange) to ensure we check the right price source
    const uniqueKeys = [...new Set(openTrades.map(t => `${t.symbol}|${t.exchange || 'KUCOIN'}`))];
    const SUPPORTED_EXCHANGES = ['KUCOIN', 'MEXC', 'HYPERLIQUID'];

    for (const key of uniqueKeys) {
        const [symbol, exchange] = key.split('|');

        if (!SUPPORTED_EXCHANGES.includes(exchange)) {
            // Logger.warn(`[TRACKER] Skipping unsupported exchange: ${exchange} for ${symbol}`);
            continue;
        }

        // Fetch recent 15m candles from the CORRECT exchange
        const candles = await fetchCandles(symbol, '15m', exchange, 500);
        if (candles.length === 0) continue;

        const tradesForKey = openTrades.filter(t => t.symbol === symbol && (t.exchange || 'BINANCE') === exchange);

        for (const trade of tradesForKey) {
            // 0. Check for Time Expiration
            // Only for pending trades (not filled yet)
            if (!trade.isFilled) {
                const age = Date.now() - trade.signalTimestamp;
                if (age > CONFIG.THRESHOLDS.MAX_TRADE_AGE_HOURS * 60 * 60 * 1000) {
                    trade.status = 'CLOSED';
                    trade.result = 'EXPIRED';
                    trade.exitDate = new Date().toISOString();
                    trade.pnl = 0;
                    updatedCount++;
                    continue; // Skip candle check
                }
            }

            // Find candles that happened AFTER the signal
            const relevantCandles = candles.filter(c => c.time > trade.signalTimestamp);

            // Initialize filled state (default to false for strict limit order tracking)
            let isFilled = trade.isFilled || false;
            let stateChanged = false;

            for (const candle of relevantCandles) {
                // 1. Check for Entry Trigger OR Structure Break (Crash Protection)
                if (!isFilled) {
                    if (trade.side === 'LONG') {
                        // CRASH PROTECTION: If price hits SL before Entry -> INVALIDATED
                        if (candle.low <= trade.sl) {
                            trade.status = 'CLOSED';
                            trade.result = 'INVALIDATED';
                            trade.exitDate = new Date(candle.time).toISOString();
                            trade.pnl = 0;
                            trade.exitPrice = trade.sl;
                            stateChanged = true;
                            if (settings.entryAlerts) sendExitAlert(trade);
                            break; // Stop checking
                        }
                        // ENTRY TRIGGER
                        else if (candle.low <= trade.entryPrice) {
                            // POTENTIAL FILL
                            let shouldFill = true;

                            if (CONFIG.RISK.ENTRY_ON_CANDLE_CLOSE) {
                                // CONFIRMATION LOGIC: Check Close
                                if (candle.close <= trade.sl) {
                                    // Invalidated! Wicks triggered entry but Close stopped out.
                                    trade.status = 'CLOSED';
                                    trade.result = 'INVALIDATED';
                                    trade.exitDate = new Date(candle.time).toISOString();
                                    trade.pnl = 0;
                                    trade.exitPrice = trade.sl;
                                    stateChanged = true;
                                    shouldFill = false;
                                    if (settings.entryAlerts) sendExitAlert(trade);
                                    break;
                                } else {
                                    // Confirmed! Enter at CLOSE (conservative).
                                    trade.entryPrice = candle.close; // Update entry to close price
                                }
                            }

                            if (shouldFill) {
                                trade.isFilled = true;
                                trade.fillDate = new Date(candle.time).toISOString();
                                stateChanged = true;
                                if (settings.entryAlerts) sendEntryAlert(trade);
                            }
                        }
                    } else { // SHORT
                        // CRASH PROTECTION: If price hits SL before Entry -> INVALIDATED
                        if (candle.high >= trade.sl) {
                            trade.status = 'CLOSED';
                            trade.result = 'INVALIDATED';
                            trade.exitDate = new Date(candle.time).toISOString();
                            trade.pnl = 0;
                            trade.exitPrice = trade.sl;
                            stateChanged = true;
                            if (settings.entryAlerts) sendExitAlert(trade);
                            break; // Stop checking
                        }
                        // ENTRY TRIGGER
                        else if (candle.high >= trade.entryPrice) {
                            // POTENTIAL FILL
                            let shouldFill = true;

                            if (CONFIG.RISK.ENTRY_ON_CANDLE_CLOSE) {
                                // CONFIRMATION LOGIC: Check Close
                                if (candle.close >= trade.sl) {
                                    // Invalidated!
                                    trade.status = 'CLOSED';
                                    trade.result = 'INVALIDATED';
                                    trade.exitDate = new Date(candle.time).toISOString();
                                    trade.pnl = 0;
                                    trade.exitPrice = trade.sl;
                                    stateChanged = true;
                                    shouldFill = false;
                                    if (settings.entryAlerts) sendExitAlert(trade);
                                    break;
                                } else {
                                    // Confirmed! Enter at CLOSE
                                    trade.entryPrice = candle.close; // Update entry to close price
                                }
                            }

                            if (shouldFill) {
                                isFilled = true;
                                trade.isFilled = true;
                                trade.fillDate = new Date(candle.time).toISOString();
                                stateChanged = true;
                                if (settings.entryAlerts) sendEntryAlert(trade);
                            }
                        }
                    }
                }

                // 2. Only check for TP/SL if the trade is filled
                if (isFilled) {
                    let outcome = null;
                    let exitPrice = 0;

                    // A. Time-Based Stop Check
                    if (CONFIG.RISK.ENABLE_TIME_BASED_STOP) {
                        const fillTime = new Date(trade.fillDate).getTime();
                        const timeInTrade = candle.time - fillTime;
                        const limitMs = (CONFIG.RISK.TIME_BASED_STOP_CANDLES || 12) * 15 * 60 * 1000;

                        if (timeInTrade >= limitMs) {
                            exitPrice = candle.close;
                            // Calculate PnL to decide WIN/LOSS
                            const pnlRaw = trade.side === 'LONG'
                                ? (exitPrice - trade.entryPrice) / trade.entryPrice
                                : (trade.entryPrice - exitPrice) / trade.entryPrice;

                            outcome = pnlRaw >= 0 ? 'WIN' : 'LOSS';
                            // We don't distinguish "TIME_EXIT" in result string yet to keep stats simple, 
                            // but we could add a meta field later.
                        }
                    }

                    // B. Regular TP/SL Check (Overrides Time Stop if hit in same candle)
                    if (trade.side === 'LONG') {
                        if (candle.low <= trade.sl) { outcome = 'LOSS'; exitPrice = trade.sl; }
                        else if (candle.high >= trade.tp) { outcome = 'WIN'; exitPrice = trade.tp; }
                    } else { // SHORT
                        if (candle.high >= trade.sl) { outcome = 'LOSS'; exitPrice = trade.sl; }
                        else if (candle.low <= trade.tp) { outcome = 'WIN'; exitPrice = trade.tp; }
                    }

                    if (outcome) {
                        trade.status = 'CLOSED';
                        trade.result = outcome;
                        trade.exitDate = new Date(candle.time).toISOString();
                        trade.exitPrice = exitPrice;

                        if (outcome === 'WIN') {
                            trade.pnl = Math.abs((exitPrice - trade.entryPrice) / trade.entryPrice) * 100;
                        } else {
                            trade.pnl = -Math.abs((trade.entryPrice - exitPrice) / trade.entryPrice) * 100; // Fix PnL Math for Short
                            // Actually, simpler:
                            // trade.pnl = (trade.side === 'LONG' ? (exitPrice - entry)/entry : (entry - exitPrice)/entry) * 100
                            // But let's stick to the existing style but fix the logic
                            const pnlVal = trade.side === 'LONG'
                                ? (exitPrice - trade.entryPrice) / trade.entryPrice
                                : (trade.entryPrice - exitPrice) / trade.entryPrice;
                            trade.pnl = pnlVal * 100;
                        }

                        stateChanged = true;

                        if (settings.entryAlerts) sendExitAlert(trade);
                        break; // Stop checking candles for this trade
                    }
                }
            }

            if (stateChanged) updatedCount++;
        }
    }

    if (updatedCount > 0) {
        await saveHistory(history);
        Logger.info(`[TRACKER] Updated ${updatedCount} trades. Performance updated.`);
    }
};

export const getPerformanceStats = async () => {
    const history = await loadHistory();
    const closed = history.filter(t => t.status === 'CLOSED');

    // Filter for valid completed trades (WIN/LOSS)
    // Exclude 'EXPIRED', 'INVALIDATED'
    const validTrades = closed.filter(t => t.result === 'WIN' || t.result === 'LOSS');

    if (validTrades.length === 0) return { total: closed.length, winRate: '0.0%', pnl: '0.00%' };

    const wins = validTrades.filter(t => t.result === 'WIN').length;
    const losses = validTrades.filter(t => t.result === 'LOSS').length;
    const totalPnL = validTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);

    return {
        totalTrades: closed.length,
        wins,
        losses,
        winRate: ((wins / validTrades.length) * 100).toFixed(1) + '%',
        avgPnL: (totalPnL / validTrades.length).toFixed(2) + '%',
        netPnL: totalPnL.toFixed(2) + '%'
    };
};
