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

function macd(closes: number[]): { macd: number[], signal: number[], histogram: number[] } {
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macdLine = closes.map((_, i) => ema12[i] - ema26[i]);
  const signal = ema(macdLine, 9);
  const histogram = macdLine.map((m, i) => m - signal[i]);
  return { macd: macdLine, signal, histogram };
}

function stochastic(candles: Candle[], kPeriod: number = 14, dPeriod: number = 3): { k: number[], d: number[] } {
  const k: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i < kPeriod - 1) { k.push(50); continue; }
    let hh = -Infinity, ll = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) { hh = Math.max(hh, candles[j].high); ll = Math.min(ll, candles[j].low); }
    k.push(hh === ll ? 50 : ((candles[i].close - ll) / (hh - ll)) * 100);
  }
  const d = sma(k, dPeriod);
  return { k, d };
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

// ===== STRATEGY #54: SUPERTREND =====
// Supertrend indicator: ATR-based trailing stop that flips direction
function testSuperTrend(pair: string, candles: Candle[], brokerCost: number): Trade[] {
  if (candles.length < 100) return [];
  
  const atrValues = atr(candles, 10);
  const pipMult = getPipMultiplier(pair);
  const multiplier = 3.0;
  
  let supertrend: number[] = [];
  let direction: number[] = []; // 1 = up (bullish), -1 = down (bearish)
  
  for (let i = 0; i < candles.length; i++) {
    if (i < 10) { supertrend.push(candles[i].close); direction.push(1); continue; }
    
    const upperBand = (candles[i].high + candles[i].low) / 2 + multiplier * atrValues[i];
    const lowerBand = (candles[i].high + candles[i].low) / 2 - multiplier * atrValues[i];
    
    let st: number;
    let dir: number;
    
    if (direction[i - 1] === 1) { // was bullish
      st = candles[i].close > supertrend[i - 1] ? Math.max(lowerBand, supertrend[i - 1]) : lowerBand;
      dir = candles[i].close > st ? 1 : -1;
    } else { // was bearish
      st = candles[i].close < supertrend[i - 1] ? Math.min(upperBand, supertrend[i - 1]) : upperBand;
      dir = candles[i].close < st ? -1 : 1;
    }
    
    supertrend.push(st);
    direction.push(dir);
  }
  
  const trades: Trade[] = [];
  let lastSignalIdx = -30;
  let lastDir = 0;
  
  for (let i = 50; i < candles.length; i++) {
    if (i - lastSignalIdx < 30) continue;
    if (atrValues[i] === 0) continue;
    
    // Direction flip = signal
    if (direction[i] === 1 && direction[i - 1] === -1 && lastDir !== 1) {
      const sl = supertrend[i];
      const risk = candles[i].close - sl;
      const tp = candles[i].close + risk * 2.5;
      const slPips = (risk / pipMult) + brokerCost;
      if (slPips < 8 || slPips > 50) continue;
      
      trades.push({ pair, direction: 'LONG', entry: candles[i].close, sl, tp, exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0 });
      lastSignalIdx = i;
      lastDir = 1;
    }
    
    if (direction[i] === -1 && direction[i - 1] === 1 && lastDir !== -1) {
      const sl = supertrend[i];
      const risk = sl - candles[i].close;
      const tp = candles[i].close - risk * 2.5;
      const slPips = (risk / pipMult) + brokerCost;
      if (slPips < 8 || slPips > 50) continue;
      
      trades.push({ pair, direction: 'SHORT', entry: candles[i].close, sl, tp, exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0 });
      lastSignalIdx = i;
      lastDir = -1;
    }
  }
  
  return simulateTrades(trades, candles, pipMult, brokerCost);
}

