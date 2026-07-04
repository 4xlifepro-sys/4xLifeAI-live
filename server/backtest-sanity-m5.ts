import 'dotenv/config';
import { fetchCandles } from './live-market-feed.js';
import { detectTrendMomentumScannerV5 } from './engine.js';
import type { Candle } from '../src/types.js';

const PAIR = 'EURUSD';

console.log(`\n=== M5 SANITY CHECK: ${PAIR} ===\n`);

// Fetch 6 months of H4 and 1 week of M5
const h4Promise = fetchCandles(PAIR, '4h', 1080);
const m5Promise = fetchCandles(PAIR, '5min', 2016);

const [h4, m5] = await Promise.all([h4Promise, m5Promise]);

if (!h4 || !m5) {
  console.log(`Failed to fetch data. H4: ${h4?.length || 0}, M5: ${m5?.length || 0}`);
  process.exit(1);
}

console.log(`H4 candles: ${h4.length}`);
console.log(`M5 candles: ${m5.length}\n`);

// Filter closed candles
const now = Date.now();
const h4Filtered = h4.filter(c => {
  const ts = new Date(c.timestamp).getTime();
  return (ts + 4*60*60*1000) <= now;
});

const m5Filtered = m5.filter(c => {
  const ts = new Date(c.timestamp).getTime();
  return (ts + 5*60*1000) <= now;
});

console.log(`H4 after filter: ${h4Filtered.length}`);
console.log(`M5 after filter: ${m5Filtered.length}\n`);

// Test last 100 M5 candles with corresponding H4 context
const sampleCount = Math.min(100, m5Filtered.length);
let activeCount = 0;
let rejectCount = 0;
const rejectReasons: Record<string, number> = {};
let maxConf = 0;

for (let i = 0; i < sampleCount; i++) {
  // Take last 100 M5 candles up to current index
  const m5Slice = m5Filtered.slice(Math.max(0, i - 100), i + 1);
  
  // Take corresponding H4 context (all available H4)
  const h4Slice = h4Filtered;
  
  const result = detectTrendMomentumScannerV5(PAIR, h4Slice, m5Slice, m5Slice);
  
  if (result.signal?.status === 'ACTIVE') {
    activeCount++;
    if (result.signal.aiConfidence > maxConf) {
      maxConf = result.signal.aiConfidence;
    }
  } else {
    rejectCount++;
    const reason = result.signal?.aiReason || result.regimeReason || 'UNKNOWN';
    const code = reason.startsWith('REJECT_') ? reason : 
                 (result.regime === 'CHOP' ? 'REJECT_EMA_FLAT' : 
                  result.regime === 'VOLATILE' ? 'REJECT_SPIKE' : 'NO_BIAS_OR_OTHER');
    rejectReasons[code] = (rejectReasons[code] || 0) + 1;
  }
}

console.log(`\n--- Last ${sampleCount} M5 candles evaluated ---`);
console.log(`ACTIVE signals: ${activeCount} (${((activeCount/sampleCount)*100).toFixed(1)}%)`);
console.log(`REJECTED:     ${rejectCount} (${((rejectCount/sampleCount)*100).toFixed(1)}%)`);
console.log(`Max confidence seen: ${maxConf}`);
console.log(`\nRejection breakdown:`);
Object.entries(rejectReasons).sort((a,b) => b[1]-a[1]).forEach(([reason, count]) => {
  console.log(`  ${reason}: ${count} (${((count/rejectCount)*100).toFixed(1)}%)`);
});

console.log('\n=== DONE ===');
process.exit(0);
