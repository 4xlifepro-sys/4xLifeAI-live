// Quick diagnostic: how many M5 candles pass each filter in engine2.ts?
import { readFileSync } from 'fs';

interface Candle { timestamp: string; open: number; high: number; low: number; close: number; volume?: number; }

function ema(closes: number[], period: number): number[] {
  const result: number[] = [];
  const k = 2 / (period + 1);
  let prev = closes[0];
  result.push(prev);
  for (let i = 1; i < closes.length; i++) {
    prev = closes[i] * k + prev * (1 - k);
    result.push(prev);
  }
  return result;
}

function rsi(closes: number[], period: number = 14): number[] {
  const result: number[] = [];
  if (closes.length < period + 1) return result;
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) avgGain += change; else avgLoss += Math.abs(change);
  }
  avgGain /= period; avgLoss /= period;
  for (let i = period; i < closes.length; i++) {
    if (i > period) {
      const change = closes[i] - closes[i - 1];
      const gain = change > 0 ? change : 0;
      const loss = change < 0 ? Math.abs(change) : 0;
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
    }
    if (avgLoss === 0) result.push(100);
    else result.push(100 - (100 / (1 + avgGain / avgLoss)));
  }
  return result;
}

function atrCalc(candles: Candle[], period: number = 14): number[] {
  const result: number[] = [];
  if (candles.length < period) return result;
  const trueRanges: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const tr = Math.max(candles[i].high - candles[i].low, Math.abs(candles[i].high - candles[i - 1].close), Math.abs(candles[i].low - candles[i - 1].close));
    trueRanges.push(tr);
  }
  let avg = 0;
  for (let i = 0; i < period; i++) avg += trueRanges[i];
  avg /= period;
  result.push(avg);
  for (let i = period; i < trueRanges.length; i++) {
    avg = (avg * (period - 1) + trueRanges[i]) / period;
    result.push(avg);
  }
  return result;
}

const h4: Candle[] = JSON.parse(readFileSync('.cache/EURUSD_4h_6m.json', 'utf-8'));
const m5: Candle[] = JSON.parse(readFileSync('.cache/EURUSD_5min_6m.json', 'utf-8'));

// Precompute H4 EMA once (full history)
const h4Closes = h4.map(c => c.close);
const h4Ema20 = ema(h4Closes, 20);
const h4Trend = h4Closes[h4Closes.length - 1] > h4Ema20[h4Ema20.length - 1] ? 'BULL' : 'BEAR';
console.log(`H4 trend: ${h4Trend} (last close: ${h4Closes[h4Closes.length - 1]}, EMA20: ${h4Ema20[h4Ema20.length - 1].toFixed(5)})`);

// But wait - H4 trend changes over time! We need to use H4 up to the M5 timestamp.
// For now, let's just count passes at the END of the dataset to see the problem.

let total = 0;
let passSession = 0, passTrend = 0, passRsi = 0, passPullback = 0, passEmaCross = 0, passAll = 0;

