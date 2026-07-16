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

// ===== STRATEGY #64: MOMENTUM ACCELERATION =====
// Trade when momentum is accelerating (rate of change increasing)
function testMomentumAccel(pair: string, candles: Candle[], brokerCost: number): Trade[] {
  if (candles.length < 100) return [];
  
  const closes = candles.map(c => c.close);
  const ema20 = ema(closes, 20);
  const atrValues = atr(candles, 14);
  const pipMult = getPipMultiplier(pair);
  
  // Calculate momentum (ROC) and its acceleration
  const roc: number[] = [];
  const accel: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < 10) { roc.push(0); accel.push(0); continue; }
    roc.push((closes[i] - closes[i - 10]) / closes[i - 10] * 100);
    accel.push(i > 0 ? roc[i] - roc[i - 1] : 0);
  }
  
  const trades: Trade[] = [];
  let lastSignalIdx = -25;
  
  for (let i = 50; i < candles.length; i++) {
    if (i - lastSignalIdx < 25) continue;
    if (atrValues[i] === 0) continue;
    
    // BUY: Momentum accelerating upward + price above EMA20
    if (accel[i] > 0 && accel[i - 1] <= 0 && closes[i] > ema20[i] && roc[i] > 0) {
      const sl = candles[i].low - atrValues[i] * 1.0;
      const risk = candles[i].close - sl;
      const tp = candles[i].close + risk * 2.5;
      const slPips = (risk / pipMult) + brokerCost;
      if (slPips < 8 || slPips > 50) continue;
      
      trades.push({ pair, direction: 'LONG', entry: candles[i].close, sl, tp, exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0 });
      lastSignalIdx = i;
    }
    
    // SELL: Momentum accelerating downward
    if (accel[i] < 0 && accel[i - 1] >= 0 && closes[i] < ema20[i] && roc[i] < 0) {
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

// ===== STRATEGY #65: VOLATILITY REGIME BREAKOUT =====
// Detect volatility regime change, trade breakout from low vol to high vol
function testVolRegime(pair: string, candles: Candle[], brokerCost: number): Trade[] {
  if (candles.length < 100) return [];
  
  const closes = candles.map(c => c.close);
  const ema50 = ema(closes, 50);
  const atrValues = atr(candles, 14);
  const pipMult = getPipMultiplier(pair);
  
  // Calculate ATR percentile (is vol high or low relative to recent history)
  const atrPercentile: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i < 50) { atrPercentile.push(50); continue; }
    const recent = atrValues.slice(i - 50, i).sort((a, b) => a - b);
    const rank = recent.filter(v => v <= atrValues[i]).length;
    atrPercentile.push((rank / 50) * 100);
  }
  
  const trades: Trade[] = [];
  let lastSignalIdx = -30;
  
  for (let i = 60; i < candles.length; i++) {
    if (i - lastSignalIdx < 30) continue;
    if (atrValues[i] === 0) continue;
    
    // Volatility expansion: was low (<30th percentile) now high (>70th percentile)
    const wasLow = atrPercentile[i - 5] < 30;
    const isHigh = atrPercentile[i] > 70;
    
    if (wasLow && isHigh) {
      // Direction: breakout direction
      const recentHigh = Math.max(...candles.slice(i - 10, i).map(c => c.high));
      const recentLow = Math.min(...candles.slice(i - 10, i).map(c => c.low));
      
      if (candles[i].close > recentHigh && candles[i].close > ema50[i]) {
        const sl = candles[i].low - atrValues[i] * 1.0;
        const risk = candles[i].close - sl;
        const tp = candles[i].close + risk * 3.0;
        const slPips = (risk / pipMult) + brokerCost;
        if (slPips < 8 || slPips > 50) continue;
        
        trades.push({ pair, direction: 'LONG', entry: candles[i].close, sl, tp, exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0 });
        lastSignalIdx = i;
      } else if (candles[i].close < recentLow && candles[i].close < ema50[i]) {
        const sl = candles[i].high + atrValues[i] * 1.0;
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

// ===== STRATEGY #66: INSIDE BAR BREAKOUT =====
// Inside bar (consolidation) followed by breakout
function testInsideBar(pair: string, candles: Candle[], brokerCost: number): Trade[] {
  if (candles.length < 100) return [];
  
  const closes = candles.map(c => c.close);
  const ema20 = ema(closes, 20);
  const atrValues = atr(candles, 14);
  const pipMult = getPipMultiplier(pair);
  
  const trades: Trade[] = [];
  let lastSignalIdx = -20;
  
  for (let i = 50; i < candles.length; i++) {
    if (i - lastSignalIdx < 20) continue;
    if (atrValues[i] === 0) continue;
    
    // Inside bar: current bar completely within previous bar's range
    const isInsideBar = candles[i].high < candles[i - 1].high && candles[i].low > candles[i - 1].low;
    
    if (isInsideBar) {
      // Wait for breakout
      if (i + 1 < candles.length) {
        const nextBar = candles[i + 1];
        
        // Breakout above
        if (nextBar.close > candles[i].high && nextBar.close > ema20[i]) {
          const sl = candles[i].low - atrValues[i] * 0.5;
          const risk = nextBar.close - sl;
          const tp = nextBar.close + risk * 2.5;
          const slPips = (risk / pipMult) + brokerCost;
          if (slPips < 8 || slPips > 50) continue;
          
          trades.push({ pair, direction: 'LONG', entry: nextBar.close, sl, tp, exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0 });
          lastSignalIdx = i + 1;
        }
        // Breakout below
        else if (nextBar.close < candles[i].low && nextBar.close < ema20[i]) {
          const sl = candles[i].high + atrValues[i] * 0.5;
          const risk = sl - nextBar.close;
          const tp = nextBar.close - risk * 2.5;
          const slPips = (risk / pipMult) + brokerCost;
          if (slPips < 8 || slPips > 50) continue;
          
          trades.push({ pair, direction: 'SHORT', entry: nextBar.close, sl, tp, exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0 });
          lastSignalIdx = i + 1;
        }
      }
    }
  }
  
  return simulateTrades(trades, candles, pipMult, brokerCost);
}

// ===== STRATEGY #67: CONSECUTIVE CANDLE PATTERN =====
// 3+ consecutive bullish/bearish candles = continuation
function testConsecutiveCandles(pair: string, candles: Candle[], brokerCost: number): Trade[] {
  if (candles.length < 100) return [];
  
  const closes = candles.map(c => c.close);
  const ema30 = ema(closes, 30);
  const atrValues = atr(candles, 14);
  const pipMult = getPipMultiplier(pair);
  
  const trades: Trade[] = [];
  let lastSignalIdx = -20;
  
  for (let i = 50; i < candles.length; i++) {
    if (i - lastSignalIdx < 20) continue;
    if (atrValues[i] === 0) continue;
    
    // Count consecutive bullish candles
    let bullCount = 0;
    for (let j = i; j >= Math.max(0, i - 10); j--) {
      if (candles[j].close > candles[j].open) bullCount++;
      else break;
    }
    
    // Count consecutive bearish candles
    let bearCount = 0;
    for (let j = i; j >= Math.max(0, i - 10); j--) {
      if (candles[j].close < candles[j].open) bearCount++;
      else break;
    }
    
    // BUY: 3+ consecutive bullish + above EMA30
    if (bullCount >= 3 && closes[i] > ema30[i]) {
      const sl = candles[i].low - atrValues[i] * 0.8;
      const risk = candles[i].close - sl;
      const tp = candles[i].close + risk * 2.0;
      const slPips = (risk / pipMult) + brokerCost;
      if (slPips < 8 || slPips > 50) continue;
      
      trades.push({ pair, direction: 'LONG', entry: candles[i].close, sl, tp, exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0 });
      lastSignalIdx = i;
    }
    
    // SELL: 3+ consecutive bearish + below EMA30
    if (bearCount >= 3 && closes[i] < ema30[i]) {
      const sl = candles[i].high + atrValues[i] * 0.8;
      const risk = sl - candles[i].close;
      const tp = candles[i].close - risk * 2.0;
      const slPips = (risk / pipMult) + brokerCost;
      if (slPips < 8 || slPips > 50) continue;
      
      trades.push({ pair, direction: 'SHORT', entry: candles[i].close, sl, tp, exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0 });
      lastSignalIdx = i;
    }
  }
  
  return simulateTrades(trades, candles, pipMult, brokerCost);
}

// ===== STRATEGY #68: GAP FILL =====
// Trade to fill gaps (if price opens significantly different from previous close)
function testGapFill(pair: string, candles: Candle[], brokerCost: number): Trade[] {
  if (candles.length < 100) return [];
  
  const closes = candles.map(c => c.close);
  const ema20 = ema(closes, 20);
  const atrValues = atr(candles, 14);
  const pipMult = getPipMultiplier(pair);
  
  const trades: Trade[] = [];
  let lastSignalIdx = -25;
  
  for (let i = 50; i < candles.length; i++) {
    if (i - lastSignalIdx < 25) continue;
    if (atrValues[i] === 0) continue;
    
    // Detect gap (current open significantly different from previous close)
    const gap = candles[i].open - candles[i - 1].close;
    const gapPips = Math.abs(gap) / pipMult;
    
    // Gap up > 5 pips: expect fill (price drops back)
    if (gapPips > 5 && gap > 0) {
      const sl = candles[i].high + atrValues[i] * 0.5;
      const risk = sl - candles[i].close;
      const tp = candles[i].close - risk * 2.0;
      const slPips = (risk / pipMult) + brokerCost;
      if (slPips < 8 || slPips > 50) continue;
      
      trades.push({ pair, direction: 'SHORT', entry: candles[i].close, sl, tp, exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0 });
      lastSignalIdx = i;
    }
    // Gap down > 5 pips: expect fill (price rises back)
    else if (gapPips > 5 && gap < 0) {
      const sl = candles[i].low - atrValues[i] * 0.5;
      const risk = candles[i].close - sl;
      const tp = candles[i].close + risk * 2.0;
      const slPips = (risk / pipMult) + brokerCost;
      if (slPips < 8 || slPips > 50) continue;
      
      trades.push({ pair, direction: 'LONG', entry: candles[i].close, sl, tp, exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0 });
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
console.log('TESTING 5 MORE UNCONVENTIONAL STRATEGIES');
console.log('#64: Momentum Acceleration');
console.log('#65: Volatility Regime Breakout');
console.log('#66: Inside Bar Breakout');
console.log('#67: Consecutive Candle Pattern');
console.log('#68: Gap Fill');
console.log('===================================================================\n');

const strategies = [
  { name: 'Momentum Accel', fn: testMomentumAccel },
  { name: 'Vol Regime', fn: testVolRegime },
  { name: 'Inside Bar', fn: testInsideBar },
  { name: 'Consecutive', fn: testConsecutiveCandles },
  { name: 'Gap Fill', fn: testGapFill },
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
  console.log(`${(i + 64).toString().padEnd(3)}| ${s.name.padEnd(27)} | ${r.avgR.toFixed(3).padStart(7)} | ${r.verdict}`);
});
console.log('\n===================================================================');
console.log('TOTAL STRATEGIES TESTED: 68');
console.log('===================================================================');
