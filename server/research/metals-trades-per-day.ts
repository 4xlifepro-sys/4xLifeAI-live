import type { Candle } from '../src/types.js';
import * as fs from 'fs';

// Load cached candle data
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

// Get broker cost
function getBrokerCost(pair: string): number {
  const costs: { [key: string]: number } = {
    'XAUUSD': 25.7, 'XAGUSD': 3.7,
  };
  return costs[pair] || 1.5;
}

interface Signal {
  pair: string;
  time: Date;
  direction: 'LONG' | 'SHORT';
  entry: number;
}

// Metals trend-breakout strategy
function testMetalsTrendBreakout(pair: string, candles: Candle[]): Signal[] {
  if (candles.length < 100) return [];

  const closes = candles.map(c => c.close);
  const ema200Values = ema(closes, 200);
  const ema20Values = ema(closes, 20);
  const rsiValues = rsi(closes, 14);
  const atrValues = atr(candles, 14);

  const signals: Signal[] = [];
  let lastSignalIdx = -50;

  for (let i = 200; i < candles.length; i++) {
    const current = candles[i];
    const ema200 = ema200Values[i];
    const ema20 = ema20Values[i];
    const rsiVal = rsiValues[i];
    const atrVal = atrValues[i];

    // Avoid multiple signals
    if (i - lastSignalIdx < 50) continue;

    // LONG: Price above EMA200, breaks above EMA20 + ATR
    if (
      current.close > ema200 &&
      current.close > ema20 + atrVal * 0.5 &&
      candles[i - 1].close <= ema20 + atrVal * 0.5 &&
      rsiVal >= 45 && rsiVal <= 75 &&
      atrVal > 0
    ) {
      signals.push({
        pair,
        time: current.time,
        direction: 'LONG',
        entry: current.close,
      });
      lastSignalIdx = i;
    }

    // SHORT: Price below EMA200, breaks below EMA20 - ATR
    if (
      current.close < ema200 &&
      current.close < ema20 - atrVal * 0.5 &&
      candles[i - 1].close >= ema20 - atrVal * 0.5 &&
      rsiVal >= 25 && rsiVal <= 55 &&
      atrVal > 0
    ) {
      signals.push({
        pair,
        time: current.time,
        direction: 'SHORT',
        entry: current.close,
      });
      lastSignalIdx = i;
    }
  }

  return signals;
}

// Main analysis
const pairs = ['XAUUSD', 'XAGUSD'];

console.log('===================================================================');
console.log('METALS TREND-BREAKOUT: TRADES PER DAY ANALYSIS');
console.log('===================================================================\n');

const allSignals: Signal[] = [];

for (const pair of pairs) {
  const candles = loadCacheFile(pair);
  if (candles.length < 100) {
    console.log(`  ${pair}: SKIP (insufficient cache)`);
    continue;
  }

  const signals = testMetalsTrendBreakout(pair, candles);
  allSignals.push(...signals);
  console.log(`  ${pair}: ${signals.length} total signals`);
}

console.log(`\nTotal signals: ${allSignals.length}\n`);

// Group by day
const signalsByDay: { [key: string]: Signal[] } = {};
for (const signal of allSignals) {
  const time = typeof signal.time === 'string' ? new Date(signal.time) : signal.time;
  if (isNaN(time.getTime())) continue; // Skip invalid dates
  const dayKey = time.toISOString().split('T')[0]; // YYYY-MM-DD
  if (!signalsByDay[dayKey]) signalsByDay[dayKey] = [];
  signalsByDay[dayKey].push(signal);
}

const days = Object.keys(signalsByDay).sort();
const tradesPerDay = days.map(day => signalsByDay[day].length);

const avgPerDay = tradesPerDay.reduce((a, b) => a + b, 0) / tradesPerDay.length;
const minPerDay = Math.min(...tradesPerDay);
const maxPerDay = Math.max(...tradesPerDay);

console.log('--- Trades per day statistics ---\n');
console.log(`  Total days: ${days.length}`);
console.log(`  Average trades/day: ${avgPerDay.toFixed(2)}`);
console.log(`  Min trades/day: ${minPerDay}`);
console.log(`  Max trades/day: ${maxPerDay}`);

// Show distribution
console.log('\n--- Distribution ---\n');
const buckets = [0, 1, 2, 3, 4, 5, 10, 20, 50];
for (let i = 0; i < buckets.length - 1; i++) {
  const min = buckets[i];
  const max = buckets[i + 1];
  const count = tradesPerDay.filter(t => t > min && t <= max).length;
  const pct = ((count / tradesPerDay.length) * 100).toFixed(1);
  console.log(`  ${min < max ? min + '-' + max : '>' + min} trades/day: ${count} days (${pct}%)`);
}

// Show sample days
console.log('\n--- Sample days (first 10) ---\n');
for (let i = 0; i < Math.min(10, days.length); i++) {
  const day = days[i];
  const count = signalsByDay[day].length;
  console.log(`  ${day}: ${count} signals`);
}

console.log('\n===================================================================');
console.log(`CONCLUSION: Metals generates ~${avgPerDay.toFixed(1)} signals per day on average`);
console.log('===================================================================\n');
