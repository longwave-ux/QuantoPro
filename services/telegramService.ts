import { AnalysisResult, NotificationSettings } from "../types";

// Cache to prevent duplicate alerts for the same symbol + timestamp
// Format: "SYMBOL_TIMESTAMP"
const sentAlertsCache = new Set<string>();

export const sendTelegramAlert = async (
  results: AnalysisResult[], 
  settings: NotificationSettings
) => {
  if (!settings.enabled || !settings.botToken || !settings.chatId) return;

  // Filter for high score AND not previously sent
  const opportunities = results.filter(r => {
    const uniqueId = `${r.symbol}_${r.timestamp}`;
    return r.score >= settings.minScore && !sentAlertsCache.has(uniqueId);
  });

  if (opportunities.length === 0) return;

  for (const pair of opportunities) {
    const uniqueId = `${pair.symbol}_${pair.timestamp}`;
    sentAlertsCache.add(uniqueId);

    const message = `
🚨 <b>HIGH SCORE ALERT: ${pair.symbol}</b>
    
<b>Score: ${pair.score}/100</b>
Price: $${pair.price}
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
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: settings.chatId,
          text: message,
          parse_mode: 'HTML'
        })
      });
      
      // Simple rate limit helper (Telegram limit is roughly 30/sec, but good to be safe)
      await new Promise(r => setTimeout(r, 500)); 

    } catch (error) {
      console.error("Failed to send Telegram alert for", pair.symbol, error);
    }
  }
};