import 'dotenv/config';
import { fetchHistoricalCandles } from './live-market-feed.js';
import { detectTrendMomentumScannerV5 } from './engine.js';
import type { Candle } from '../src/types.js';

const PAIR = 'EURUSD';

console.log(`\n=== PASS-RATE SANITY CHECK: ${PAIR} ===\n`);

const h4 = await fetchHistoricalCandles(PAIR, '4h', 1080);
if (!h4 || h4.length < 100) {
  console.log(`Insufficient H4 data: ${h4?.length || 0}`);
  process.exit(1);
}

const now = Date.now();
const h4Filtered = h4.filter(c => {
  const ts = new Date(c.timestamp).getTime();
  return (ts + 4*60*60*1000) <= now;
});

console.log(`H4 candles after filter: ${h4Filtered.length}`);

// Test the last 100 H4 candles
const sampleCount = Math.min(100, h4Filtered.length - 50);
let activeCount = 0;
let rejectCount = 0;
const rejectReasons: Record<string, number> = {};
let maxConf = 0;

for (let i = 50; i < 50 + sampleCount; i++) {
  const slice = h4Filtered.slice(0, i + 1);
  const result = detectTrendMomentumScannerV5(PAIR, slice, slice, slice);
  
  if (result.signal?.status === 'ACTIVE') {
    activeCount++;
    if (result.signal.aiConfidence > maxConf) {
      maxConf = result.signal.aiConfidence;
    }
  } else {
    rejectCount++;
    const reason = result.signal?.aiReason || result.regimeReason || 'UNKNOWN';
    // Normalize to the rejection code
    const code = reason.startsWith('REJECT_') ? reason : 
                 (result.regime === 'CHOP' ? 'REJECT_EMA_FLAT' : 
                  result.regime === 'VOLATILE' ? 'REJECT_SPIKE' : 'NO_BIAS_OR_OTHER');
    rejectReasons[code] = (rejectReasons[code] || 0) + 1;
  }
}

console.log(`\n--- Last ${sampleCount} H4 candles evaluated ---`);
console.log(`ACTIVE signals: ${activeCount} (${((activeCount/sampleCount)*100).toFixed(1)}%)`);
console.log(`REJECTED:     ${rejectCount} (${((rejectCount/sampleCount)*100).toFixed(1)}%)`);
console.log(`Max confidence seen: ${maxConf}`);
console.log(`\nRejection breakdown:`);
Object.entries(rejectReasons).sort((a,b) => b[1]-a[1]).forEach(([reason, count]) => {
  console.log(`  ${reason}: ${count} (${((count/rejectCount)*100).toFixed(1)}%)`);
});

console.log('\n=== DONE ===');
process.exit(0);
