import 'dotenv/config';
import { fetchHistoricalCandles } from './live-market-feed.js';
import { detectTrendMomentumScannerV5, getPipMultiplier } from './engine.js';
import type { Candle } from '../src/types.js';

const PAIRS = ['EURUSD', 'XAUUSD', 'BTCUSD'];

console.log('\n=== DIAGNOSTIC BACKTEST ===\n');

for (const pair of PAIRS) {
  console.log(`\n[${pair}] Fetching H4 data...`);
  const h4 = await fetchHistoricalCandles(pair, '4h', 1080);
  
  if (!h4 || h4.length === 0) {
    console.log(`[${pair}] NO H4 DATA`);
    continue;
  }
  
  console.log(`[${pair}] H4 candles: ${h4.length}`);
  console.log(`[${pair}] H4 range: ${h4[0].timestamp} → ${h4[h4.length-1].timestamp}`);
  
  // Test filterClosedCandles directly
  const now = Date.now();
  const h4Filtered = h4.filter(c => {
    const ts = new Date(c.timestamp).getTime();
    return (ts + 4*60*60*1000) <= now;
  });
  console.log(`[${pair}] After filterClosedCandles: ${h4Filtered.length} candles (removed ${h4.length - h4Filtered.length})`);
  
  if (h4Filtered.length < 50) {
    console.log(`[${pair}] ⚠️  INSUFFICIENT H4 after filter — this is the bug!`);
    continue;
  }
  
  // Now test the engine
  console.log(`\n[${pair}] Testing engine with last 100 H4 candles...`);
  for (let i = 100; i < h4Filtered.length; i += 20) {
    const slice = h4Filtered.slice(0, i);
    const result = detectTrendMomentumScannerV5(pair, slice, slice, slice);
    
    console.log(`  [i=${i}] regime=${result.regime} reason="${result.regimeReason}" bias=${result.signal?.bias || 'N/A'} conf=${result.signal?.aiConfidence || 0} tier=${result.signal?.tier || 'N/A'}`);
    
    if (i > 200) break; // Just sample a few
  }
  
  break; // Only test first pair for now
}

console.log('\n=== DONE ===\n');
process.exit(0);
