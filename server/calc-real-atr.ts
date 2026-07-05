import { fetchCandles } from './live-market-feed.js';

const pairs = [
  { pair: 'EURUSD', digits: 5, unit: 'pips' },
  { pair: 'USDJPY', digits: 3, unit: 'pips' },
  { pair: 'USDCAD', digits: 5, unit: 'pips' },
  { pair: 'NZDUSD', digits: 5, unit: 'pips' },
  { pair: 'EURJPY', digits: 3, unit: 'pips' },
  { pair: 'GBPJPY', digits: 3, unit: 'pips' },
  { pair: 'XAUUSD', digits: 2, unit: 'USD' },
  { pair: 'XAGUSD', digits: 3, unit: 'USD' },
  { pair: 'BTCUSD', digits: 2, unit: 'USD' },
  { pair: 'ETHUSD', digits: 2, unit: 'USD' }
];

function convertValue(val: number, digits: number): number {
  if (digits <= 3) return val * 100;   // JPY: 1 pip = 0.01
  if (digits === 2) return val;         // metals/crypto: value IS dollars
  return val * 10000;                   // forex: 1 pip = 0.0001
}

async function main() {
  console.log('REAL ATR FROM LIVE cTrader DATA (100 M5 candles)\n');
  console.log('Pair     | Unit | Avg      | Min      | Max      | SL@1.5x  | SL@2.0x  | SL@2.5x');
  console.log('---------|------|----------|----------|----------|----------|----------|--------');

  for (const { pair, digits, unit } of pairs) {
    try {
      const candles = await fetchCandles(pair, '5min');
      if (!candles || candles.length < 20) { console.log(`${pair.padEnd(9)} | ${unit.padEnd(4)} | NO DATA`); continue; }

      const trs: number[] = [];
      for (let i = 1; i < candles.length; i++) {
        const c = candles[i], p = candles[i - 1];
        trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
      }
      const avgTR = trs.reduce((a, b) => a + b, 0) / trs.length;
      const minTR = Math.min(...trs);
      const maxTR = Math.max(...trs);

      const a = convertValue(avgTR, digits);
      const mn = convertValue(minTR, digits);
      const mx = convertValue(maxTR, digits);
      
      const fmt = (v: number) => v.toFixed(unit === 'USD' ? 2 : 1);
      
      console.log(`${pair.padEnd(9)} | ${unit.padEnd(4)} | ${fmt(a).padStart(8)} | ${fmt(mn).padStart(8)} | ${fmt(mx).padStart(8)} | ${fmt(a*1.5).padStart(8)} | ${fmt(a*2).padStart(8)} | ${fmt(a*2.5).padStart(8)}`);
    } catch (e: any) { console.log(`${pair.padEnd(9)} | ${unit.padEnd(4)} | ERROR: ${e.message}`); }
    await new Promise(r => setTimeout(r, 50));
  }
}

main().catch(console.error);
