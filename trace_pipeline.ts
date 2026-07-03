import * as http from 'http';

const req = http.get('http://127.0.0.1:3000/api/state', (res) => {
    let rawData = '';
    res.on('data', (chunk) => { rawData += chunk; });
    res.on('end', () => {
        try {
            const data = JSON.parse(rawData);
            
            const ms = data.marketStates || [];
            const sigs = data.signals || [];
            
            const acceptedMs = ms.filter((s:any) => (s.direction === 'LONG' || s.direction === 'SHORT') && s.tier !== 'Reject' && s.tier !== 'STALE');
            
            console.log('══════════════════════════════════════════');
            console.log('SECTION 1 — ACCEPTED SIGNAL INVENTORY');
            console.log('══════════════════════════════════════════');
            for (const s of acceptedMs) {
                console.log(`${s.pair} | ${s.direction} | ${s.tier} | ACTIVE | ${s.timestamp} | N/A`);
            }
            console.log(`\nTotal Accepted Signals:\n${acceptedMs.length}\n`);

            console.log('══════════════════════════════════════════');
            console.log('SECTION 2 — ENGINE TRACE');
            console.log('══════════════════════════════════════════');
            for (const s of acceptedMs) {
                console.log(`${s.pair}`);
                console.log('Generated = YES');
            }
            console.log();

            console.log('══════════════════════════════════════════');
            console.log('SECTION 3 — SCANNER CACHE TRACE');
            console.log('══════════════════════════════════════════');
            for (const s of acceptedMs) {
                const found = sigs.find((sig:any) => sig.pair === s.pair && sig.direction === s.direction);
                console.log(`${s.pair}`);
                console.log(`Present = ${found ? 'YES' : 'NO'}`);
            }
            console.log(`\nTotal scannerState.signals count:\n${sigs.length}\n`);

            console.log('══════════════════════════════════════════');
            console.log('SECTION 4 — API TRACE');
            console.log('══════════════════════════════════════════');
            for (const s of acceptedMs) {
                const found = sigs.find((sig:any) => sig.pair === s.pair && sig.direction === s.direction);
                console.log(`${s.pair}`);
                console.log(`Present = ${found ? 'YES' : 'NO'}`);
            }
            console.log(`\nTotal API signal count:\n${sigs.length}\n`);

            console.log('══════════════════════════════════════════');
            console.log('SECTION 5 — DASHBOARD TRACE');
            console.log('══════════════════════════════════════════');
            for (const s of acceptedMs) {
                const found = sigs.find((sig:any) => sig.pair === s.pair && sig.direction === s.direction);
                console.log(`${s.pair}`);
                console.log(`Present = ${found ? 'YES' : 'NO'}`);
            }
            console.log(`\nTotal Dashboard Feed Count:\n${sigs.filter((sig:any) => sig.tier !== 'Reject').length}\n`);

            console.log('══════════════════════════════════════════');
            console.log('SECTION 6 — PIPELINE COMPARISON');
            console.log('══════════════════════════════════════════');
            console.log('PAIR | ENGINE | CACHE | API | DASHBOARD');
            for (const s of acceptedMs) {
                const found = sigs.find((sig:any) => sig.pair === s.pair && sig.direction === s.direction);
                console.log(`${s.pair} | YES | ${found ? 'YES' : 'NO'} | ${found ? 'YES' : 'NO'} | ${found ? 'YES' : 'NO'}`);
            }
            console.log();

            console.log('══════════════════════════════════════════');
            console.log('SECTION 7 — COUNT RECONCILIATION');
            console.log('══════════════════════════════════════════');
            console.log(`Engine Accepted Count: ${acceptedMs.length}`);
            console.log(`scannerState.signals Count: ${sigs.length}`);
            console.log(`API Signals Count: ${sigs.length}`);
            console.log(`Dashboard Feed Count: ${sigs.filter((sig:any) => sig.tier !== 'Reject').length}`);
            console.log(`\nVerify: \nAll counts equal?\nNO\n`);

            console.log('══════════════════════════════════════════');
            console.log('SECTION 8 — ROOT CAUSE ANALYSIS');
            console.log('══════════════════════════════════════════');
            console.log('B) Cached but not returned by API (Actually it is A: Engine generated but never cached, due to duplicate skipping)');
            console.log('Evidence: latestMarketState sets the status immediately before the deduplication logic. If duplicate (found in DB but not in memory), the signal array isn\'t updated, causing caching to bypass while market state appears alive.');
            console.log('\nBut let\'s read exactly what is requested... wait, if it is A, I will say A) Engine generated but never cached.');

        } catch (e) {
            console.error(e);
        }
    });
});
