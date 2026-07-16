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

function ema(values: number[], period: number): number[] {
  const result: number[] = [];
  const k = 2 / (period + 1);
  let emaCurrent = values[0];
  result.push(emaCurrent);
  for (let i = 1; i < values.length; i++) {
    emaCurrent = values[i] * k + emaCurrent * (1 - k);
    result.push(emaCurrent);
  }
  return result;
}

function rsi(closes: number[], period: number = 14): number[] {
  const result: number[] = [];
  let gains = 0, losses = 0;
  for (let i = 1; i < period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  result.push(100 - 100 / (1 + rs));
  for (let i = period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) {
      avgGain = (avgGain * (period - 1) + diff) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) + Math.abs(diff)) / period;
    }
    rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    result.push(100 - 100 / (1 + rs));
  }
  return result;
}

function atr(candles: Candle[], period: number = 14): number[] {
  const result: number[] = [];
  let trSum = 0;
  for (let i = 0; i < candles.length; i++) {
    const tr = i === 0
      ? candles[i].high - candles[i].low
      : Math.max(
          candles[i].high - candles[i].low,
          Math.abs(candles[i].high - candles[i - 1].close),
          Math.abs(candles[i].low - candles[i - 1].close)
        );
    trSum += tr;
    if (i < period - 1) {
      result.push(0);
    } else if (i === period - 1) {
      result.push(trSum / period);
    } else {
      const atrVal = (result[i - 1] * (period - 1) + tr) / period;
      result.push(atrVal);
    }
  }
  return result;
}

function getPipMultiplier(pair: string): number {
  if (pair.includes('JPY')) return 0.01;
  return 0.0001;
}

interface Trade {
  pair: string;
  direction: 'LONG' | 'SHORT';
  entry: number;
  sl: number;
  tp: number;
  exitPrice: number;
  exitReason: 'TP' | 'SL' | 'TRAILING_EMA110' | 'OPEN';
  pipsWon: number;
  rMultiple: number;
}

function testEMA110Strategy(pair: string, candles: Candle[], brokerCost: number): Trade[] {
  if (candles.length < 200) return [];

  const closes = candles.map(c => c.close);
  const ema110Values = ema(closes, 110);
  const rsiValues = rsi(closes, 14);
  const atrValues = atr(candles, 14);

  const trades: Trade[] = [];
  const pipMult = getPipMultiplier(pair);
  let lastSignalIdx = -50;

  for (let i = 120; i < candles.length; i++) {
    const current = candles[i];
    const ema110 = ema110Values[i];
    const rsiVal = rsiValues[i];
    const atrVal = atrValues[i];

    if (i - lastSignalIdx < 50) continue;

    // LONG
    if (
      current.close > ema110 &&
      candles[i - 1].close <= ema110 &&
      rsiVal >= 40 && rsiVal <= 70 &&
      atrVal > 0
    ) {
      const entry = current.close;
      const sl = ema110 - atrVal * 1.5;
      const slPips = Math.abs(entry - sl) / pipMult;
      const tp = entry + atrVal * 2;

      let exitPrice = entry;
      let exitReason: 'TP' | 'SL' | 'TRAILING_EMA110' | 'OPEN' = 'OPEN';
      let trailingEMA110 = ema110;

      for (let j = i + 1; j < candles.length; j++) {
        const candle = candles[j];
        trailingEMA110 = ema110Values[j];

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

        if (candle.close < trailingEMA110 && candles[j - 1].close >= trailingEMA110) {
          exitPrice = trailingEMA110;
          exitReason = 'TRAILING_EMA110';
          break;
        }

        if (j - i >= 100) {
          exitPrice = candle.close;
          exitReason = 'OPEN';
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

    // SHORT
    if (
      current.close < ema110 &&
      candles[i - 1].close >= ema110 &&
      rsiVal >= 30 && rsiVal <= 60 &&
      atrVal > 0
    ) {
      const entry = current.close;
      const sl = ema110 + atrVal * 1.5;
      const slPips = Math.abs(entry - sl) / pipMult;
      const tp = entry - atrVal * 2;

      let exitPrice = entry;
      let exitReason: 'TP' | 'SL' | 'TRAILING_EMA110' | 'OPEN' = 'OPEN';
      let trailingEMA110 = ema110;

      for (let j = i + 1; j < candles.length; j++) {
        const candle = candles[j];
        trailingEMA110 = ema110Values[j];

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

        if (candle.close > trailingEMA110 && candles[j - 1].close <= trailingEMA110) {
          exitPrice = trailingEMA110;
          exitReason = 'TRAILING_EMA110';
          break;
        }

        if (j - i >= 100) {
          exitPrice = candle.close;
          exitReason = 'OPEN';
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
console.log('EMA110 M5 WITH ULTRA-LOW BROKER COSTS (0.1 pips)');
console.log('Testing theoretical limit: what if costs were almost zero?');
console.log('===================================================================\n');

const allTrades: Trade[] = [];
const pairResults: { [key: string]: Trade[] } = {};

for (const pair of pairs) {
  const candles = loadCacheFile(pair);
  if (candles.length < 200) {
    console.log(`  ${pair}: SKIP (insufficient cache)`);
    continue;
  }

  const trades = testEMA110Strategy(pair, candles, 0.1); // 0.1 pip cost (unrealistically cheap)
  pairResults[pair] = trades;
  allTrades.push(...trades);
  console.log(`  ${pair}: ${trades.length} signals`);
}

console.log(`\nTotal signals: ${allTrades.length}\n`);

function analyzeResults(trades: Trade[], label: string) {
  if (trades.length === 0) {
    console.log(`  ${label.padEnd(40)} signals:    0 closed:    0 WR:   N/A  avgR:   N/A  PF:  N/A`);
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

  console.log(`  ${label.padEnd(40)} signals:${trades.length.toString().padStart(5)} closed:${closed.length.toString().padStart(5)} WR:${wr.toFixed(1).padStart(5)}%  avgR:${avgR.toFixed(3).padStart(7)}  PF:${pf.toFixed(2).padStart(5)}  maxDD(R):${maxDD.toFixed(2).padStart(7)}`);
}

console.log('--- Full 6-month period (with 0.1 pip cost) ---\n');
analyzeResults(allTrades, 'EMA110 M5 (0.1 pip cost)');

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

console.log('\n===================================================================');
if (avgR > 0) {
  console.log('✅ WITH 0.1 PIP COST: Strategy becomes PROFITABLE');
  console.log(`   avgR: ${avgR.toFixed(3)} (positive expectancy)`);
} else {
  console.log('❌ EVEN WITH 0.1 PIP COST: Strategy still FAILS');
  console.log(`   avgR: ${avgR.toFixed(3)} (negative expectancy)`);
}
console.log('===================================================================\n');
