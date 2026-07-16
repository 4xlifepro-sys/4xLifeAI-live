import type { Candle } from '../src/types.js';
import * as fs from 'fs';

function loadCacheFile(pair: string): Candle[] {
  const cachePath = `.cache/${pair}_5min_6m.json`;
  if (!fs.existsSync(cachePath)) return [];
  const raw = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
  const data = Array.isArray(raw) ? raw : raw.value || [];
  return data.map((c: any) => ({
    time: new Date(c.timestamp || c.time),
    open: c.open, high: c.high, low: c.low, close: c.close,
    volume: c.volume || 0,
  }));
}

function ema(values: number[], period: number): number[] {
  const result: number[] = [];
  const k = 2 / (period + 1);
  let e = values[0];
  result.push(e);
  for (let i = 1; i < values.length; i++) { e = values[i] * k + e * (1 - k); result.push(e); }
  return result;
}

function sma(values: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) { result.push(0); continue; }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += values[j];
    result.push(sum / period);
  }
  return result;
}

function atr(candles: Candle[], period: number = 14): number[] {
  const result: number[] = [];
  let trSum = 0;
  for (let i = 0; i < candles.length; i++) {
    const tr = i === 0 ? candles[i].high - candles[i].low :
      Math.max(candles[i].high - candles[i].low, Math.abs(candles[i].high - candles[i - 1].close), Math.abs(candles[i].low - candles[i - 1].close));
    trSum += tr;
    if (i < period - 1) result.push(0);
    else if (i === period - 1) result.push(trSum / period);
    else result.push((result[i - 1] * (period - 1) + tr) / period);
  }
  return result;
}

function rsi(closes: number[], period: number = 14): number[] {
  const result: number[] = [];
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) { const d = closes[i] - closes[i - 1]; if (d > 0) gains += d; else losses -= d; }
  let ag = gains / period, al = losses / period;
  result.push(100 - 100 / (1 + ag / al));
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) { ag = (ag * (period - 1) + d) / period; al = (al * (period - 1)) / period; }
    else { ag = (ag * (period - 1)) / period; al = (al * (period - 1) - d) / period; }
    result.push(100 - 100 / (1 + ag / al));
  }
  return result;
}

function williamsR(candles: Candle[], period: number = 14): number[] {
  const result: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) { result.push(-50); continue; }
    let hh = -Infinity, ll = Infinity;
    for (let j = i - period + 1; j <= i; j++) { hh = Math.max(hh, candles[j].high); ll = Math.min(ll, candles[j].low); }
    result.push(hh === ll ? -50 : ((hh - candles[i].close) / (hh - ll)) * -100);
  }
  return result;
}

function parabolicSAR(candles: Candle[], af: number = 0.02, maxAF: number = 0.2): number[] {
  const result: number[] = [];
  let sar = candles[0].low;
  let ep = candles[0].high;
  let isLong = true;
  let accel = af;
  
  result.push(sar);
  
  for (let i = 1; i < candles.length; i++) {
    const prevSar = sar;
    
    if (isLong) {
      sar = prevSar + accel * (ep - prevSar);
      sar = Math.min(sar, candles[i - 1].low, candles[i - 2]?.low || Infinity);
      
      if (candles[i].low < sar) {
        isLong = false;
        sar = ep;
        ep = candles[i].low;
        accel = af;
      } else {
        if (candles[i].high > ep) {
          ep = candles[i].high;
          accel = Math.min(accel + af, maxAF);
        }
      }
    } else {
      sar = prevSar + accel * (ep - prevSar);
      sar = Math.max(sar, candles[i - 1].high, candles[i - 2]?.high || -Infinity);
      
      if (candles[i].high > sar) {
        isLong = true;
        sar = ep;
        ep = candles[i].high;
        accel = af;
      } else {
        if (candles[i].low < ep) {
          ep = candles[i].low;
          accel = Math.min(accel + af, maxAF);
        }
      }
    }
    
    result.push(sar);
  }
  
  return result;
}

function getPipMultiplier(pair: string): number {
  return pair.includes('JPY') ? 0.01 : 0.0001;
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
  pair: string; direction: 'LONG' | 'SHORT'; entry: number; sl: number; tp: number;
  exitPrice: number; exitReason: string; pipsWon: number; rMultiple: number;
}

