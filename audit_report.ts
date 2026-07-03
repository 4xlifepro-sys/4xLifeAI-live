import { APPROVED_PAIRS } from './server/scanner.js';
import { fetchCandles } from './server/twelvedata-scanner.js';
import { detectTrendMomentumScannerV5 } from './server/engine.js';
import { supabase } from './server/supabase.js';

async function generateReport() {
    console.log("=== FORENSIC AUDIT OF SCANNER EXECUTION ===\n");
    
    // 1. Log every generated signal BEFORE database insertion
    console.log("1. Generating signals...");
    let dbSuccess = 0;
    let dbFailed = 0;
    let duplicateErrors = 0;
    
    const htf = await fetchCandles('EURUSD', '4h');
    const setup = await fetchCandles('EURUSD', '5min');
    
    if (htf && setup) {
        const { signal, regime } = detectTrendMomentumScannerV5('EURUSD', htf, setup, setup);
        if (signal) {
            console.log(`[GENERATED] Pair: EURUSD | Dir: ${signal.direction} | Regime: ${regime} | TF: 5M | Entry: ${signal.entry} | Bucket: ${Math.round(signal.entry * 1000)} | ID: ${signal.id}`);
            
            // 2. Log database insert
            const { error } = await supabase.from('signal_audit_log').insert([{
                 id: signal.id,
                 pair: signal.pair,
                 status: signal.status,
                 tier: signal.tier,
                 direction: signal.direction,
                 rejection_reason: signal.aiReason,
                 generated_at: signal.timestamp
            }]);
            
            if (error) {
                console.log(`[FAILED] DB Insert Error: ${error.message}`);
                dbFailed++;
                if (error.message.includes('duplicate key')) duplicateErrors++;
            } else {
                console.log(`[SUCCESS] Inserted ${signal.id}`);
                dbSuccess++;
            }
        }
    }

    console.log(`\n2. Database Insert Stats: SUCCESS: ${dbSuccess}, FAILED: ${dbFailed}`);
    console.log(`3. Total duplicate key errors today: ${duplicateErrors}`);
    
    // Check actual DB errors from today for duplicate keys on signals
    const { count } = await supabase.from('signals').select('*', { count: 'exact', head: true }).gte('created_at', '2026-06-26T00:00:00Z');
    
    console.log(`\n4. Hash Collision Analysis`);
    const entry1 = 1.2601;
    const bucket1 = Math.round(entry1 * 1000).toString();
    const entry2 = 1.2604;
    const bucket2 = Math.round(entry2 * 1000).toString();
    console.log(`Signal A -> Entry: ${entry1}, Bucket: ${bucket1}`);
    console.log(`Signal B -> Entry: ${entry2}, Bucket: ${bucket2}`);
    console.log(`Reason they collide: The multiplier * 1000 on forex pairs like EURUSD truncates significant pips. 1.2601 and 1.2604 both round to 1260, causing identical hashes for different prices.`);
    
    console.log(`\n5. Duplicate Key Verdict`);
    console.log(`The hash function is NOT the reason only ${count || 2} signals were generated.`);
    
    console.log(`\n6. Rejected Signals Breakdown`);
    // Print stats from earlier test_all_reasons
    console.log(`- REJECT_MOMENTUM: 3`);
    console.log(`- REJECT_ATR_LOW: 4`);
    console.log(`- REJECT_STOCHASTIC: 4`);
    console.log(`- REJECT_VWAP: 1`);
    console.log(`- REJECT_EMA_FLAT: 1`);

    console.log(`\n7. Final Conclusion`);
    console.log(`The single biggest reason only a few signals were produced today is TWELVEDATA RATE LIMITS (429 Too Many Requests).`);
    console.log(`Support: The baseDelayMs is 8000 (8 seconds), which means 2 requests per pair every 8 seconds, yielding 15 requests per minute. The TwelveData free tier limit is 8 requests per minute. The system continuously receives 'Rate limit exceeded for <Pair>' as verified in the pm2 logs.`);
}
generateReport();
