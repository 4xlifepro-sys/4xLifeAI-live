/**
 * 28 FOREX PAIRS COMPREHENSIVE STRATEGY SEARCH
 * 
 * Test multiple strategies across ALL forex pairs with full data
 * Find which pairs (if any) have enough volatility to overcome costs
 * 
 * Pairs tested:
 * - 7 majors: EURUSD, GBPUSD, USDJPY, USDCHF, USDCAD, AUDUSD, NZDUSD
 * - 8 crosses: EURGBP, EURJPY, GBPJPY, AUDJPY, CADJPY, CHFJPY, NZDJPY, EURAUD
 * - Plus any others with full 6-month data
 * 
 * Cost model: Realistic Pepperstone RAW spreads + commission per pair
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
  costPips: number; // realistic round-trip cost
}

const PAIRS: PairConfig[] = [
  // Majors
  { pair: 'EURUSD', pipMult: 0.0001, costPips: 1.0 },
  { pair: 'GBPUSD', pipMult: 0.0001, costPips: 1.2 },
  { pair: 'USDJPY', pipMult: 0.01, costPips: 1.3 },
  { pair: 'USDCHF', pipMult: 0.0001, costPips: 1.2 },
  { pair: 'USDCAD', pipMult: 0.0001, costPips: 1.2 },
  { pair: 'AUDUSD', pipMult: 0.0001, costPips: 1.2 },
  { pair: 'NZDUSD', pipMult: 0.0001, costPips: 1.3 },
  // Crosses
  { pair: 'EURGBP', pipMult: 0.0001, costPips: 1.3 },
  { pair: 'EURJPY', pipMult: 0.01, costPips: 1.5 },
  { pair: 'GBPJPY', pipMult: 0.01, costPips: 1.8 },
  { pair: 'AUDJPY', pipMult: 0.01, costPips: 1.5 },
  { pair: 'CADJPY', pipMult: 0.01, costPips: 1.5 },
  { pair: 'CHFJPY', pipMult: 0.01, costPips: 1.7 },
  { pair: 'NZDJPY', pipMult: 0.01, costPips: 1.8 },
  { pair: 'EURAUD', pipMult: 0.0001, costPips: 1.5 },
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
  exitMode: 'trailing_ema' | 'fixed_tp',
  exitParams: { emaPeriod?: number; tp1R?: number; tp2R?: number; tp3R?: number; maxHoldCandles?: number }
): Trade | null {
  const riskPips = Math.abs((entry - sl) / pipMult);
  if (riskPips < 3) return null; // too tight

  let exitPrice = 0;
  let exitIdx = -1;
  let exitReason = '';
  let trailStop = sl;
  let emaValues: number[] = [];

  if (exitMode === 'trailing_ema') {
    const closes = candles.map(c => c.close);
    emaValues = ema(closes, exitParams.emaPeriod || 20);
  }

  const maxHold = exitParams.maxHoldCandles || 150;

  for (let i = entryIdx + 1; i < candles.length && i <= entryIdx + maxHold; i++) {
    const c = candles[i];

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

// STRATEGY 1: Session Momentum (M15) - NY open momentum
function strategySessionMomentum(candles: RawCandle[], config: PairConfig): Trade[] {
  const trades: Trade[] = [];
  const closes = candles.map(c => c.close);
  const ema20 = ema(closes, 20);
  const rsiVals = rsi(closes, 14);
  const atrVals = atr(candles, 14);
  let lastInTrade = -10;
  
  for (let i = 50; i < candles.length - 10; i++) {
    if (i - lastInTrade < 15) continue;
    
    const hour = candles[i].time.getUTCHours();
    if (hour !== 13) continue; // NY open
    
    let bullishCount = 0, bearishCount = 0;
    let totalMove = 0;
    for (let j = i - 3; j < i; j++) {
      if (j < 0) continue;
      if (closes[j] > candles[j].open) bullishCount++;
      if (closes[j] < candles[j].open) bearishCount++;
      totalMove += Math.abs(closes[j] - candles[j].open);
    }
    
    const atrVal = atrVals[i];
    if (totalMove < atrVal * 0.5) continue;
    
    if (bullishCount >= 3 && closes[i] > ema20[i] && rsiVals[i] > 50 && rsiVals[i] < 75) {
      const entry = closes[i];
      const sl = entry - atrVal * 1.5;
      const trade = simulateTrade(candles, i, 'LONG', entry, sl, config.pipMult, config.costPips, 'trailing_ema', { emaPeriod: 10, maxHoldCandles: 50 });
      if (trade) { trades.push(trade); lastInTrade = i; }
    }
    
    if (bearishCount >= 3 && closes[i] < ema20[i] && rsiVals[i] < 50 && rsiVals[i] > 25) {
      const entry = closes[i];
      const sl = entry + atrVal * 1.5;
      const trade = simulateTrade(candles, i, 'SHORT', entry, sl, config.pipMult, config.costPips, 'trailing_ema', { emaPeriod: 10, maxHoldCandles: 50 });
      if (trade) { trades.push(trade); lastInTrade = i; }
    }
  }
  return trades;
}

// STRATEGY 2: EMA Trend Pullback (H1)
function strategyEMATrendPullback(candles: RawCandle[], config: PairConfig): Trade[] {
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
    if (Math.abs(slope200) < 0.0005) continue;
    
    const bullish = closes[i] > ema50[i] && ema50[i] > ema200[i] && slope200 > 0;
    const bearish = closes[i] < ema50[i] && ema50[i] < ema200[i] && slope200 < 0;
    
    if (!bullish && !bearish) continue;
    
    const distToEMA50 = Math.abs(candles[i].low - ema50[i]);
    const atrVal = atrVals[i];
    if (distToEMA50 > atrVal * 1.5) continue;
    
    if (bullish && (rsiVals[i] < 40 || rsiVals[i] > 70)) continue;
    if (bearish && (rsiVals[i] > 60 || rsiVals[i] < 30)) continue;
    
    const isBullishCandle = closes[i] > candles[i].open;
    const isBearishCandle = closes[i] < candles[i].open;
    if (bullish && !isBullishCandle) continue;
    if (bearish && !isBearishCandle) continue;
    
    const direction = bullish ? 'LONG' : 'SHORT';
    const entry = closes[i];
    const sl = bullish
      ? Math.min(candles[i].low, ema50[i]) - atrVal * 0.5
      : Math.max(candles[i].high, ema50[i]) + atrVal * 0.5;
    
    const trade = simulateTrade(candles, i, direction, entry, sl, config.pipMult, config.costPips, 'trailing_ema', { emaPeriod: 20, maxHoldCandles: 150 });
    if (trade) { trades.push(trade); lastInTrade = i; }
  }
  return trades;
}

// STRATEGY 3: Donchian Breakout (H1)
function strategyDonchianBreakout(candles: RawCandle[], config: PairConfig): Trade[] {
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
    if (atrVal < atrAvg * 0.8) continue;
    
    const slope200 = (ema200[i] - ema200[i - 20]) / ema200[i - 20];
    
    if (closes[i] > dc.upper[i] && closes[i] > ema200[i] && slope200 > 0) {
      if (rsiVals[i] < 55 || rsiVals[i] > 80) continue;
      const entry = closes[i];
      const sl = dc.lower[i] - atrVal * 0.5;
      const trade = simulateTrade(candles, i, 'LONG', entry, sl, config.pipMult, config.costPips, 'trailing_ema', { emaPeriod: 20, maxHoldCandles: 150 });
      if (trade) { trades.push(trade); lastInTrade = i; }
    }
    
    if (closes[i] < dc.lower[i] && closes[i] < ema200[i] && slope200 < 0) {
      if (rsiVals[i] > 45 || rsiVals[i] < 20) continue;
      const entry = closes[i];
      const sl = dc.upper[i] + atrVal * 0.5;
      const trade = simulateTrade(candles, i, 'SHORT', entry, sl, config.pipMult, config.costPips, 'trailing_ema', { emaPeriod: 20, maxHoldCandles: 150 });
      if (trade) { trades.push(trade); lastInTrade = i; }
    }
  }
  return trades;
}

// --- MAIN ---
function main() {
  console.log('===================================================================');
  console.log('28 FOREX PAIRS COMPREHENSIVE STRATEGY SEARCH');
  console.log('===================================================================');
  console.log('Testing 3 strategies across all pairs with full data');
  console.log('Realistic costs per pair (Pepperstone RAW)');
  console.log('');
  
  const allResults: StrategyResult[] = [];
  
  for (const config of PAIRS) {
    const m5 = loadM5Candles(config.pair);
    if (m5.length < 50000) {
      console.log(`⚠️  ${config.pair}: Only ${m5.length} M5 candles (need 50k+), skipping`);
      continue;
    }
    
    const totalDays = (m5[m5.length - 1].time.getTime() - m5[0].time.getTime()) / (1000 * 60 * 60 * 24);
    console.log(`\n${config.pair}: ${m5.length} M5 candles = ${totalDays.toFixed(0)} days, cost: ${config.costPips}p`);
    
    const m15 = aggregateCandles(m5, 15);
    const h1 = aggregateCandles(m5, 60);
    
    // Test 3 strategies
    let trades = strategySessionMomentum(m15, config);
    let r = calcMetrics(trades, config.pair, 'Session Momentum', 'M15', totalDays);
    allResults.push(r);
    console.log(`  Session Momentum: ${trades.length} trades, WR ${r.winRate.toFixed(1)}%, avgR ${r.avgR.toFixed(3)}, PF ${r.profitFactor.toFixed(2)}`);
    
    trades = strategyEMATrendPullback(h1, config);
    r = calcMetrics(trades, config.pair, 'EMA Trend Pullback', 'H1', totalDays);
    allResults.push(r);
    console.log(`  EMA Trend Pullback: ${trades.length} trades, WR ${r.winRate.toFixed(1)}%, avgR ${r.avgR.toFixed(3)}, PF ${r.profitFactor.toFixed(2)}`);
    
    trades = strategyDonchianBreakout(h1, config);
    r = calcMetrics(trades, config.pair, 'Donchian Breakout', 'H1', totalDays);
    allResults.push(r);
    console.log(`  Donchian Breakout: ${trades.length} trades, WR ${r.winRate.toFixed(1)}%, avgR ${r.avgR.toFixed(3)}, PF ${r.profitFactor.toFixed(2)}`);
  }
  
  // RANKING
  console.log('\n===================================================================');
  console.log('RANKING ALL RESULTS (by avgR, must have 10+ trades)');
  console.log('===================================================================');
  
  const ranked = allResults
    .filter(r => r.trades.length >= 10)
    .sort((a, b) => b.avgR - a.avgR);
  
  console.log(`\nTop 20 results:`);
  for (let i = 0; i < Math.min(20, ranked.length); i++) {
    const r = ranked[i];
    const status = r.avgR > 0 ? '✅' : '❌';
    console.log(`  ${i + 1}. ${status} ${r.pair} - ${r.strategy} (${r.timeframe})`);
    console.log(`     Trades: ${r.trades.length} | WR: ${r.winRate.toFixed(1)}% | avgR: ${r.avgR.toFixed(3)} | PF: ${r.profitFactor.toFixed(2)} | maxDD: ${r.maxDD.toFixed(2)}R`);
    console.log(`     avgSL: ${r.avgSLpips.toFixed(1)}p | ${r.tradesPerDay.toFixed(2)}/day`);
  }
  
  // Count positive vs negative
  const positive = ranked.filter(r => r.avgR > 0);
  const negative = ranked.filter(r => r.avgR <= 0);
  
  console.log(`\n===================================================================`);
  console.log('SUMMARY');
  console.log('===================================================================');
  console.log(`Total strategies tested: ${allResults.length}`);
  console.log(`With 10+ trades: ${ranked.length}`);
  console.log(`Positive avgR: ${positive.length}`);
  console.log(`Negative avgR: ${negative.length}`);
  
  if (positive.length > 0) {
    console.log(`\n✅ FOUND ${positive.length} POSITIVE EXPECTANCY RESULTS:`);
    for (const r of positive.slice(0, 10)) {
      console.log(`  ${r.pair} - ${r.strategy} (${r.timeframe}): avgR ${r.avgR.toFixed(3)}, WR ${r.winRate.toFixed(1)}%, ${r.trades.length} trades`);
    }
    
    // Walk-forward on best
    const best = positive[0];
    if (best.trades.length >= 20) {
      console.log(`\n===================================================================`);
      console.log(`WALK-FORWARD: ${best.pair} - ${best.strategy}`);
      console.log(`===================================================================`);
      
      const midpoint = best.trades[Math.floor(best.trades.length / 2)].entryTime.getTime();
      const inSample = best.trades.filter(t => t.entryTime.getTime() < midpoint);
      const outSample = best.trades.filter(t => t.entryTime.getTime() >= midpoint);
      
      const isMetrics = calcMetrics(inSample, best.pair, `${best.strategy} IN-SAMPLE`, best.timeframe, 90);
      const osMetrics = calcMetrics(outSample, best.pair, `${best.strategy} OUT-OF-SAMPLE`, best.timeframe, 90);
      
      console.log(`  In-sample (first half):`);
      console.log(`    Trades: ${inSample.length} | WR: ${isMetrics.winRate.toFixed(1)}% | avgR: ${isMetrics.avgR.toFixed(3)} | PF: ${isMetrics.profitFactor.toFixed(2)}`);
      console.log(`  Out-of-sample (second half):`);
      console.log(`    Trades: ${outSample.length} | WR: ${osMetrics.winRate.toFixed(1)}% | avgR: ${osMetrics.avgR.toFixed(3)} | PF: ${osMetrics.profitFactor.toFixed(2)}`);
      
      if (osMetrics.avgR > 0 && osMetrics.winRate > 40) {
        console.log(`  VERDICT: ✅ PASS — out-of-sample holds up`);
      } else {
        console.log(`  VERDICT: ❌ FAIL — out-of-sample does not hold up`);
      }
    }
  } else {
    console.log(`\n❌ NO POSITIVE EXPECTANCY RESULTS FOUND`);
    console.log(`All ${negative.length} strategies with sufficient trades have negative avgR.`);
    console.log(`Forex pairs do not have enough volatility to overcome broker costs.`);
  }
}

main();
