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

// ===== STRATEGY #69: MULTI-PAIR CORRELATION BREAKDOWN =====
// When EURUSD and GBPUSD diverge (normally correlated), trade the reversal
function testCorrelationBreakdown(pair: string, candles: Candle[], brokerCost: number, eurCandles?: Candle[], gbpCandles?: Candle[]): Trade[] {
  if (!eurCandles || !gbpCandles || candles.length < 100) return [];
  
  const closes = candles.map(c => c.close);
  const ema20 = ema(closes, 20);
  const atrValues = atr(candles, 14);
  const pipMult = getPipMultiplier(pair);
  
  // Calculate correlation between EUR and GBP (20-bar rolling)
  const correlations: number[] = [];
  for (let i = 0; i < Math.min(eurCandles.length, gbpCandles.length); i++) {
    if (i < 20) { correlations.push(0); continue; }
    const eurReturns: number[] = [], gbpReturns: number[] = [];
    for (let j = i - 19; j <= i; j++) {
      eurReturns.push((eurCandles[j].close - eurCandles[j - 1].close) / eurCandles[j - 1].close);
      gbpReturns.push((gbpCandles[j].close - gbpCandles[j - 1].close) / gbpCandles[j - 1].close);
    }
    const eurMean = eurReturns.reduce((a, b) => a + b, 0) / 20;
    const gbpMean = gbpReturns.reduce((a, b) => a + b, 0) / 20;
    let cov = 0, eurVar = 0, gbpVar = 0;
    for (let j = 0; j < 20; j++) {
      cov += (eurReturns[j] - eurMean) * (gbpReturns[j] - gbpMean);
      eurVar += (eurReturns[j] - eurMean) ** 2;
      gbpVar += (gbpReturns[j] - gbpMean) ** 2;
    }
    correlations.push(eurVar === 0 || gbpVar === 0 ? 0 : cov / Math.sqrt(eurVar * gbpVar));
  }
  
  const trades: Trade[] = [];
  let lastSignalIdx = -30;
  
  for (let i = 50; i < candles.length && i < correlations.length; i++) {
    if (i - lastSignalIdx < 30) continue;
    if (atrValues[i] === 0) continue;
    
    // Correlation breakdown: was high (>0.7) now low (<0.3)
    const wasCorrelated = correlations[i - 5] > 0.7;
    const isDivergent = correlations[i] < 0.3;
    
    if (wasCorrelated && isDivergent) {
      // Trade mean reversion: expect correlation to restore
      const eurNow = eurCandles[i].close;
      const gbpNow = gbpCandles[i].close;
      const eurPrev = eurCandles[i - 10].close;
      const gbpPrev = gbpCandles[i - 10].close;
      
      const eurChange = (eurNow - eurPrev) / eurPrev;
      const gbpChange = (gbpNow - gbpPrev) / gbpPrev;
      
      // If EUR went up but GBP went down (divergence), expect EUR to fall or GBP to rise
      if (eurChange > 0.001 && gbpChange < -0.001 && closes[i] > ema20[i]) {
        const sl = candles[i].high + atrValues[i] * 0.8;
        const risk = sl - candles[i].close;
        const tp = candles[i].close - risk * 2.0;
        const slPips = (risk / pipMult) + brokerCost;
        if (slPips < 8 || slPips > 50) continue;
        
        trades.push({ pair, direction: 'SHORT', entry: candles[i].close, sl, tp, exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0 });
        lastSignalIdx = i;
      } else if (eurChange < -0.001 && gbpChange > 0.001 && closes[i] < ema20[i]) {
        const sl = candles[i].low - atrValues[i] * 0.8;
        const risk = candles[i].close - sl;
        const tp = candles[i].close + risk * 2.0;
        const slPips = (risk / pipMult) + brokerCost;
        if (slPips < 8 || slPips > 50) continue;
        
        trades.push({ pair, direction: 'LONG', entry: candles[i].close, sl, tp, exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0 });
        lastSignalIdx = i;
      }
    }
  }
  
  return simulateTrades(trades, candles, pipMult, brokerCost);
}

