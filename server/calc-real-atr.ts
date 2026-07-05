import { fetchCandles } from './live-market-feed.js';

const pairs = [
  { pair: 'EURUSD', digits: 5 }, { pair: 'USDJPY', digits: 3 },
  { pair: 'USDCAD', digits: 5 }, { pair: 'NZDUSD', digits: 5 },
  { pair: 'EURJPY', digits: 3 }, { pair: 'GBPJPY', digits: 3 },
  { pair: 'XAUUSD', digits: 2 }, { pair: 'XAGUSD', digits: 3 },
  { pair: 'BTCUSD', digits: 2 }, { pair: 'ETHUSD', digits: 2 }
];

function toPips(val: number, digits: number): number {
  if (digits <= 3) return val * 100;       // JPY pairs: 1 pip = 0.01
  if (digits === 2) return val;             // metals/crypto: 1 pip = $1
  return val * 10000;                       // forex: 1 pip = 0.0001
}

async function main() {
  console.log('REAL ATR FROM LIVE cTrader DATA (100 M5 candles)\n');
  console.log('Pair     | Avg(pips) | Min(pips) | Max(pips) | SL@1.5x | SL@2.0x | SL@2.5x');
  console.log('---------|-----------|-----------|-----------|---------|---------|--------');

  for (const { pair, digits } of pairs) {
    try {
      const candles = await fetchCandles(pair, '5min');
      if (!candles || candles.length < 20) { console.log(`${pair.padEnd(9)} | NO DATA`); continue; }

      const trs: number[] = [];
      for (let i = 1; i < candles.length; i++) {
        const c = candles[i], p = candles[i - 1];
        trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
      }
      const avgTR = trs.reduce((a, b) => a + b, 0) / trs.length;
      const minTR = Math.min(...trs);
      const maxTR = Math.max(...trs);

      const a = toPips(avgTR, digits);
      const mn = toPips(minTR, digits);
      const mx = toPips(maxTR, digits);
      console.log(`${pair.padEnd(9)} | ${a.toFixed(1).padStart(9)} | ${mn.toFixed(1).padStart(9)} | ${mx.toFixed(1).padStart(9)} | ${(a*1.5).toFixed(1).padStart(7)} | ${(a*2).toFixed(1).padStart(7)} | ${(a*2.5).toFixed(1).padStart(7)}`);
    } catch (e: any) { console.log(`${pair.padEnd(9)} | ERROR: ${e.message}`); }
    await new Promise(r => setTimeout(r, 50));
  }
}

main().catch(console.error);
