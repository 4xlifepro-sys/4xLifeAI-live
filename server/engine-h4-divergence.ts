/**
 * H4 RSI-DIVERGENCE TREND-REVERSAL ENGINE — BACKTEST ONLY
 * 
 * Tests whether H4 timeframe (bigger moves) overcomes the broker cost problem
 * that killed all 78 M5 forex strategies.
 * 
 * ISOLATED: Does not modify any existing engine or live routing files.
 */

import * as fs from 'fs';

// ===== DATA LOADING & AGGREGATION =====

interface RawCandle {
  time: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

function loadM5Cache(pair: string): RawCandle[] {
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

function aggregateToH4(m5Candles: RawCandle[]): RawCandle[] {
  if (m5Candles.length === 0) return [];
  
  const h4Map = new Map<string, RawCandle>();
  
  for (const c of m5Candles) {
    // H4 bucket: floor to nearest 4-hour boundary
    const h = c.time.getUTCHours();
    const h4Hour = Math.floor(h / 4) * 4;
    const bucketKey = `${c.time.getUTCFullYear()}-${c.time.getUTCMonth()}-${c.time.getUTCDate()}-${h4Hour}`;
    
    if (!h4Map.has(bucketKey)) {
      h4Map.set(bucketKey, {
        time: new Date(Date.UTC(c.time.getUTCFullYear(), c.time.getUTCMonth(), c.time.getUTCDate(), h4Hour, 0, 0)),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      });
    } else {
      const existing = h4Map.get(bucketKey)!;
      existing.high = Math.max(existing.high, c.high);
      existing.low = Math.min(existing.low, c.low);
      existing.close = c.close;
      existing.volume += c.volume;
    }
  }
  
  return Array.from(h4Map.values()).sort((a, b) => a.time.getTime() - b.time.getTime());
}

// ===== INDICATORS =====

function ema(values: number[], period: number): number[] {
  const result: number[] = [];
  const k = 2 / (period + 1);
  let e = values[0];
  result.push(e);
  for (let i = 1; i < values.length; i++) {
    e = values[i] * k + e * (1 - k);
    result.push(e);
  }
  return result;
}

function rsi(closes: number[], period: number = 14): number[] {
  const result: number[] = [];
  if (closes.length < period + 1) return closes.map(() => 50);
  
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gains += d; else losses -= d;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  
  for (let i = 0; i <= period; i++) result.push(50);
  result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) {
      avgGain = (avgGain * (period - 1) + d) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) - d) / period;
    }
    result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }
  return result;
}

function atr(candles: RawCandle[], period: number = 14): number[] {
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
    if (i < period - 1) result.push(0);
    else if (i === period - 1) result.push(trSum / period);
    else result.push((result[i - 1] * (period - 1) + tr) / period);
  }
  return result;
}

// ===== SWING DETECTION =====

interface SwingPoint {
  index: number;
  price: number;
  type: 'high' | 'low';
}

function findSwingHighs(candles: RawCandle[], lookback: number = 5): SwingPoint[] {
  const swings: SwingPoint[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    let isSwing = true;
    for (let j = 1; j <= lookback; j++) {
      if (candles[i].high <= candles[i - j].high || candles[i].high <= candles[i + j].high) {
        isSwing = false;
        break;
      }
    }
    if (isSwing) swings.push({ index: i, price: candles[i].high, type: 'high' });
  }
  return swings;
}

function findSwingLows(candles: RawCandle[], lookback: number = 5): SwingPoint[] {
  const swings: SwingPoint[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    let isSwing = true;
    for (let j = 1; j <= lookback; j++) {
      if (candles[i].low >= candles[i - j].low || candles[i].low >= candles[i + j].low) {
        isSwing = false;
        break;
      }
    }
    if (isSwing) swings.push({ index: i, price: candles[i].low, type: 'low' });
  }
  return swings;
}

// ===== DIVERGENCE DETECTION =====

interface DivergenceSignal {
  index: number;
  type: 'bullish' | 'bearish';
  slLevel: number;
  triggerLevel: number;
}

