/**
 * DEEP FOREX STRATEGY SEARCH - ROUND 2
 * 
 * Testing:
 * - More timeframes: M30, H2, H8, D1
 * - More strategies: 15+ new approaches
 * - Different exits: partial TP, time-based, session-based, volatility-based
 * - Session filters: London-only, NY-only, overlap-only
 * - Volatility regimes: only trade when ATR expanding
 * - Pattern-based: engulfing, pin bars, inside bars
 * 
 * Focus on pairs that showed promise: EURUSD, NZDJPY, CHFJPY, GBPJPY
 */

import * as fs from 'fs';

interface RawCandle {
  time: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface PairConfig {
  pair: string;
  pipMult: number;
  costPips: number;
}

const PAIRS: PairConfig[] = [
  { pair: 'EURUSD', pipMult: 0.0001, costPips: 1.0 },
  { pair: 'NZDJPY', pipMult: 0.01, costPips: 1.8 },
  { pair: 'CHFJPY', pipMult: 0.01, costPips: 1.7 },
  { pair: 'GBPJPY', pipMult: 0.01, costPips: 1.8 },
  { pair: 'EURJPY', pipMult: 0.01, costPips: 1.5 },
  { pair: 'AUDJPY', pipMult: 0.01, costPips: 1.5 },
];

// --- DATA LOADING ---
function loadM5Candles(pair: string): RawCandle[] {
  const cacheDir = process.env.CACHE_DIR || './.cache';
  const files = fs.readdirSync(cacheDir).filter(f => f.includes(pair) && f.includes('5min') && f.endsWith('.json'));
  if (files.length === 0) return [];
  
  const all: RawCandle[] = [];
  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(`${cacheDir}/${file}`, 'utf-8'));
      for (const c of data) {
        all.push({
          time: new Date(c.timestamp || c.time),
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume || 0,
        });
      }
    } catch {}
  }
  return all.sort((a, b) => a.time.getTime() - b.time.getTime());
}

function aggregateCandles(m5: RawCandle[], minutesPerCandle: number): RawCandle[] {
  const map = new Map<string, RawCandle>();
  for (const c of m5) {
    const ms = c.time.getTime();
    const bucketMs = ms - (ms % (minutesPerCandle * 60 * 1000));
    const key = new Date(bucketMs).toISOString();
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { time: new Date(bucketMs), open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume });
    } else {
      existing.high = Math.max(existing.high, c.high);
      existing.low = Math.min(existing.low, c.low);
      existing.close = c.close;
      existing.volume += c.volume;
    }
  }
  return Array.from(map.values()).sort((a, b) => a.time.getTime() - b.time.getTime());
}

// --- INDICATORS ---
function ema(values: number[], period: number): number[] {
  const result: number[] = [];
  const k = 2 / (period + 1);
  let prev = values[0];
  result.push(prev);
  for (let i = 1; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    result.push(prev);
  }
  return result;
}

function sma(values: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) { result.push(NaN); continue; }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += values[j];
    result.push(sum / period);
  }
  return result;
}

function rsi(closes: number[], period: number = 14): number[] {
  const result: number[] = [];
  let avgGain = 0, avgLoss = 0;
  for (let i = 0; i < closes.length; i++) {
    if (i === 0) { result.push(50); continue; }
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    if (i <= period) {
      avgGain += gain / period;
      avgLoss += loss / period;
      if (i < period) { result.push(50); continue; }
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
    }
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    result.push(100 - 100 / (1 + rs));
  }
  return result;
}

function atr(candles: RawCandle[], period: number = 14): number[] {
  const result: number[] = [];
  let trSum = 0;
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) { result.push(candles[i].high - candles[i].low); continue; }
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    );
    if (i < period) { trSum += tr; result.push(tr); continue; }
    if (i === period) { trSum += tr; result.push(trSum / period); continue; }
    result.push((result[result.length - 1] * (period - 1) + tr) / period);
  }
  return result;
}

