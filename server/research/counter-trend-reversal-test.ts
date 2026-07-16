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

function rsi(closes: number[], period: number = 14): number[] {
  const result: number[] = [];
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  result.push(100 - 100 / (1 + avgGain / avgLoss));
  
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) {
      avgGain = (avgGain * (period - 1) + diff) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) - diff) / period;
    }
    result.push(100 - 100 / (1 + avgGain / avgLoss));
  }
  return result;
}

function getPipMultiplier(pair: string): number {
  if (pair.includes('JPY')) return 0.01;
  return 0.0001;
}

function getBrokerCost(pair: string): number {
  const costs: { [key: string]: number } = {
    'EURUSD': 1.3, 'GBPUSD': 1.6, 'USDJPY': 1.4, 'USDCHF': 1.5, 'USDCAD': 1.4,
    'AUDUSD': 1.5, 'NZDUSD': 1.6, 'EURGBP': 1.7, 'EURJPY': 2.0, 'GBPJPY': 2.2,
    'AUDJPY': 2.0, 'CADJPY': 1.8, 'CHFJPY': 2.1, 'NZDJPY': 2.3, 'EURAUD': 2.0,
  };
  return costs[pair] || 1.5;
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

// ===== STRATEGY: COUNTER-TREND REVERSAL =====
// Trade extreme overextensions that snap back to mean
function testCounterTrendReversal(pair: string, candles: Candle[], brokerCost: number): Trade[] {
  if (candles.length < 100) return [];

  const closes = candles.map(c => c.close);
  const ema50 = ema(closes, 50);
  const atrValues = atr(candles, 14);
  const rsiValues = rsi(closes, 14);

  const trades: Trade[] = [];
  const pipMult = getPipMultiplier(pair);
  let lastSignalIdx = -60;

  for (let i = 50; i < candles.length; i++) {
    if (i - lastSignalIdx < 60) continue;

    const current = candles[i];
    const ema50Val = ema50[i];
    const atrVal = atrValues[i];
    const rsiVal = rsiValues[i];

    // Calculate distance from EMA50
    const distanceFromEMA = Math.abs(current.close - ema50Val);
    const distanceATR = distanceFromEMA / atrVal;

    // ===== LONG: Price extremely oversold (far below EMA50 + RSI < 25) =====
    const oversold = current.close < ema50Val && distanceATR > 2.5 && rsiVal < 25;
    const reversalCandle = current.close > current.open && (current.close - current.open) > atrVal * 0.4;

    if (oversold && reversalCandle) {
      const entry = current.close;
      const sl = current.low - atrVal * 0.5; // SL below reversal candle
      const slPips = Math.abs(entry - sl) / pipMult;

      if (slPips < 8 || slPips > 40) continue;

      // TP: Target EMA50 (mean reversion)
      const tp = ema50Val;
      const tpPips = Math.abs(tp - entry) / pipMult;

      if (tpPips < 10) continue; // Need at least 10 pip target

      let exitPrice = entry;
      let exitReason = 'OPEN';

      for (let j = i + 1; j < Math.min(i + 200, candles.length); j++) {
        const candle = candles[j];
        
        // TP hit (reached EMA50)
        if (candle.high >= tp) {
          exitPrice = tp;
          exitReason = 'TP';
          break;
        }
        
        // SL hit
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

    // ===== SHORT: Price extremely overbought (far above EMA50 + RSI > 75) =====
    const overbought = current.close > ema50Val && distanceATR > 2.5 && rsiVal > 75;
    const reversalCandleShort = current.close < current.open && (current.open - current.close) > atrVal * 0.4;

    if (overbought && reversalCandleShort) {
      const entry = current.close;
      const sl = current.high + atrVal * 0.5;
      const slPips = Math.abs(entry - sl) / pipMult;

      if (slPips < 8 || slPips > 40) continue;

      const tp = ema50Val;
      const tpPips = Math.abs(entry - tp) / pipMult;

      if (tpPips < 10) continue;

      let exitPrice = entry;
      let exitReason = 'OPEN';

      for (let j = i + 1; j < Math.min(i + 200, candles.length); j++) {
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
console.log('STRATEGY #24: COUNTER-TREND REVERSAL');
console.log('Entry: Price extremely overextended (>2.5x ATR from EMA50 + RSI extreme)');
console.log('Exit: Target EMA50 (mean reversion)');
console.log('Key insight: Trade snap-back moves after extreme moves');
console.log('Real costs: 1.3-2.3 pips per pair');
console.log('===================================================================\n');

const allTrades: Trade[] = [];
const pairResults: { [key: string]: Trade[] } = {};

for (const pair of pairs) {
  const candles = loadCacheFile(pair);
  if (candles.length < 100) {
    console.log(`  ${pair}: SKIP (insufficient cache)`);
    continue;
  }

  const cost = getBrokerCost(pair);
  const trades = testCounterTrendReversal(pair, candles, cost);
  pairResults[pair] = trades;
  allTrades.push(...trades);
  console.log(`  ${pair}: ${trades.length} signals`);
}

console.log(`\nTotal signals: ${allTrades.length}\n`);

function analyzeResults(trades: Trade[], label: string) {
  if (trades.length === 0) {
    console.log(`  ${label.padEnd(50)} signals:    0 closed:    0 WR:   N/A  avgR:   N/A  PF:  N/A`);
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

  const avgSL = closed.length > 0 ? closed.reduce((sum, t) => sum + Math.abs(t.entry - t.sl) / getPipMultiplier(t.pair), 0) / closed.length : 0;
  const avgTP = closed.length > 0 ? closed.reduce((sum, t) => sum + Math.abs(t.tp - t.entry) / getPipMultiplier(t.pair), 0) / closed.length : 0;

  console.log(`  ${label.padEnd(50)} signals:${trades.length.toString().padStart(5)} closed:${closed.length.toString().padStart(5)} WR:${wr.toFixed(1).padStart(5)}%  avgR:${avgR.toFixed(3).padStart(7)}  PF:${pf.toFixed(2).padStart(5)}  maxDD(R):${maxDD.toFixed(2).padStart(7)}  avgSL:${avgSL.toFixed(1).padStart(5)}p  avgTP:${avgTP.toFixed(1).padStart(5)}p`);
}

console.log('--- Full 6-month period (with real per-pair costs) ---\n');
analyzeResults(allTrades, 'Counter-Trend Reversal');

console.log('\n--- Per-pair breakdown ---\n');
for (const pair of pairs) {
  const trades = pairResults[pair] || [];
  if (trades.length > 0) {
    analyzeResults(trades, `  ${pair}`);
  }
}

// Exit reason breakdown
const exitReasons: { [key: string]: number } = {};
for (const t of allTrades) {
  exitReasons[t.exitReason] = (exitReasons[t.exitReason] || 0) + 1;
}
console.log('\n--- Exit reason breakdown ---\n');
for (const [reason, count] of Object.entries(exitReasons)) {
  const pct = ((count / allTrades.length) * 100).toFixed(1);
  console.log(`  ${reason}: ${count} (${pct}%)`);
}

const closed = allTrades.filter(t => t.exitReason !== 'OPEN');
const wins = closed.filter(t => t.pipsWon > 0);
const avgR = closed.length > 0 ? closed.reduce((sum, t) => sum + t.rMultiple, 0) / closed.length : 0;
const wr = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;

console.log('\n===================================================================');
if (avgR > 0 && wr > 50) {
  console.log('✅ COUNTER-TREND REVERSAL PASSES');
  console.log(`   Win Rate: ${wr.toFixed(1)}%, Avg R: ${avgR.toFixed(3)}`);
} else if (avgR > 0) {
  console.log('⚠️  MARGINAL — Positive avgR but low win rate');
  console.log(`   Win Rate: ${wr.toFixed(1)}%, Avg R: ${avgR.toFixed(3)}`);
} else {
  console.log('❌ COUNTER-TREND REVERSAL FAILS');
  console.log(`   Win Rate: ${wr.toFixed(1)}%, Avg R: ${avgR.toFixed(3)}`);
}
console.log('===================================================================\n');

fs.writeFileSync('counter-trend-reversal-results.json', JSON.stringify({ allTrades, pairResults }, null, 2));
console.log('Saved to counter-trend-reversal-results.json');
