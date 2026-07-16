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

// ===== STRATEGY #74: ZIGZAG REVERSAL =====
// Detect significant reversals using zigzag-like logic
function testZigzagReversal(pair: string, candles: Candle[], brokerCost: number): Trade[] {
  if (candles.length < 100) return [];
  
  const closes = candles.map(c => c.close);
  const ema30 = ema(closes, 30);
  const atrValues = atr(candles, 14);
  const pipMult = getPipMultiplier(pair);
  
  // Find swing points (simplified zigzag)
  const swingThreshold = 0.0015; // 15 pips for majors
  const swings: { idx: number; price: number; type: 'high' | 'low' }[] = [];
  
  let lastSwingHigh = candles[0].high;
  let lastSwingLow = candles[0].low;
  let lastHighIdx = 0;
  let lastLowIdx = 0;
  
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].high > lastSwingHigh) {
      lastSwingHigh = candles[i].high;
      lastHighIdx = i;
    }
    if (candles[i].low < lastSwingLow) {
      lastSwingLow = candles[i].low;
      lastLowIdx = i;
    }
    
    // Check for swing low (reversal up)
    if (i - lastLowIdx > 5 && (candles[i].high - lastSwingLow) / lastSwingLow > swingThreshold) {
      swings.push({ idx: lastLowIdx, price: lastSwingLow, type: 'low' });
      lastSwingHigh = candles[i].high;
      lastHighIdx = i;
    }
    
    // Check for swing high (reversal down)
    if (i - lastHighIdx > 5 && (lastSwingHigh - candles[i].low) / lastSwingHigh > swingThreshold) {
      swings.push({ idx: lastHighIdx, price: lastSwingHigh, type: 'high' });
      lastSwingLow = candles[i].low;
      lastLowIdx = i;
    }
  }
  
  const trades: Trade[] = [];
  let lastSignalIdx = -30;
  
  for (let i = 50; i < candles.length; i++) {
    if (i - lastSignalIdx < 30) continue;
    if (atrValues[i] === 0) continue;
    
    // Find most recent swing
    const recentSwings = swings.filter(s => s.idx < i && s.idx > i - 30);
    if (recentSwings.length < 2) continue;
    
    const lastSwing = recentSwings[recentSwings.length - 1];
    const prevSwing = recentSwings[recentSwings.length - 2];
    
    // BUY: After swing low, price breaks above previous swing high
    if (lastSwing.type === 'low' && prevSwing.type === 'high' && 
        closes[i] > prevSwing.price && closes[i] > ema30[i]) {
      const sl = lastSwing.price - atrValues[i] * 0.8;
      const risk = candles[i].close - sl;
      const tp = candles[i].close + risk * 2.5;
      const slPips = (risk / pipMult) + brokerCost;
      if (slPips < 8 || slPips > 50) continue;
      
      trades.push({ pair, direction: 'LONG', entry: candles[i].close, sl, tp, exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0 });
      lastSignalIdx = i;
    }
    
    // SELL: After swing high, price breaks below previous swing low
    if (lastSwing.type === 'high' && prevSwing.type === 'low' &&
        closes[i] < prevSwing.price && closes[i] < ema30[i]) {
      const sl = lastSwing.price + atrValues[i] * 0.8;
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

// ===== STRATEGY #75: VOLUME WEIGHTED AVERAGE PRICE (VWAP) =====
// Trade mean reversion to VWAP with momentum confirmation
function testVWAP(pair: string, candles: Candle[], brokerCost: number): Trade[] {
  if (candles.length < 100) return [];
  
  const closes = candles.map(c => c.close);
  const rsiValues = rsi(closes, 14);
  const atrValues = atr(candles, 14);
  const pipMult = getPipMultiplier(pair);
  
  // Calculate VWAP (rolling 50-period)
  const vwap: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i < 10) { vwap.push(closes[i]); continue; }
    let cumVol = 0, cumTP = 0;
    for (let j = Math.max(0, i - 49); j <= i; j++) {
      const tp = (candles[j].high + candles[j].low + candles[j].close) / 3;
      cumTP += tp * (candles[j].volume || 1);
      cumVol += (candles[j].volume || 1);
    }
    vwap.push(cumVol > 0 ? cumTP / cumVol : closes[i]);
  }
  
  const trades: Trade[] = [];
  let lastSignalIdx = -25;
  
  for (let i = 50; i < candles.length; i++) {
    if (i - lastSignalIdx < 25) continue;
    if (atrValues[i] === 0) continue;
    
    const distanceFromVWAP = (closes[i] - vwap[i]) / vwap[i] * 100;
    
    // BUY: Price significantly below VWAP + RSI oversold + starting to recover
    if (distanceFromVWAP < -0.15 && rsiValues[i] < 35 && rsiValues[i] > rsiValues[i - 1]) {
      const sl = candles[i].low - atrValues[i] * 1.0;
      const risk = candles[i].close - sl;
      const tp = vwap[i]; // Target VWAP
      const slPips = (risk / pipMult) + brokerCost;
      if (slPips < 8 || slPips > 50) continue;
      
      trades.push({ pair, direction: 'LONG', entry: candles[i].close, sl, tp, exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0 });
      lastSignalIdx = i;
    }
    
    // SELL: Price significantly above VWAP + RSI overbought + starting to fall
    if (distanceFromVWAP > 0.15 && rsiValues[i] > 65 && rsiValues[i] < rsiValues[i - 1]) {
      const sl = candles[i].high + atrValues[i] * 1.0;
      const risk = sl - candles[i].close;
      const tp = vwap[i];
      const slPips = (risk / pipMult) + brokerCost;
      if (slPips < 8 || slPips > 50) continue;
      
      trades.push({ pair, direction: 'SHORT', entry: candles[i].close, sl, tp, exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0 });
      lastSignalIdx = i;
    }
  }
  
  return simulateTrades(trades, candles, pipMult, brokerCost);
}