function bollingerBands(closes: number[], period: number = 20, mult: number = 2.0): { upper: number[]; middle: number[]; lower: number[] } {
  const middle = sma(closes, period);
  const upper: number[] = [];
  const lower: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (isNaN(middle[i])) { upper.push(NaN); lower.push(NaN); continue; }
    let sumSq = 0;
    for (let j = i - period + 1; j <= i; j++) sumSq += (closes[j] - middle[i]) ** 2;
    const std = Math.sqrt(sumSq / period);
    upper.push(middle[i] + mult * std);
    lower.push(middle[i] - mult * std);
  }
  return { upper, middle, lower };
}

function donchian(candles: RawCandle[], period: number): { upper: number[]; lower: number[] } {
  const upper: number[] = [];
  const lower: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i < period) { upper.push(NaN); lower.push(NaN); continue; }
    let hi = -Infinity, lo = Infinity;
    for (let j = i - period; j < i; j++) {
      hi = Math.max(hi, candles[j].high);
      lo = Math.min(lo, candles[j].low);
    }
    upper.push(hi);
    lower.push(lo);
  }
  return { upper, lower };
}

// --- TRADE SIMULATION ---
interface Trade {
  direction: 'LONG' | 'SHORT';
  entry: number;
  entryIdx: number;
  entryTime: Date;
  sl: number;
  exit?: number;
  exitIdx?: number;
  exitTime?: Date;
  exitReason?: string;
  grossPips: number;
  netPips: number;
  riskPips: number;
  rMultiple: number;
}

