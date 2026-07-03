import { detectTrendMomentumScannerV5 } from './server/engine.js';
import { fetchCandles } from './server/twelvedata-scanner.js';
import { supabase } from './server/supabase.js';

async function testSingle() {
    const pair = 'EURUSD';
    const htf = await fetchCandles(pair, '4h');
    const setup = await fetchCandles(pair, '5min');
    
    if (htf && setup) {
        const result = detectTrendMomentumScannerV5(pair, htf, setup, setup);
        console.log("Current signal:", result.signal?.id);
        console.log("Regime:", result.regime);
        console.log("Tier:", result.signal?.tier);
        console.log("Reason:", result.signal?.aiReason);
        console.log("Entry bucket:", Math.round(result.signal?.entry! * 1000));
        
        const { data } = await supabase.from('signal_audit_log').select('*').eq('id', result.signal?.id).limit(1);
        console.log("Found in DB?", data?.length ? data[0].generated_at : 'No');
    }
}
testSingle();
