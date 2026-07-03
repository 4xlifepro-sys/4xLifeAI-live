import { fetchCandles } from './server/twelvedata-scanner';
import { detectTrendMomentumScannerV5 } from './server/engine';

async function run() {
  const pairs = ['EURUSD', 'GBPJPY', 'XAUUSD', 'BTCUSD', 'EURAUD', 'GBPAUD', 'EURNZD', 'AUDCAD', 'GBPUSD', 'USDCAD'];
  let totalSignals = 0;
  let totalRejections = 0;
  let flatEmaRejects = 0;

  for (const pair of pairs) {
    const candles5m = await fetchCandles(pair, '5min');
    const candles4h = await fetchCandles(pair, '4h');
    
    if (candles5m && candles4h) {
       // Just test for the very last candle
       const result = detectTrendMomentumScannerV5(pair, candles4h, candles5m, candles5m);
       if (result.signal && result.signal.tier !== 'Reject') {
           totalSignals++;
       } else {
           totalRejections++;
           if (result.hardReject === 'REJECT_EMA_FLAT' || (result.signal && result.signal.aiReason === 'REJECT_EMA_FLAT')) {
               flatEmaRejects++;
           }
       }
    }
  }

  console.log(`\n--- FREQUENCY SANITY CHECK ---`);
  console.log(`Total Pairs Tested: ${pairs.length}`);
  console.log(`Total Valid Signals: ${totalSignals}`);
  console.log(`Total Rejections: ${totalRejections}`);
  console.log(`Rejections due to CHOP (EMA FLAT): ${flatEmaRejects}`);
  
  // If we have 1 valid signal out of 10 pairs right now, then over 288 candles (24h in 5m), 
  // how many signals would we get? 
  // It's not perfectly linear but roughly:
  const estimatedSignalsPerDay = (totalSignals / pairs.length) * 20; // Assume we scan 20 pairs total, and signals come when conditions align.
  console.log(`\nRough estimation: This strict filtering will yield very few but highly filtered signals per day.`);
}

run();