function simulateTrade(
  candles: RawCandle[],
  entryIdx: number,
  direction: 'LONG' | 'SHORT',
  entry: number,
  sl: number,
  pipMult: number,
  costPips: number,
  exitMode: 'trailing_ema' | 'fixed_tp' | 'partial_tp' | 'time_exit' | 'session_exit',
  exitParams: { 
    emaPeriod?: number; 
    tp1R?: number; 
    tp2R?: number; 
    tp3R?: number; 
    maxHoldCandles?: number;
    closeHour?: number; // for session exit
    partialClosePercent?: number; // for partial TP
  }
): Trade | null {
  const riskPips = Math.abs((entry - sl) / pipMult);
  if (riskPips < 3) return null;

  let exitPrice = 0;
  let exitIdx = -1;
  let exitReason = '';
  let trailStop = sl;
  let emaValues: number[] = [];
  let tp1Hit = false;
  let partialCloseDone = false;
  let avgEntry = entry;

  if (exitMode === 'trailing_ema') {
    const closes = candles.map(c => c.close);
    emaValues = ema(closes, exitParams.emaPeriod || 20);
  }

  const maxHold = exitParams.maxHoldCandles || 150;

  for (let i = entryIdx + 1; i < candles.length && i <= entryIdx + maxHold; i++) {
    const c = candles[i];

    // Session exit: close at specific hour
    if (exitMode === 'session_exit' && exitParams.closeHour !== undefined) {
      if (c.time.getUTCHours() === exitParams.closeHour) {
        exitPrice = c.close;
        exitIdx = i;
        exitReason = 'SESSION_EXIT';
        break;
      }
    }

    if (direction === 'LONG') {
      if (c.low <= (exitMode === 'trailing_ema' ? trailStop : sl)) {
        exitPrice = exitMode === 'trailing_ema' ? trailStop : sl;
        exitIdx = i;
        exitReason = 'SL';
        break;
      }

      if (exitMode === 'trailing_ema') {
        const emaVal = emaValues[i];
        if (emaVal > trailStop) trailStop = emaVal;
        if (c.close < emaVal) {
          exitPrice = c.close;
          exitIdx = i;
          exitReason = 'EMA_TRAIL';
          break;
        }
      } else if (exitMode === 'fixed_tp') {
        const tp1 = entry + pipMult * riskPips * (exitParams.tp1R || 1);
        const tp2 = entry + pipMult * riskPips * (exitParams.tp2R || 2);
        const tp3 = entry + pipMult * riskPips * (exitParams.tp3R || 3);
        if (c.high >= tp3) { exitPrice = tp3; exitIdx = i; exitReason = 'TP3'; break; }
        if (c.high >= tp2) { exitPrice = tp2; exitIdx = i; exitReason = 'TP2'; break; }
        if (c.high >= tp1) { exitPrice = tp1; exitIdx = i; exitReason = 'TP1'; break; }
      } else if (exitMode === 'partial_tp') {
        const tp1 = entry + pipMult * riskPips * (exitParams.tp1R || 1);
        const tp2 = entry + pipMult * riskPips * (exitParams.tp2R || 2);
        if (!tp1Hit && c.high >= tp1) {
          tp1Hit = true;
          // Move SL to breakeven
          trailStop = entry;
        }
        if (tp1Hit && c.high >= tp2) {
          exitPrice = tp2;
          exitIdx = i;
          exitReason = 'TP2';
          break;
        }
        if (c.low <= trailStop) {
          exitPrice = trailStop;
          exitIdx = i;
          exitReason = tp1Hit ? 'BE_TRAIL' : 'SL';
          break;
        }
      } else if (exitMode === 'time_exit') {
        if (i >= entryIdx + (exitParams.maxHoldCandles || 30)) {
          exitPrice = c.close;
          exitIdx = i;
          exitReason = 'TIME_EXIT';
          break;
        }
      }
    } else {
      if (c.high >= (exitMode === 'trailing_ema' ? trailStop : sl)) {
        exitPrice = exitMode === 'trailing_ema' ? trailStop : sl;
        exitIdx = i;
        exitReason = 'SL';
        break;
      }

      if (exitMode === 'trailing_ema') {
        const emaVal = emaValues[i];
        if (emaVal < trailStop) trailStop = emaVal;
        if (c.close > emaVal) {
          exitPrice = c.close;
          exitIdx = i;
          exitReason = 'EMA_TRAIL';
          break;
        }
      } else if (exitMode === 'fixed_tp') {
        const tp1 = entry - pipMult * riskPips * (exitParams.tp1R || 1);
        const tp2 = entry - pipMult * riskPips * (exitParams.tp2R || 2);
        const tp3 = entry - pipMult * riskPips * (exitParams.tp3R || 3);
        if (c.low <= tp3) { exitPrice = tp3; exitIdx = i; exitReason = 'TP3'; break; }
        if (c.low <= tp2) { exitPrice = tp2; exitIdx = i; exitReason = 'TP2'; break; }
        if (c.low <= tp1) { exitPrice = tp1; exitIdx = i; exitReason = 'TP1'; break; }
      } else if (exitMode === 'partial_tp') {
        const tp1 = entry - pipMult * riskPips * (exitParams.tp1R || 1);
        const tp2 = entry - pipMult * riskPips * (exitParams.tp2R || 2);
        if (!tp1Hit && c.low <= tp1) {
          tp1Hit = true;
          trailStop = entry;
        }
        if (tp1Hit && c.low <= tp2) {
          exitPrice = tp2;
          exitIdx = i;
          exitReason = 'TP2';
          break;
        }
        if (c.high >= trailStop) {
          exitPrice = trailStop;
          exitIdx = i;
          exitReason = tp1Hit ? 'BE_TRAIL' : 'SL';
          break;
        }
      } else if (exitMode === 'time_exit') {
        if (i >= entryIdx + (exitParams.maxHoldCandles || 30)) {
          exitPrice = c.close;
          exitIdx = i;
          exitReason = 'TIME_EXIT';
          break;
        }
      }
    }
  }

  if (exitIdx === -1) {
    const lastIdx = Math.min(entryIdx + maxHold, candles.length - 1);
    exitPrice = candles[lastIdx].close;
    exitIdx = lastIdx;
    exitReason = 'MAX_HOLD';
  }

  const grossPips = direction === 'LONG'
    ? (exitPrice - entry) / pipMult
    : (entry - exitPrice) / pipMult;
  const netPips = grossPips - costPips;
  const rMultiple = netPips / riskPips;

  return {
    direction,
    entry,
    entryIdx,
    entryTime: candles[entryIdx].time,
    sl,
    exit: exitPrice,
    exitIdx,
    exitTime: candles[exitIdx].time,
    exitReason,
    grossPips,
    netPips,
    riskPips,
    rMultiple,
  };
}

// --- STRATEGIES ---