// ===== STRATEGY #59: WILLIAMS %R EXTREME + TREND =====
// Williams %R oversold/overbought + EMA trend filter
function testWilliamsR(pair: string, candles: Candle[], brokerCost: number): Trade[] {
  if (candles.length < 100) return [];
  
  const closes = candles.map(c => c.close);
  const ema50 = ema(closes, 50);
  const wr = williamsR(candles, 14);
  const atrValues = atr(candles, 14);
  const pipMult = getPipMultiplier(pair);
  
  const trades: Trade[] = [];
  let lastSignalIdx = -30;
  
  for (let i = 50; i < candles.length; i++) {
    if (i - lastSignalIdx < 30) continue;
    if (atrValues[i] === 0) continue;
    
    // BUY: WR was below -80 then crosses above -80 + price above EMA50
    if (wr[i] > -80 && wr[i - 1] <= -80 && closes[i] > ema50[i]) {
      const sl = candles[i].low - atrValues[i] * 1.0;
      const risk = candles[i].close - sl;
      const tp = candles[i].close + risk * 3.0;
      const slPips = (risk / pipMult) + brokerCost;
      if (slPips < 8 || slPips > 50) continue;
      
      trades.push({ pair, direction: 'LONG', entry: candles[i].close, sl, tp, exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0 });
      lastSignalIdx = i;
    }
    
    // SELL: WR was above -20 then crosses below -20 + price below EMA50
    if (wr[i] < -20 && wr[i - 1] >= -20 && closes[i] < ema50[i]) {
      const sl = candles[i].high + atrValues[i] * 1.0;
      const risk = sl - candles[i].close;
      const tp = candles[i].close - risk * 3.0;
      const slPips = (risk / pipMult) + brokerCost;
      if (slPips < 8 || slPips > 50) continue;
      
      trades.push({ pair, direction: 'SHORT', entry: candles[i].close, sl, tp, exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0 });
      lastSignalIdx = i;
    }
  }
  
  return simulateTrades(trades, candles, pipMult, brokerCost);
}

// ===== STRATEGY #60: PARABOLIC SAR REVERSAL =====
// SAR flip + RSI confirmation
function testParabolicSAR(pair: string, candles: Candle[], brokerCost: number): Trade[] {
  if (candles.length < 100) return [];
  
  const closes = candles.map(c => c.close);
  const sar = parabolicSAR(candles);
  const rsiValues = rsi(closes, 14);
  const atrValues = atr(candles, 14);
  const pipMult = getPipMultiplier(pair);
  
  const trades: Trade[] = [];
  let lastSignalIdx = -25;
  
  for (let i = 50; i < candles.length; i++) {
    if (i - lastSignalIdx < 25) continue;
    if (atrValues[i] === 0) continue;
    
    // BUY: SAR flips below price (was above) + RSI > 50
    if (candles[i].close > sar[i] && candles[i - 1].close <= sar[i - 1] && rsiValues[i] > 50) {
      const sl = sar[i];
      const risk = candles[i].close - sl;
      const tp = candles[i].close + risk * 2.5;
      const slPips = (risk / pipMult) + brokerCost;
      if (slPips < 8 || slPips > 50) continue;
      
      trades.push({ pair, direction: 'LONG', entry: candles[i].close, sl, tp, exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0 });
      lastSignalIdx = i;
    }
    
    // SELL: SAR flips above price (was below) + RSI < 50
    if (candles[i].close < sar[i] && candles[i - 1].close >= sar[i - 1] && rsiValues[i] < 50) {
      const sl = sar[i];
      const risk = sl - candles[i].close;
      const tp = candles[i].close - risk * 2.5;
      const slPips = (risk / pipMult) + brokerCost;
      if (slPips < 8 || slPips > 50) continue;
      
      trades.push({ pair, direction: 'SHORT', entry: candles[i].close, sl, tp, exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0 });
      lastSignalIdx = i;
    }
  }
  
  return simulateTrades(trades, candles, pipMult, brokerCost);
}

