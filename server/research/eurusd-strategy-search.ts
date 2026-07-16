/**
 * EURUSD-ONLY STRATEGY SEARCH
 * 
 * EURUSD has the tightest spreads in forex (~0.1-0.3 pips on Pepperstone RAW)
 * Total round-trip cost: ~1.0 pip (0.3 spread + 0.7 commission)
 * Full 6-month data: 51,478 M5 candles
 * 
 * This script tests multiple strategy approaches on EURUSD ONLY,
 * using the real 1.0 pip cost from the first test.
 * 
 * Timeframes tested: M15, H1, H4 (M5 already proven unviable)
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
  tp1?: number;
  tp2?: number;
  tp3?: number;
  exit?: number;
  exitIdx?: number;
  exitTime?: Date;
  exitReason?: string;
  grossPips: number;
  netPips: number;
  riskPips: number;
  rMultiple: number;
}

const PIP_MULT = 0.0001;
const COST_PIPS = 1.0; // EURUSD realistic: 0.3 spread + 0.7 commission

function pipsToPrice(pips: number): number {
  return pips * PIP_MULT;
}

function priceToPips(price: number): number {
  return price / PIP_MULT;
}

function simulateTrade(
  candles: RawCandle[],
  entryIdx: number,
  direction: 'LONG' | 'SHORT',
  entry: number,
  sl: number,
  exitMode: 'trailing_ema' | 'fixed_tp' | 'mean_reversion',
  exitParams: { emaPeriod?: number; tp1R?: number; tp2R?: number; tp3R?: number; maxHoldCandles?: number; targetMean?: number }
): Trade | null {
  const riskPips = Math.abs(priceToPips(entry - sl));
  if (riskPips < 2) return null; // too tight

  let exitPrice = 0;
  let exitIdx = -1;
  let exitReason = '';
  let trailStop = sl;
  let emaValues: number[] = [];

  if (exitMode === 'trailing_ema') {
    const closes = candles.map(c => c.close);
    emaValues = ema(closes, exitParams.emaPeriod || 20);
  }

  const maxHold = exitParams.maxHoldCandles || 200;

  for (let i = entryIdx + 1; i < candles.length && i <= entryIdx + maxHold; i++) {
    const c = candles[i];

    if (direction === 'LONG') {
      // Check SL
      if (c.low <= (exitMode === 'trailing_ema' ? trailStop : sl)) {
        exitPrice = exitMode === 'trailing_ema' ? trailStop : sl;
        exitIdx = i;
        exitReason = 'SL';
        break;
      }

      if (exitMode === 'trailing_ema') {
        // Trail using EMA
        const emaVal = emaValues[i];
        if (emaVal > trailStop) trailStop = emaVal;
        if (c.close < emaVal) {
          exitPrice = c.close;
          exitIdx = i;
          exitReason = 'EMA_TRAIL';
          break;
        }
      } else if (exitMode === 'fixed_tp') {
        const tp1 = entry + (direction === 'LONG' ? 1 : -1) * pipsToPrice(riskPips * (exitParams.tp1R || 1));
        const tp2 = entry + (direction === 'LONG' ? 1 : -1) * pipsToPrice(riskPips * (exitParams.tp2R || 2));
        const tp3 = entry + (direction === 'LONG' ? 1 : -1) * pipsToPrice(riskPips * (exitParams.tp3R || 3));
        if (c.high >= tp3) { exitPrice = tp3; exitIdx = i; exitReason = 'TP3'; break; }
        if (c.high >= tp2) { exitPrice = tp2; exitIdx = i; exitReason = 'TP2'; break; }
        if (c.high >= tp1) { exitPrice = tp1; exitIdx = i; exitReason = 'TP1'; break; }
      } else if (exitMode === 'mean_reversion') {
        // Exit at target mean (SMA)
        if (exitParams.targetMean && c.high >= exitParams.targetMean) {
          exitPrice = exitParams.targetMean;
          exitIdx = i;
          exitReason = 'MEAN_TARGET';
          break;
        }
        // Time-based exit
        if (i >= entryIdx + (exitParams.maxHoldCandles || 50)) {
          exitPrice = c.close;
          exitIdx = i;
          exitReason = 'TIME_EXIT';
          break;
        }
      }
    } else {
      // SHORT
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
        const tp1 = entry - pipsToPrice(riskPips * (exitParams.tp1R || 1));
        const tp2 = entry - pipsToPrice(riskPips * (exitParams.tp2R || 2));
        const tp3 = entry - pipsToPrice(riskPips * (exitParams.tp3R || 3));
        if (c.low <= tp3) { exitPrice = tp3; exitIdx = i; exitReason = 'TP3'; break; }
        if (c.low <= tp2) { exitPrice = tp2; exitIdx = i; exitReason = 'TP2'; break; }
        if (c.low <= tp1) { exitPrice = tp1; exitIdx = i; exitReason = 'TP1'; break; }
      } else if (exitMode === 'mean_reversion') {
        if (exitParams.targetMean && c.low <= exitParams.targetMean) {
          exitPrice = exitParams.targetMean;
          exitIdx = i;
          exitReason = 'MEAN_TARGET';
          break;
        }
        if (i >= entryIdx + (exitParams.maxHoldCandles || 50)) {
          exitPrice = c.close;
          exitIdx = i;
          exitReason = 'TIME_EXIT';
          break;
        }
      }
    }
  }

  if (exitIdx === -1) {
    // Force close at last candle
    const lastIdx = Math.min(entryIdx + maxHold, candles.length - 1);
    exitPrice = candles[lastIdx].close;
    exitIdx = lastIdx;
    exitReason = 'MAX_HOLD';
  }

  const grossPips = direction === 'LONG'
    ? priceToPips(exitPrice - entry)
    : priceToPips(entry - exitPrice);
  const netPips = grossPips - COST_PIPS;
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

// --- STRATEGY DEFINITIONS ---

interface StrategyResult {
  name: string;
  timeframe: string;
  trades: Trade[];
  winRate: number;
  avgR: number;
  profitFactor: number;
  maxDD: number;
  avgSLpips: number;
  avgWinPips: number;
  avgLossPips: number;
  tradesPerDay: number;
}

function calcMetrics(trades: Trade[], name: string, timeframe: string, totalDays: number): StrategyResult {
  const wins = trades.filter(t => t.netPips > 0);
  const losses = trades.filter(t => t.netPips <= 0);
  const winRate = trades.length > 0 ? wins.length / trades.length * 100 : 0;
  const avgR = trades.length > 0 ? trades.reduce((s, t) => s + t.rMultiple, 0) / trades.length : 0;
  const grossWins = wins.reduce((s, t) => s + t.netPips, 0);
  const grossLosses = Math.abs(losses.reduce((s, t) => s + t.netPips, 0));
  const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0;
  
  // Max drawdown
  let peak = 0, maxDD = 0, cum = 0;
  for (const t of trades) {
    cum += t.rMultiple;
    peak = Math.max(peak, cum);
    maxDD = Math.min(maxDD, peak - cum);
  }

  const avgSLpips = trades.length > 0 ? trades.reduce((s, t) => s + t.riskPips, 0) / trades.length : 0;
  const avgWinPips = wins.length > 0 ? wins.reduce((s, t) => s + t.netPips, 0) / wins.length : 0;
  const avgLossPips = losses.length > 0 ? losses.reduce((s, t) => s + t.netPips, 0) / losses.length : 0;
  const tradesPerDay = totalDays > 0 ? trades.length / totalDays : 0;

  return { name, timeframe, trades, winRate, avgR, profitFactor, maxDD, avgSLpips, avgWinPips, avgLossPips, tradesPerDay };
}

// STRATEGY 1: London Breakout (Asian range breakout during London open)
function strategyLondonBreakout(candles: RawCandle[]): Trade[] {
  const trades: Trade[] = [];
  const m5 = candles; // assume M5 input
  
  // Find Asian session range (22:00-06:00 UTC), then trade breakout at 07:00-08:00
  let lastInTrade = -10;
  
  for (let i = 50; i < m5.length - 10; i++) {
    if (i - lastInTrade < 20) continue; // min gap between trades
    
    const hour = m5[i].time.getUTCHours();
    if (hour !== 7) continue; // London open hour
    
    // Calculate Asian range (previous 22:00-06:00)
    let asianHigh = -Infinity, asianLow = Infinity;
    for (let j = i - 60; j < i; j++) { // look back ~5 hours
      if (j < 0) continue;
      const h = m5[j].time.getUTCHours();
      if (h >= 22 || h < 6) {
        asianHigh = Math.max(asianHigh, m5[j].high);
        asianLow = Math.min(asianLow, m5[j].low);
      }
    }
    
    if (asianHigh === -Infinity || asianLow === Infinity) continue;
    const range = asianHigh - asianLow;
    if (range < pipsToPrice(10) || range > pipsToPrice(50)) continue; // filter dead/range too wide
    
    // Breakout: close above Asian high or below Asian low
    const close = m5[i].close;
    const atrVal = atr(m5.slice(Math.max(0, i - 50), i + 1), 14);
    const currentATR = atrVal[atrVal.length - 1];
    
    if (close > asianHigh && currentATR > 0) {
      const entry = close;
      const sl = asianLow; // SL at other side of range
      const trade = simulateTrade(m5, i, 'LONG', entry, sl, 'fixed_tp', { tp1R: 0.5, tp2R: 1.0, tp3R: 1.5, maxHoldCandles: 100 });
      if (trade) { trades.push(trade); lastInTrade = i; }
    } else if (close < asianLow && currentATR > 0) {
      const entry = close;
      const sl = asianHigh;
      const trade = simulateTrade(m5, i, 'SHORT', entry, sl, 'fixed_tp', { tp1R: 0.5, tp2R: 1.0, tp3R: 1.5, maxHoldCandles: 100 });
      if (trade) { trades.push(trade); lastInTrade = i; }
    }
  }
  return trades;
}

// STRATEGY 2: EMA Trend Pullback (H1)
function strategyEMATrendPullback(candles: RawCandle[]): Trade[] {
  const trades: Trade[] = [];
  const closes = candles.map(c => c.close);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);
  const rsiVals = rsi(closes, 14);
  const atrVals = atr(candles, 14);
  let lastInTrade = -10;
  
  for (let i = 210; i < candles.length - 10; i++) {
    if (i - lastInTrade < 10) continue;
    
    const slope200 = (ema200[i] - ema200[i - 20]) / ema200[i - 20];
    if (Math.abs(slope200) < 0.0005) continue; // flat EMA200
    
    const bullish = closes[i] > ema50[i] && ema50[i] > ema200[i] && slope200 > 0;
    const bearish = closes[i] < ema50[i] && ema50[i] < ema200[i] && slope200 < 0;
    
    if (!bullish && !bearish) continue;
    
    // Pullback to EMA50 zone
    const distToEMA50 = Math.abs(candles[i].low - ema50[i]);
    const atrVal = atrVals[i];
    if (distToEMA50 > atrVal * 1.5) continue; // too far from EMA
    
    // RSI filter
    if (bullish && (rsiVals[i] < 40 || rsiVals[i] > 70)) continue;
    if (bearish && (rsiVals[i] > 60 || rsiVals[i] < 30)) continue;
    
    // Entry candle: close in trend direction
    const isBullishCandle = closes[i] > candles[i].open;
    const isBearishCandle = closes[i] < candles[i].open;
    if (bullish && !isBullishCandle) continue;
    if (bearish && !isBearishCandle) continue;
    
    const direction = bullish ? 'LONG' : 'SHORT';
    const entry = closes[i];
    const sl = bullish
      ? Math.min(candles[i].low, ema50[i]) - atrVal * 0.5
      : Math.max(candles[i].high, ema50[i]) + atrVal * 0.5;
    
    const trade = simulateTrade(candles, i, direction, entry, sl, 'trailing_ema', { emaPeriod: 20, maxHoldCandles: 150 });
    if (trade) { trades.push(trade); lastInTrade = i; }
  }
  return trades;
}

// STRATEGY 3: Bollinger Band Mean Reversion (H1, target SMA20)
function strategyBBMeanReversionSMA(candles: RawCandle[]): Trade[] {
  const trades: Trade[] = [];
  const closes = candles.map(c => c.close);
  const bb = bollingerBands(closes, 20, 2.5); // wider bands = more extreme
  const rsiVals = rsi(closes, 14);
  const sma20 = sma(closes, 20);
  const atrVals = atr(candles, 14);
  let lastInTrade = -10;
  
  for (let i = 50; i < candles.length - 10; i++) {
    if (i - lastInTrade < 8) continue;
    if (isNaN(bb.lower[i]) || isNaN(sma20[i])) continue;
    
    const atrVal = atrVals[i];
    
    // BUY: price below lower BB + RSI oversold
    if (closes[i] < bb.lower[i] && rsiVals[i] < 30) {
      const entry = closes[i];
      const sl = entry - atrVal * 2;
      const target = sma20[i]; // target the actual mean
      if (target <= entry) continue;
      
      const trade = simulateTrade(candles, i, 'LONG', entry, sl, 'mean_reversion', {
        targetMean: target,
        maxHoldCandles: 40,
      });
      if (trade) { trades.push(trade); lastInTrade = i; }
    }
    
    // SELL: price above upper BB + RSI overbought
    if (closes[i] > bb.upper[i] && rsiVals[i] > 70) {
      const entry = closes[i];
      const sl = entry + atrVal * 2;
      const target = sma20[i];
      if (target >= entry) continue;
      
      const trade = simulateTrade(candles, i, 'SHORT', entry, sl, 'mean_reversion', {
        targetMean: target,
        maxHoldCandles: 40,
      });
      if (trade) { trades.push(trade); lastInTrade = i; }
    }
  }
  return trades;
}

// STRATEGY 4: Donchian Breakout + Trail (H1)
function strategyDonchianBreakout(candles: RawCandle[]): Trade[] {
  const trades: Trade[] = [];
  const closes = candles.map(c => c.close);
  const dc = donchian(candles, 20);
  const rsiVals = rsi(closes, 14);
  const atrVals = atr(candles, 14);
  const ema200 = ema(closes, 200);
  let lastInTrade = -10;
  
  for (let i = 210; i < candles.length - 10; i++) {
    if (i - lastInTrade < 10) continue;
    if (isNaN(dc.upper[i])) continue;
    
    const atrVal = atrVals[i];
    const atrAvg = atrVals.slice(i - 10, i).reduce((s, v) => s + v, 0) / 10;
    if (atrVal < atrAvg * 0.8) continue; // low vol
    
    // Trend filter
    const slope200 = (ema200[i] - ema200[i - 20]) / ema200[i - 20];
    
    // Breakout above Donchian high
    if (closes[i] > dc.upper[i] && closes[i] > ema200[i] && slope200 > 0) {
      if (rsiVals[i] < 55 || rsiVals[i] > 80) continue;
      const entry = closes[i];
      const sl = dc.lower[i] - atrVal * 0.5;
      const trade = simulateTrade(candles, i, 'LONG', entry, sl, 'trailing_ema', { emaPeriod: 20, maxHoldCandles: 150 });
      if (trade) { trades.push(trade); lastInTrade = i; }
    }
    
    // Breakout below Donchian low
    if (closes[i] < dc.lower[i] && closes[i] < ema200[i] && slope200 < 0) {
      if (rsiVals[i] > 45 || rsiVals[i] < 20) continue;
      const entry = closes[i];
      const sl = dc.upper[i] + atrVal * 0.5;
      const trade = simulateTrade(candles, i, 'SHORT', entry, sl, 'trailing_ema', { emaPeriod: 20, maxHoldCandles: 150 });
      if (trade) { trades.push(trade); lastInTrade = i; }
    }
  }
  return trades;
}

// STRATEGY 5: Session Momentum (NY open momentum continuation)
function strategySessionMomentum(candles: RawCandle[]): Trade[] {
  const trades: Trade[] = [];
  const closes = candles.map(c => c.close);
  const ema20 = ema(closes, 20);
  const rsiVals = rsi(closes, 14);
  const atrVals = atr(candles, 14);
  let lastInTrade = -10;
  
  for (let i = 50; i < candles.length - 10; i++) {
    if (i - lastInTrade < 15) continue;
    
    const hour = candles[i].time.getUTCHours();
    const min = candles[i].time.getUTCMinutes();
    
    // Enter at NY open (13:00-14:00 UTC) if strong momentum
    if (hour !== 13) continue;
    
    // Check previous 3 candles for strong directional move
    let bullishCount = 0, bearishCount = 0;
    let totalMove = 0;
    for (let j = i - 3; j < i; j++) {
      if (j < 0) continue;
      if (closes[j] > candles[j].open) bullishCount++;
      if (closes[j] < candles[j].open) bearishCount++;
      totalMove += Math.abs(closes[j] - candles[j].open);
    }
    
    const atrVal = atrVals[i];
    if (totalMove < atrVal * 0.5) continue; // not enough momentum
    
    if (bullishCount >= 3 && closes[i] > ema20[i] && rsiVals[i] > 50 && rsiVals[i] < 75) {
      const entry = closes[i];
      const sl = entry - atrVal * 1.5;
      const trade = simulateTrade(candles, i, 'LONG', entry, sl, 'trailing_ema', { emaPeriod: 10, maxHoldCandles: 50 });
      if (trade) { trades.push(trade); lastInTrade = i; }
    }
    
    if (bearishCount >= 3 && closes[i] < ema20[i] && rsiVals[i] < 50 && rsiVals[i] > 25) {
      const entry = closes[i];
      const sl = entry + atrVal * 1.5;
      const trade = simulateTrade(candles, i, 'SHORT', entry, sl, 'trailing_ema', { emaPeriod: 10, maxHoldCandles: 50 });
      if (trade) { trades.push(trade); lastInTrade = i; }
    }
  }
  return trades;
}

// STRATEGY 6: Multi-Timeframe Confluence (H4 trend + H1 entry)
function strategyMTFConfluence(h1Candles: RawCandle[], h4Candles: RawCandle[]): Trade[] {
  const trades: Trade[] = [];
  
  const h4Closes = h4Candles.map(c => c.close);
  const h4Ema200 = ema(h4Closes, 200);
  const h4Ema50 = ema(h4Closes, 50);
  
  const h1Closes = h1Candles.map(c => c.close);
  const h1Ema50 = ema(h1Closes, 50);
  const h1Ema200 = ema(h1Closes, 200);
  const h1Rsi = rsi(h1Closes, 14);
  const h1Atr = atr(h1Candles, 14);
  
  let lastInTrade = -10;
  
  for (let i = 210; i < h1Candles.length - 10; i++) {
    if (i - lastInTrade < 15) continue;
    
    // Find corresponding H4 candle
    const h1Time = h1Candles[i].time.getTime();
    let h4Idx = -1;
    for (let j = h4Candles.length - 1; j >= 0; j--) {
      if (h4Candles[j].time.getTime() <= h1Time) { h4Idx = j; break; }
    }
    if (h4Idx < 200) continue;
    
    // H4 trend filter
    const h4Bullish = h4Closes[h4Idx] > h4Ema200[h4Idx] && h4Ema50[h4Idx] > h4Ema200[h4Idx];
    const h4Bearish = h4Closes[h4Idx] < h4Ema200[h4Idx] && h4Ema50[h4Idx] < h4Ema200[h4Idx];
    
    if (!h4Bullish && !h4Bearish) continue;
    
    // H1 pullback to EMA50
    const distToEMA50 = Math.abs(h1Candles[i].low - h1Ema50[i]);
    const atrVal = h1Atr[i];
    
    if (h4Bullish && h1Closes[i] > h1Ema200[i] && distToEMA50 < atrVal) {
      if (h1Rsi[i] >= 40 && h1Rsi[i] <= 65) {
        if (h1Closes[i] > h1Candles[i].open) { // bullish candle
          const entry = h1Closes[i];
          const sl = Math.min(h1Candles[i].low, h1Ema50[i]) - atrVal * 0.5;
          const trade = simulateTrade(h1Candles, i, 'LONG', entry, sl, 'trailing_ema', { emaPeriod: 20, maxHoldCandles: 100 });
          if (trade) { trades.push(trade); lastInTrade = i; }
        }
      }
    }
    
    if (h4Bearish && h1Closes[i] < h1Ema200[i] && distToEMA50 < atrVal) {
      if (h1Rsi[i] <= 60 && h1Rsi[i] >= 35) {
        if (h1Closes[i] < h1Candles[i].open) { // bearish candle
          const entry = h1Closes[i];
          const sl = Math.max(h1Candles[i].high, h1Ema50[i]) + atrVal * 0.5;
          const trade = simulateTrade(h1Candles, i, 'SHORT', entry, sl, 'trailing_ema', { emaPeriod: 20, maxHoldCandles: 100 });
          if (trade) { trades.push(trade); lastInTrade = i; }
        }
      }
    }
  }
  return trades;
}

// STRATEGY 7: Volatility Squeeze (BB inside Keltner = squeeze, then breakout)
function strategyVolSqueeze(candles: RawCandle[]): Trade[] {
  const trades: Trade[] = [];
  const closes = candles.map(c => c.close);
  const bb = bollingerBands(closes, 20, 2.0);
  const ema20 = ema(closes, 20);
  const atrVals = atr(candles, 10); // Keltner uses ATR
  const rsiVals = rsi(closes, 14);
  let lastInTrade = -10;
  
  for (let i = 50; i < candles.length - 10; i++) {
    if (i - lastInTrade < 10) continue;
    if (isNaN(bb.upper[i])) continue;
    
    // Squeeze: BB inside Keltner Channel
    const keltnerUpper = ema20[i] + atrVals[i] * 1.5;
    const keltnerLower = ema20[i] - atrVals[i] * 1.5;
    const inSqueeze = bb.upper[i] < keltnerUpper && bb.lower[i] > keltnerLower;
    
    // Check if we were in squeeze 3 candles ago (squeeze release)
    const wasInSqueeze = i >= 53 && !isNaN(bb.upper[i - 3]) &&
      bb.upper[i - 3] < (ema20[i - 3] + atrVals[i - 3] * 1.5) &&
      bb.lower[i - 3] > (ema20[i - 3] - atrVals[i - 3] * 1.5);
    
    if (!wasInSqueeze || inSqueeze) continue; // want squeeze RELEASE
    
    // Breakout direction
    if (closes[i] > bb.upper[i] && rsiVals[i] > 55) {
      const entry = closes[i];
      const sl = bb.lower[i]; // SL at other band
      const trade = simulateTrade(candles, i, 'LONG', entry, sl, 'trailing_ema', { emaPeriod: 20, maxHoldCandles: 80 });
      if (trade) { trades.push(trade); lastInTrade = i; }
    }
    
    if (closes[i] < bb.lower[i] && rsiVals[i] < 45) {
      const entry = closes[i];
      const sl = bb.upper[i];
      const trade = simulateTrade(candles, i, 'SHORT', entry, sl, 'trailing_ema', { emaPeriod: 20, maxHoldCandles: 80 });
      if (trade) { trades.push(trade); lastInTrade = i; }
    }
  }
  return trades;
}

// STRATEGY 8: RSI Divergence Reversal (H4)
function strategyRSIDivergence(candles: RawCandle[]): Trade[] {
  const trades: Trade[] = [];
  const closes = candles.map(c => c.close);
  const rsiVals = rsi(closes, 14);
  const atrVals = atr(candles, 14);
  const ema50 = ema(closes, 50);
  let lastInTrade = -10;
  
  for (let i = 50; i < candles.length - 10; i++) {
    if (i - lastInTrade < 5) continue;
    
    // Find swing lows in last 20 candles for bullish divergence
    const lookback = 20;
    let recentLowIdx = i;
    let prevLowIdx = i - 10;
    
    for (let j = i - 1; j >= i - lookback; j--) {
      if (j < 1) break;
      if (candles[j].low < candles[recentLowIdx].low && j > i - 10) {
        prevLowIdx = recentLowIdx;
        recentLowIdx = j;
      } else if (candles[j].low < candles[recentLowIdx].low) {
        prevLowIdx = j;
      }
    }
    
    if (recentLowIdx === prevLowIdx) continue;
    if (recentLowIdx >= prevLowIdx) continue;
    
    // Bullish divergence: price lower low, RSI higher low
    if (candles[recentLowIdx].low < candles[prevLowIdx].low &&
        rsiVals[recentLowIdx] > rsiVals[prevLowIdx] &&
        rsiVals[recentLowIdx] < 35) {
      // Wait for confirmation: close above previous candle high
      if (closes[i] > candles[i - 1].high) {
        const entry = closes[i];
        const sl = candles[recentLowIdx].low - atrVals[i] * 0.5;
        const trade = simulateTrade(candles, i, 'LONG', entry, sl, 'trailing_ema', { emaPeriod: 20, maxHoldCandles: 100 });
        if (trade) { trades.push(trade); lastInTrade = i; }
      }
    }
    
    // Bearish divergence: price higher high, RSI lower high
    let recentHighIdx = i;
    let prevHighIdx = i - 10;
    for (let j = i - 1; j >= i - lookback; j--) {
      if (j < 1) break;
      if (candles[j].high > candles[recentHighIdx].high && j > i - 10) {
        prevHighIdx = recentHighIdx;
        recentHighIdx = j;
      } else if (candles[j].high > candles[recentHighIdx].high) {
        prevHighIdx = j;
      }
    }
    
    if (recentHighIdx === prevHighIdx) continue;
    if (recentHighIdx >= prevHighIdx) continue;
    
    if (candles[recentHighIdx].high > candles[prevHighIdx].high &&
        rsiVals[recentHighIdx] < rsiVals[prevHighIdx] &&
        rsiVals[recentHighIdx] > 65) {
      if (closes[i] < candles[i - 1].low) {
        const entry = closes[i];
        const sl = candles[recentHighIdx].high + atrVals[i] * 0.5;
        const trade = simulateTrade(candles, i, 'SHORT', entry, sl, 'trailing_ema', { emaPeriod: 20, maxHoldCandles: 100 });
        if (trade) { trades.push(trade); lastInTrade = i; }
      }
    }
  }
  return trades;
}

// --- MAIN ---
function main() {
  console.log('===================================================================');
  console.log('EURUSD-ONLY STRATEGY SEARCH');
  console.log('===================================================================');
  console.log(`Cost: ${COST_PIPS} pip (0.3 spread + 0.7 commission, Pepperstone RAW)`);
  console.log(`Pip multiplier: ${PIP_MULT}`);
  console.log('');
  
  const m5 = loadM5Candles('EURUSD');
  if (m5.length === 0) {
    console.log('ERROR: No EURUSD data found');
    return;
  }
  
  console.log(`EURUSD M5 candles: ${m5.length}`);
  console.log(`Date range: ${m5[0].time.toISOString()} to ${m5[m5.length - 1].time.toISOString()}`);
  const totalDays = (m5[m5.length - 1].time.getTime() - m5[0].time.getTime()) / (1000 * 60 * 60 * 24);
  console.log(`Total days: ${totalDays.toFixed(0)}`);
  console.log('');
  
  // Aggregate to different timeframes
  const m15 = aggregateCandles(m5, 15);
  const h1 = aggregateCandles(m5, 60);
  const h4 = aggregateCandles(m5, 240);
  
  console.log(`M15 candles: ${m15.length}`);
  console.log(`H1 candles: ${h1.length}`);
  console.log(`H4 candles: ${h4.length}`);
  console.log('');
  
  const results: StrategyResult[] = [];
  
  // Test all strategies
  console.log('===================================================================');
  console.log('TESTING STRATEGIES ON EURUSD');
  console.log('===================================================================');
  console.log('');
  
  // M15 strategies
  console.log('--- M15 Strategies ---');
  
  let trades = strategyLondonBreakout(m5);
  let r = calcMetrics(trades, 'London Breakout', 'M5→M15', totalDays);
  results.push(r);
  console.log(`  ${r.name}: ${trades.length} trades, WR ${r.winRate.toFixed(1)}%, avgR ${r.avgR.toFixed(3)}, PF ${r.profitFactor.toFixed(2)}, maxDD ${r.maxDD.toFixed(2)}R, avgSL ${r.avgSLpips.toFixed(1)}p, ${r.tradesPerDay.toFixed(2)}/day`);
  
  trades = strategySessionMomentum(m15);
  r = calcMetrics(trades, 'Session Momentum', 'M15', totalDays);
  results.push(r);
  console.log(`  ${r.name}: ${trades.length} trades, WR ${r.winRate.toFixed(1)}%, avgR ${r.avgR.toFixed(3)}, PF ${r.profitFactor.toFixed(2)}, maxDD ${r.maxDD.toFixed(2)}R, avgSL ${r.avgSLpips.toFixed(1)}p, ${r.tradesPerDay.toFixed(2)}/day`);
  
  trades = strategyVolSqueeze(m15);
  r = calcMetrics(trades, 'Vol Squeeze', 'M15', totalDays);
  results.push(r);
  console.log(`  ${r.name}: ${trades.length} trades, WR ${r.winRate.toFixed(1)}%, avgR ${r.avgR.toFixed(3)}, PF ${r.profitFactor.toFixed(2)}, maxDD ${r.maxDD.toFixed(2)}R, avgSL ${r.avgSLpips.toFixed(1)}p, ${r.tradesPerDay.toFixed(2)}/day`);
  
  // H1 strategies
  console.log('\n--- H1 Strategies ---');
  
  trades = strategyEMATrendPullback(h1);
  r = calcMetrics(trades, 'EMA Trend Pullback', 'H1', totalDays);
  results.push(r);
  console.log(`  ${r.name}: ${trades.length} trades, WR ${r.winRate.toFixed(1)}%, avgR ${r.avgR.toFixed(3)}, PF ${r.profitFactor.toFixed(2)}, maxDD ${r.maxDD.toFixed(2)}R, avgSL ${r.avgSLpips.toFixed(1)}p, ${r.tradesPerDay.toFixed(2)}/day`);
  
  trades = strategyBBMeanReversionSMA(h1);
  r = calcMetrics(trades, 'BB Mean Rev → SMA20', 'H1', totalDays);
  results.push(r);
  console.log(`  ${r.name}: ${trades.length} trades, WR ${r.winRate.toFixed(1)}%, avgR ${r.avgR.toFixed(3)}, PF ${r.profitFactor.toFixed(2)}, maxDD ${r.maxDD.toFixed(2)}R, avgSL ${r.avgSLpips.toFixed(1)}p, ${r.tradesPerDay.toFixed(2)}/day`);
  
  trades = strategyDonchianBreakout(h1);
  r = calcMetrics(trades, 'Donchian Breakout', 'H1', totalDays);
  results.push(r);
  console.log(`  ${r.name}: ${trades.length} trades, WR ${r.winRate.toFixed(1)}%, avgR ${r.avgR.toFixed(3)}, PF ${r.profitFactor.toFixed(2)}, maxDD ${r.maxDD.toFixed(2)}R, avgSL ${r.avgSLpips.toFixed(1)}p, ${r.tradesPerDay.toFixed(2)}/day`);
  
  // H4 strategies
  console.log('\n--- H4 Strategies ---');
  
  trades = strategyRSIDivergence(h4);
  r = calcMetrics(trades, 'RSI Divergence', 'H4', totalDays);
  results.push(r);
  console.log(`  ${r.name}: ${trades.length} trades, WR ${r.winRate.toFixed(1)}%, avgR ${r.avgR.toFixed(3)}, PF ${r.profitFactor.toFixed(2)}, maxDD ${r.maxDD.toFixed(2)}R, avgSL ${r.avgSLpips.toFixed(1)}p, ${r.tradesPerDay.toFixed(2)}/day`);
  
  trades = strategyEMATrendPullback(h4);
  r = calcMetrics(trades, 'EMA Trend Pullback', 'H4', totalDays);
  results.push(r);
  console.log(`  ${r.name}: ${trades.length} trades, WR ${r.winRate.toFixed(1)}%, avgR ${r.avgR.toFixed(3)}, PF ${r.profitFactor.toFixed(2)}, maxDD ${r.maxDD.toFixed(2)}R, avgSL ${r.avgSLpips.toFixed(1)}p, ${r.tradesPerDay.toFixed(2)}/day`);
  
  trades = strategyDonchianBreakout(h4);
  r = calcMetrics(trades, 'Donchian Breakout', 'H4', totalDays);
  results.push(r);
  console.log(`  ${r.name}: ${trades.length} trades, WR ${r.winRate.toFixed(1)}%, avgR ${r.avgR.toFixed(3)}, PF ${r.profitFactor.toFixed(2)}, maxDD ${r.maxDD.toFixed(2)}R, avgSL ${r.avgSLpips.toFixed(1)}p, ${r.tradesPerDay.toFixed(2)}/day`);
  
  // MTF strategy
  console.log('\n--- Multi-Timeframe ---');
  
  trades = strategyMTFConfluence(h1, h4);
  r = calcMetrics(trades, 'MTF Confluence (H4+H1)', 'H1/H4', totalDays);
  results.push(r);
  console.log(`  ${r.name}: ${trades.length} trades, WR ${r.winRate.toFixed(1)}%, avgR ${r.avgR.toFixed(3)}, PF ${r.profitFactor.toFixed(2)}, maxDD ${r.maxDD.toFixed(2)}R, avgSL ${r.avgSLpips.toFixed(1)}p, ${r.tradesPerDay.toFixed(2)}/day`);
  
  // RANKING
  console.log('\n===================================================================');
  console.log('RANKING (by avgR, must have 10+ trades)');
  console.log('===================================================================');
  
  const ranked = results
    .filter(r => r.trades.length >= 10)
    .sort((a, b) => b.avgR - a.avgR);
  
  if (ranked.length === 0) {
    console.log('  No strategy produced 10+ trades.');
    console.log('  Showing all results regardless of trade count:');
    const all = results.sort((a, b) => b.avgR - a.avgR);
    for (const r of all) {
      console.log(`  ${r.name} (${r.timeframe}): ${r.trades.length} trades, avgR ${r.avgR.toFixed(3)}, WR ${r.winRate.toFixed(1)}%`);
    }
  } else {
    for (let i = 0; i < ranked.length; i++) {
      const r = ranked[i];
      const status = r.avgR > 0 ? '✅' : '❌';
      console.log(`  ${i + 1}. ${status} ${r.name} (${r.timeframe})`);
      console.log(`     Trades: ${r.trades.length} | WR: ${r.winRate.toFixed(1)}% | avgR: ${r.avgR.toFixed(3)} | PF: ${r.profitFactor.toFixed(2)} | maxDD: ${r.maxDD.toFixed(2)}R`);
      console.log(`     avgSL: ${r.avgSLpips.toFixed(1)}p | avgWin: ${r.avgWinPips.toFixed(1)}p | avgLoss: ${r.avgLossPips.toFixed(1)}p | ${r.tradesPerDay.toFixed(2)}/day`);
    }
  }
  
  // Show trade details for best strategy
  const best = ranked.length > 0 ? ranked[0] : results.sort((a, b) => b.avgR - a.avgR)[0];
  if (best && best.trades.length > 0) {
    console.log(`\n===================================================================`);
    console.log(`BEST STRATEGY: ${best.name} (${best.timeframe}) — FIRST 10 TRADES`);
    console.log(`===================================================================`);
    for (let i = 0; i < Math.min(10, best.trades.length); i++) {
      const t = best.trades[i];
      console.log(`  Trade ${i + 1}: ${t.direction} @ ${t.entryTime.toISOString().slice(0, 16)}`);
      console.log(`    Entry: ${t.entry.toFixed(5)} | SL: ${t.sl.toFixed(5)} (${t.riskPips.toFixed(1)}p)`);
      console.log(`    Exit: ${t.exit?.toFixed(5)} @ ${t.exitTime?.toISOString().slice(0, 16)} (${t.exitReason})`);
      console.log(`    Gross: ${t.grossPips.toFixed(1)}p | Cost: ${COST_PIPS}p | Net: ${t.netPips.toFixed(1)}p | R: ${t.rMultiple.toFixed(3)}`);
    }
  }
  
  // Walk-forward for best strategy
  if (best && best.trades.length >= 20) {
    console.log(`\n===================================================================`);
    console.log(`WALK-FORWARD: ${best.name} (${best.timeframe})`);
    console.log(`===================================================================`);
    
    const midpoint = m5[Math.floor(m5.length / 2)].time.getTime();
    const inSample = best.trades.filter(t => t.entryTime.getTime() < midpoint);
    const outSample = best.trades.filter(t => t.entryTime.getTime() >= midpoint);
    
    const isMetrics = calcMetrics(inSample, `${best.name} IN-SAMPLE`, best.timeframe, totalDays / 2);
    const osMetrics = calcMetrics(outSample, `${best.name} OUT-OF-SAMPLE`, best.timeframe, totalDays / 2);
    
    console.log(`  In-sample (months 1-3):`);
    console.log(`    Trades: ${inSample.length} | WR: ${isMetrics.winRate.toFixed(1)}% | avgR: ${isMetrics.avgR.toFixed(3)} | PF: ${isMetrics.profitFactor.toFixed(2)} | maxDD: ${isMetrics.maxDD.toFixed(2)}R`);
    console.log(`  Out-of-sample (months 4-6):`);
    console.log(`    Trades: ${outSample.length} | WR: ${osMetrics.winRate.toFixed(1)}% | avgR: ${osMetrics.avgR.toFixed(3)} | PF: ${osMetrics.profitFactor.toFixed(2)} | maxDD: ${osMetrics.maxDD.toFixed(2)}R`);
    
    if (osMetrics.avgR > 0 && osMetrics.winRate > 45) {
      console.log(`  VERDICT: ✅ PASS — out-of-sample holds up`);
    } else {
      console.log(`  VERDICT: ❌ FAIL — out-of-sample does not hold up`);
    }
  }
}

main();