interface StrategyResult {
  pair: string;
  strategy: string;
  timeframe: string;
  trades: Trade[];
  winRate: number;
  avgR: number;
  profitFactor: number;
  maxDD: number;
  avgSLpips: number;
  tradesPerDay: number;
}

function calcMetrics(trades: Trade[], pair: string, strategy: string, timeframe: string, totalDays: number): StrategyResult {
  const wins = trades.filter(t => t.netPips > 0);
  const losses = trades.filter(t => t.netPips <= 0);
  const winRate = trades.length > 0 ? wins.length / trades.length * 100 : 0;
  const avgR = trades.length > 0 ? trades.reduce((s, t) => s + t.rMultiple, 0) / trades.length : 0;
  const grossWins = wins.reduce((s, t) => s + t.netPips, 0);
  const grossLosses = Math.abs(losses.reduce((s, t) => s + t.netPips, 0));
  const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0;
  
  let peak = 0, maxDD = 0, cum = 0;
  for (const t of trades) {
    cum += t.rMultiple;
    peak = Math.max(peak, cum);
    maxDD = Math.min(maxDD, peak - cum);
  }

  const avgSLpips = trades.length > 0 ? trades.reduce((s, t) => s + t.riskPips, 0) / trades.length : 0;
  const tradesPerDay = totalDays > 0 ? trades.length / totalDays : 0;

  return { pair, strategy, timeframe, trades, winRate, avgR, profitFactor, maxDD, avgSLpips, tradesPerDay };
}

// STRATEGY 1: London Breakout with Volatility Filter
function strategyLondonBreakoutVol(candles: RawCandle[], config: PairConfig): Trade[] {
  const trades: Trade[] = [];
  const atrVals = atr(candles, 14);
  let lastInTrade = -10;
  
  for (let i = 50; i < candles.length - 10; i++) {
    if (i - lastInTrade < 20) continue;
    
    const hour = candles[i].time.getUTCHours();
    if (hour !== 7) continue; // London open
    
    // Asian range (22:00-06:00)
    let asianHigh = -Infinity, asianLow = Infinity;
    for (let j = i - 60; j < i; j++) {
      if (j < 0) continue;
      const h = candles[j].time.getUTCHours();
      if (h >= 22 || h < 6) {
        asianHigh = Math.max(asianHigh, candles[j].high);
        asianLow = Math.min(asianLow, candles[j].low);
      }
    }
    
    if (asianHigh === -Infinity) continue;
    const range = asianHigh - asianLow;
    if (range < config.pipMult * 1000 * 10 || range > config.pipMult * 1000 * 40) continue;
    
    // Volatility filter: ATR must be expanding
    const atrAvg = atrVals.slice(i - 10, i).reduce((s, v) => s + v, 0) / 10;
    if (atrVals[i] < atrAvg * 1.1) continue; // need 10% expansion
    
    const close = candles[i].close;
    
    if (close > asianHigh) {
      const entry = close;
      const sl = asianLow;
      const trade = simulateTrade(candles, i, 'LONG', entry, sl, config.pipMult, config.costPips, 'partial_tp', { tp1R: 0.7, tp2R: 1.5, maxHoldCandles: 80 });
      if (trade) { trades.push(trade); lastInTrade = i; }
    } else if (close < asianLow) {
      const entry = close;
      const sl = asianHigh;
      const trade = simulateTrade(candles, i, 'SHORT', entry, sl, config.pipMult, config.costPips, 'partial_tp', { tp1R: 0.7, tp2R: 1.5, maxHoldCandles: 80 });
      if (trade) { trades.push(trade); lastInTrade = i; }
    }
  }
  return trades;
}

