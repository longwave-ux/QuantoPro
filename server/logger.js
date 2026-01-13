import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOG_DIR = path.join(__dirname, '../logs');

// Ensure log directory exists
await fs.mkdir(LOG_DIR, { recursive: true });

const getTimestamp = () => new Date().toISOString();

const logToFile = async (level, message, data = null) => {
    const logFile = path.join(LOG_DIR, `${new Date().toISOString().split('T')[0]}.log`);
    const logEntry = `[${getTimestamp()}] [${level}] ${message} ${data ? JSON.stringify(data) : ''}\n`;
    try {
        await fs.appendFile(logFile, logEntry);
    } catch (e) {
        console.error('Failed to write to log file', e);
    }
};

export const Logger = {
    info: (message, data) => {
        console.log(`[INFO] ${message}`);
        logToFile('INFO', message, data);
    },
    warn: (message, data) => {
        console.warn(`[WARN] ${message}`);
        logToFile('WARN', message, data);
    },
    error: (message, error) => {
        console.error(`[ERROR] ${message}`, error);
        logToFile('ERROR', message, error?.message || error);
    },
    debug: (message, data) => {
        // console.debug(`[DEBUG] ${message}`); // Optional: Uncomment for verbose console
        logToFile('DEBUG', message, data);
    }
};