// ===== STRATEGY #61: PIVOT POINT BREAKOUT =====
// Break above/below daily pivot with momentum
function testPivotBreakout(pair: string, candles: Candle[], brokerCost: number): Trade[] {
  if (candles.length < 300) return [];
  
  const closes = candles.map(c => c.close);
  const ema20 = ema(closes, 20);
  const atrValues = atr(candles, 14);
  const pipMult = getPipMultiplier(pair);
  
  // Calculate pivot points (288 candles = 1 day on M5)
  const trades: Trade[] = [];
  let lastSignalIdx = -40;
  
  for (let i = 300; i < candles.length; i++) {
    if (i - lastSignalIdx < 40) continue;
    if (atrValues[i] === 0) continue;
    
    // Find day's high/low/close (last 288 candles)
    let dayHigh = -Infinity, dayLow = Infinity, dayClose = 0;
    for (let j = i - 288; j < i; j++) {
      dayHigh = Math.max(dayHigh, candles[j].high);
      dayLow = Math.min(dayLow, candles[j].low);
    }
    dayClose = candles[i - 1].close;
    
    const pivot = (dayHigh + dayLow + dayClose) / 3;
    const r1 = 2 * pivot - dayLow;
    const s1 = 2 * pivot - dayHigh;
    
    // BUY: Break above R1 + above EMA20
    if (candles[i].close > r1 && candles[i].close > ema20[i] && candles[i - 1].close <= r1) {
      const sl = pivot;
      const risk = candles[i].close - sl;
      const tp = candles[i].close + risk * 2.5;
      const slPips = (risk / pipMult) + brokerCost;
      if (slPips < 8 || slPips > 60) continue;
      
      trades.push({ pair, direction: 'LONG', entry: candles[i].close, sl, tp, exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0 });
      lastSignalIdx = i;
    }
    
    // SELL: Break below S1 + below EMA20
    if (candles[i].close < s1 && candles[i].close < ema20[i] && candles[i - 1].close >= s1) {
      const sl = pivot;
      const risk = sl - candles[i].close;
      const tp = candles[i].close - risk * 2.5;
      const slPips = (risk / pipMult) + brokerCost;
      if (slPips < 8 || slPips > 60) continue;
      
      trades.push({ pair, direction: 'SHORT', entry: candles[i].close, sl, tp, exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0 });
      lastSignalIdx = i;
    }
  }
  
  return simulateTrades(trades, candles, pipMult, brokerCost);
}

// ===== STRATEGY #62: TRIPLE EMA CROSSOVER =====
// EMA 8/21/55 alignment + momentum
function testTripleEMA(pair: string, candles: Candle[], brokerCost: number): Trade[] {
  if (candles.length < 100) return [];
  
  const closes = candles.map(c => c.close);
  const ema8 = ema(closes, 8);
  const ema21 = ema(closes, 21);
  const ema55 = ema(closes, 55);
  const atrValues = atr(candles, 14);
  const pipMult = getPipMultiplier(pair);
  
  const trades: Trade[] = [];
  let lastSignalIdx = -30;
  
  for (let i = 60; i < candles.length; i++) {
    if (i - lastSignalIdx < 30) continue;
    if (atrValues[i] === 0) continue;
    
    // BUY: EMA8 > EMA21 > EMA55 (perfect alignment) + just crossed
    if (ema8[i] > ema21[i] && ema21[i] > ema55[i] && 
        !(ema8[i - 1] > ema21[i - 1] && ema21[i - 1] > ema55[i - 1])) {
      const sl = candles[i].low - atrValues[i] * 1.0;
      const risk = candles[i].close - sl;
      const tp = candles[i].close + risk * 3.0;
      const slPips = (risk / pipMult) + brokerCost;
      if (slPips < 8 || slPips > 50) continue;
      
      trades.push({ pair, direction: 'LONG', entry: candles[i].close, sl, tp, exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0 });
      lastSignalIdx = i;
    }
    
    // SELL: EMA8 < EMA21 < EMA55
    if (ema8[i] < ema21[i] && ema21[i] < ema55[i] &&
        !(ema8[i - 1] < ema21[i - 1] && ema21[i - 1] < ema55[i - 1])) {
      const sl = candles[i].high + atrValues[i] * 1.0;
      const risk = sl - candles[i].close;
      const tp = candles[i].close - risk * 3.0;
      const slPips = (risk / pipMult) + brokerCost;
      if (slPips < 8 || slPips > 50) continue;
      
      trades.push({ pair, direction: 'SHORT', entry: candles[i].close, sl, tp, exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0 });
      lastSignalIdx = i;
    }
  }
  
  return simulateTrades(trades, candles, pipMult, brokerCost);
}