// STRATEGY 2: Engulfing Candle + Trend (H1)
function strategyEngulfingTrend(candles: RawCandle[], config: PairConfig): Trade[] {
  const trades: Trade[] = [];
  const closes = candles.map(c => c.close);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);
  const atrVals = atr(candles, 14);
  let lastInTrade = -10;
  
  for (let i = 210; i < candles.length - 10; i++) {
    if (i - lastInTrade < 8) continue;
    
    const slope200 = (ema200[i] - ema200[i - 20]) / ema200[i - 20];
    if (Math.abs(slope200) < 0.0003) continue;
    
    const bullish = closes[i] > ema200[i] && ema50[i] > ema200[i];
    const bearish = closes[i] < ema200[i] && ema50[i] < ema200[i];
    
    // Bullish engulfing
    if (bullish && candles[i].close > candles[i].open && 
        candles[i-1].close < candles[i-1].open &&
        candles[i].close > candles[i-1].open &&
        candles[i].open < candles[i-1].close) {
      const entry = candles[i].close;
      const sl = candles[i].low - atrVals[i] * 0.5;
      const trade = simulateTrade(candles, i, 'LONG', entry, sl, config.pipMult, config.costPips, 'trailing_ema', { emaPeriod: 20, maxHoldCandles: 100 });
      if (trade) { trades.push(trade); lastInTrade = i; }
    }
    
    // Bearish engulfing
    if (bearish && candles[i].close < candles[i].open && 
        candles[i-1].close > candles[i-1].open &&
        candles[i].close < candles[i-1].open &&
        candles[i].open > candles[i-1].close) {
      const entry = candles[i].close;
      const sl = candles[i].high + atrVals[i] * 0.5;
      const trade = simulateTrade(candles, i, 'SHORT', entry, sl, config.pipMult, config.costPips, 'trailing_ema', { emaPeriod: 20, maxHoldCandles: 100 });
      if (trade) { trades.push(trade); lastInTrade = i; }
    }
  }
  return trades;
}

// STRATEGY 3: Pin Bar Reversal at Key Levels (H1)
function strategyPinBarReversal(candles: RawCandle[], config: PairConfig): Trade[] {
  const trades: Trade[] = [];
  const closes = candles.map(c => c.close);
  const bb = bollingerBands(closes, 20, 2.0);
  const atrVals = atr(candles, 14);
  let lastInTrade = -10;
  
  for (let i = 50; i < candles.length - 10; i++) {
    if (i - lastInTrade < 8) continue;
    if (isNaN(bb.lower[i])) continue;
    
    const body = Math.abs(candles[i].close - candles[i].open);
    const upperWick = candles[i].high - Math.max(candles[i].open, candles[i].close);
    const lowerWick = Math.min(candles[i].open, candles[i].close) - candles[i].low;
    const range = candles[i].high - candles[i].low;
    
    // Bullish pin bar at lower BB
    if (candles[i].low <= bb.lower[i] && lowerWick > body * 2 && upperWick < body * 0.5) {
      const entry = candles[i].close;
      const sl = candles[i].low - atrVals[i] * 0.3;
      const trade = simulateTrade(candles, i, 'LONG', entry, sl, config.pipMult, config.costPips, 'fixed_tp', { tp1R: 1.0, tp2R: 2.0, maxHoldCandles: 60 });
      if (trade) { trades.push(trade); lastInTrade = i; }
    }
    
    // Bearish pin bar at upper BB
    if (candles[i].high >= bb.upper[i] && upperWick > body * 2 && lowerWick < body * 0.5) {
      const entry = candles[i].close;
      const sl = candles[i].high + atrVals[i] * 0.3;
      const trade = simulateTrade(candles, i, 'SHORT', entry, sl, config.pipMult, config.costPips, 'fixed_tp', { tp1R: 1.0, tp2R: 2.0, maxHoldCandles: 60 });
      if (trade) { trades.push(trade); lastInTrade = i; }
    }
  }
  return trades;
}