function detectDivergences(candles: RawCandle[], rsiValues: number[]): DivergenceSignal[] {
  const signals: DivergenceSignal[] = [];
  const lookback = 5; // swing detection lookback
  const divergenceWindow = 30; // max distance between two swing points for comparison
  
  const swingHighs = findSwingHighs(candles, lookback);
  const swingLows = findSwingLows(candles, lookback);
  
  // BEARISH DIVERGENCE: price higher high, RSI lower high
  for (let i = 1; i < swingHighs.length; i++) {
    const prev = swingHighs[i - 1];
    const curr = swingHighs[i];
    
    if (curr.index - prev.index > divergenceWindow) continue;
    if (curr.index >= candles.length - 10) continue; // too recent
    
    // Price made higher high
    if (curr.price > prev.price) {
      // RSI made lower high (compare RSI at swing points)
      const rsiPrev = rsiValues[prev.index] || 50;
      const rsiCurr = rsiValues[curr.index] || 50;
      
      if (rsiCurr < rsiPrev && rsiPrev > 60) { // RSI was in overbought territory
        // Find trigger: recent swing low between the two highs
        let triggerLow = Infinity;
        for (let j = prev.index; j <= curr.index; j++) {
          triggerLow = Math.min(triggerLow, candles[j].low);
        }
        
        signals.push({
          index: curr.index,
          type: 'bearish',
          slLevel: curr.price, // SL above the higher high
          triggerLevel: triggerLow, // Entry when price breaks below this
        });
      }
    }
  }
  
  // BULLISH DIVERGENCE: price lower low, RSI higher low
  for (let i = 1; i < swingLows.length; i++) {
    const prev = swingLows[i - 1];
    const curr = swingLows[i];
    
    if (curr.index - prev.index > divergenceWindow) continue;
    if (curr.index >= candles.length - 10) continue;
    
    // Price made lower low
    if (curr.price < prev.price) {
      const rsiPrev = rsiValues[prev.index] || 50;
      const rsiCurr = rsiValues[curr.index] || 50;
      
      if (rsiCurr > rsiPrev && rsiPrev < 40) { // RSI was in oversold territory
        let triggerHigh = -Infinity;
        for (let j = prev.index; j <= curr.index; j++) {
          triggerHigh = Math.max(triggerHigh, candles[j].high);
        }
        
        signals.push({
          index: curr.index,
          type: 'bullish',
          slLevel: curr.price, // SL below the lower low
          triggerLevel: triggerHigh, // Entry when price breaks above this
        });
      }
    }
  }
  
  return signals;
}

// ===== TRADE SIMULATION =====

interface Trade {
  pair: string;
  direction: 'LONG' | 'SHORT';
  entry: number;
  entryIdx: number;
  entryTime: Date;
  sl: number;
  exitPrice: number;
  exitIdx: number;
  exitTime: Date;
  exitReason: string;
  grossPips: number;
  netPips: number;
  rMultiple: number;
}

function simulateTrade(
  pair: string,
  direction: 'LONG' | 'SHORT',
  entry: number,
  entryIdx: number,
  sl: number,
  candles: RawCandle[],
  ema50: number[],
  pipMult: number,
  brokerCost: number
): Trade | null {
  const risk = Math.abs(entry - sl);
  if (risk === 0) return null;
  
  let exitPrice = entry;
  let exitIdx = entryIdx;
  let exitReason = 'TIME';
  const maxHold = 60; // max 60 H4 candles = 10 days
  
  for (let j = entryIdx + 1; j < candles.length && j < entryIdx + maxHold; j++) {
    const c = candles[j];
    
    // Check SL first
    if (direction === 'LONG') {
      if (c.low <= sl) {
        exitPrice = sl;
        exitIdx = j;
        exitReason = 'SL';
        break;
      }
    } else {
      if (c.high >= sl) {
        exitPrice = sl;
        exitIdx = j;
        exitReason = 'SL';
        break;
      }
    }
    
    // Trailing EMA50 exit: close back through EMA50 against position
    if (direction === 'LONG' && c.close < ema50[j] && j > entryIdx + 4) {
      // Price closed below EMA50 — exit at close
      exitPrice = c.close;
      exitIdx = j;
      exitReason = 'EMA50_TRAIL';
      break;
    }
    if (direction === 'SHORT' && c.close > ema50[j] && j > entryIdx + 4) {
      exitPrice = c.close;
      exitIdx = j;
      exitReason = 'EMA50_TRAIL';
      break;
    }
  }
  
  // If no exit triggered, exit at last candle close
  if (exitReason === 'TIME') {
    const lastIdx = Math.min(entryIdx + maxHold, candles.length - 1);
    exitPrice = candles[lastIdx].close;
    exitIdx = lastIdx;
  }
  
  const grossPips = direction === 'LONG'
    ? (exitPrice - entry) / pipMult
    : (entry - exitPrice) / pipMult;
  
  const netPips = grossPips - brokerCost;
  const riskPips = risk / pipMult;
  const rMultiple = riskPips > 0 ? netPips / riskPips : 0;
  
  return {
    pair,
    direction,
    entry,
    entryIdx,
    entryTime: candles[entryIdx].time,
    sl,
    exitPrice,
    exitIdx,
    exitTime: candles[exitIdx].time,
    exitReason,
    grossPips,
    netPips,
    rMultiple,
  };
}

