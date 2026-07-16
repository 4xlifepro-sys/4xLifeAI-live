import type { Candle } from '../src/types.js';

// ---------------------------------------------------------------------------
// FOREX MEAN-REVERSION: TARGET THE REAL MEAN (SMA20)
// 
// Entry: same BB extreme + RSI extreme
// Exit: target SMA20 (the actual mean) instead of tiny 0.35R fixed target
// Secondary exit: time-based cutoff (35 candles) OR trailing stop
// Real costs applied from start (Pepperstone RAW spreads + commission)
// ---------------------------------------------------------------------------

interface Signal {
  pair: string;
  direction: 'LONG' | 'SHORT';
  entry: number;
  sl: number;
  target: number; // SMA20 (the real mean)
  candleIndex: number;
  confidence: number;
  reason: string;
}

interface Trade {
  pair: string;
  direction: 'LONG' | 'SHORT';
  entry: number;
  sl: number;
  target: number;
  entryTime: string;
  exitTime?: string;
  exitPrice?: number;
  exitReason?: string;
  pips?: number;
  r?: number;
  result?: string;
  confidence: number;
  slPips: number;
  targetPips: number;
}

function getPipMultiplier(pair: string): number {
  return pair.includes('JPY') ? 0.01 : 0.0001;
}

// Realistic broker spreads (Pepperstone RAW)
const BROKER_SPREADS: Record<string, number> = {
  'EURUSD': 0.6, 'GBPUSD': 0.9, 'USDJPY': 0.7, 'USDCHF': 0.8,
  'USDCAD': 0.9, 'AUDUSD': 0.7, 'NZDUSD': 0.9,
  'EURGBP': 1.0, 'EURJPY': 1.2, 'GBPJPY': 1.5, 'AUDJPY': 1.3,
  'CADJPY': 1.4, 'CHFJPY': 1.6, 'NZDJPY': 1.5, 'EURAUD': 1.4,
};
const COMMISSION_PIPS = 0.7;

function getRealCost(pair: string): number {
  const spread = BROKER_SPREADS[pair] ?? 1.5;
  return spread + COMMISSION_PIPS;
}

// Indicators
function sma(values: number[], period: number): number[] {
  const result: number[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) result.push(sum / period);
  }
  return result;
}

function stddev(values: number[], smaArr: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = period - 1; i < values.length; i++) {
    const mean = smaArr[i - (period - 1)];
    let sumSq = 0;
    for (let j = i - period + 1; j <= i; j++) sumSq += (values[j] - mean) ** 2;
    result.push(Math.sqrt(sumSq / period));
  }
  return result;
}