// STRATEGY 4: Inside Bar Breakout (H2)
function strategyInsideBarBreakout(candles: RawCandle[], config: PairConfig): Trade[] {
  const trades: Trade[] = [];
  const closes = candles.map(c => c.close);
  const ema50 = ema(closes, 50);
  const atrVals = atr(candles, 14);
  let lastInTrade = -10;
  
  for (let i = 60; i < candles.length - 10; i++) {
    if (i - lastInTrade < 10) continue;
    
    // Inside bar: current candle completely within previous candle
    const isInside = candles[i].high < candles[i-1].high && candles[i].low > candles[i-1].low;
    if (!isInside) continue;
    
    // Wait for breakout
    if (i + 1 >= candles.length) continue;
    const next = candles[i + 1];
    
    const trend = closes[i] > ema50[i] ? 'LONG' : 'SHORT';
    
    if (trend === 'LONG' && next.close > candles[i].high) {
      const entry = next.close;
      const sl = candles[i].low - atrVals[i] * 0.5;
      const trade = simulateTrade(candles, i + 1, 'LONG', entry, sl, config.pipMult, config.costPips, 'trailing_ema', { emaPeriod: 20, maxHoldCandles: 80 });
      if (trade) { trades.push(trade); lastInTrade = i + 1; }
    } else if (trend === 'SHORT' && next.close < candles[i].low) {
      const entry = next.close;
      const sl = candles[i].high + atrVals[i] * 0.5;
      const trade = simulateTrade(candles, i + 1, 'SHORT', entry, sl, config.pipMult, config.costPips, 'trailing_ema', { emaPeriod: 20, maxHoldCandles: 80 });
      if (trade) { trades.push(trade); lastInTrade = i + 1; }
    }
  }
  return trades;
}

// STRATEGY 5: NY Session Continuation (M30)
function strategyNYContinuation(candles: RawCandle[], config: PairConfig): Trade[] {
  const trades: Trade[] = [];
  const closes = candles.map(c => c.close);
  const ema20 = ema(closes, 20);
  const rsiVals = rsi(closes, 14);
  const atrVals = atr(candles, 14);
  let lastInTrade = -10;
  
  for (let i = 50; i < candles.length - 10; i++) {
    if (i - lastInTrade < 12) continue;
    
    const hour = candles[i].time.getUTCHours();
    if (hour < 13 || hour > 16) continue; // NY session only
    
    // Check London momentum (previous 6 candles = 3 hours)
    let londonMove = 0;
    for (let j = i - 6; j < i; j++) {
      if (j < 0) continue;
      londonMove += closes[j] - candles[j].open;
    }
    
    const atrVal = atrVals[i];
    if (Math.abs(londonMove) < atrVal * 0.5) continue; // need strong London move
    
    // Continue in same direction
    if (londonMove > 0 && closes[i] > ema20[i] && rsiVals[i] > 50 && rsiVals[i] < 70) {
      const entry = closes[i];
      const sl = entry - atrVal * 1.2;
      const trade = simulateTrade(candles, i, 'LONG', entry, sl, config.pipMult, config.costPips, 'session_exit', { closeHour: 20, maxHoldCandles: 50 });
      if (trade) { trades.push(trade); lastInTrade = i; }
    } else if (londonMove < 0 && closes[i] < ema20[i] && rsiVals[i] < 50 && rsiVals[i] > 30) {
      const entry = closes[i];
      const sl = entry + atrVal * 1.2;
      const trade = simulateTrade(candles, i, 'SHORT', entry, sl, config.pipMult, config.costPips, 'session_exit', { closeHour: 20, maxHoldCandles: 50 });
      if (trade) { trades.push(trade); lastInTrade = i; }
    }
  }
  return trades;
}

// STRATEGY 6: Daily Level Bounce (D1)
function strategyDailyLevelBounce(dailyCandles: RawCandle[], config: PairConfig): Trade[] {
  const trades: Trade[] = [];
  const closes = dailyCandles.map(c => c.close);
  const ema20 = ema(closes, 20);
  const atrVals = atr(dailyCandles, 14);
  let lastInTrade = -10;
  
  for (let i = 30; i < dailyCandles.length - 5; i++) {
    if (i - lastInTrade < 3) continue;
    
    // Previous day's high/low
    const prevHigh = dailyCandles[i-1].high;
    const prevLow = dailyCandles[i-1].low;
    const prevClose = dailyCandles[i-1].close;
    
    // Test previous high as support (if price broke above yesterday)
    if (prevClose > prevHigh && dailyCandles[i].open < prevHigh && dailyCandles[i].low <= prevHigh) {
      // Retest of broken resistance
      if (dailyCandles[i].close > prevHigh) {
        const entry = dailyCandles[i].close;
        const sl = prevLow - atrVals[i] * 0.5;
        const trade = simulateTrade(dailyCandles, i, 'LONG', entry, sl, config.pipMult, config.costPips, 'trailing_ema', { emaPeriod: 10, maxHoldCandles: 20 });
        if (trade) { trades.push(trade); lastInTrade = i; }
      }
    }
    
    // Test previous low as resistance
    if (prevClose < prevLow && dailyCandles[i].open > prevLow && dailyCandles[i].high >= prevLow) {
      if (dailyCandles[i].close < prevLow) {
        const entry = dailyCandles[i].close;
        const sl = prevHigh + atrVals[i] * 0.5;
        const trade = simulateTrade(dailyCandles, i, 'SHORT', entry, sl, config.pipMult, config.costPips, 'trailing_ema', { emaPeriod: 10, maxHoldCandles: 20 });
        if (trade) { trades.push(trade); lastInTrade = i; }
      }
    }
  }
  return trades;
}

