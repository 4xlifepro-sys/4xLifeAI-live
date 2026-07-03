import { detectTrendMomentumScannerV5 } from './server/engine.js';
import { fetchCandles } from './server/twelvedata-scanner.js';
import { APPROVED_PAIRS } from './server/scanner.js';

async function testAll() {
    let totalScans = 0;
    let accepted = 0;
    let rejected = 0;

    const reasons: any = {};
    const regimes: any = {};

    for (const pair of APPROVED_PAIRS) {
        try {
            const htf = await fetchCandles(pair, '4h');
            const setup = await fetchCandles(pair, '5min');
            if (htf && setup) {
                totalScans++;
                const result = detectTrendMomentumScannerV5(pair, htf, setup, setup);
                
                const regime = result.regime;
                regimes[regime] = (regimes[regime] || 0) + 1;

                if (result.signal) {
                    if (result.signal.tier === 'Reject') {
                        rejected++;
                        const reason = result.signal.aiReason || 'UNKNOWN';
                        reasons[reason] = (reasons[reason] || 0) + 1;
                    } else {
                        accepted++;
                    }
                }
            }
        } catch(e) {}
    }
    
    console.log(`\nStats: Scans=${totalScans}, Accepted=${accepted}, Rejected=${rejected}`);
    console.log(`Regimes:`, regimes);
    console.log(`Rejection Reasons:`, reasons);
}
testAll();
