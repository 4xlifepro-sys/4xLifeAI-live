import type { Candle } from '../src/types.js';
import * as fs from 'fs';

// Load cached candle data
function loadCacheFile(pair: string): Candle[] {
  const cachePath = `.cache/${pair}_5min_6m.json`;
  if (!fs.existsSync(cachePath)) return [];
  const data = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
  return data.map((c: any) => ({
    time: new Date(c.time),
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume || 0,
  }));
}

// Calculate EMA
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

// Calculate RSI
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

// Calculate ATR
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

// Get pip multiplier
function getPipMultiplier(pair: string): number {
  if (pair.includes('JPY')) return 0.01;
  if (pair.includes('XAU')) return 0.1;
  if (pair.includes('XAG')) return 0.01;
  return 0.0001;
}

// Get broker cost per pair (Pepperstone RAW)
function getBrokerCost(pair: string): number {
  const costs: { [key: string]: number } = {
    'EURUSD': 1.3, 'GBPUSD': 1.6, 'USDJPY': 1.4, 'USDCHF': 1.5, 'USDCAD': 1.4,
    'AUDUSD': 1.5, 'NZDUSD': 1.6, 'EURGBP': 1.7, 'EURJPY': 2.0, 'GBPJPY': 2.2,
    'AUDJPY': 2.0, 'CADJPY': 1.8, 'CHFJPY': 2.1, 'NZDJPY': 2.3, 'EURAUD': 2.0,
  };
  return costs[pair] || 1.5;
}

