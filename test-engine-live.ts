import { fetchCandles } from './server/twelvedata-scanner';
import { detectTrendMomentumScannerV5 } from './server/engine';

async function run() {
  const pairs = ['EURUSD', 'GBPJPY', 'XAUUSD', 'BTCUSD', 'EURAUD', 'GBPAUD', 'EURNZD', 'AUDCAD', 'GBPUSD', 'USDCAD'];
  
  for (const pair of pairs) {
    const candles5m = await fetchCandles(pair, '5min');
    const candles4h = await fetchCandles(pair, '4h');
    
    if (candles5m && candles4h) {
      const result = detectTrendMomentumScannerV5(pair, candles4h, candles5m, candles5m);
      if (result.signal && result.signal.tier !== 'Reject') {
        const pipsMultiplier = (pair.includes('JPY') || pair.includes('XAG')) ? 0.01 : 
                             (pair.includes('XAU') ? 0.1 : 
                             (pair === 'BTCUSD' ? 1.0 : 0.0001));
                             
        const slPips = Math.abs(result.signal.entry - result.signal.sl) / pipsMultiplier;
        console.log(`\n[${pair}] SIGNAL GENERATED! Risk: ${slPips.toFixed(1)} pips (EMA Crosses: ${(result.scores as any).emaCrosses})`);
      } else {
        const rejectReason = result.signal ? result.signal.aiReason : result.hardReject;
        console.log(`\n[${pair}] REJECTED! Regime: ${result.regime} | Reject: ${rejectReason} (EMA Crosses: ${(result.scores as any)?.emaCrosses})`);
      }
    }
  }
}

run();
