
import fetch from 'node-fetch';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '../data');

const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

// Cache to prevent duplicate alerts
const sentAlertsCache = new Set();

export const getSettings = async () => {
    try {
        const data = await fs.readFile(SETTINGS_FILE, 'utf-8');
        const settings = JSON.parse(data);
        // Default entryAlerts to true if not specified
        if (settings.entryAlerts === undefined) settings.entryAlerts = true;
        return settings;
    } catch {
        return { enabled: false, botToken: '', chatId: '', minScore: 85, entryAlerts: true };
    }
};

export const saveSettings = async (settings) => {
    try {
        await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2));
    } catch (e) {
        console.error("Failed to save settings", e);
    }
};

export const sendTelegramAlert = async (results) => {
    const settings = await getSettings();
    if (!settings.enabled || !settings.botToken || !settings.chatId) return;

    const opportunities = results.filter(r => {
        const uniqueId = `${r.symbol}_${r.timestamp}`;
        // Check if score meets threshold AND not already sent
        return r.score >= settings.minScore && !sentAlertsCache.has(uniqueId);
    });

    if (opportunities.length === 0) return;

    for (const pair of opportunities) {
        const uniqueId = `${pair.symbol}_${pair.timestamp}`;
        sentAlertsCache.add(uniqueId);

        // Keep cache size manageable
        if (sentAlertsCache.size > 1000) {
            const it = sentAlertsCache.values();
            sentAlertsCache.delete(it.next().value);
        }

        const message = `
🚨 <b>HIGH SCORE ALERT: ${pair.symbol}</b>
    
<b>Score: ${pair.score}/100</b>
Price: $${pair.price}
Exchange: ${pair.source || 'Unknown'}
Bias: ${pair.htf.bias}
Timeframe: ${pair.meta.htfInterval}

<b>Setup Details:</b>
• Entry: $${pair.setup?.entry.toFixed(4)}
• TP: $${pair.setup?.tp.toFixed(4)}
• SL: $${pair.setup?.sl.toFixed(4)}
• RR: 1:${pair.setup?.rr}

<i>Scores > ${settings.minScore}</i>
`;

        try {
            const url = `https://api.telegram.org/bot${settings.botToken}/sendMessage`;
            await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: settings.chatId,
                    text: message,
                    parse_mode: 'HTML'
                })
            });
            console.log(`[TELEGRAM] Sent alert for ${pair.symbol}`);
        } catch (e) {
            console.error(`[TELEGRAM ERROR] Failed to send alert for ${pair.symbol}`, e);
        }
    }
};

export const sendEntryAlert = async (trade) => {
    const settings = await getSettings();
    // Entry Alerts independent of "High Score" (enabled) switch
    if (!settings.entryAlerts || !settings.botToken || !settings.chatId) return;

    const message = `
🚀 <b>ENTRY TRIGGERED: ${trade.symbol}</b>

<b>Exchange:</b> ${trade.exchange || 'Unknown'}
<b>Side:</b> ${trade.side}
<b>Entry Price:</b> $${trade.entryPrice}
<b>Time:</b> ${new Date().toLocaleString()}

<i>Trade is now active!</i>
`;

    try {
        const url = `https://api.telegram.org/bot${settings.botToken}/sendMessage`;
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: settings.chatId,
                text: message,
                parse_mode: 'HTML'
            })
        });
        console.log(`[TELEGRAM] Sent entry alert for ${trade.symbol}`);
    } catch (e) {
        console.error(`[TELEGRAM ERROR] Failed to send entry alert for ${trade.symbol}`, e);
    }
};

export const sendExitAlert = async (trade) => {
    const settings = await getSettings();
    // Exit Alerts independent of "High Score" (enabled) switch
    if (!settings.entryAlerts || !settings.botToken || !settings.chatId) return;

    const isWin = trade.result === 'WIN';
    const emoji = isWin ? '✅' : '❌';
    const pnlText = trade.pnl ? (trade.pnl > 0 ? '+' : '') + trade.pnl.toFixed(2) + '%' : '0%';

    const message = `
${emoji} <b>TRADE CLOSED: ${trade.symbol}</b>

<b>Exchange:</b> ${trade.exchange || 'Unknown'}
<b>Result:</b> ${trade.result}
<b>PnL:</b> ${pnlText}
<b>Exit Price:</b> $${trade.exitPrice}
<b>Side:</b> ${trade.side}

<i>${isWin ? 'Target Hit!' : 'Stop Loss Hit.'}</i>
`;


    try {
        const url = `https://api.telegram.org/bot${settings.botToken}/sendMessage`;
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: settings.chatId,
                text: message,
                parse_mode: 'HTML'
            })
        });
        console.log(`[TELEGRAM] Sent exit alert for ${trade.symbol}`);
    } catch (e) {
        console.error(`[TELEGRAM ERROR] Failed to send exit alert for ${trade.symbol}`, e);
    }
};