// ===== MAIN BACKTEST =====

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

const PAIRS = [
  'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'USDCAD',
  'AUDUSD', 'NZDUSD', 'EURGBP', 'EURJPY', 'GBPJPY',
  'AUDJPY', 'CADJPY', 'CHFJPY', 'NZDJPY', 'EURAUD'
];

interface PairResult {
  pair: string;
  totalTrades: number;
  closedTrades: number;
  wins: number;
  winRate: number;
  avgR: number;
  profitFactor: number;
  maxDD: number;
  avgSLpips: number;
  avgWinPips: number;
  avgLossPips: number;
}

function runBacktest(
  pair: string,
  candles: RawCandle[],
  brokerCost: number,
  startDate?: Date,
  endDate?: Date
): Trade[] {
  if (candles.length < 120) return [];
  
  // Filter by date range if specified
  let filteredCandles = candles;
  let offsetMap: number[] = []; // maps filtered index to original index
  if (startDate || endDate) {
    filteredCandles = [];
    offsetMap = [];
    for (let i = 0; i < candles.length; i++) {
      const t = candles[i].time;
      if (startDate && t < startDate) continue;
      if (endDate && t > endDate) continue;
      offsetMap.push(i);
      filteredCandles.push(candles[i]);
    }
  }
  
  if (filteredCandles.length < 120) return [];
  
  const closes = filteredCandles.map(c => c.close);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const ema100 = ema(closes, 100);
  const rsiValues = rsi(closes, 14);
  const atrValues = atr(filteredCandles, 14);
  const pipMult = getPipMultiplier(pair);
  
  // Detect divergences
  const divergences = detectDivergences(filteredCandles, rsiValues);
  
  const trades: Trade[] = [];
  let lastTradeIdx = -10; // minimum distance between trades
  
  for (const div of divergences) {
    // Wait for trigger: price breaks the trigger level after divergence
    for (let j = div.index + 1; j < filteredCandles.length && j < div.index + 20; j++) {
      if (j - lastTradeIdx < 8) continue; // cooldown
      
      const c = filteredCandles[j];
      const atrVal = atrValues[j];
      if (atrVal === 0) continue;
      
      if (div.type === 'bullish' && c.close > div.triggerLevel) {
        // Trend context: check EMA alignment (relaxed — just need general reference)
        // For bullish: prefer price below EMA50 (reversal from below) or near it
        const sl = div.slLevel - atrVal * 0.3; // ATR buffer below swing low
        const risk = c.close - sl;
        const riskPips = risk / pipMult;
        
        // Sanity: SL should be reasonable for H4 (10-200 pips for majors, wider for JPY)
        if (riskPips < 10 || riskPips > 300) continue;
        
        const trade = simulateTrade(pair, 'LONG', c.close, j, sl, filteredCandles, ema50, pipMult, brokerCost);
        if (trade) {
          trades.push(trade);
          lastTradeIdx = j;
        }
        break;
      }
      
      if (div.type === 'bearish' && c.close < div.triggerLevel) {
        const sl = div.slLevel + atrVal * 0.3;
        const risk = sl - c.close;
        const riskPips = risk / pipMult;
        
        if (riskPips < 10 || riskPips > 300) continue;
        
        const trade = simulateTrade(pair, 'SHORT', c.close, j, sl, filteredCandles, ema50, pipMult, brokerCost);
        if (trade) {
          trades.push(trade);
          lastTradeIdx = j;
        }
        break;
      }
    }
  }
  
  return trades;
}

