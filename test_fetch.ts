import { fetchCandles } from './server/twelvedata-scanner.js';

async function testFetch() {
    try {
        const testSymbols = [
            'BTCUSD', 'ETHUSD', 'SOLUSD', 'XRPUSD', 'BNBUSD', 'ADAUSD', 'LTCUSD', 'DOTUSD'
        ];
        console.log("Testing crypto symbol formats against TwelveData API...");
        for (const pair of testSymbols) {
            console.log(`\n--- Testing ${pair} ---`);
            const withSlash = pair.substring(0, 3) + '/' + pair.substring(3);
            const withoutSlash = pair;
            
            console.log(`With slash (${withSlash}):`);
            const htfSlash = await fetchCandles(pair, '4h');
            console.log(`Result: ${htfSlash ? `${htfSlash.length} candles` : 'Failed/Null'}`);

            // Also check how twelve data treats the exact query
            const apiKey = process.env.TWELVEDATA_API_KEY;
            if (apiKey) {
                const urlSlash = `https://api.twelvedata.com/time_series?symbol=${withSlash}&interval=4h&outputsize=5&apikey=${apiKey}`;
                const res1 = await fetch(urlSlash);
                const data1 = await res1.json();
                console.log(`API response for ${withSlash}:`, JSON.stringify(data1).substring(0, 200));

                const urlNoSlash = `https://api.twelvedata.com/time_series?symbol=${withoutSlash}&interval=4h&outputsize=5&apikey=${apiKey}`;
                const res2 = await fetch(urlNoSlash);
                const data2 = await res2.json();
                console.log(`API response for ${withoutSlash}:`, JSON.stringify(data2).substring(0, 200));
            }
        }
    } catch(e) {
        console.log("Error:", e);
    }
}

testFetch();
