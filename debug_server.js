import express from 'express';
import { CONFIG, loadConfig } from './server/config.js';

await loadConfig();

const app = express();
app.get('/api/config', (req, res) => {
    console.log('Hit /api/config');
    res.json(CONFIG);
});

app.listen(3001, () => {
    console.log('Debug server running on 3001');
});
