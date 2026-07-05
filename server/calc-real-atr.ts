import { fetchCandles } from './live-market-feed.js';

const pairs = ['EURUSD', 'USDJPY', 'USDCAD', 'NZDUSD', 'EURJPY', 'GBPJPY', 'XAUUSD', 'XAGUSD', 'BTCUSD', 'ETHUSD'];

async function calcATR(pair: string): Promise<{ avg: number; min: number; max: number; candles: number }> {
  try {
    const candles = await fetchCandles(pair, 'M5', 1000);
    if (!candles || candles.length < 50) return { avg: 0, min: 0, max: 0, candles: 0 };

    // Calculate ATR(14) manually
    const trValues: number[] = [];
    for (let i = 1; i < candles.length; i++) {
      const high = candles[i].high;
      const low = candles[i].low;
      const prevClose = candles[i - 1].close;
      const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
      trValues.push(tr);
    }

    // Average TR (simplified - full ATR uses Wilder's smoothing)
    const avgTR = trValues.reduce((sum, tr) => sum + tr, 0) / trValues.length;
    const minTR = Math.min(...trValues);
    const maxTR = Math.max(...trValues);

    return {
      avg: avgTR,
      min: minTR,
      max: maxTR,
      candles: candles.length
    };
  } catch (e) {
    console.error(`${pair} failed:`, e.message);
    return { avg: 0, min: 0, max: 0, candles: 0 };
  }
}

async function main() {
  console.log('REAL ATR CALCULATION FROM LIVE DATA\n');
  console.log('Pair | Avg ATR | Min ATR | Max ATR | Candles | SL (2x ATR) | SL (1.5x ATR)');
  console.log('---|---|---|---|---|---|---');

  for (const pair of pairs) {
    const atr = await calcATR(pair);
    if (atr.candles === 0) continue;

    const sl2x = atr.avg * 2;
    const sl15x = atr.avg * 1.5;
    console.log(`${pair} | ${atr.avg.toFixed(2)} | ${atr.min.toFixed(2)} | ${atr.max.toFixed(2)} | ${atr.candles} | ${sl2x.toFixed(2)} | ${sl15x.toFixed(2)}`);

    // Wait 50ms between requests to avoid rate limits
    await new Promise(r => setTimeout(r, 50));
  }
}

main().catch(console.error);