// ===== STRATEGY #63: RSI DIVERGENCE + BREAKOUT =====
// RSI divergence + price breaks recent high/low
function testRSIDivergence(pair: string, candles: Candle[], brokerCost: number): Trade[] {
  if (candles.length < 100) return [];
  
  const closes = candles.map(c => c.close);
  const rsiValues = rsi(closes, 14);
  const atrValues = atr(candles, 14);
  const pipMult = getPipMultiplier(pair);
  
  const trades: Trade[] = [];
  let lastSignalIdx = -35;
  
  for (let i = 50; i < candles.length; i++) {
    if (i - lastSignalIdx < 35) continue;
    if (atrValues[i] === 0) continue;
    
    // Find recent swing points (last 20 candles)
    let recentHigh = -Infinity, recentLow = Infinity;
    let highIdx = i, lowIdx = i;
    for (let j = Math.max(0, i - 20); j < i; j++) {
      if (candles[j].high > recentHigh) { recentHigh = candles[j].high; highIdx = j; }
      if (candles[j].low < recentLow) { recentLow = candles[j].low; lowIdx = j; }
    }
    
    // BULLISH DIVERGENCE: Price makes lower low, RSI makes higher low
    if (candles[i].low < recentLow && rsiValues[i] > rsiValues[lowIdx]) {
      // Confirmation: bullish candle
      if (candles[i].close > candles[i].open) {
        const sl = candles[i].low - atrValues[i] * 0.8;
        const risk = candles[i].close - sl;
        const tp = candles[i].close + risk * 3.0;
        const slPips = (risk / pipMult) + brokerCost;
        if (slPips < 8 || slPips > 50) continue;
        
        trades.push({ pair, direction: 'LONG', entry: candles[i].close, sl, tp, exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0 });
        lastSignalIdx = i;
      }
    }
    
    // BEARISH DIVERGENCE: Price makes higher high, RSI makes lower high
    if (candles[i].high > recentHigh && rsiValues[i] < rsiValues[highIdx]) {
      if (candles[i].close < candles[i].open) {
        const sl = candles[i].high + atrValues[i] * 0.8;
        const risk = sl - candles[i].close;
        const tp = candles[i].close - risk * 3.0;
        const slPips = (risk / pipMult) + brokerCost;
        if (slPips < 8 || slPips > 50) continue;
        
        trades.push({ pair, direction: 'SHORT', entry: candles[i].close, sl, tp, exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0 });
        lastSignalIdx = i;
      }
    }
  }
  
  return simulateTrades(trades, candles, pipMult, brokerCost);
}

// ===== TRADE SIMULATION =====
function simulateTrades(rawTrades: Trade[], candles: Candle[], pipMult: number, brokerCost: number): Trade[] {
  const results: Trade[] = [];
  for (const trade of rawTrades) {
    const entryIdx = candles.findIndex((c, idx) => idx > 0 && Math.abs(c.close - trade.entry) < pipMult * 2);
    if (entryIdx === -1) continue;
    let exitPrice = trade.entry, exitReason = 'TIME';
    for (let j = entryIdx + 1; j < candles.length && j < entryIdx + 120; j++) {
      const c = candles[j];
      if (trade.direction === 'LONG') {
        if (c.low <= trade.sl) { exitPrice = trade.sl; exitReason = 'SL'; break; }
        if (c.high >= trade.tp) { exitPrice = trade.tp; exitReason = 'TP'; break; }
      } else {
        if (c.high >= trade.sl) { exitPrice = trade.sl; exitReason = 'SL'; break; }
        if (c.low <= trade.tp) { exitPrice = trade.tp; exitReason = 'TP'; break; }
      }
    }
    const grossPips = trade.direction === 'LONG' ? (exitPrice - trade.entry) / pipMult : (trade.entry - exitPrice) / pipMult;
    const netPips = grossPips - brokerCost;
    const riskPips = Math.abs(trade.entry - trade.sl) / pipMult;
    const rMultiple = riskPips > 0 ? netPips / riskPips : 0;
    results.push({ ...trade, exitPrice, exitReason, pipsWon: netPips, rMultiple });
  }
  return results;
}

// ===== MAIN =====
const PAIRS = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'USDCAD', 'AUDUSD', 'NZDUSD', 'EURGBP', 'EURJPY', 'GBPJPY', 'AUDJPY', 'CADJPY', 'CHFJPY', 'NZDJPY', 'EURAUD'];

console.log('===================================================================');
console.log('TESTING 5 MORE STRATEGIES');
console.log('#59: Williams %R Extreme + Trend');
console.log('#60: Parabolic SAR Reversal');
console.log('#61: Pivot Point Breakout');
console.log('#62: Triple EMA Crossover (8/21/55)');
console.log('#63: RSI Divergence + Breakout');
console.log('===================================================================\n');

