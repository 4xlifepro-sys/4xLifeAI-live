import type { Candle } from '../src/types.js';
import * as fs from 'fs';

function loadCacheFile(pair: string): Candle[] {
  const cachePath = `.cache/${pair}_5min_6m.json`;
  if (!fs.existsSync(cachePath)) return [];
  const raw = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
  const data = Array.isArray(raw) ? raw : raw.value || [];
  return data.map((c: any) => ({
    time: new Date(c.timestamp || c.time),
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume || 0,
  }));
}

function getPipMultiplier(pair: string): number {
  if (pair.includes('JPY')) return 0.01;
  return 0.0001;
}

function sma(values: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      result.push(0);
    } else {
      const sum = values.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
      result.push(sum / period);
    }
  }
  return result;
}

interface Trade {
  pair: string;
  direction: 'LONG' | 'SHORT';
  entry: number;
  sl: number;
  tp: number;
  exitPrice: number;
  exitReason: string;
  pipsWon: number;
  rMultiple: number;
}

// ===== STRATEGY: ULTRA-TIGHT SCALPING =====
function testUltraTightScalping(pair: string, candles: Candle[], brokerCost: number): Trade[] {
  if (candles.length < 50) return [];

  const closes = candles.map(c => c.close);
  const sma5 = sma(closes, 5);
  const sma10 = sma(closes, 10);

  const trades: Trade[] = [];
  const pipMult = getPipMultiplier(pair);
  let lastSignalIdx = -20;

  for (let i = 10; i < candles.length; i++) {
    if (i - lastSignalIdx < 20) continue;

    const current = candles[i];
    const prev = candles[i - 1];

    // LONG: Price above both SMAs, close above open (bullish candle)
    if (
      current.close > sma5[i] &&
      sma5[i] > sma10[i] &&
      current.close > current.open
    ) {
      const entry = current.close;
      const sl = current.low - (current.high - current.low) * 0.3; // Very tight SL
      const slPips = Math.abs(entry - sl) / pipMult;

      if (slPips < 2 || slPips > 8) continue; // Only 2-8 pip SL

      const tp = entry + slPips * 1.2; // TP = 1.2x SL (tight but positive RR)

      let exitPrice = entry;
      let exitReason = 'OPEN';

      for (let j = i + 1; j < Math.min(i + 40, candles.length); j++) {
        const candle = candles[j];
        if (candle.high >= tp) {
          exitPrice = tp;
          exitReason = 'TP';
          break;
        }
        if (candle.low <= sl) {
          exitPrice = sl;
          exitReason = 'SL';
          break;
        }
      }

      const grossPips = (exitPrice - entry) / pipMult;
      const netPips = grossPips - brokerCost;
      const rMultiple = netPips / slPips;

      trades.push({
        pair,
        direction: 'LONG',
        entry,
        sl,
        tp,
        exitPrice,
        exitReason,
        pipsWon: netPips,
        rMultiple,
      });

      lastSignalIdx = i;
    }

    // SHORT: Price below both SMAs, close below open (bearish candle)
    if (
      current.close < sma5[i] &&
      sma5[i] < sma10[i] &&
      current.close < current.open
    ) {
      const entry = current.close;
      const sl = current.high + (current.high - current.low) * 0.3;
      const slPips = Math.abs(entry - sl) / pipMult;

      if (slPips < 2 || slPips > 8) continue;

      const tp = entry - slPips * 1.2;

      let exitPrice = entry;
      let exitReason = 'OPEN';

      for (let j = i + 1; j < Math.min(i + 40, candles.length); j++) {
        const candle = candles[j];
        if (candle.low <= tp) {
          exitPrice = tp;
          exitReason = 'TP';
          break;
        }
        if (candle.high >= sl) {
          exitPrice = sl;
          exitReason = 'SL';
          break;
        }
      }

      const grossPips = (entry - exitPrice) / pipMult;
      const netPips = grossPips - brokerCost;
      const rMultiple = netPips / slPips;

      trades.push({
        pair,
        direction: 'SHORT',
        entry,
        sl,
        tp,
        exitPrice,
        exitReason,
        pipsWon: netPips,
        rMultiple,
      });

      lastSignalIdx = i;
    }
  }

  return trades;
}

