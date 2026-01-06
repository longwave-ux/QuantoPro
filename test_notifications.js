
import { sendEntryAlert, getSettings } from './server/telegram.js';

const test = async () => {
    const settings = await getSettings();
    console.log('Current Settings:', settings);

    if (!settings.botToken || !settings.chatId) {
        console.error('Missing Bot Token or Chat ID');
        return;
    }

    // Force enable for the test
    settings.enabled = true;

    // We need to mock the getSettings in telegram.js or just replicate the fetch logic 
    // BUT since sendEntryAlert calls getSettings internally, we can't easily mock it without a proper mock framework or modifying the file.

    // EASIER APPROACH: Direct fetch test using the credentials found.

    const url = `https://api.telegram.org/bot${settings.botToken}/sendMessage`;
    const message = "🔔 <b>Test Notification</b> from QuantPro Scanner";

    console.log(`Sending test message to ${settings.chatId}...`);

    try {
        const fetch = (await import('node-fetch')).default;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: settings.chatId,
                text: message,
                parse_mode: 'HTML'
            })
        });

        const data = await response.json();
        console.log('Response:', data);

        if (data.ok) {
            console.log('SUCCESS: Telegram notification sent successfully.');
        } else {
            console.error('FAILED: Telegram API returned error:', data.description);
        }
    } catch (e) {
        console.error('FAILED: Network error:', e.message);
    }
};

test();
