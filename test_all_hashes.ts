import { detectTrendMomentumScannerV5 } from './server/engine.js';
import { fetchCandles } from './server/twelvedata-scanner.js';
import { APPROVED_PAIRS } from './server/scanner.js';
import { supabase } from './server/supabase.js';

async function testAll() {
    let totalScans = 0;
    let accepted = 0;
    let rejected = 0;
    let duplicate = 0;

    for (const pair of APPROVED_PAIRS) {
        try {
            const htf = await fetchCandles(pair, '4h');
            const setup = await fetchCandles(pair, '5min');
            if (htf && setup) {
                totalScans++;
                const result = detectTrendMomentumScannerV5(pair, htf, setup, setup);
                
                if (result.signal) {
                    const { data } = await supabase.from('signal_audit_log').select('*').eq('id', result.signal.id).limit(1);
                    const isDup = data && data.length > 0;
                    if (isDup) duplicate++;
                    else if (result.signal.tier === 'Reject') rejected++;
                    else accepted++;
                    
                    console.log(`${pair}: Bias ${result.signal.direction}, Regime ${result.regime}, Tier ${result.signal.tier}, Dup? ${isDup}`);
                } else {
                    console.log(`${pair}: No Bias, Regime ${result.regime}`);
                }
            }
        } catch(e) {}
    }
    
    console.log(`\nStats: Scans=${totalScans}, Accepted=${accepted}, Rejected=${rejected}, Duplicates=${duplicate}`);
}
testAll();