// ===== STRATEGY #76: DONCHIAN CHANNEL BREAKOUT =====
// Classic turtle trading: break above/below N-period high/low
function testDonchianBreakout(pair: string, candles: Candle[], brokerCost: number): Trade[] {
  if (candles.length < 100) return [];
  
  const closes = candles.map(c => c.close);
  const ema50 = ema(closes, 50);
  const atrValues = atr(candles, 14);
  const pipMult = getPipMultiplier(pair);
  
  const trades: Trade[] = [];
  let lastSignalIdx = -40;
  
  for (let i = 50; i < candles.length; i++) {
    if (i - lastSignalIdx < 40) continue;
    if (atrValues[i] === 0) continue;
    
    // 20-period Donchian channel
    let high20 = -Infinity, low20 = Infinity;
    for (let j = i - 20; j < i; j++) {
      high20 = Math.max(high20, candles[j].high);
      low20 = Math.min(low20, candles[j].low);
    }
    
    // BUY: Break above 20-period high + above EMA50
    if (closes[i] > high20 && closes[i] > ema50[i]) {
      const sl = low20;
      const risk = candles[i].close - sl;
      const tp = candles[i].close + risk * 2.0;
      const slPips = (risk / pipMult) + brokerCost;
      if (slPips < 8 || slPips > 60) continue;
      
      trades.push({ pair, direction: 'LONG', entry: candles[i].close, sl, tp, exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0 });
      lastSignalIdx = i;
    }
    
    // SELL: Break below 20-period low + below EMA50
    if (closes[i] < low20 && closes[i] < ema50[i]) {
      const sl = high20;
      const risk = sl - candles[i].close;
      const tp = candles[i].close - risk * 2.0;
      const slPips = (risk / pipMult) + brokerCost;
      if (slPips < 8 || slPips > 60) continue;
      
      trades.push({ pair, direction: 'SHORT', entry: candles[i].close, sl, tp, exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0 });
      lastSignalIdx = i;
    }
  }
  
  return simulateTrades(trades, candles, pipMult, brokerCost);
}