// ===== STRATEGY #55: ICHIMOKU CLOUD =====
// Tenkan/Kijun cross + price above/below cloud
function testIchimoku(pair: string, candles: Candle[], brokerCost: number): Trade[] {
  if (candles.length < 200) return [];
  
  const pipMult = getPipMultiplier(pair);
  const atrValues = atr(candles, 14);
  
  // Calculate Ichimoku lines
  const tenkan: number[] = [], kijun: number[] = [], senkouA: number[] = [], senkouB: number[] = [];
  
  for (let i = 0; i < candles.length; i++) {
    // Tenkan-sen (9)
    if (i < 8) { tenkan.push(candles[i].close); }
    else {
      let hh = -Infinity, ll = Infinity;
      for (let j = i - 8; j <= i; j++) { hh = Math.max(hh, candles[j].high); ll = Math.min(ll, candles[j].low); }
      tenkan.push((hh + ll) / 2);
    }
    
    // Kijun-sen (26)
    if (i < 25) { kijun.push(candles[i].close); }
    else {
      let hh = -Infinity, ll = Infinity;
      for (let j = i - 25; j <= i; j++) { hh = Math.max(hh, candles[j].high); ll = Math.min(ll, candles[j].low); }
      kijun.push((hh + ll) / 2);
    }
    
    // Senkou A (Tenkan + Kijun) / 2, shifted forward 26
    senkouA.push((tenkan[i] + kijun[i]) / 2);
    
    // Senkou B (52-period high+low)/2, shifted forward 26
    if (i < 51) { senkouB.push(candles[i].close); }
    else {
      let hh = -Infinity, ll = Infinity;
      for (let j = i - 51; j <= i; j++) { hh = Math.max(hh, candles[j].high); ll = Math.min(ll, candles[j].low); }
      senkouB.push((hh + ll) / 2);
    }
  }
  
  const trades: Trade[] = [];
  let lastSignalIdx = -40;
  
  for (let i = 100; i < candles.length - 26; i++) {
    if (i - lastSignalIdx < 40) continue;
    if (atrValues[i] === 0) continue;
    
    const cloudTop = Math.max(senkouA[i - 26], senkouB[i - 26]);
    const cloudBottom = Math.min(senkouA[i - 26], senkouB[i - 26]);
    
    // BUY: Tenkan crosses above Kijun + price above cloud
    if (tenkan[i] > kijun[i] && tenkan[i - 1] <= kijun[i - 1] && candles[i].close > cloudTop) {
      const sl = cloudBottom - atrValues[i] * 0.5;
      const risk = candles[i].close - sl;
      const tp = candles[i].close + risk * 3.0;
      const slPips = (risk / pipMult) + brokerCost;
      if (slPips < 8 || slPips > 60) continue;
      
      trades.push({ pair, direction: 'LONG', entry: candles[i].close, sl, tp, exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0 });
      lastSignalIdx = i;
    }
    
    // SELL: Tenkan crosses below Kijun + price below cloud
    if (tenkan[i] < kijun[i] && tenkan[i - 1] >= kijun[i - 1] && candles[i].close < cloudBottom) {
      const sl = cloudTop + atrValues[i] * 0.5;
      const risk = sl - candles[i].close;
      const tp = candles[i].close - risk * 3.0;
      const slPips = (risk / pipMult) + brokerCost;
      if (slPips < 8 || slPips > 60) continue;
      
      trades.push({ pair, direction: 'SHORT', entry: candles[i].close, sl, tp, exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0 });
      lastSignalIdx = i;
    }
  }
  
  return simulateTrades(trades, candles, pipMult, brokerCost);
}