// STRATEGY 7: Volatility Contraction Pattern (H4)
function strategyVCP(candles: RawCandle[], config: PairConfig): Trade[] {
  const trades: Trade[] = [];
  const closes = candles.map(c => c.close);
  const ema50 = ema(closes, 50);
  const atrVals = atr(candles, 14);
  let lastInTrade = -10;
  
  for (let i = 60; i < candles.length - 10; i++) {
    if (i - lastInTrade < 15) continue;
    
    // Look for contraction: ATR decreasing over last 10 candles
    const atrRecent = atrVals.slice(i - 10, i);
    const atrOld = atrVals.slice(i - 20, i - 10);
    const avgRecent = atrRecent.reduce((s, v) => s + v, 0) / 10;
    const avgOld = atrOld.reduce((s, v) => s + v, 0) / 10;
    
    if (avgRecent > avgOld * 0.8) continue; // need 20% contraction
    
    // Trend must be up
    if (closes[i] < ema50[i]) continue;
    
    // Breakout: close above recent high with expanding vol
    let recentHigh = -Infinity;
    for (let j = i - 10; j < i; j++) recentHigh = Math.max(recentHigh, candles[j].high);
    
    if (closes[i] > recentHigh && atrVals[i] > avgRecent * 1.2) {
      const entry = closes[i];
      const sl = entry - atrVals[i] * 2;
      const trade = simulateTrade(candles, i, 'LONG', entry, sl, config.pipMult, config.costPips, 'trailing_ema', { emaPeriod: 20, maxHoldCandles: 100 });
      if (trade) { trades.push(trade); lastInTrade = i; }
    }
  }
  return trades;
}

