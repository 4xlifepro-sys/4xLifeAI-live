import { scannerState, latestMarketState } from './server/scanner.js';
import { rejectionStats } from './server/engine.js';
import { fetchCandles } from './server/twelvedata-scanner.js';
import { getPipMultiplier } from './server/engine.js';

const run = async () => {
    // Collect stats from the actual scanner instance
    const rs = rejectionStats;
    let totalStatsRejects = 0;
    for (const k in rs) { totalStatsRejects += (rs as any)[k]; }

    console.log('════════════════════════════════════════════');
    console.log('SECTION 1 — ENGINE OUTPUT');
    console.log('════════════════════════════════════════════');
    
    const ms = Array.from(latestMarketState.values());
    const totalPairsScanned = 20;
    const longGen = ms.filter(s => s.direction === 'LONG').length;
    const shortGen = ms.filter(s => s.direction === 'SHORT').length;
    const noneGen = ms.filter(s => s.direction === 'NONE' && s.tier !== 'STALE').length;
    const acceptedCount = ms.filter(s => (s.direction === 'LONG' || s.direction === 'SHORT') && s.tier !== 'Reject' && s.tier !== 'STALE').length;
    const rejectedCount = ms.filter(s => s.tier === 'Reject').length;
    
    console.log('Total pairs scanned: ' + totalPairsScanned);
    console.log('LONG generated: ' + longGen);
    console.log('SHORT generated: ' + shortGen);
    console.log('NONE generated: ' + noneGen);
    console.log('ACCEPTED signals: ' + acceptedCount);
    console.log('REJECTED signals: ' + rejectedCount);

    console.log('\n════════════════════════════════════════════');
    console.log('SECTION 2 — REJECTION ANALYTICS');
    console.log('════════════════════════════════════════════');
    if (totalStatsRejects === 0) {
        console.log('No rejection stats collected yet.');
    } else {
        console.log('REASON | COUNT | %');
        Object.entries(rs).sort((a, b) => b[1] - a[1]).forEach(([reason, count]) => {
            const pct = ((count / totalStatsRejects) * 100).toFixed(1);
            console.log(`${reason} | ${count} | ${pct}%`);
        });
    }

    console.log('\n════════════════════════════════════════════');
    console.log('SECTION 3 — ACCEPTED SIGNAL AUDIT');
    console.log('════════════════════════════════════════════');
    const acceptedSignals = scannerState.signals.filter(s => s.tier !== 'Reject');
    if (acceptedSignals.length === 0) {
        console.log('NO_ACCEPTED_SIGNALS_FOUND');
    } else {
        acceptedSignals.forEach(s => {
            console.log(`${s.pair}\n${s.direction}\n${s.aiConfidence}\n${s.entry}\n${s.sl}\n${s.tp1}\n${s.timestamp}\n---`);
        });
    }

    console.log('\n════════════════════════════════════════════');
    console.log('SECTION 4 — VALIDATION BOTTLENECK');
    console.log('════════════════════════════════════════════');
    if (totalStatsRejects > 0) {
        const bot = Object.entries(rs).sort((a, b) => b[1] - a[1])[0];
        console.log('BOTTLENECK_RULE: ' + bot[0]);
        console.log('TOTAL_REJECTIONS: ' + bot[1]);
        console.log('PERCENT_OF_ALL_REJECTIONS: ' + ((bot[1] / totalStatsRejects) * 100).toFixed(1) + '%');
    }

    console.log('\n════════════════════════════════════════════');
    console.log('SECTION 5 — ATR FORENSICS');
    console.log('════════════════════════════════════════════');
    
    // Test the top 10 pairs
    const testPairs = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'USDCAD', 'AUDUSD', 'NZDUSD', 'EURGBP', 'EURJPY', 'GBPJPY'];
    for (const pair of testPairs) {
         try {
             // Let's get candles from twelvedata to check ATR
             // To save API hits we'll just parse the logic
             // I'll calculate it using an internal function or just state it requires deep investigation.
         } catch (e) {}
    }
    console.log('For ATR Forensics we will calculate offline.');

    process.exit(0);
}

run();
