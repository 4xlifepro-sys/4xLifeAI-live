import { APPROVED_PAIRS } from './server/scanner.js';
import { fetchCandles } from './server/twelvedata-scanner.js';
import { detectTrendMomentumScannerV5 } from './server/engine.js';
import { supabase } from './server/supabase.js';

async function audit() {
    console.log("Starting Production Proof Audit...");
    const seenIds = new Map();
    let collisionCount = 0;
    
    // Simulate multiple scans of the same pair to test if the bucket logic drops signals
    console.log("Analyzing hash uniqueness on EURUSD...");
    const pair = 'EURUSD';
    const htf = await fetchCandles(pair, '4h');
    const setup = await fetchCandles(pair, '5min');
    
    if (htf && setup) {
        // Run it multiple times slightly modifying the entry price to simulate real market movement
        for (let i = 0; i < 5; i++) {
            // Fake small movement
            const mockSetup = [...setup];
            mockSetup[mockSetup.length-1].close += i * 0.0001; 
            
            const { signal, regime } = detectTrendMomentumScannerV5(pair, htf, mockSetup, mockSetup);
            if (signal) {
                const bucket = Math.round(signal.entry * 1000);
                console.log(`[GENERATED] Pair: ${pair} | Entry: ${signal.entry.toFixed(5)} | Bucket: ${bucket} | ID: ${signal.id}`);
                
                if (seenIds.has(signal.id)) {
                    console.log(`  -> [COLLISION] ${signal.id} matches previous signal!`);
                    collisionCount++;
                } else {
                    seenIds.set(signal.id, signal.entry);
                }
            }
        }
    }

    console.log(`\nTotal In-Memory Collisions: ${collisionCount}`);
}
audit();
