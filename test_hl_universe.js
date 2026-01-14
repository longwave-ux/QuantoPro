import fetch from 'node-fetch';

const BASE_URL = 'https://api.hyperliquid.xyz';

async function testHL() {
    try {
        console.log("Fetching HL Universe...");
        const res = await fetch(`${BASE_URL}/info`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'metaAndAssetCtxs' })
        });

        if (!res.ok) {
            console.error("HTTP Error:", res.status, res.statusText);
            return;
        }

        const data = await res.json();
        console.log("Data received. Type:", typeof data, "IsArray:", Array.isArray(data));

        if (Array.isArray(data)) {
            console.log("Length:", data.length);
            console.log("Item 0 keys:", Object.keys(data[0] || {}));
            if (data[0].universe) {
                console.log("Universe found. Length:", data[0].universe.length);
            } else {
                console.error("Universe NOT found in element 0.");
            }
        } else {
            console.log("Data keys:", Object.keys(data));
        }

    } catch (e) {
        console.error("Fetch failed:", e);
    }
}

testHL();