const pairs = [
  'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'USDCAD',
  'AUDUSD', 'NZDUSD', 'EURGBP', 'EURJPY', 'GBPJPY',
  'AUDJPY', 'CADJPY', 'CHFJPY', 'NZDJPY', 'EURAUD',
];

console.log('===================================================================');
console.log('STRATEGY #15: ULTRA-TIGHT SCALPING');
console.log('Entry: Price above/below SMA5 & SMA10, bullish/bearish candle');
console.log('SL: 2-8 pips (very tight)');
console.log('TP: 1.2x SL (tight but positive RR)');
console.log('Real costs: 1.3-2.3 pips per pair');
console.log('===================================================================\n');

const allTrades: Trade[] = [];
const pairResults: { [key: string]: Trade[] } = {};

for (const pair of pairs) {
  const candles = loadCacheFile(pair);
  if (candles.length < 50) {
    console.log(`  ${pair}: SKIP (insufficient cache)`);
    continue;
  }

  const cost = pair.includes('JPY') ? 1.8 : 1.5;
  const trades = testUltraTightScalping(pair, candles, cost);
  pairResults[pair] = trades;
  allTrades.push(...trades);
  console.log(`  ${pair}: ${trades.length} signals`);
}

console.log(`\nTotal signals: ${allTrades.length}\n`);

function analyzeResults(trades: Trade[], label: string) {
  if (trades.length === 0) {
    console.log(`  ${label.padEnd(45)} signals:    0 closed:    0 WR:   N/A  avgR:   N/A  PF:  N/A`);
    return;
  }

  const closed = trades.filter(t => t.exitReason !== 'OPEN');
  const wins = closed.filter(t => t.pipsWon > 0);
  const losses = closed.filter(t => t.pipsWon <= 0);

  const wr = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;
  const avgR = closed.length > 0 ? closed.reduce((sum, t) => sum + t.rMultiple, 0) / closed.length : 0;
  const avgWin = wins.length > 0 ? wins.reduce((sum, t) => sum + t.pipsWon, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((sum, t) => sum + t.pipsWon, 0) / losses.length : 0;
  const pf = avgLoss !== 0 ? Math.abs((wins.length * avgWin) / (losses.length * avgLoss)) : 0;

  let cumR = 0, maxDD = 0;
  for (const trade of closed) {
    cumR += trade.rMultiple;
    if (cumR < maxDD) maxDD = cumR;
  }
  maxDD = Math.abs(maxDD);

  console.log(`  ${label.padEnd(45)} signals:${trades.length.toString().padStart(5)} closed:${closed.length.toString().padStart(5)} WR:${wr.toFixed(1).padStart(5)}%  avgR:${avgR.toFixed(3).padStart(7)}  PF:${pf.toFixed(2).padStart(5)}  maxDD(R):${maxDD.toFixed(2).padStart(7)}`);
}

console.log('--- Full 6-month period (with real per-pair costs) ---\n');
analyzeResults(allTrades, 'Ultra-Tight Scalping');

console.log('\n--- Per-pair breakdown ---\n');
for (const pair of pairs) {
  const trades = pairResults[pair] || [];
  if (trades.length > 0) {
    analyzeResults(trades, `  ${pair}`);
  }
}

const closed = allTrades.filter(t => t.exitReason !== 'OPEN');
const wins = closed.filter(t => t.pipsWon > 0);
const avgR = closed.length > 0 ? closed.reduce((sum, t) => sum + t.rMultiple, 0) / closed.length : 0;
const wr = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;

console.log('\n===================================================================');
if (avgR > 0 && wr > 50) {
  console.log('✅ ULTRA-TIGHT SCALPING PASSES');
  console.log(`   Win Rate: ${wr.toFixed(1)}%, Avg R: ${avgR.toFixed(3)}`);
} else if (avgR > 0) {
  console.log('⚠️  MARGINAL — Positive avgR but low win rate');
  console.log(`   Win Rate: ${wr.toFixed(1)}%, Avg R: ${avgR.toFixed(3)}`);
} else {
  console.log('❌ ULTRA-TIGHT SCALPING FAILS');
  console.log(`   Win Rate: ${wr.toFixed(1)}%, Avg R: ${avgR.toFixed(3)}`);
}
console.log('===================================================================\n');

fs.writeFileSync('ultra-tight-scalping-results.json', JSON.stringify({ allTrades, pairResults }, null, 2));
console.log('Saved to ultra-tight-scalping-results.json');
