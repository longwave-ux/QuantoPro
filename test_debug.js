import fetch from 'node-fetch';

async function test() {
    try {
        const res = await fetch('http://localhost:3001/api/config');
        console.log('Status:', res.status);
        const text = await res.text();
        console.log('Body:', text.substring(0, 100));
    } catch (e) {
        console.error('Fetch failed:', e);
    }
}

test();