const strategies = [
  { name: 'Williams %R', fn: testWilliamsR },
  { name: 'Parabolic SAR', fn: testParabolicSAR },
  { name: 'Pivot Breakout', fn: testPivotBreakout },
  { name: 'Triple EMA', fn: testTripleEMA },
  { name: 'RSI Divergence', fn: testRSIDivergence },
];

const allResults: { name: string; avgR: number; verdict: string }[] = [];

for (const strat of strategies) {
  console.log(`\n--- Strategy: ${strat.name} ---\n`);
  const allTrades: Trade[] = [];
  const pairStats: { pair: string; signals: number; closed: number; wr: number; avgR: number; maxDD: number; avgSL: number }[] = [];
  
  for (const pair of PAIRS) {
    const candles = loadCacheFile(pair);
    if (candles.length === 0) continue;
    const cost = getBrokerCost(pair);
    const trades = strat.fn(pair, candles, cost);
    const closed = trades.filter(t => t.exitReason !== 'TIME');
    const wins = closed.filter(t => t.pipsWon > 0);
    const wr = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;
    const avgR = closed.length > 0 ? closed.reduce((s, t) => s + t.rMultiple, 0) / closed.length : 0;
    let equity = 0, peak = 0, maxDD = 0;
    for (const t of closed) { equity += t.rMultiple; peak = Math.max(peak, equity); maxDD = Math.max(maxDD, peak - equity); }
    const pipMult = getPipMultiplier(pair);
    const avgSL = closed.length > 0 ? closed.reduce((s, t) => s + Math.abs(t.entry - t.sl) / pipMult, 0) / closed.length : 0;
    pairStats.push({ pair, signals: trades.length, closed: closed.length, wr, avgR, maxDD, avgSL });
    allTrades.push(...trades);
    console.log(`  ${pair}: ${trades.length} signals`);
  }
  
  const closed = allTrades.filter(t => t.exitReason !== 'TIME');
  const wins = closed.filter(t => t.pipsWon > 0);
  const losses = closed.filter(t => t.pipsWon <= 0);
  const wr = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;
  const avgR = closed.length > 0 ? closed.reduce((s, t) => s + t.rMultiple, 0) / closed.length : 0;
  let equity = 0, peak = 0, maxDD = 0;
  for (const t of closed) { equity += t.rMultiple; peak = Math.max(peak, equity); maxDD = Math.max(maxDD, peak - equity); }
  const grossProfit = wins.reduce((s, t) => s + t.rMultiple, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.rMultiple, 0));
  const pf = grossLoss > 0 ? grossProfit / grossLoss : 0;
  const avgSL = closed.length > 0 ? closed.reduce((s, t) => s + Math.abs(t.entry - t.sl) / getPipMultiplier(t.pair), 0) / closed.length : 0;
  
  console.log(`\n  ${strat.name} (combined)`.padEnd(55) +
    `signals: ${String(closed.length).padStart(4)} closed: ${String(closed.length).padStart(4)} ` +
    `WR: ${wr.toFixed(1).padStart(4)}%  avgR: ${avgR.toFixed(3).padStart(7)}  ` +
    `PF: ${pf.toFixed(2).padStart(4)}  maxDD(R): ${maxDD.toFixed(2).padStart(7)}  avgSL: ${avgSL.toFixed(1)}p`);
  
  for (const ps of pairStats) {
    console.log(`    ${ps.pair}`.padEnd(55) +
      `signals: ${String(ps.signals).padStart(4)} closed: ${String(ps.closed).padStart(4)} ` +
      `WR: ${ps.wr.toFixed(1).padStart(4)}%  avgR: ${ps.avgR.toFixed(3).padStart(7)}  ` +
      `maxDD(R): ${ps.maxDD.toFixed(2).padStart(7)}  avgSL: ${ps.avgSL.toFixed(1)}p`);
  }
  
  const verdict = avgR > 0.05 ? '✅' : avgR > 0 ? '⚠️' : '❌';
  allResults.push({ name: strat.name, avgR, verdict });
}

console.log('\n===================================================================');
console.log('SUMMARY');
console.log('===================================================================\n');
console.log('#  | Strategy                    | avgR    | Verdict');
console.log('---+-----------------------------+---------+--------');
strategies.forEach((s, i) => {
  const r = allResults[i];
  console.log(`${(i + 59).toString().padEnd(3)}| ${s.name.padEnd(27)} | ${r.avgR.toFixed(3).padStart(7)} | ${r.verdict}`);
});
console.log('\n===================================================================');
console.log('TOTAL STRATEGIES TESTED: 63');
console.log('===================================================================');