// ===== STRATEGY #77: KELTNER CHANNEL SQUEEZE =====
// BB inside Keltner = squeeze, trade breakout
function testKeltnerSqueeze(pair: string, candles: Candle[], brokerCost: number): Trade[] {
  if (candles.length < 100) return [];
  
  const closes = candles.map(c => c.close);
  const ema20 = ema(closes, 20);
  const atrValues = atr(candles, 14);
  const pipMult = getPipMultiplier(pair);
  
  // Calculate BB and Keltner
  const bbUpper: number[] = [], bbLower: number[] = [];
  const keltnerUpper: number[] = [], keltnerLower: number[] = [];
  
  for (let i = 0; i < closes.length; i++) {
    if (i < 20) {
      bbUpper.push(closes[i]); bbLower.push(closes[i]);
      keltnerUpper.push(closes[i]); keltnerLower.push(closes[i]);
      continue;
    }
    
    // BB
    let sumSq = 0;
    for (let j = i - 19; j <= i; j++) sumSq += (closes[j] - ema20[i]) ** 2;
    const std = Math.sqrt(sumSq / 20);
    bbUpper.push(ema20[i] + std * 2);
    bbLower.push(ema20[i] - std * 2);
    
    // Keltner (EMA ± 1.5*ATR)
    keltnerUpper.push(ema20[i] + atrValues[i] * 1.5);
    keltnerLower.push(ema20[i] - atrValues[i] * 1.5);
  }
  
  const trades: Trade[] = [];
  let lastSignalIdx = -30;
  
  for (let i = 50; i < candles.length; i++) {
    if (i - lastSignalIdx < 30) continue;
    if (atrValues[i] === 0) continue;
    
    // Squeeze: BB inside Keltner
    const isSqueezed = bbUpper[i] < keltnerUpper[i] && bbLower[i] > keltnerLower[i];
    const wasSqueezed = bbUpper[i - 3] < keltnerUpper[i - 3] && bbLower[i - 3] > keltnerLower[i - 3];
    
    // Breakout from squeeze
    if (wasSqueezed && !isSqueezed) {
      if (closes[i] > bbUpper[i] && closes[i] > ema20[i]) {
        const sl = keltnerLower[i];
        const risk = candles[i].close - sl;
        const tp = candles[i].close + risk * 2.5;
        const slPips = (risk / pipMult) + brokerCost;
        if (slPips < 8 || slPips > 50) continue;
        
        trades.push({ pair, direction: 'LONG', entry: candles[i].close, sl, tp, exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0 });
        lastSignalIdx = i;
      } else if (closes[i] < bbLower[i] && closes[i] < ema20[i]) {
        const sl = keltnerUpper[i];
        const risk = sl - candles[i].close;
        const tp = candles[i].close - risk * 2.5;
        const slPips = (risk / pipMult) + brokerCost;
        if (slPips < 8 || slPips > 50) continue;
        
        trades.push({ pair, direction: 'SHORT', entry: candles[i].close, sl, tp, exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0 });
        lastSignalIdx = i;
      }
    }
  }
  
  return simulateTrades(trades, candles, pipMult, brokerCost);
}

// ===== STRATEGY #78: RELATIVE VIGOR INDEX (RVI) =====
// RVI measures conviction behind recent price action
function testRVI(pair: string, candles: Candle[], brokerCost: number): Trade[] {
  if (candles.length < 100) return [];
  
  const closes = candles.map(c => c.close);
  const ema30 = ema(closes, 30);
  const atrValues = atr(candles, 14);
  const pipMult = getPipMultiplier(pair);
  
  // Calculate RVI (simplified)
  const rvi: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i < 10) { rvi.push(0); continue; }
    let numSum = 0, denSum = 0;
    for (let j = i - 9; j <= i; j++) {
      numSum += (closes[j] - candles[j].open);
      denSum += (candles[j].high - candles[j].low);
    }
    rvi.push(denSum === 0 ? 0 : numSum / denSum);
  }
  
  // Signal line (4-period SMA of RVI)
  const rviSignal = sma(rvi, 4);
  
  const trades: Trade[] = [];
  let lastSignalIdx = -25;
  
  for (let i = 50; i < candles.length; i++) {
    if (i - lastSignalIdx < 25) continue;
    if (atrValues[i] === 0) continue;
    
    // BUY: RVI crosses above signal + RVI > 0 + price above EMA30
    if (rvi[i] > rviSignal[i] && rvi[i - 1] <= rviSignal[i - 1] && rvi[i] > 0 && closes[i] > ema30[i]) {
      const sl = candles[i].low - atrValues[i] * 1.0;
      const risk = candles[i].close - sl;
      const tp = candles[i].close + risk * 2.5;
      const slPips = (risk / pipMult) + brokerCost;
      if (slPips < 8 || slPips > 50) continue;
      
      trades.push({ pair, direction: 'LONG', entry: candles[i].close, sl, tp, exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0 });
      lastSignalIdx = i;
    }
    
    // SELL: RVI crosses below signal + RVI < 0 + price below EMA30
    if (rvi[i] < rviSignal[i] && rvi[i - 1] >= rviSignal[i - 1] && rvi[i] < 0 && closes[i] < ema30[i]) {
      const sl = candles[i].high + atrValues[i] * 1.0;
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
console.log('#74: Zigzag Reversal');
console.log('#75: VWAP Mean Reversion');
console.log('#76: Donchian Channel Breakout');
console.log('#77: Keltner Channel Squeeze');
console.log('#78: Relative Vigor Index (RVI)');
console.log('===================================================================\n');

const strategies = [
  { name: 'Zigzag Reversal', fn: testZigzagReversal },
  { name: 'VWAP Reversion', fn: testVWAP },
  { name: 'Donchian Breakout', fn: testDonchianBreakout },
  { name: 'Keltner Squeeze', fn: testKeltnerSqueeze },
  { name: 'RVI', fn: testRVI },
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
  console.log(`${(i + 74).toString().padEnd(3)}| ${s.name.padEnd(27)} | ${r.avgR.toFixed(3).padStart(7)} | ${r.verdict}`);
});
console.log('\n===================================================================');
console.log('TOTAL STRATEGIES TESTED: 78');
console.log('===================================================================');
