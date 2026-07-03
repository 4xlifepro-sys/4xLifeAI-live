import { detectTrendMomentumScannerV5 } from './server/engine';

function mockCandles(count: number, startPrice: number) {
  const candles = [];
  let currentPrice = startPrice;
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    candles.push({
      timestamp: new Date(now - (count - i) * 300000).toISOString(),
      open: currentPrice,
      high: currentPrice + 0.001,
      low: currentPrice - 0.001,
      close: currentPrice + 0.0005,
      volume: 100
    });
    // flat price
  }
  return candles;
}

const htf = mockCandles(100, 1.1000);
// Make the HTF EMA rising to get a BUY bias
for (let i = 0; i < htf.length; i++) {
  htf[i].close = 1.1000 + (i * 0.0010);
  htf[i].high = htf[i].close + 0.001;
  htf[i].low = htf[i].close - 0.001;
  htf[i].open = htf[i].close - 0.0005;
}

const setup = mockCandles(100, 1.1000);
// Make setup flat/choppy
for (let i = 0; i < setup.length; i++) {
   setup[i].close = 1.1000 + Math.sin(i) * 0.0010;
   setup[i].open = 1.1000;
   setup[i].high = 1.1000 + 0.0020;
   setup[i].low = 1.1000 - 0.0020;
}

const result = detectTrendMomentumScannerV5('EURUSD', htf, setup, setup);
console.log(result.regime);
if (result.signal) {
  console.log(`Tier:`, result.signal.tier);
  console.log(`Reason:`, result.signal.aiReason);
}
