import { supabase } from './server/supabase.js';
import { detectTrendMomentumScannerV5 } from './server/engine.js';
import { APPROVED_PAIRS } from './server/scanner.js';

async function generateFakeCandles(pair: string) {
    // Generate fake htf and setup candles for testing
    const htfRaw = [];
    const setupRaw = [];
    
    let basePrice = 1.1000;
    if (pair.includes('JPY')) basePrice = 150.00;
    if (pair.includes('XAU')) basePrice = 2300.00;
    
    // 100 HTF candles
    for (let i = 0; i < 100; i++) {
        const o = basePrice + (Math.random() - 0.5) * 0.01;
        const c = o + (Math.random() - 0.4) * 0.01; // slight upward bias
        const h = Math.max(o, c) + Math.random() * 0.005;
        const l = Math.min(o, c) - Math.random() * 0.005;
        htfRaw.push({ open: o, high: h, low: l, close: c, volume: 1000, datetime: new Date(Date.now() - (100 - i) * 4 * 60 * 60 * 1000).getTime() });
        basePrice = c;
    }
    
    // 100 Setup candles
    for (let i = 0; i < 100; i++) {
        const o = basePrice + (Math.random() - 0.5) * 0.002;
        const c = o + (Math.random() - 0.4) * 0.002;
        const h = Math.max(o, c) + Math.random() * 0.001;
        const l = Math.min(o, c) - Math.random() * 0.001;
        setupRaw.push({ open: o, high: h, low: l, close: c, volume: 100, datetime: new Date(Date.now() - (100 - i) * 5 * 60 * 1000).getTime() });
        basePrice = c;
    }
    
    return { htfRaw, setupRaw };
}

async function runBurst() {
    console.log("Starting Burst Test: 100 signals");
    let signalsGenerated = 0;
    
    // We will simulate the `engine` creating a signal for 100 pairs/setups
    for (let i = 0; i < 100; i++) {
        const pair = APPROVED_PAIRS[i % APPROVED_PAIRS.length];
        const { htfRaw, setupRaw } = await generateFakeCandles(pair);
        const result = detectTrendMomentumScannerV5(pair, htfRaw, setupRaw);
        
        // We will directly inject into Supabase to simulate burst DB write
        if (result && supabase) {
             const signal = {
                 id: crypto.randomUUID(),
                 pair,
                 direction: i % 2 === 0 ? 'LONG' : 'SHORT',
                 entry: setupRaw[setupRaw.length - 1].close,
                 sl: setupRaw[setupRaw.length - 1].close - 0.0050,
                 tp1: setupRaw[setupRaw.length - 1].close + 0.0050,
                 tp2: setupRaw[setupRaw.length - 1].close + 0.0100,
                 tp3: setupRaw[setupRaw.length - 1].close + 0.0150,
                 timestamp: new Date().toISOString(),
                 aiConfidence: 85,
                 tier: 'Good',
                 bias: i % 2 === 0 ? 'BULLISH' : 'BEARISH'
             };
             
             // Async write without waiting to blast DB
             supabase.from('signals').insert([{
                 id: signal.id,
                 pair: signal.pair,
                 direction: signal.direction,
                 entry_price: signal.entry,
                 sl: signal.sl,
                 tp1: signal.tp1,
                 tp2: signal.tp2,
                 tp3: signal.tp3,
                 score: signal.aiConfidence,
                 tier: signal.tier,
                 bias: signal.bias,
                 status: 'ACTIVE'
             }]).then(({error}) => {
                 if (error) {
                     console.error("Burst write error:", error.message);
                 } else {
                     signalsGenerated++;
                     if (signalsGenerated === 100) {
                         console.log("Burst Test Completed Successfully: 100 signals written");
                     }
                 }
             });
        }
        
        // Small delay to simulate processing but still bursty
        await new Promise(r => setTimeout(r, 10));
    }
}

runBurst();