interface Signal {
  pair: string;
  direction: 'LONG' | 'SHORT';
  entry: number;
  sl: number;
  tp: number;
  candleIndex: number;
  reason: string;
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

// EMA110 Strategy: Pullback to EMA110, exit via trailing EMA110
function testEMA110Strategy(pair: string, candles: Candle[]): Trade[] {
  if (candles.length < 200) return [];

  const closes = candles.map(c => c.close);
  const ema110Values = ema(closes, 110);
  const rsiValues = rsi(closes, 14);
  const atrValues = atr(candles, 14);

  const trades: Trade[] = [];
  const pipMult = getPipMultiplier(pair);
  const brokerCost = getBrokerCost(pair);
  let lastSignalIdx = -50;

  for (let i = 120; i < candles.length; i++) {
    const current = candles[i];
    const ema110 = ema110Values[i];
    const rsiVal = rsiValues[i];
    const atrVal = atrValues[i];

    // Avoid multiple signals on same pair
    if (i - lastSignalIdx < 50) continue;

    // LONG: Price pulled back to EMA110, now bouncing up
    if (
      current.close > ema110 &&
      candles[i - 1].close <= ema110 &&
      rsiVal >= 40 && rsiVal <= 70 &&
      atrVal > 0
    ) {
      const entry = current.close;
      const sl = ema110 - atrVal * 1.5; // SL below EMA110 + ATR buffer
      const slPips = Math.abs(entry - sl) / pipMult;

      // TP: target 2x ATR above entry (natural reversal target)
      const tp = entry + atrVal * 2;
      const tpPips = Math.abs(tp - entry) / pipMult;

      // Simulate trade: follow candles until TP, SL, or trailing EMA110 exit
      let exitPrice = entry;
      let exitReason: 'TP' | 'SL' | 'TRAILING_EMA110' | 'OPEN' = 'OPEN';
      let trailingEMA110 = ema110;

      for (let j = i + 1; j < candles.length; j++) {
        const candle = candles[j];
        trailingEMA110 = ema110Values[j];

        // Check TP hit
        if (candle.high >= tp) {
          exitPrice = tp;
          exitReason = 'TP';
          break;
        }

        // Check SL hit
        if (candle.low <= sl) {
          exitPrice = sl;
          exitReason = 'SL';
          break;
        }

        // Check trailing EMA110 exit (close below EMA110 after being above)
        if (candle.close < trailingEMA110 && candles[j - 1].close >= trailingEMA110) {
          exitPrice = trailingEMA110;
          exitReason = 'TRAILING_EMA110';
          break;
        }

        // Max hold: 100 candles
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

    // SHORT: Price pulled back to EMA110, now bouncing down
    if (
      current.close < ema110 &&
      candles[i - 1].close >= ema110 &&
      rsiVal >= 30 && rsiVal <= 60 &&
      atrVal > 0
    ) {
      const entry = current.close;
      const sl = ema110 + atrVal * 1.5; // SL above EMA110 + ATR buffer
      const slPips = Math.abs(entry - sl) / pipMult;

      // TP: target 2x ATR below entry
      const tp = entry - atrVal * 2;
      const tpPips = Math.abs(entry - tp) / pipMult;

      // Simulate trade
      let exitPrice = entry;
      let exitReason: 'TP' | 'SL' | 'TRAILING_EMA110' | 'OPEN' = 'OPEN';
      let trailingEMA110 = ema110;

      for (let j = i + 1; j < candles.length; j++) {
        const candle = candles[j];
        trailingEMA110 = ema110Values[j];

        // Check TP hit
        if (candle.low <= tp) {
          exitPrice = tp;
          exitReason = 'TP';
          break;
        }

        // Check SL hit
        if (candle.high >= sl) {
          exitPrice = sl;
          exitReason = 'SL';
          break;
        }

        // Check trailing EMA110 exit (close above EMA110 after being below)
        if (candle.close > trailingEMA110 && candles[j - 1].close <= trailingEMA110) {
          exitPrice = trailingEMA110;
          exitReason = 'TRAILING_EMA110';
          break;
        }

        // Max hold: 100 candles
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

// Main backtest
const pairs = [
  'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'USDCAD',
  'AUDUSD', 'NZDUSD', 'EURGBP', 'EURJPY', 'GBPJPY',
  'AUDJPY', 'CADJPY', 'CHFJPY', 'NZDJPY', 'EURAUD',
];

console.log('===================================================================');
console.log('EMA110 M5 PULLBACK STRATEGY FOR FOREX');
console.log('Entry: Price pulls back to EMA110, bounces');
console.log('Exit: Trailing EMA110 OR 2x ATR TP target');
console.log('Real costs applied from start (Pepperstone RAW spreads + commission)');
console.log('===================================================================\n');

const allTrades: Trade[] = [];
const pairResults: { [key: string]: Trade[] } = {};

for (const pair of pairs) {
  const candles = loadCacheFile(pair);
  if (candles.length < 200) {
    console.log(`  ${pair}: SKIP (insufficient cache)`);
    continue;
  }

  const trades = testEMA110Strategy(pair, candles);
  pairResults[pair] = trades;
  allTrades.push(...trades);
  console.log(`  ${pair}: ${trades.length} signals`);
}

console.log(`\nTotal signals across ${Object.keys(pairResults).length} pairs: ${allTrades.length}\n`);

// Find walk-forward split (roughly 67% / 33%)
const sortedTrades = allTrades.sort((a, b) => a.entry - b.entry);
const splitIdx = Math.floor(sortedTrades.length * 0.67);
const inSampleTrades = allTrades.filter((t, i) => i < splitIdx);
const outOfSampleTrades = allTrades.filter((t, i) => i >= splitIdx);

function analyzeResults(trades: Trade[], label: string) {
  if (trades.length === 0) {
    console.log(`  ${label.padEnd(40)} signals:    0 closed:    0 WR:   N/A  avgR:   N/A  PF:  N/A  maxDD(R):  N/A  avgSL(pips):  N/A`);
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

  // Max drawdown in R
  let cumR = 0, maxDD = 0;
  for (const trade of closed) {
    cumR += trade.rMultiple;
    if (cumR < maxDD) maxDD = cumR;
  }
  maxDD = Math.abs(maxDD);

  const avgSL = closed.length > 0 ? closed.reduce((sum, t) => sum + Math.abs(t.entry - t.sl) / getPipMultiplier(t.pair), 0) / closed.length : 0;

  console.log(`  ${label.padEnd(40)} signals:${trades.length.toString().padStart(5)} closed:${closed.length.toString().padStart(5)} WR:${wr.toFixed(1).padStart(5)}%  avgR:${avgR.toFixed(3).padStart(7)}  PF:${pf.toFixed(2).padStart(5)}  maxDD(R):${maxDD.toFixed(2).padStart(7)}  avgSL(pips):${avgSL.toFixed(1).padStart(6)}`);
}

console.log('--- Full 6-month period (with real per-pair costs) ---\n');
analyzeResults(allTrades, 'EMA110 M5 (full period)');

console.log('\n--- Per-pair breakdown (full period, with costs) ---\n');
for (const pair of pairs) {
  const trades = pairResults[pair] || [];
  if (trades.length > 0) {
    analyzeResults(trades, `  ${pair}`);
  }
}

console.log('\n--- Walk-forward validation (with real per-pair costs) ---\n');
analyzeResults(inSampleTrades, 'EMA110 M5 (in-sample)');
analyzeResults(outOfSampleTrades, 'EMA110 M5 (out-of-sample)');

// Exit reason breakdown
const exitReasons = {
  'TP': allTrades.filter(t => t.exitReason === 'TP').length,
  'SL': allTrades.filter(t => t.exitReason === 'SL').length,
  'TRAILING_EMA110': allTrades.filter(t => t.exitReason === 'TRAILING_EMA110').length,
  'OPEN': allTrades.filter(t => t.exitReason === 'OPEN').length,
};

console.log('\n--- Exit reason breakdown (full period) ---\n');
for (const [reason, count] of Object.entries(exitReasons)) {
  const pct = ((count / allTrades.length) * 100).toFixed(1);
  console.log(`  ${reason}: ${count} (${pct}%)`);
}

console.log('\n===================================================================');
const closed = allTrades.filter(t => t.exitReason !== 'OPEN');
const wins = closed.filter(t => t.pipsWon > 0);
const avgR = closed.length > 0 ? closed.reduce((sum, t) => sum + t.rMultiple, 0) / closed.length : 0;
const wr = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;

if (avgR > 0 && wr > 50) {
  console.log('✅ EMA110 M5 PASSES — Positive expectancy, reasonable win rate');
} else if (avgR > 0) {
  console.log('⚠️  EMA110 M5 MARGINAL — Positive avgR but low win rate');
} else {
  console.log('❌ EMA110 M5 FAILS — Negative expectancy after costs');
}
console.log('===================================================================\n');

fs.writeFileSync('ema110-m5-results.json', JSON.stringify({ allTrades, pairResults }, null, 2));
console.log('Saved to ema110-m5-results.json');