function rsi(closes: number[], period: number = 14): number[] {
  const result: number[] = [];
  if (closes.length < period + 1) return result;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;
  for (let i = period; i < closes.length; i++) {
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    result.push(100 - (100 / (1 + rs)));
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  return result;
}

function atr(candles: Candle[], period: number = 14): number[] {
  const result: number[] = [];
  const tr: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    tr.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  let sum = 0;
  for (let i = 0; i < period && i < tr.length; i++) sum += tr[i];
  if (tr.length >= period) result.push(sum / period);
  for (let i = period; i < tr.length; i++) {
    sum = sum - tr[i - period] + tr[i];
    result.push(sum / period);
  }
  return result;
}

// Scan for mean-reversion signals targeting SMA20
export function scanMeanReversionTargetMean(
  pair: string,
  m5Candles: Candle[]
): Signal[] {
  const signals: Signal[] = [];
  const closes = m5Candles.map(c => c.close);
  const pip = getPipMultiplier(pair);
  
  // Session filter: 07:00-21:00 UTC
  const hour = new Date(m5Candles[0].timestamp).getUTCHours();
  if (hour < 7 || hour >= 21) return signals;
  
  // Calculate indicators
  const sma20 = sma(closes, 20);
  const std20 = stddev(closes, sma20, 20);
  const rsi14 = rsi(closes, 14);
  const atr14 = atr(m5Candles, 14);
  
  // Minimum signal gap: 30 minutes
  const MIN_SIGNAL_GAP_MS = 30 * 60 * 1000;
  let lastSignalTime = 0;
  
  // Start from index 50 to ensure indicators are warmed up
  for (let i = 50; i < m5Candles.length - 10; i++) {
    const candle = m5Candles[i];
    const ts = new Date(candle.timestamp).getTime();
    
    // Check signal gap
    if (ts - lastSignalTime < MIN_SIGNAL_GAP_MS) continue;
    
    // Skip if indicators not ready
    const smaIdx = i - 19;
    const stdIdx = i - 19;
    const rsiIdx = i - 14;
    const atrIdx = i - 14;
    
    if (smaIdx < 0 || stdIdx < 0 || rsiIdx < 0 || atrIdx < 0) continue;
    if (smaIdx >= sma20.length || stdIdx >= std20.length || rsiIdx >= rsi14.length || atrIdx >= atr14.length) continue;
    
    const currentSma = sma20[smaIdx];
    const currentStd = std20[stdIdx];
    const currentRsi = rsi14[rsiIdx];
    const currentAtr = atr14[atrIdx];
    
    // BB bands (2 standard deviations)
    const bbUpper = currentSma + 2 * currentStd;
    const bbLower = currentSma - 2 * currentStd;
    
    // Check for extreme (BB + RSI)
    const isLongExtreme = candle.close <= bbLower && currentRsi < 25;
    const isShortExtreme = candle.close >= bbUpper && currentRsi > 75;
    
    if (!isLongExtreme && !isShortExtreme) continue;
    
    // Enter on the extreme candle close
    const entry = candle.close;
    
    // Target: SMA20 (the real mean)
    const target = currentSma;
    
    // SL: beyond the extreme candle's low/high + 1.5 ATR buffer
    const slDistance = currentAtr * 1.5;
    const sl = isLongExtreme 
      ? candle.low - slDistance
      : candle.high + slDistance;
    
    // Confidence: base 70, adjust based on RSI extremity and distance to mean
    let confidence = 70;
    if (isLongExtreme && currentRsi < 20) confidence += 5;
    if (isShortExtreme && currentRsi > 80) confidence += 5;
    
    // Distance to mean (bigger distance = more room to profit)
    const distanceToMeanPips = Math.abs(entry - target) / pip;
    if (distanceToMeanPips > 15) confidence += 5; // Very stretched
    
    const direction = isLongExtreme ? 'LONG' : 'SHORT';
    const reason = `Mean reversion targeting SMA20: BB extreme + RSI ${currentRsi.toFixed(1)}, target ${distanceToMeanPips.toFixed(1)} pips away`;
    
    signals.push({
      pair,
      direction,
      entry,
      sl,
      target,
      candleIndex: i,
      confidence,
      reason
    });
    
    lastSignalTime = ts;
  }
  
  return signals;
}

// Simulate trade targeting SMA20 with time-based exit
function simulateTradeTargetMean(
  pair: string,
  direction: 'LONG' | 'SHORT',
  entry: number,
  sl: number,
  target: number,
  entryTime: string,
  candles: Candle[],
  candleIndex: number,
  confidence: number,
  maxCandles: number = 35 // time-based cutoff
): Trade {
  const isLong = direction === 'LONG';
  const pip = getPipMultiplier(pair);
  const initialRiskPips = Math.abs(entry - sl) / pip;
  const costPips = getRealCost(pair);
  const targetPips = Math.abs(target - entry) / pip;
  
  const r: Trade = { 
    pair, direction, entry, sl, target, entryTime, confidence, 
    slPips: initialRiskPips, targetPips
  };

  const maxLookahead = Math.min(candleIndex + maxCandles, candles.length);
  
  // Track trailing stop (move SL to breakeven after 50% of target reached)
  let trailingSL = sl;
  const breakevenTrigger = isLong 
    ? entry + (target - entry) * 0.5 
    : entry - (entry - target) * 0.5;
  
  for (let i = candleIndex + 1; i < maxLookahead; i++) {
    const c = candles[i];

    // Update trailing SL to breakeven if 50% of target reached
    if (isLong && c.high >= breakevenTrigger && trailingSL < entry) {
      trailingSL = entry; // Move to breakeven
    }
    if (!isLong && c.low <= breakevenTrigger && trailingSL > entry) {
      trailingSL = entry; // Move to breakeven
    }

    // Check SL (with trailing)
    if (isLong && c.low <= trailingSL) {
      r.exitPrice = trailingSL; r.exitTime = c.timestamp; r.exitReason = 'SL';
      r.pips = (trailingSL - entry) / pip - costPips;
      r.r = initialRiskPips > 0 ? r.pips / initialRiskPips : 0;
      r.result = r.pips > 0 ? 'WIN' : 'LOSS';
      return r;
    }
    if (!isLong && c.high >= trailingSL) {
      r.exitPrice = trailingSL; r.exitTime = c.timestamp; r.exitReason = 'SL';
      r.pips = (entry - trailingSL) / pip - costPips;
      r.r = initialRiskPips > 0 ? r.pips / initialRiskPips : 0;
      r.result = r.pips > 0 ? 'WIN' : 'LOSS';
      return r;
    }

    // Check target (SMA20)
    if (isLong && c.high >= target) {
      r.exitPrice = target; r.exitTime = c.timestamp; r.exitReason = 'TARGET_SMA20';
      r.pips = (target - entry) / pip - costPips;
      r.r = initialRiskPips > 0 ? r.pips / initialRiskPips : 0;
      r.result = 'WIN';
      return r;
    }
    if (!isLong && c.low <= target) {
      r.exitPrice = target; r.exitTime = c.timestamp; r.exitReason = 'TARGET_SMA20';
      r.pips = (entry - target) / pip - costPips;
      r.r = initialRiskPips > 0 ? r.pips / initialRiskPips : 0;
      r.result = 'WIN';
      return r;
    }
  }

  // Time-based exit: close at last candle if target not reached
  const lastIdx = maxLookahead - 1;
  const last = candles[lastIdx]?.close ?? entry;
  r.exitPrice = last; r.exitTime = candles[lastIdx]?.timestamp ?? entryTime;
  r.exitReason = 'TIME_CUTOFF';
  r.pips = (isLong ? (last - entry) / pip : (entry - last) / pip) - costPips;
  r.r = initialRiskPips > 0 ? r.pips / initialRiskPips : 0;
  r.result = r.pips > 0 ? 'WIN' : 'LOSS';
  return r;
}

function analyze(label: string, trades: Trade[]) {
  const closed = trades.filter(t => t.result !== 'OPEN');
  const wins = closed.filter(t => t.result === 'WIN');
  const winRate = closed.length ? (wins.length / closed.length) * 100 : 0;

  let totalR = 0;
  let peak = 0, running = 0, maxDD = 0;
  for (const t of closed) {
    const r = t.r ?? 0;
    totalR += r;
    running += r;
    if (running > peak) peak = running;
    const dd = peak - running;
    if (dd > maxDD) maxDD = dd;
  }
  const avgR = closed.length ? totalR / closed.length : 0;
  const avgSlPips = trades.length ? trades.reduce((s, t) => s + t.slPips, 0) / trades.length : 0;
  const avgTargetPips = trades.length ? trades.reduce((s, t) => s + t.targetPips, 0) / trades.length : 0;

  const grossProfit = closed.filter(t => t.r && t.r > 0).reduce((sum, t) => sum + (t.r || 0), 0);
  const grossLoss = Math.abs(closed.filter(t => t.r && t.r < 0).reduce((sum, t) => sum + (t.r || 0), 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  console.log(`  ${label.padEnd(40)} signals:${String(trades.length).padStart(4)} closed:${String(closed.length).padStart(4)} WR:${winRate.toFixed(1).padStart(6)}%  avgR:${avgR.toFixed(3).padStart(7)}  PF:${profitFactor.toFixed(2).padStart(6)}  maxDD(R):${maxDD.toFixed(2).padStart(6)}  avgSL(pips):${avgSlPips.toFixed(1).padStart(6)}  avgTarget(pips):${avgTargetPips.toFixed(1).padStart(6)}`);

  return { label, signals: trades.length, closed: closed.length, winRate, avgR, profitFactor, maxDD, avgSlPips, avgTargetPips };
}

const fs = await import('fs');
const path = await import('path');
const CACHE = path.default.join(process.cwd(), '.cache');

function normalizeTimestamp(ts: string): string {
  return (ts.includes('T') || ts.endsWith('Z')) ? ts : ts.replace(' ', 'T') + 'Z';
}

function loadCache(pair: string): Candle[] | null {
  const f = path.default.join(CACHE, `${pair}_5min_6m.json`);
  if (!fs.default.existsSync(f)) return null;
  const raw: Candle[] = JSON.parse(fs.default.readFileSync(f, 'utf-8'));
  const normalized = raw.map(c => ({ ...c, timestamp: normalizeTimestamp(c.timestamp) }));
  const seen = new Set<string>();
  const dedup = normalized.filter(c => {
    if (seen.has(c.timestamp)) return false;
    seen.add(c.timestamp);
    return true;
  });
  dedup.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  return dedup;
}

async function main() {
  const FOREX_PAIRS = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'USDCAD', 'AUDUSD', 'NZDUSD', 'EURGBP', 'EURJPY', 'GBPJPY', 'AUDJPY', 'CADJPY', 'CHFJPY', 'NZDJPY', 'EURAUD'];

  console.log('\n===================================================================');
  console.log('FOREX MEAN-REVERSION: TARGET THE REAL MEAN (SMA20)');
  console.log('Exit: SMA20 (actual mean) instead of tiny 0.35R fixed target');
  console.log('Secondary exit: time-based cutoff (35 candles) + trailing to BE');
  console.log('Real costs applied from start (Pepperstone RAW spreads + commission)');
  console.log('===================================================================\n');

  // Load all forex data and generate signals
  const allSignals: Record<string, any[]> = {};
  const allCandles: Record<string, Candle[]> = {};
  for (const pair of FOREX_PAIRS) {
    const m5 = loadCache(pair);
    if (!m5 || m5.length < 60) {
      console.warn(`SKIP ${pair}: no/short cache`);
      continue;
    }
    allCandles[pair] = m5;
    allSignals[pair] = scanMeanReversionTargetMean(pair, m5);
  }

  // Determine split time (4 months in = 67% of 6 months)
  const allTimestamps: number[] = [];
  for (const m5 of Object.values(allCandles)) {
    allTimestamps.push(new Date(m5[0].timestamp).getTime());
    allTimestamps.push(new Date(m5[m5.length - 1].timestamp).getTime());
  }
  const minTs = Math.min(...allTimestamps);
  const maxTs = Math.max(...allTimestamps);
  const splitTime = minTs + (maxTs - minTs) * 0.67;
  console.log(`Walk-forward split: ${new Date(splitTime).toISOString().split('T')[0]} (4 months in-sample, 2 months out-of-sample)\n`);

  // Full period test
  console.log('--- Full 6-month period (with real per-pair costs) ---\n');
  const fullPeriodTrades: Trade[] = [];
  for (const [pair, signals] of Object.entries(allSignals)) {
    const m5 = allCandles[pair];
    for (const sig of signals) {
      const trade = simulateTradeTargetMean(
        pair, sig.direction, sig.entry, sig.sl, sig.target,
        m5[sig.candleIndex].timestamp, m5, sig.candleIndex, sig.confidence,
        35 // 35-candle time cutoff
      );
      fullPeriodTrades.push(trade);
    }
  }
  const fullStats = analyze('Target SMA20 (full period)', fullPeriodTrades);

  // Walk-forward: in-sample vs out-of-sample
  console.log('\n--- Walk-forward validation (with real per-pair costs) ---\n');
  const inSample: Trade[] = [];
  const outSample: Trade[] = [];
  for (const [pair, signals] of Object.entries(allSignals)) {
    const m5 = allCandles[pair];
    for (const sig of signals) {
      const trade = simulateTradeTargetMean(
        pair, sig.direction, sig.entry, sig.sl, sig.target,
        m5[sig.candleIndex].timestamp, m5, sig.candleIndex, sig.confidence,
        35
      );
      const ts = new Date(m5[sig.candleIndex].timestamp).getTime();
      if (ts < splitTime) inSample.push(trade);
      else outSample.push(trade);
    }
  }
  const inStats = analyze('Target SMA20 (in-sample)', inSample);
  const outStats = analyze('Target SMA20 (out-of-sample)', outSample);

  // Exit reason breakdown
  console.log('\n--- Exit reason breakdown (full period) ---\n');
  const targetHits = fullPeriodTrades.filter(t => t.exitReason === 'TARGET_SMA20');
  const timeCutoffs = fullPeriodTrades.filter(t => t.exitReason === 'TIME_CUTOFF');
  const slHits = fullPeriodTrades.filter(t => t.exitReason === 'SL');
  console.log(`  Target SMA20 reached: ${targetHits.length} (${(targetHits.length / fullPeriodTrades.length * 100).toFixed(1)}%)`);
  console.log(`  Time cutoff (35 candles): ${timeCutoffs.length} (${(timeCutoffs.length / fullPeriodTrades.length * 100).toFixed(1)}%)`);
  console.log(`  Stop loss hit: ${slHits.length} (${(slHits.length / fullPeriodTrades.length * 100).toFixed(1)}%)`);

  // Comparison with current strategy
  console.log('\n===================================================================');
  console.log('COMPARISON: Target SMA20 vs Current (0.35R fixed TP)');
  console.log('===================================================================\n');
  console.log('                    | Target SMA20 | Current (from previous tests)');
  console.log('  ------------------+--------------+--------------------------------');
  console.log(`  Full period WR    | ${fullStats.winRate.toFixed(1).padStart(5)}%      | 77.0% (with costs)`);
  console.log(`  Full period avgR  | ${fullStats.avgR.toFixed(3).padStart(7)}      | -0.004 (with costs)`);
  console.log(`  Full period PF    | ${fullStats.profitFactor.toFixed(2).padStart(6)}        | 0.98 (with costs)`);
  console.log(`  Full period avgTP | ${fullStats.avgTargetPips.toFixed(1).padStart(5)} pips   | 3.3 pips (0.35R)`);
  console.log(`  In-sample WR      | ${inStats.winRate.toFixed(1).padStart(5)}%      | 76.6% (with costs)`);
  console.log(`  In-sample avgR    | ${inStats.avgR.toFixed(3).padStart(7)}      | -0.046 (with costs)`);
  console.log(`  Out-of-sample WR  | ${outStats.winRate.toFixed(1).padStart(5)}%      | 79.0% (with costs)`);
  console.log(`  Out-of-sample avgR| ${outStats.avgR.toFixed(3).padStart(7)}      | -0.051 (with costs)`);

  // Verdict
  console.log('\n=== VERDICT ===\n');
  const passes = outStats.avgR > 0 && outStats.winRate > 55;
  
  if (passes) {
    console.log('✅ Target SMA20 PASSES walk-forward validation.');
    console.log(`   Out-of-sample avgR: ${outStats.avgR.toFixed(3)}, WR: ${outStats.winRate.toFixed(1)}%`);
    console.log(`   Average target distance: ${outStats.avgTargetPips.toFixed(1)} pips (vs 3.3 pips for 0.35R)`);
    console.log('   Targeting the real mean produces bigger moves that survive costs.');
    console.log('   Recommendation: Worth considering for deployment after further testing.');
  } else {
    console.log('❌ Target SMA20 FAILS walk-forward validation.');
    console.log(`   Out-of-sample avgR: ${outStats.avgR.toFixed(3)}, WR: ${outStats.winRate.toFixed(1)}%`);
    console.log(`   Average target distance: ${outStats.avgTargetPips.toFixed(1)} pips`);
    console.log('   Even targeting the real mean does not produce enough edge after costs.');
    console.log('   Recommendation: Forex mean-reversion is NOT viable after realistic costs.');
    console.log('   Accept this and move to a different strategy type (trend-following/breakout).');
  }

  fs.default.writeFileSync('target-sma20-results.json', JSON.stringify({
    splitTime: new Date(splitTime).toISOString(),
    fullPeriod: fullStats,
    inSample: inStats,
    outOfSample: outStats,
    exitBreakdown: {
      targetHits: targetHits.length,
      timeCutoffs: timeCutoffs.length,
      slHits: slHits.length,
    }
  }, null, 0));
  console.log('\nSaved to target-sma20-results.json');
}

main().catch(e => { console.error(e); process.exit(1); });
