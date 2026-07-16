/**
 * WALK-FORWARD VALIDATION: Pin Bar Reversal Strategy
 * 
 * Top results from Round 2:
 * 1. EURJPY - Pin Bar Reversal (H1): 61 trades, 59.0% WR, +0.187 avgR, 1.68 PF
 * 2. EURUSD - Pin Bar Reversal (H1): 56 trades, 51.8% WR, +0.073 avgR, 1.32 PF
 * 
 * This validates whether these results hold up out-of-sample.
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
  { pair: 'EURJPY', pipMult: 0.01, costPips: 1.5 },
  { pair: 'EURUSD', pipMult: 0.0001, costPips: 1.0 },
];

function loadM5Candles(pair: string): RawCandle[] {
  const cacheDir = process.env.CACHE_DIR || './.cache';
  const files = fs.readdirSync(cacheDir).filter(f => f.includes(pair) && f.includes('5min') && f.endsWith('.json'));
  if (files.length === 0) return [];
  const all: RawCandle[] = [];
  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(`${cacheDir}/${file}`, 'utf-8'));
      for (const c of data) {
        all.push({ time: new Date(c.timestamp || c.time), open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume || 0 });
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

function atr(candles: RawCandle[], period: number = 14): number[] {
  const result: number[] = [];
  let trSum = 0;
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) { result.push(candles[i].high - candles[i].low); continue; }
    const tr = Math.max(candles[i].high - candles[i].low, Math.abs(candles[i].high - candles[i - 1].close), Math.abs(candles[i].low - candles[i - 1].close));
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
  candles: RawCandle[], entryIdx: number, direction: 'LONG' | 'SHORT',
  entry: number, sl: number, pipMult: number, costPips: number,
  tp1R: number, tp2R: number, maxHold: number
): Trade | null {
  const riskPips = Math.abs((entry - sl) / pipMult);
  if (riskPips < 3) return null;

  let exitPrice = 0, exitIdx = -1, exitReason = '';
  const tp1 = direction === 'LONG' ? entry + pipMult * riskPips * tp1R : entry - pipMult * riskPips * tp1R;
  const tp2 = direction === 'LONG' ? entry + pipMult * riskPips * tp2R : entry - pipMult * riskPips * tp2R;

  for (let i = entryIdx + 1; i < candles.length && i <= entryIdx + maxHold; i++) {
    const c = candles[i];
    if (direction === 'LONG') {
      if (c.low <= sl) { exitPrice = sl; exitIdx = i; exitReason = 'SL'; break; }
      if (c.high >= tp2) { exitPrice = tp2; exitIdx = i; exitReason = 'TP2'; break; }
      if (c.high >= tp1) { exitPrice = tp1; exitIdx = i; exitReason = 'TP1'; break; }
    } else {
      if (c.high >= sl) { exitPrice = sl; exitIdx = i; exitReason = 'SL'; break; }
      if (c.low <= tp2) { exitPrice = tp2; exitIdx = i; exitReason = 'TP2'; break; }
      if (c.low <= tp1) { exitPrice = tp1; exitIdx = i; exitReason = 'TP1'; break; }
    }
  }

  if (exitIdx === -1) {
    const lastIdx = Math.min(entryIdx + maxHold, candles.length - 1);
    exitPrice = candles[lastIdx].close;
    exitIdx = lastIdx;
    exitReason = 'MAX_HOLD';
  }

  const grossPips = direction === 'LONG' ? (exitPrice - entry) / pipMult : (entry - exitPrice) / pipMult;
  const netPips = grossPips - costPips;
  const rMultiple = netPips / riskPips;

  return { direction, entry, entryIdx, entryTime: candles[entryIdx].time, sl, exit: exitPrice, exitIdx, exitTime: candles[exitIdx].time, exitReason, grossPips, netPips, riskPips, rMultiple };
}

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
    
    if (candles[i].low <= bb.lower[i] && lowerWick > body * 2 && upperWick < body * 0.5) {
      const entry = candles[i].close;
      const sl = candles[i].low - atrVals[i] * 0.3;
      const trade = simulateTrade(candles, i, 'LONG', entry, sl, config.pipMult, config.costPips, 1.0, 2.0, 60);
      if (trade) { trades.push(trade); lastInTrade = i; }
    }
    
    if (candles[i].high >= bb.upper[i] && upperWick > body * 2 && lowerWick < body * 0.5) {
      const entry = candles[i].close;
      const sl = candles[i].high + atrVals[i] * 0.3;
      const trade = simulateTrade(candles, i, 'SHORT', entry, sl, config.pipMult, config.costPips, 1.0, 2.0, 60);
      if (trade) { trades.push(trade); lastInTrade = i; }
    }
  }
  return trades;
}

function calcMetrics(trades: Trade[]) {
  const wins = trades.filter(t => t.netPips > 0);
  const losses = trades.filter(t => t.netPips <= 0);
  const winRate = trades.length > 0 ? wins.length / trades.length * 100 : 0;
  const avgR = trades.length > 0 ? trades.reduce((s, t) => s + t.rMultiple, 0) / trades.length : 0;
  const grossWins = wins.reduce((s, t) => s + t.netPips, 0);
  const grossLosses = Math.abs(losses.reduce((s, t) => s + t.netPips, 0));
  const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0;
  let peak = 0, maxDD = 0, cum = 0;
  for (const t of trades) { cum += t.rMultiple; peak = Math.max(peak, cum); maxDD = Math.min(maxDD, peak - cum); }
  const avgSLpips = trades.length > 0 ? trades.reduce((s, t) => s + t.riskPips, 0) / trades.length : 0;
  const avgWinPips = wins.length > 0 ? wins.reduce((s, t) => s + t.netPips, 0) / wins.length : 0;
  const avgLossPips = losses.length > 0 ? losses.reduce((s, t) => s + t.netPips, 0) / losses.length : 0;
  return { winRate, avgR, profitFactor, maxDD, avgSLpips, avgWinPips, avgLossPips, totalTrades: trades.length };
}

function main() {
  console.log('===================================================================');
  console.log('WALK-FORWARD VALIDATION: PIN BAR REVERSAL');
  console.log('===================================================================');
  console.log('');
  
  for (const config of PAIRS) {
    const m5 = loadM5Candles(config.pair);
    if (m5.length < 50000) continue;
    
    const h1 = aggregateCandles(m5, 60);
    const totalDays = (m5[m5.length - 1].time.getTime() - m5[0].time.getTime()) / (1000 * 60 * 60 * 24);
    
    console.log(`\n${'='.repeat(65)}`);
    console.log(`${config.pair} — Pin Bar Reversal (H1)`);
    console.log(`${'='.repeat(65)}`);
    console.log(`Data: ${m5.length} M5 candles = ${totalDays.toFixed(0)} days`);
    console.log(`Cost: ${config.costPips} pips round-trip`);
    console.log(`Exit: TP1 = 1.0R, TP2 = 2.0R, max hold 60 candles`);
    
    // Full dataset
    const allTrades = strategyPinBarReversal(h1, config);
    const fullMetrics = calcMetrics(allTrades);
    console.log(`\n--- FULL DATASET ---`);
    console.log(`  Trades: ${fullMetrics.totalTrades} | WR: ${fullMetrics.winRate.toFixed(1)}% | avgR: ${fullMetrics.avgR.toFixed(3)} | PF: ${fullMetrics.profitFactor.toFixed(2)} | maxDD: ${fullMetrics.maxDD.toFixed(2)}R`);
    console.log(`  avgSL: ${fullMetrics.avgSLpips.toFixed(1)}p | avgWin: ${fullMetrics.avgWinPips.toFixed(1)}p | avgLoss: ${fullMetrics.avgLossPips.toFixed(1)}p`);
    
    // Walk-forward: 3-way split (months 1-2, 3-4, 5-6)
    const third = Math.floor(h1.length / 3);
    const split1Time = h1[third].time;
    const split2Time = h1[third * 2].time;
    
    const period1 = allTrades.filter(t => t.entryTime < split1Time);
    const period2 = allTrades.filter(t => t.entryTime >= split1Time && t.entryTime < split2Time);
    const period3 = allTrades.filter(t => t.entryTime >= split2Time);
    
    const m1 = calcMetrics(period1);
    const m2 = calcMetrics(period2);
    const m3 = calcMetrics(period3);
    
    console.log(`\n--- WALK-FORWARD (3 periods) ---`);
    console.log(`  Period 1 (months 1-2): ${m1.totalTrades} trades, WR ${m1.winRate.toFixed(1)}%, avgR ${m1.avgR.toFixed(3)}, PF ${m1.profitFactor.toFixed(2)}`);
    console.log(`  Period 2 (months 3-4): ${m2.totalTrades} trades, WR ${m2.winRate.toFixed(1)}%, avgR ${m2.avgR.toFixed(3)}, PF ${m2.profitFactor.toFixed(2)}`);
    console.log(`  Period 3 (months 5-6): ${m3.totalTrades} trades, WR ${m3.winRate.toFixed(1)}%, avgR ${m3.avgR.toFixed(3)}, PF ${m3.profitFactor.toFixed(2)}`);
    
    // In-sample vs out-of-sample
    const inSample = allTrades.filter(t => t.entryTime < split2Time);
    const outSample = allTrades.filter(t => t.entryTime >= split2Time);
    const isM = calcMetrics(inSample);
    const osM = calcMetrics(outSample);
    
    console.log(`\n--- IN-SAMPLE vs OUT-OF-SAMPLE ---`);
    console.log(`  In-sample (months 1-4): ${isM.totalTrades} trades, WR ${isM.winRate.toFixed(1)}%, avgR ${isM.avgR.toFixed(3)}, PF ${isM.profitFactor.toFixed(2)}, maxDD ${isM.maxDD.toFixed(2)}R`);
    console.log(`  Out-of-sample (months 5-6): ${osM.totalTrades} trades, WR ${osM.winRate.toFixed(1)}%, avgR ${osM.avgR.toFixed(3)}, PF ${osM.profitFactor.toFixed(2)}, maxDD ${osM.maxDD.toFixed(2)}R`);
    
    // Verdict
    console.log(`\n--- VERDICT ---`);
    const pass3Periods = [m1, m2, m3].filter(m => m.avgR > 0 && m.totalTrades >= 5).length;
    const passOS = osM.avgR > 0 && osM.totalTrades >= 5;
    
    if (pass3Periods >= 2 && passOS) {
      console.log(`  ✅ STRONG PASS — positive in 2+ of 3 periods AND out-of-sample`);
    } else if (pass3Periods >= 2 || passOS) {
      console.log(`  ⚠️  MARGINAL — some periods positive but not consistent`);
    } else {
      console.log(`  ❌ FAIL — does not hold up out-of-sample`);
    }
    
    // Show individual trades
    console.log(`\n--- ALL TRADES ---`);
    for (let i = 0; i < allTrades.length; i++) {
      const t = allTrades[i];
      const status = t.netPips > 0 ? '✅' : '❌';
      console.log(`  ${status} ${i+1}. ${t.direction} @ ${t.entryTime.toISOString().slice(0,10)} | Entry: ${t.entry.toFixed(3)} | SL: ${t.sl.toFixed(3)} (${t.riskPips.toFixed(1)}p) | Exit: ${t.exitReason} ${t.exit?.toFixed(3)} | Net: ${t.netPips.toFixed(1)}p | R: ${t.rMultiple.toFixed(3)}`);
    }
  }
  
  // Also test with different BB periods and multipliers
  console.log(`\n\n${'='.repeat(65)}`);
  console.log('SENSITIVITY TEST: Different BB parameters on EURJPY');
  console.log(`${'='.repeat(65)}`);
  
  const config = { pair: 'EURJPY', pipMult: 0.01, costPips: 1.5 };
  const m5 = loadM5Candles('EURJPY');
  const h1 = aggregateCandles(m5, 60);
  
  for (const bbPeriod of [15, 20, 25, 30]) {
    for (const bbMult of [1.5, 2.0, 2.5, 3.0]) {
      // Custom pin bar with these params
      const closes = h1.map(c => c.close);
      const bb = bollingerBands(closes, bbPeriod, bbMult);
      const atrVals = atr(h1, 14);
      const trades: Trade[] = [];
      let lastInTrade = -10;
      
      for (let i = 50; i < h1.length - 10; i++) {
        if (i - lastInTrade < 8) continue;
        if (isNaN(bb.lower[i])) continue;
        
        const body = Math.abs(h1[i].close - h1[i].open);
        const upperWick = h1[i].high - Math.max(h1[i].open, h1[i].close);
        const lowerWick = Math.min(h1[i].open, h1[i].close) - h1[i].low;
        
        if (h1[i].low <= bb.lower[i] && lowerWick > body * 2 && upperWick < body * 0.5) {
          const entry = h1[i].close;
          const sl = h1[i].low - atrVals[i] * 0.3;
          const trade = simulateTrade(h1, i, 'LONG', entry, sl, config.pipMult, config.costPips, 1.0, 2.0, 60);
          if (trade) { trades.push(trade); lastInTrade = i; }
        }
        if (h1[i].high >= bb.upper[i] && upperWick > body * 2 && lowerWick < body * 0.5) {
          const entry = h1[i].close;
          const sl = h1[i].high + atrVals[i] * 0.3;
          const trade = simulateTrade(h1, i, 'SHORT', entry, sl, config.pipMult, config.costPips, 1.0, 2.0, 60);
          if (trade) { trades.push(trade); lastInTrade = i; }
        }
      }
      
      const m = calcMetrics(trades);
      const status = m.avgR > 0 ? '✅' : '❌';
      console.log(`  ${status} BB(${bbPeriod}, ${bbMult}): ${m.totalTrades} trades, WR ${m.winRate.toFixed(1)}%, avgR ${m.avgR.toFixed(3)}, PF ${m.profitFactor.toFixed(2)}`);
    }
  }
}

main();
