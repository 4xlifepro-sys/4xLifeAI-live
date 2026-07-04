import 'dotenv/config';
import { fetchCandles } from './live-market-feed.js';
import { detectTrendMomentumScannerV5 } from './engine.js';
import type { Candle } from '../src/types.js';

const PAIR = 'EURUSD';

console.log(`\n=== M5 SANITY CHECK: ${PAIR} ===\n`);

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
const primaryRejectReasons: Record<string, number> = {};
const failureCounts: Record<number, number> = {};
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
    
    // Collect ALL failing conditions
    const allFailures: string[] = [];
    
    // Check each condition independently
    if (result.regime === 'CHOP') {
      allFailures.push('REGIME_CHOP');
    }
    if (result.regime === 'VOLATILE') {
      allFailures.push('REGIME_VOLATILE');
    }
    
    // Check bias
    if (!result.signal?.bias || result.signal.bias === 'NONE') {
      allFailures.push('NO_BIAS');
    }
    
    // Check confidence
    if (result.signal && result.signal.aiConfidence < 65) {
      allFailures.push('LOW_CONFIDENCE');
    }
    
    // Parse the aiReason for explicit rejection codes
    const aiReason = result.signal?.aiReason || '';
    if (aiReason.includes('ATR_LOW')) allFailures.push('ATR_LOW');
    if (aiReason.includes('MOMENTUM')) allFailures.push('MOMENTUM');
    if (aiReason.includes('STOCHASTIC')) allFailures.push('STOCHASTIC');
    if (aiReason.includes('COUNTER_TREND')) allFailures.push('COUNTER_TREND');
    if (aiReason.includes('NO_PULLBACK')) allFailures.push('NO_PULLBACK');
    if (aiReason.includes('STOP_DISTANCE')) allFailures.push('STOP_DISTANCE');
    if (aiReason.includes('EMA_FLAT')) allFailures.push('EMA_FLAT');
    if (aiReason.includes('SPIKE')) allFailures.push('SPIKE');
    
    // If no explicit failures detected, mark as OTHER
    if (allFailures.length === 0) {
      allFailures.push('OTHER');
    }
    
    // Track how many failures per candle
    const failureCount = allFailures.length;
    failureCounts[failureCount] = (failureCounts[failureCount] || 0) + 1;
    
    // Track each individual failure
    for (const failure of allFailures) {
      rejectReasons[failure] = (rejectReasons[failure] || 0) + 1;
    }
    
    // Track the primary (first) rejection for backward compatibility
    const primaryReason = aiReason.startsWith('REJECT_') ? aiReason : 
                 (result.regime === 'CHOP' ? 'REJECT_EMA_FLAT' : 
                  result.regime === 'VOLATILE' ? 'REJECT_SPIKE' : 'NO_BIAS_OR_OTHER');
    primaryRejectReasons[primaryReason] = (primaryRejectReasons[primaryReason] || 0) + 1;
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