// Check last 5000 candles (about 17 days)
const start = Math.max(200, m5.length - 5000);
for (let i = start; i < m5.length; i += 3) { // every 15 min
  total++;
  
  const c = m5[i];
  const hour = new Date(c.timestamp).getUTCHours();
  
  if (hour >= 7 && hour <= 21) passSession++;
  else continue;
  
  // Use H4 trend at this point in time (approximate)
  // Find closest H4 candle
  const m5Ts = new Date(c.timestamp).getTime();
  let h4Idx = h4.length - 1;
  for (let j = h4.length - 1; j >= 0; j--) {
    if (new Date(h4[j].timestamp).getTime() <= m5Ts) { h4Idx = j; break; }
  }
  const trend = h4Closes[h4Idx] > h4Ema20[h4Idx] ? 'BULL' : 'BEAR';
  if (trend === 'BULL' || trend === 'BEAR') passTrend++; // always passes (it's either bull or bear)
  
  // M5 indicators using slice up to i
  const slice = m5.slice(Math.max(0, i - 200), i + 1);
  const closes = slice.map(c => c.close);
  const e20 = ema(closes, 20);
  const e9 = ema(closes, 9);
  const r = rsi(closes, 14);
  const a = atrCalc(slice, 14);
  
  const price = closes[closes.length - 1];
  const ema20 = e20[e20.length - 1];
  const ema9 = e9[e9.length - 1];
  const rsiVal = r.length > 0 ? r[r.length - 1] : 50;
  const atrVal = a.length > 0 ? a[a.length - 1] : 0;
  
  // RSI filter
  if (trend === 'BULL') {
    if (rsiVal <= 75) passRsi++;
    else continue;
    
    // Pullback zone: price within 0.5 ATR above EMA20
    if (price <= ema20 + atrVal * 0.5) passPullback++;
    else continue;
    
    // EMA cross: EMA9 > EMA20
    if (ema9 > ema20) passEmaCross++;
    else continue;
    
    passAll++;
  } else {
    if (rsiVal >= 25) passRsi++;
    else continue;
    
    if (price >= ema20 - atrVal * 0.5) passPullback++;
    else continue;
    
    if (ema9 < ema20) passEmaCross++;
    else continue;
    
    passAll++;
  }
}

console.log(`\nFilter breakdown (last 5000 M5 candles, sampled every 3rd):`);
console.log(`  Total sampled: ${total}`);
console.log(`  Pass session (07-21 UTC): ${passSession} (${(passSession/total*100).toFixed(1)}%)`);
console.log(`  Pass trend: ${passTrend} (${(passTrend/total*100).toFixed(1)}%)`);
console.log(`  Pass RSI: ${passRsi} (${(passRsi/total*100).toFixed(1)}%)`);
console.log(`  Pass pullback (within 0.5 ATR of EMA20): ${passPullback} (${(passPullback/total*100).toFixed(1)}%)`);
console.log(`  Pass EMA cross (EMA9 on correct side of EMA20): ${passEmaCross} (${(passEmaCross/total*100).toFixed(1)}%)`);
console.log(`  Pass ALL: ${passAll} (${(passAll/total*100).toFixed(1)}%)`);

// Now let's see what happens if we widen the pullback zone
console.log(`\n--- Pullback zone sensitivity (last 5000 candles) ---`);
for (const mult of [0.5, 1.0, 1.5, 2.0, 3.0]) {
  let count = 0;
  for (let i = start; i < m5.length; i += 3) {
    const c = m5[i];
    const hour = new Date(c.timestamp).getUTCHours();
    if (hour < 7 || hour > 21) continue;
    
    const m5Ts = new Date(c.timestamp).getTime();
    let h4Idx = h4.length - 1;
    for (let j = h4.length - 1; j >= 0; j--) {
      if (new Date(h4[j].timestamp).getTime() <= m5Ts) { h4Idx = j; break; }
    }
    const trend = h4Closes[h4Idx] > h4Ema20[h4Idx] ? 'BULL' : 'BEAR';
    
    const slice = m5.slice(Math.max(0, i - 200), i + 1);
    const closes = slice.map(c => c.close);
    const e20 = ema(closes, 20);
    const e9 = ema(closes, 9);
    const r = rsi(closes, 14);
    const a = atrCalc(slice, 14);
    const price = closes[closes.length - 1];
    const ema20v = e20[e20.length - 1];
    const ema9v = e9[e9.length - 1];
    const rsiVal = r.length > 0 ? r[r.length - 1] : 50;
    const atrVal = a.length > 0 ? a[a.length - 1] : 0;
    
    if (trend === 'BULL') {
      if (rsiVal > 75) continue;
      if (price > ema20v + atrVal * mult) continue;
      if (ema9v <= ema20v) continue;
      count++;
    } else {
      if (rsiVal < 25) continue;
      if (price < ema20v - atrVal * mult) continue;
      if (ema9v >= ema20v) continue;
      count++;
    }
  }
  console.log(`  Multiplier ${mult}x ATR: ${count} signals (${(count/total*100).toFixed(1)}%)`);
}