function computeStats(trades: Trade[], label: string): PairResult | null {
  const closed = trades.filter(t => t.exitReason !== 'TIME');
  if (closed.length === 0) return null;
  
  const wins = closed.filter(t => t.netPips > 0);
  const losses = closed.filter(t => t.netPips <= 0);
  const winRate = (wins.length / closed.length) * 100;
  const avgR = closed.reduce((s, t) => s + t.rMultiple, 0) / closed.length;
  
  const grossProfit = wins.reduce((s, t) => s + t.rMultiple, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.rMultiple, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0;
  
  // Max drawdown
  let equity = 0, peak = 0, maxDD = 0;
  for (const t of closed) {
    equity += t.rMultiple;
    peak = Math.max(peak, equity);
    maxDD = Math.max(maxDD, peak - equity);
  }
  
  const pipMult = getPipMultiplier(closed[0].pair);
  const avgSLpips = closed.reduce((s, t) => s + Math.abs(t.entry - t.sl) / pipMult, 0) / closed.length;
  const avgWinPips = wins.length > 0 ? wins.reduce((s, t) => s + t.netPips, 0) / wins.length : 0;
  const avgLossPips = losses.length > 0 ? losses.reduce((s, t) => s + t.netPips, 0) / losses.length : 0;
  
  return {
    pair: closed[0].pair,
    totalTrades: trades.length,
    closedTrades: closed.length,
    wins: wins.length,
    winRate,
    avgR,
    profitFactor,
    maxDD,
    avgSLpips,
    avgWinPips,
    avgLossPips,
  };
}

// ===== RUN =====

console.log('===================================================================');
console.log('H4 RSI-DIVERGENCE TREND-REVERSAL BACKTEST');
console.log('===================================================================');
console.log('Testing whether H4 timeframe overcomes M5 cost problem.');
console.log('All 15 forex pairs, 6-month dataset, REAL COSTS applied.');
console.log('===================================================================\n');

// Load and aggregate all pairs
const pairData = new Map<string, RawCandle[]>();
for (const pair of PAIRS) {
  const m5 = loadM5Cache(pair);
  if (m5.length === 0) {
    console.log(`  WARNING: No data for ${pair}`);
    continue;
  }
  const h4 = aggregateToH4(m5);
  pairData.set(pair, h4);
  console.log(`  ${pair}: ${m5.length} M5 candles → ${h4.length} H4 candles`);
}

// Determine date range for walk-forward split
let globalMinDate = new Date('2099-01-01');
let globalMaxDate = new Date('1970-01-01');
for (const [, candles] of pairData) {
  if (candles.length > 0) {
    globalMinDate = new Date(Math.min(globalMinDate.getTime(), candles[0].time.getTime()));
    globalMaxDate = new Date(Math.max(globalMaxDate.getTime(), candles[candles.length - 1].time.getTime()));
  }
}

const totalDays = (globalMaxDate.getTime() - globalMinDate.getTime()) / (1000 * 60 * 60 * 24);
const splitPoint = new Date(globalMinDate.getTime() + totalDays * (4 / 6) * 24 * 60 * 60 * 1000);

console.log(`\n  Data range: ${globalMinDate.toISOString().split('T')[0]} to ${globalMaxDate.toISOString().split('T')[0]}`);
console.log(`  Total days: ${totalDays.toFixed(0)}`);
console.log(`  Walk-forward split: ${splitPoint.toISOString().split('T')[0]}`);
console.log(`  In-sample: ${globalMinDate.toISOString().split('T')[0]} to ${splitPoint.toISOString().split('T')[0]} (~4 months)`);
console.log(`  Out-of-sample: ${splitPoint.toISOString().split('T')[0]} to ${globalMaxDate.toISOString().split('T')[0]} (~2 months)`);

// ===== FULL PERIOD BACKTEST =====
console.log('\n===================================================================');
console.log('FULL PERIOD RESULTS (6 months, with costs)');
console.log('===================================================================\n');

const allFullTrades: Trade[] = [];
const fullPairResults: PairResult[] = [];

for (const pair of PAIRS) {
  const candles = pairData.get(pair);
  if (!candles) continue;
  
  const cost = getBrokerCost(pair);
  const trades = runBacktest(pair, candles, cost);
  allFullTrades.push(...trades);
  
  const stats = computeStats(trades, pair);
  if (stats) {
    fullPairResults.push(stats);
    console.log(`  ${pair.padEnd(10)} signals: ${String(trades.length).padStart(3)} closed: ${String(stats.closedTrades).padStart(3)} ` +
      `WR: ${stats.winRate.toFixed(1).padStart(5)}%  avgR: ${stats.avgR.toFixed(3).padStart(7)}  ` +
      `PF: ${stats.profitFactor.toFixed(2).padStart(5)}  maxDD: ${stats.maxDD.toFixed(2).padStart(6)}R  ` +
      `avgSL: ${stats.avgSLpips.toFixed(1).padStart(5)}p  avgWin: ${stats.avgWinPips.toFixed(1).padStart(6)}p  avgLoss: ${stats.avgLossPips.toFixed(1).padStart(6)}p`);
  } else {
    console.log(`  ${pair.padEnd(10)} signals: ${String(trades.length).padStart(3)} — no closed trades`);
  }
}

// Combined full period
const fullClosed = allFullTrades.filter(t => t.exitReason !== 'TIME');
const fullWins = fullClosed.filter(t => t.netPips > 0);
const fullLosses = fullClosed.filter(t => t.netPips <= 0);
const fullWR = fullClosed.length > 0 ? (fullWins.length / fullClosed.length) * 100 : 0;
const fullAvgR = fullClosed.length > 0 ? fullClosed.reduce((s, t) => s + t.rMultiple, 0) / fullClosed.length : 0;
const fullGP = fullWins.reduce((s, t) => s + t.rMultiple, 0);
const fullGL = Math.abs(fullLosses.reduce((s, t) => s + t.rMultiple, 0));
const fullPF = fullGL > 0 ? fullGP / fullGL : 0;
let fullEq = 0, fullPeak = 0, fullMaxDD = 0;
for (const t of fullClosed) { fullEq += t.rMultiple; fullPeak = Math.max(fullPeak, fullEq); fullMaxDD = Math.max(fullMaxDD, fullPeak - fullEq); }

const fullAvgSL = fullClosed.length > 0 ? fullClosed.reduce((s, t) => s + Math.abs(t.entry - t.sl) / getPipMultiplier(t.pair), 0) / fullClosed.length : 0;
const fullAvgWin = fullWins.length > 0 ? fullWins.reduce((s, t) => s + t.netPips, 0) / fullWins.length : 0;
const fullAvgLoss = fullLosses.length > 0 ? fullLosses.reduce((s, t) => s + t.netPips, 0) / fullLosses.length : 0;

console.log(`\n  ${'COMBINED'.padEnd(10)} signals: ${String(allFullTrades.length).padStart(3)} closed: ${String(fullClosed.length).padStart(3)} ` +
  `WR: ${fullWR.toFixed(1).padStart(5)}%  avgR: ${fullAvgR.toFixed(3).padStart(7)}  ` +
  `PF: ${fullPF.toFixed(2).padStart(5)}  maxDD: ${fullMaxDD.toFixed(2).padStart(6)}R  ` +
  `avgSL: ${fullAvgSL.toFixed(1).padStart(5)}p  avgWin: ${fullAvgWin.toFixed(1).padStart(6)}p  avgLoss: ${fullAvgLoss.toFixed(1).padStart(6)}p`);

// Exit reason breakdown
const exitReasons = new Map<string, number>();
for (const t of fullClosed) {
  exitReasons.set(t.exitReason, (exitReasons.get(t.exitReason) || 0) + 1);
}
console.log(`\n  Exit reasons:`);
for (const [reason, count] of exitReasons) {
  console.log(`    ${reason}: ${count} (${(count / fullClosed.length * 100).toFixed(1)}%)`);
}

// ===== WALK-FORWARD: IN-SAMPLE =====
console.log('\n===================================================================');
console.log('WALK-FORWARD: IN-SAMPLE (months 1-4, with costs)');
console.log('===================================================================\n');

const allISTrades: Trade[] = [];
const isPairResults: PairResult[] = [];

for (const pair of PAIRS) {
  const candles = pairData.get(pair);
  if (!candles) continue;
  
  const cost = getBrokerCost(pair);
  const trades = runBacktest(pair, candles, cost, globalMinDate, splitPoint);
  allISTrades.push(...trades);
  
  const stats = computeStats(trades, pair);
  if (stats) {
    isPairResults.push(stats);
    console.log(`  ${pair.padEnd(10)} closed: ${String(stats.closedTrades).padStart(3)} ` +
      `WR: ${stats.winRate.toFixed(1).padStart(5)}%  avgR: ${stats.avgR.toFixed(3).padStart(7)}  ` +
      `PF: ${stats.profitFactor.toFixed(2).padStart(5)}  maxDD: ${stats.maxDD.toFixed(2).padStart(6)}R  ` +
      `avgSL: ${stats.avgSLpips.toFixed(1).padStart(5)}p`);
  } else {
    console.log(`  ${pair.padEnd(10)} closed:   0`);
  }
}

const isClosed = allISTrades.filter(t => t.exitReason !== 'TIME');
const isWins = isClosed.filter(t => t.netPips > 0);
const isLosses = isClosed.filter(t => t.netPips <= 0);
const isWR = isClosed.length > 0 ? (isWins.length / isClosed.length) * 100 : 0;
const isAvgR = isClosed.length > 0 ? isClosed.reduce((s, t) => s + t.rMultiple, 0) / isClosed.length : 0;
const isGP = isWins.reduce((s, t) => s + t.rMultiple, 0);
const isGL = Math.abs(isLosses.reduce((s, t) => s + t.rMultiple, 0));
const isPF = isGL > 0 ? isGP / isGL : 0;
let isEq = 0, isPeak = 0, isMaxDD = 0;
for (const t of isClosed) { isEq += t.rMultiple; isPeak = Math.max(isPeak, isEq); isMaxDD = Math.max(isMaxDD, isPeak - isEq); }

console.log(`\n  ${'COMBINED'.padEnd(10)} closed: ${String(isClosed.length).padStart(3)} ` +
  `WR: ${isWR.toFixed(1).padStart(5)}%  avgR: ${isAvgR.toFixed(3).padStart(7)}  ` +
  `PF: ${isPF.toFixed(2).padStart(5)}  maxDD: ${isMaxDD.toFixed(2).padStart(6)}R`);

// ===== WALK-FORWARD: OUT-OF-SAMPLE =====
console.log('\n===================================================================');
console.log('WALK-FORWARD: OUT-OF-SAMPLE (months 5-6, with costs)');
console.log('===================================================================\n');

const allOOSTrades: Trade[] = [];
const oosPairResults: PairResult[] = [];

for (const pair of PAIRS) {
  const candles = pairData.get(pair);
  if (!candles) continue;
  
  const cost = getBrokerCost(pair);
  const trades = runBacktest(pair, candles, cost, splitPoint, globalMaxDate);
  allOOSTrades.push(...trades);
  
  const stats = computeStats(trades, pair);
  if (stats) {
    oosPairResults.push(stats);
    console.log(`  ${pair.padEnd(10)} closed: ${String(stats.closedTrades).padStart(3)} ` +
      `WR: ${stats.winRate.toFixed(1).padStart(5)}%  avgR: ${stats.avgR.toFixed(3).padStart(7)}  ` +
      `PF: ${stats.profitFactor.toFixed(2).padStart(5)}  maxDD: ${stats.maxDD.toFixed(2).padStart(6)}R  ` +
      `avgSL: ${stats.avgSLpips.toFixed(1).padStart(5)}p`);
  } else {
    console.log(`  ${pair.padEnd(10)} closed:   0`);
  }
}

const oosClosed = allOOSTrades.filter(t => t.exitReason !== 'TIME');
const oosWins = oosClosed.filter(t => t.netPips > 0);
const oosLosses = oosClosed.filter(t => t.netPips <= 0);
const oosWR = oosClosed.length > 0 ? (oosWins.length / oosClosed.length) * 100 : 0;
const oosAvgR = oosClosed.length > 0 ? oosClosed.reduce((s, t) => s + t.rMultiple, 0) / oosClosed.length : 0;
const oosGP = oosWins.reduce((s, t) => s + t.rMultiple, 0);
const oosGL = Math.abs(oosLosses.reduce((s, t) => s + t.rMultiple, 0));
const oosPF = oosGL > 0 ? oosGP / oosGL : 0;
let oosEq = 0, oosPeak = 0, oosMaxDD = 0;
for (const t of oosClosed) { oosEq += t.rMultiple; oosPeak = Math.max(oosPeak, oosEq); oosMaxDD = Math.max(oosMaxDD, oosPeak - oosEq); }

console.log(`\n  ${'COMBINED'.padEnd(10)} closed: ${String(oosClosed.length).padStart(3)} ` +
  `WR: ${oosWR.toFixed(1).padStart(5)}%  avgR: ${oosAvgR.toFixed(3).padStart(7)}  ` +
  `PF: ${oosPF.toFixed(2).padStart(5)}  maxDD: ${oosMaxDD.toFixed(2).padStart(6)}R`);

// ===== VERDICT =====
console.log('\n===================================================================');
console.log('WALK-FORWARD COMPARISON');
console.log('===================================================================\n');
console.log(`  Period          | Closed | Win Rate | avgR    | PF    | Max DD(R)`);
console.log(`  ----------------+--------+----------+---------+-------+----------`);
console.log(`  In-sample (1-4) | ${String(isClosed.length).padStart(6)} | ${isWR.toFixed(1).padStart(7)}% | ${isAvgR.toFixed(3).padStart(7)} | ${isPF.toFixed(2).padStart(5)} | ${isMaxDD.toFixed(2).padStart(9)}`);
console.log(`  Out-of-sample   | ${String(oosClosed.length).padStart(6)} | ${oosWR.toFixed(1).padStart(7)}% | ${oosAvgR.toFixed(3).padStart(7)} | ${oosPF.toFixed(2).padStart(5)} | ${oosMaxDD.toFixed(2).padStart(9)}`);
console.log(`  Full period     | ${String(fullClosed.length).padStart(6)} | ${fullWR.toFixed(1).padStart(7)}% | ${fullAvgR.toFixed(3).padStart(7)} | ${fullPF.toFixed(2).padStart(5)} | ${fullMaxDD.toFixed(2).padStart(9)}`);

console.log('\n===================================================================');
console.log('COST IMPACT ANALYSIS');
console.log('===================================================================\n');
console.log(`  Average SL distance: ${fullAvgSL.toFixed(1)} pips (H4)`);
console.log(`  Average broker cost: ~1.8 pips (weighted across pairs)`);
console.log(`  Cost as % of SL: ${fullAvgSL > 0 ? (1.8 / fullAvgSL * 100).toFixed(1) : 'N/A'}%`);
console.log(`  Average winning trade: ${fullAvgWin.toFixed(1)} pips`);
console.log(`  Cost as % of avg win: ${fullAvgWin > 0 ? (1.8 / fullAvgWin * 100).toFixed(1) : 'N/A'}%`);
console.log(`\n  Compare to M5:`);
console.log(`  M5 avg SL: ~8 pips, cost as % of SL: ~22%`);
console.log(`  H4 avg SL: ${fullAvgSL.toFixed(1)} pips, cost as % of SL: ${fullAvgSL > 0 ? (1.8 / fullAvgSL * 100).toFixed(1) : 'N/A'}%`);

console.log('\n===================================================================');
console.log('VERDICT');
console.log('===================================================================\n');

if (oosAvgR > 0.05 && oosClosed.length >= 20) {
  console.log('  ✅ PASS — H4 divergence strategy is profitable after costs.');
  console.log(`     Out-of-sample avgR: ${oosAvgR.toFixed(3)} with ${oosClosed.length} closed trades.`);
  console.log('     This is a viable second option alongside metals trend-breakout.');
} else if (oosAvgR > 0 && oosAvgR <= 0.05) {
  console.log('  ⚠️  MARGINAL — Barely positive out-of-sample.');
  console.log(`     Out-of-sample avgR: ${oosAvgR.toFixed(3)} with ${oosClosed.length} closed trades.`);
  console.log('     Too fragile to deploy confidently. Needs more data or refinement.');
} else if (oosClosed.length < 20) {
  console.log('  ❌ INSUFFICIENT DATA — Too few out-of-sample trades to evaluate.');
  console.log(`     Only ${oosClosed.length} closed trades out-of-sample (need 20+ minimum).`);
  console.log(`     avgR: ${oosAvgR.toFixed(3)}`);
} else {
  console.log('  ❌ FAIL — H4 divergence strategy is NOT profitable after costs.');
  console.log(`     Out-of-sample avgR: ${oosAvgR.toFixed(3)} with ${oosClosed.length} closed trades.`);
  if (oosAvgR < isAvgR) {
    console.log('     Performance DEGRADED out-of-sample (was better in-sample).');
  }
  console.log('     H4 timeframe alone does not solve the forex cost problem.');
}

console.log('\n===================================================================');
console.log('CONFIRMATION: This file is fully isolated. No existing engines');
console.log('or live routing files were modified. Backtest only, nothing deployed.');
console.log('===================================================================');