// ===== STRATEGY #56: MACD + STOCHASTIC COMBO =====
// MACD histogram flip + Stochastic oversold/overbought
function testMACD_Stoch(pair: string, candles: Candle[], brokerCost: number): Trade[] {
  if (candles.length < 100) return [];
  
  const closes = candles.map(c => c.close);
  const { histogram } = macd(closes);
  const { k, d } = stochastic(candles, 14, 3);
  const atrValues = atr(candles, 14);
  const pipMult = getPipMultiplier(pair);
  
  const trades: Trade[] = [];
  let lastSignalIdx = -30;
  
  for (let i = 50; i < candles.length; i++) {
    if (i - lastSignalIdx < 30) continue;
    if (atrValues[i] === 0) continue;
    
    // BUY: MACD histogram turns positive + Stoch K < 30 then crosses up
    if (histogram[i] > 0 && histogram[i - 1] <= 0 && k[i] > d[i] && k[i - 1] <= d[i - 1] && k[i] < 50) {
      const sl = candles[i].low - atrValues[i] * 1.0;
      const risk = candles[i].close - sl;
      const tp = candles[i].close + risk * 3.0;
      const slPips = (risk / pipMult) + brokerCost;
      if (slPips < 8 || slPips > 50) continue;
      
      trades.push({ pair, direction: 'LONG', entry: candles[i].close, sl, tp, exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0 });
      lastSignalIdx = i;
    }
    
    // SELL: MACD histogram turns negative + Stoch K > 70 then crosses down
    if (histogram[i] < 0 && histogram[i - 1] >= 0 && k[i] < d[i] && k[i - 1] >= d[i - 1] && k[i] > 50) {
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

// ===== STRATEGY #57: HEIKEN ASHI TREND =====
// Convert to Heiken Ashi candles, trade consecutive color changes
function testHeikenAshi(pair: string, candles: Candle[], brokerCost: number): Trade[] {
  if (candles.length < 100) return [];
  
  const pipMult = getPipMultiplier(pair);
  const atrValues = atr(candles, 14);
  
  // Calculate Heiken Ashi candles
  const haClose: number[] = [], haOpen: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    haClose.push((candles[i].open + candles[i].high + candles[i].low + candles[i].close) / 4);
    if (i === 0) haOpen.push((candles[i].open + candles[i].close) / 2);
    else haOpen.push((haOpen[i - 1] + haClose[i - 1]) / 2);
  }
  
  const trades: Trade[] = [];
  let lastSignalIdx = -25;
  
  for (let i = 50; i < candles.length; i++) {
    if (i - lastSignalIdx < 25) continue;
    if (atrValues[i] === 0) continue;
    
    // Count consecutive bullish/bearish HA candles
    let bullCount = 0, bearCount = 0;
    for (let j = i; j >= Math.max(0, i - 10); j--) {
      if (haClose[j] > haOpen[j]) bullCount++;
      else break;
    }
    for (let j = i; j >= Math.max(0, i - 10); j--) {
      if (haClose[j] < haOpen[j]) bearCount++;
      else break;
    }
    
    // BUY: 3 consecutive bullish HA candles after bearish
    if (bullCount === 3 && haClose[i - 3] < haOpen[i - 3]) {
      const sl = candles[i].low - atrValues[i] * 0.8;
      const risk = candles[i].close - sl;
      const tp = candles[i].close + risk * 2.5;
      const slPips = (risk / pipMult) + brokerCost;
      if (slPips < 8 || slPips > 50) continue;
      
      trades.push({ pair, direction: 'LONG', entry: candles[i].close, sl, tp, exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0 });
      lastSignalIdx = i;
    }
    
    // SELL: 3 consecutive bearish HA candles after bullish
    if (bearCount === 3 && haClose[i - 3] > haOpen[i - 3]) {
      const sl = candles[i].high + atrValues[i] * 0.8;
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

// ===== STRATEGY #58: CCI EXTREME + TREND =====
// CCI (Commodity Channel Index) extreme + EMA trend filter
function testCCI(pair: string, candles: Candle[], brokerCost: number): Trade[] {
  if (candles.length < 100) return [];
  
  const closes = candles.map(c => c.close);
  const ema50 = ema(closes, 50);
  const atrValues = atr(candles, 14);
  const pipMult = getPipMultiplier(pair);
  
  // Calculate CCI(20)
  const cci: number[] = [];
  const tp: number[] = candles.map(c => (c.high + c.low + c.close) / 3);
  for (let i = 0; i < candles.length; i++) {
    if (i < 19) { cci.push(0); continue; }
    const smaTP = tp.slice(i - 19, i + 1).reduce((a, b) => a + b, 0) / 20;
    const meanDev = tp.slice(i - 19, i + 1).reduce((s, v) => s + Math.abs(v - smaTP), 0) / 20;
    cci.push(meanDev === 0 ? 0 : (tp[i] - smaTP) / (0.015 * meanDev));
  }
  
  const trades: Trade[] = [];
  let lastSignalIdx = -30;
  
  for (let i = 50; i < candles.length; i++) {
    if (i - lastSignalIdx < 30) continue;
    if (atrValues[i] === 0) continue;
    
    // BUY: CCI was below -100 then crosses above -100 + price above EMA50
    if (cci[i] > -100 && cci[i - 1] <= -100 && closes[i] > ema50[i]) {
      const sl = candles[i].low - atrValues[i] * 1.0;
      const risk = candles[i].close - sl;
      const tp = candles[i].close + risk * 3.0;
      const slPips = (risk / pipMult) + brokerCost;
      if (slPips < 8 || slPips > 50) continue;
      
      trades.push({ pair, direction: 'LONG', entry: candles[i].close, sl, tp, exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0 });
      lastSignalIdx = i;
    }
    
    // SELL: CCI was above +100 then crosses below +100 + price below EMA50
    if (cci[i] < 100 && cci[i - 1] >= 100 && closes[i] < ema50[i]) {
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
console.log('#54: SuperTrend');
console.log('#55: Ichimoku Cloud');
console.log('#56: MACD + Stochastic');
console.log('#57: Heiken Ashi Trend');
console.log('#58: CCI Extreme + Trend');
console.log('===================================================================\n');

const strategies = [
  { name: 'SuperTrend', fn: testSuperTrend },
  { name: 'Ichimoku', fn: testIchimoku },
  { name: 'MACD + Stoch', fn: testMACD_Stoch },
  { name: 'Heiken Ashi', fn: testHeikenAshi },
  { name: 'CCI Extreme', fn: testCCI },
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
  console.log(`${(i + 54).toString().padEnd(3)}| ${s.name.padEnd(27)} | ${r.avgR.toFixed(3).padStart(7)} | ${r.verdict}`);
});
console.log('\n===================================================================');
console.log('TOTAL STRATEGIES TESTED: 58');
console.log('===================================================================');