// ===== STRATEGY #70: ADVANCED CANDLESTICK PATTERNS =====
// Multiple candlestick patterns combined (engulfing + pin bar + morning/evening star)
function testAdvancedPatterns(pair: string, candles: Candle[], brokerCost: number): Trade[] {
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
    
    const c1 = candles[i - 2];
    const c2 = candles[i - 1];
    const c3 = candles[i];
    
    // Bullish Engulfing
    const isBullishEngulfing = c2.close < c2.open && c3.close > c3.open &&
      c3.close > c2.open && c3.open < c2.close;
    
    // Bullish Pin Bar
    const isBullishPinBar = (c3.close - c3.open) > 0 &&
      (c3.open - c3.low) > 2 * (c3.close - c3.open) &&
      (c3.high - c3.close) < (c3.close - c3.open) * 0.3;
    
    // Morning Star (3-candle reversal)
    const isMorningStar = c1.close < c1.open && // first bearish
      Math.abs(c2.close - c2.open) < (c1.open - c1.close) * 0.3 && // second small body
      c3.close > c3.open && c3.close > (c1.open + c1.close) / 2; // third bullish, closes above midpoint
    
    // BUY: Any bullish pattern + above EMA30
    if ((isBullishEngulfing || isBullishPinBar || isMorningStar) && closes[i] > ema30[i]) {
      const sl = candles[i].low - atrValues[i] * 0.8;
      const risk = candles[i].close - sl;
      const tp = candles[i].close + risk * 2.5;
      const slPips = (risk / pipMult) + brokerCost;
      if (slPips < 8 || slPips > 50) continue;
      
      trades.push({ pair, direction: 'LONG', entry: candles[i].close, sl, tp, exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0 });
      lastSignalIdx = i;
    }
    
    // Bearish Engulfing
    const isBearishEngulfing = c2.close > c2.open && c3.close < c3.open &&
      c3.close < c2.open && c3.open > c2.close;
    
    // Bearish Pin Bar
    const isBearishPinBar = (c3.close - c3.open) < 0 &&
      (c3.high - c3.open) > 2 * (c3.open - c3.close) &&
      (c3.close - c3.low) < (c3.open - c3.close) * 0.3;
    
    // Evening Star
    const isEveningStar = c1.close > c1.open &&
      Math.abs(c2.close - c2.open) < (c1.close - c1.open) * 0.3 &&
      c3.close < c3.open && c3.close < (c1.open + c1.close) / 2;
    
    // SELL: Any bearish pattern + below EMA30
    if ((isBearishEngulfing || isBearishPinBar || isEveningStar) && closes[i] < ema30[i]) {
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

// ===== STRATEGY #71: TIME-OF-DAY MOMENTUM =====
// Trade momentum from London open, hold for specific duration
function testTimeOfDay(pair: string, candles: Candle[], brokerCost: number): Trade[] {
  if (candles.length < 100) return [];
  
  const closes = candles.map(c => c.close);
  const ema20 = ema(closes, 20);
  const atrValues = atr(candles, 14);
  const pipMult = getPipMultiplier(pair);
  
  const trades: Trade[] = [];
  let lastSignalIdx = -288; // 24 hours on M5
  
  for (let i = 50; i < candles.length; i++) {
    if (i - lastSignalIdx < 288) continue;
    if (atrValues[i] === 0) continue;
    
    const hour = candles[i].time.getUTCHours();
    const minute = candles[i].time.getUTCMinutes();
    
    // London open: 7:00-8:00 UTC
    const isLondonOpen = hour === 7 && minute < 30;
    
    if (isLondonOpen) {
      // Determine direction from pre-London momentum (last 2 hours)
      const momentum = closes[i] - closes[i - 24]; // 2 hours = 24 candles
      
      if (momentum > 0 && closes[i] > ema20[i]) {
        const sl = candles[i].low - atrValues[i] * 1.0;
        const risk = candles[i].close - sl;
        const tp = candles[i].close + risk * 2.5;
        const slPips = (risk / pipMult) + brokerCost;
        if (slPips < 8 || slPips > 50) continue;
        
        trades.push({ pair, direction: 'LONG', entry: candles[i].close, sl, tp, exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0 });
        lastSignalIdx = i;
      } else if (momentum < 0 && closes[i] < ema20[i]) {
        const sl = candles[i].high + atrValues[i] * 1.0;
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

// ===== STRATEGY #72: RSI + MACD DOUBLE CONFIRMATION =====
// Both RSI and MACD must agree on direction
function testRSI_MACD(pair: string, candles: Candle[], brokerCost: number): Trade[] {
  if (candles.length < 100) return [];
  
  const closes = candles.map(c => c.close);
  const rsiValues = rsi(closes, 14);
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macdLine = closes.map((_, i) => ema12[i] - ema26[i]);
  const macdSignal = ema(macdLine, 9);
  const atrValues = atr(candles, 14);
  const pipMult = getPipMultiplier(pair);
  
  const trades: Trade[] = [];
  let lastSignalIdx = -25;
  
  for (let i = 50; i < candles.length; i++) {
    if (i - lastSignalIdx < 25) continue;
    if (atrValues[i] === 0) continue;
    
    // BUY: RSI crosses above 50 + MACD histogram turns positive
    const rsiCrossUp = rsiValues[i] > 50 && rsiValues[i - 1] <= 50;
    const macdTurnPositive = macdLine[i] > macdSignal[i] && macdLine[i - 1] <= macdSignal[i - 1];
    
    if (rsiCrossUp && macdTurnPositive) {
      const sl = candles[i].low - atrValues[i] * 1.0;
      const risk = candles[i].close - sl;
      const tp = candles[i].close + risk * 2.5;
      const slPips = (risk / pipMult) + brokerCost;
      if (slPips < 8 || slPips > 50) continue;
      
      trades.push({ pair, direction: 'LONG', entry: candles[i].close, sl, tp, exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0 });
      lastSignalIdx = i;
    }
    
    // SELL: RSI crosses below 50 + MACD histogram turns negative
    const rsiCrossDown = rsiValues[i] < 50 && rsiValues[i - 1] >= 50;
    const macdTurnNegative = macdLine[i] < macdSignal[i] && macdLine[i - 1] >= macdSignal[i - 1];
    
    if (rsiCrossDown && macdTurnNegative) {
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

// ===== STRATEGY #73: BOLLINGER BAND WIDTH EXPANSION =====
// Trade when BB width expands rapidly (volatility breakout)
function testBBExpansion(pair: string, candles: Candle[], brokerCost: number): Trade[] {
  if (candles.length < 100) return [];
  
  const closes = candles.map(c => c.close);
  const sma20 = sma(closes, 20);
  const atrValues = atr(candles, 14);
  const pipMult = getPipMultiplier(pair);
  
  // Calculate BB width
  const bbWidth: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < 20) { bbWidth.push(0); continue; }
    let sumSq = 0;
    for (let j = i - 19; j <= i; j++) sumSq += (closes[j] - sma20[i]) ** 2;
    const std = Math.sqrt(sumSq / 20);
    bbWidth.push(std * 4);
  }
  
  const trades: Trade[] = [];
  let lastSignalIdx = -30;
  
  for (let i = 50; i < candles.length; i++) {
    if (i - lastSignalIdx < 30) continue;
    if (atrValues[i] === 0 || bbWidth[i] === 0) continue;
    
    // BB width expanding rapidly (>20% increase in 3 candles)
    const expansion = bbWidth[i] > bbWidth[i - 3] * 1.2;
    
    if (expansion) {
      const upperBand = sma20[i] + bbWidth[i] / 2;
      const lowerBand = sma20[i] - bbWidth[i] / 2;
      
      // Breakout above upper band
      if (closes[i] > upperBand && closes[i] > closes[i - 1]) {
        const sl = sma20[i] - atrValues[i] * 0.5;
        const risk = candles[i].close - sl;
        const tp = candles[i].close + risk * 2.5;
        const slPips = (risk / pipMult) + brokerCost;
        if (slPips < 8 || slPips > 50) continue;
        
        trades.push({ pair, direction: 'LONG', entry: candles[i].close, sl, tp, exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0 });
        lastSignalIdx = i;
      }
      // Breakout below lower band
      else if (closes[i] < lowerBand && closes[i] < closes[i - 1]) {
        const sl = sma20[i] + atrValues[i] * 0.5;
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
console.log('TESTING 5 MORE ADVANCED STRATEGIES');
console.log('#69: Multi-Pair Correlation Breakdown');
console.log('#70: Advanced Candlestick Patterns');
console.log('#71: Time-of-Day Momentum (London Open)');
console.log('#72: RSI + MACD Double Confirmation');
console.log('#73: Bollinger Band Width Expansion');
console.log('===================================================================\n');

// Load EUR and GBP for correlation strategy
const eurCandles = loadCacheFile('EURUSD');
const gbpCandles = loadCacheFile('GBPUSD');

const strategies = [
  { name: 'Correlation Break', fn: (p: string, c: Candle[], cost: number) => testCorrelationBreakdown(p, c, cost, eurCandles, gbpCandles) },
  { name: 'Advanced Patterns', fn: testAdvancedPatterns },
  { name: 'Time-of-Day', fn: testTimeOfDay },
  { name: 'RSI + MACD', fn: testRSI_MACD },
  { name: 'BB Expansion', fn: testBBExpansion },
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
  console.log(`${(i + 69).toString().padEnd(3)}| ${s.name.padEnd(27)} | ${r.avgR.toFixed(3).padStart(7)} | ${r.verdict}`);
});
console.log('\n===================================================================');
console.log('TOTAL STRATEGIES TESTED: 73');
console.log('===================================================================');