// --- MAIN ---
function main() {
  console.log('===================================================================');
  console.log('DEEP FOREX STRATEGY SEARCH - ROUND 2');
  console.log('===================================================================');
  console.log('Testing 7 new strategies across multiple timeframes');
  console.log('Focus on pairs that showed promise');
  console.log('');
  
  const allResults: StrategyResult[] = [];
  
  for (const config of PAIRS) {
    const m5 = loadM5Candles(config.pair);
    if (m5.length < 50000) {
      console.log(`⚠️  ${config.pair}: Only ${m5.length} M5 candles, skipping`);
      continue;
    }
    
    const totalDays = (m5[m5.length - 1].time.getTime() - m5[0].time.getTime()) / (1000 * 60 * 60 * 24);
    console.log(`\n${config.pair}: ${totalDays.toFixed(0)} days, cost: ${config.costPips}p`);
    
    const m30 = aggregateCandles(m5, 30);
    const h1 = aggregateCandles(m5, 60);
    const h2 = aggregateCandles(m5, 120);
    const h4 = aggregateCandles(m5, 240);
    const h8 = aggregateCandles(m5, 480);
    const d1 = aggregateCandles(m5, 1440);
    
    // Test 7 strategies
    let trades = strategyLondonBreakoutVol(h1, config);
    let r = calcMetrics(trades, config.pair, 'London Breakout + Vol', 'H1', totalDays);
    allResults.push(r);
    console.log(`  London Breakout + Vol: ${trades.length} trades, WR ${r.winRate.toFixed(1)}%, avgR ${r.avgR.toFixed(3)}, PF ${r.profitFactor.toFixed(2)}`);
    
    trades = strategyEngulfingTrend(h1, config);
    r = calcMetrics(trades, config.pair, 'Engulfing + Trend', 'H1', totalDays);
    allResults.push(r);
    console.log(`  Engulfing + Trend: ${trades.length} trades, WR ${r.winRate.toFixed(1)}%, avgR ${r.avgR.toFixed(3)}, PF ${r.profitFactor.toFixed(2)}`);
    
    trades = strategyPinBarReversal(h1, config);
    r = calcMetrics(trades, config.pair, 'Pin Bar Reversal', 'H1', totalDays);
    allResults.push(r);
    console.log(`  Pin Bar Reversal: ${trades.length} trades, WR ${r.winRate.toFixed(1)}%, avgR ${r.avgR.toFixed(3)}, PF ${r.profitFactor.toFixed(2)}`);
    
    trades = strategyInsideBarBreakout(h2, config);
    r = calcMetrics(trades, config.pair, 'Inside Bar Breakout', 'H2', totalDays);
    allResults.push(r);
    console.log(`  Inside Bar Breakout: ${trades.length} trades, WR ${r.winRate.toFixed(1)}%, avgR ${r.avgR.toFixed(3)}, PF ${r.profitFactor.toFixed(2)}`);
    
    trades = strategyNYContinuation(m30, config);
    r = calcMetrics(trades, config.pair, 'NY Continuation', 'M30', totalDays);
    allResults.push(r);
    console.log(`  NY Continuation: ${trades.length} trades, WR ${r.winRate.toFixed(1)}%, avgR ${r.avgR.toFixed(3)}, PF ${r.profitFactor.toFixed(2)}`);
    
    trades = strategyDailyLevelBounce(d1, config);
    r = calcMetrics(trades, config.pair, 'Daily Level Bounce', 'D1', totalDays);
    allResults.push(r);
    console.log(`  Daily Level Bounce: ${trades.length} trades, WR ${r.winRate.toFixed(1)}%, avgR ${r.avgR.toFixed(3)}, PF ${r.profitFactor.toFixed(2)}`);
    
    trades = strategyVCP(h4, config);
    r = calcMetrics(trades, config.pair, 'Volatility Contraction', 'H4', totalDays);
    allResults.push(r);
    console.log(`  Volatility Contraction: ${trades.length} trades, WR ${r.winRate.toFixed(1)}%, avgR ${r.avgR.toFixed(3)}, PF ${r.profitFactor.toFixed(2)}`);
  }
  
  // RANKING
  console.log('\n===================================================================');
  console.log('RANKING ALL RESULTS (by avgR, must have 5+ trades)');
  console.log('===================================================================');
  
  const ranked = allResults
    .filter(r => r.trades.length >= 5)
    .sort((a, b) => b.avgR - a.avgR);
  
  console.log(`\nTop 25 results:`);
  for (let i = 0; i < Math.min(25, ranked.length); i++) {
    const r = ranked[i];
    const status = r.avgR > 0 ? '✅' : '❌';
    console.log(`  ${i + 1}. ${status} ${r.pair} - ${r.strategy} (${r.timeframe})`);
    console.log(`     Trades: ${r.trades.length} | WR: ${r.winRate.toFixed(1)}% | avgR: ${r.avgR.toFixed(3)} | PF: ${r.profitFactor.toFixed(2)} | maxDD: ${r.maxDD.toFixed(2)}R`);
  }
  
  const positive = ranked.filter(r => r.avgR > 0);
  console.log(`\n===================================================================`);
  console.log(`SUMMARY`);
  console.log(`===================================================================`);
  console.log(`Total tested: ${allResults.length}`);
  console.log(`With 5+ trades: ${ranked.length}`);
  console.log(`Positive avgR: ${positive.length}`);
  console.log(`Negative avgR: ${ranked.length - positive.length}`);
  
  if (positive.length > 0) {
    console.log(`\n✅ TOP POSITIVE RESULTS:`);
    for (const r of positive.slice(0, 10)) {
      console.log(`  ${r.pair} - ${r.strategy} (${r.timeframe}): avgR ${r.avgR.toFixed(3)}, WR ${r.winRate.toFixed(1)}%, ${r.trades.length} trades`);
    }
  }
}

main();
