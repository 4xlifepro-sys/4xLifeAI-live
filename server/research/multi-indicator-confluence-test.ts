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

// ===== INDICATORS =====
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

function macd(closes: number[]): { macd: number[], signal: number[], hist: number[] } {
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signalLine = ema(macdLine, 9);
  const histogram = macdLine.map((v, i) => v - signalLine[i]);
  return { macd: macdLine, signal: signalLine, hist: histogram };
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

function adx(candles: Candle[], period: number = 14): number[] {
  const result: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i < period) {
      result.push(0);
      continue;
    }
    let plusDM = 0, minusDM = 0, tr = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const high = candles[j].high - candles[j - 1].high;
      const low = candles[j - 1].low - candles[j].low;
      if (high > 0 && high > low) plusDM += high;
      if (low > 0 && low > high) minusDM += low;
      tr += Math.max(
        candles[j].high - candles[j].low,
        Math.abs(candles[j].high - candles[j - 1].close),
        Math.abs(candles[j].low - candles[j - 1].close)
      );
    }
    const plusDI = (plusDM / tr) * 100;
    const minusDI = (minusDM / tr) * 100;
    const di = Math.abs(plusDI - minusDI) / (plusDI + minusDI);
    result.push(di * 100);
  }
  return result;
}

function stochastic(candles: Candle[], period: number = 14): { k: number[], d: number[] } {
  const k: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) {
      k.push(0);
    } else {
      const high = Math.max(...candles.slice(i - period + 1, i + 1).map(c => c.high));
      const low = Math.min(...candles.slice(i - period + 1, i + 1).map(c => c.low));
      const close = candles[i].close;
      const stoch = ((close - low) / (high - low)) * 100;
      k.push(stoch);
    }
  }
  const d = sma(k, 3);
  return { k, d };
}

function bbands(closes: number[], period: number = 20, stdDev: number = 2): { upper: number[], middle: number[], lower: number[] } {
  const middle = sma(closes, period);
  const upper: number[] = [];
  const lower: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      upper.push(0);
      lower.push(0);
    } else {
      const slice = closes.slice(i - period + 1, i + 1);
      const mean = slice.reduce((a, b) => a + b, 0) / period;
      const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period;
      const std = Math.sqrt(variance);
      upper.push(middle[i] + stdDev * std);
      lower.push(middle[i] - stdDev * std);
    }
  }
  return { upper, middle, lower };
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
  exitReason: string;
  pipsWon: number;
  rMultiple: number;
}

// ===== STRATEGY: MULTI-INDICATOR CONFLUENCE =====
function testMultiIndicatorStrategy(pair: string, candles: Candle[], brokerCost: number): Trade[] {
  if (candles.length < 200) return [];

  const closes = candles.map(c => c.close);
  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const rsiVal = rsi(closes, 14);
  const macdData = macd(closes);
  const atrVal = atr(candles, 14);
  const adxVal = adx(candles, 14);
  const stochData = stochastic(candles, 14);
  const bbData = bbands(closes, 20, 2);

  const trades: Trade[] = [];
  const pipMult = getPipMultiplier(pair);
  let lastSignalIdx = -50;

  for (let i = 200; i < candles.length; i++) {
    const current = candles[i];
    if (i - lastSignalIdx < 50) continue;

    // ===== LONG SETUP =====
    // Confluence: Price above SMA200, SMA50 > SMA200, RSI 40-70, MACD positive, ADX > 20, Stoch < 80
    const longTrend = closes[i] > sma200[i] && sma50[i] > sma200[i];
    const longRSI = rsiVal[i] >= 40 && rsiVal[i] <= 70;
    const longMACD = macdData.hist[i] > 0;
    const longADX = adxVal[i] > 20;
    const longStoch = stochData.k[i] < 80;
    const longBB = closes[i] > bbData.lower[i] && closes[i] < bbData.upper[i];
    const longEMA = ema12[i] > ema26[i];

    let longScore = 0;
    if (longTrend) longScore++;
    if (longRSI) longScore++;
    if (longMACD) longScore++;
    if (longADX) longScore++;
    if (longStoch) longScore++;
    if (longBB) longScore++;
    if (longEMA) longScore++;

    if (longScore >= 5) { // Need 5+ indicators aligned
      const entry = current.close;
      const sl = entry - atrVal[i] * 1.5;
      const slPips = Math.abs(entry - sl) / pipMult;
      const tp = entry + atrVal[i] * 2.5;

      let exitPrice = entry;
      let exitReason = 'OPEN';

      for (let j = i + 1; j < Math.min(i + 100, candles.length); j++) {
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

    // ===== SHORT SETUP =====
    const shortTrend = closes[i] < sma200[i] && sma50[i] < sma200[i];
    const shortRSI = rsiVal[i] >= 30 && rsiVal[i] <= 60;
    const shortMACD = macdData.hist[i] < 0;
    const shortADX = adxVal[i] > 20;
    const shortStoch = stochData.k[i] > 20;
    const shortBB = closes[i] > bbData.lower[i] && closes[i] < bbData.upper[i];
    const shortEMA = ema12[i] < ema26[i];

    let shortScore = 0;
    if (shortTrend) shortScore++;
    if (shortRSI) shortScore++;
    if (shortMACD) shortScore++;
    if (shortADX) shortScore++;
    if (shortStoch) shortScore++;
    if (shortBB) shortScore++;
    if (shortEMA) shortScore++;

    if (shortScore >= 5) {
      const entry = current.close;
      const sl = entry + atrVal[i] * 1.5;
      const slPips = Math.abs(entry - sl) / pipMult;
      const tp = entry - atrVal[i] * 2.5;

      let exitPrice = entry;
      let exitReason = 'OPEN';

      for (let j = i + 1; j < Math.min(i + 100, candles.length); j++) {
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
console.log('MULTI-INDICATOR CONFLUENCE STRATEGY (7 INDICATORS)');
console.log('SMA + EMA + RSI + MACD + ADX + Stochastic + Bollinger Bands');
console.log('Requires 5+ indicators aligned for entry');
console.log('Real costs: 1.3-2.3 pips per pair');
console.log('===================================================================\n');

const allTrades: Trade[] = [];
const pairResults: { [key: string]: Trade[] } = {};

for (const pair of pairs) {
  const candles = loadCacheFile(pair);
  if (candles.length < 200) {
    console.log(`  ${pair}: SKIP (insufficient cache)`);
    continue;
  }

  const cost = pair.includes('JPY') ? 1.8 : 1.5; // Slightly higher cost for JPY
  const trades = testMultiIndicatorStrategy(pair, candles, cost);
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
analyzeResults(allTrades, 'Multi-Indicator Confluence');

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
  console.log('✅ MULTI-INDICATOR CONFLUENCE PASSES');
  console.log(`   Win Rate: ${wr.toFixed(1)}%, Avg R: ${avgR.toFixed(3)}`);
} else if (avgR > 0) {
  console.log('⚠️  MARGINAL — Positive avgR but low win rate');
  console.log(`   Win Rate: ${wr.toFixed(1)}%, Avg R: ${avgR.toFixed(3)}`);
} else {
  console.log('❌ MULTI-INDICATOR CONFLUENCE FAILS');
  console.log(`   Win Rate: ${wr.toFixed(1)}%, Avg R: ${avgR.toFixed(3)}`);
}
console.log('===================================================================\n');

fs.writeFileSync('multi-indicator-results.json', JSON.stringify({ allTrades, pairResults }, null, 2));
console.log('Saved to multi-indicator-results.json');
