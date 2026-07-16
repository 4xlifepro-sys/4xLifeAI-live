import type { Candle } from '../src/types.js';

// ---------------------------------------------------------------------------
// FOREX MEAN-REVERSION WITH CONFIRMATION DELAY
// 
// Instead of entering immediately when BB extreme + RSI extreme is hit,
// wait 1-2 candles to confirm the reversal is actually starting.
// This sacrifices some early entries but produces trades with more
// immediate follow-through and bigger real profits.
//
// Real costs applied from start (Pepperstone RAW spreads + commission).
// ---------------------------------------------------------------------------

interface Signal {
  pair: string;
  direction: 'LONG' | 'SHORT';
  entry: number;
  sl: number;
  tp1: number;
  tp2: number;
  tp3: number;
  candleIndex: number;
  confidence: number;
  reason: string;
}

interface Trade {
  pair: string;
  direction: 'LONG' | 'SHORT';
  entry: number;
  sl: number;
  tp1: number;
  tp2: number;
  tp3: number;
  entryTime: string;
  exitTime?: string;
  exitPrice?: number;
  exitReason?: string;
  pips?: number;
  r?: number;
  result?: string;
  confidence: number;
  slPips: number;
  tp1Pips: number;
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

// Scan for mean-reversion signals with confirmation delay
export function scanMeanReversionWithConfirmation(
  pair: string,
  m5Candles: Candle[],
  confirmationCandles: number = 2 // wait 2 candles to confirm reversal
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
  for (let i = 50; i < m5Candles.length - confirmationCandles; i++) {
    const candle = m5Candles[i];
    const ts = new Date(candle.timestamp).getTime();
    
    // Check signal gap
    if (ts - lastSignalTime < MIN_SIGNAL_GAP_MS) continue;
    
    // Skip if indicators not ready
    const smaIdx = i - 19; // sma20 aligns at index 19
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
    
    // === CONFIRMATION DELAY ===
    // Wait for confirmationCandles to see if reversal is starting
    let confirmed = false;
    let confirmationIdx = -1;
    
    for (let j = 1; j <= confirmationCandles; j++) {
      const confirmCandle = m5Candles[i + j];
      if (!confirmCandle) break;
      
      if (isLongExtreme) {
        // For long: price should start moving up (reversal confirmed)
        if (confirmCandle.close > candle.close) {
          confirmed = true;
          confirmationIdx = i + j;
          break;
        }
      } else {
        // For short: price should start moving down (reversal confirmed)
        if (confirmCandle.close < candle.close) {
          confirmed = true;
          confirmationIdx = i + j;
          break;
        }
      }
    }
    
    if (!confirmed) continue; // Reversal not confirmed, skip
    
    // Enter on the confirmation candle
    const entryCandle = m5Candles[confirmationIdx];
    const entry = entryCandle.close;
    
    // SL: beyond the extreme candle's low/high + 1 ATR buffer
    const slDistance = currentAtr * 1.5;
    const sl = isLongExtreme 
      ? Math.min(candle.low, entryCandle.low) - slDistance
      : Math.max(candle.high, entryCandle.high) + slDistance;
    
    // TPs: 0.35R / 0.9R / 1.8R
    const risk = Math.abs(entry - sl);
    const tp1 = isLongExtreme ? entry + risk * 0.35 : entry - risk * 0.35;
    const tp2 = isLongExtreme ? entry + risk * 0.9 : entry - risk * 0.9;
    const tp3 = isLongExtreme ? entry + risk * 1.8 : entry - risk * 1.8;
    
    // Confidence: base 70, adjust based on RSI extremity
    let confidence = 70;
    if (isLongExtreme && currentRsi < 20) confidence += 5;
    if (isShortExtreme && currentRsi > 80) confidence += 5;
    if (currentAtr > currentAtr * 1.2) confidence += 5; // ATR expansion
    
    const direction = isLongExtreme ? 'LONG' : 'SHORT';
    const reason = `Mean reversion with ${confirmationCandles}-candle confirmation: BB extreme + RSI ${currentRsi.toFixed(1)}, reversal confirmed`;
    
    signals.push({
      pair,
      direction,
      entry,
      sl,
      tp1,
      tp2,
      tp3,
      candleIndex: confirmationIdx,
      confidence,
      reason
    });
    
    lastSignalTime = ts;
  }
  
  return signals;
}

// Simulate trade with realistic costs
function simulateTrade(
  pair: string,
  direction: 'LONG' | 'SHORT',
  entry: number,
  sl: number,
  tp1: number,
  tp2: number,
  tp3: number,
  entryTime: string,
  candles: Candle[],
  candleIndex: number,
  confidence: number
): Trade {
  const isLong = direction === 'LONG';
  const pip = getPipMultiplier(pair);
  const initialRiskPips = Math.abs(entry - sl) / pip;
  const costPips = getRealCost(pair);
  
  const r: Trade = { 
    pair, direction, entry, sl, tp1, tp2, tp3, entryTime, confidence, 
    slPips: initialRiskPips, tp1Pips: Math.abs(tp1 - entry) / pip
  };

  const maxLookahead = Math.min(candleIndex + 2001, candles.length);
  for (let i = candleIndex + 1; i < maxLookahead; i++) {
    const c = candles[i];

    // Check SL
    if (isLong && c.low <= sl) {
      r.exitPrice = sl; r.exitTime = c.timestamp; r.exitReason = 'SL';
      r.pips = (sl - entry) / pip - costPips;
      r.r = initialRiskPips > 0 ? r.pips / initialRiskPips : 0;
      r.result = r.pips > 0 ? 'WIN' : 'LOSS';
      return r;
    }
    if (!isLong && c.high >= sl) {
      r.exitPrice = sl; r.exitTime = c.timestamp; r.exitReason = 'SL';
      r.pips = (entry - sl) / pip - costPips;
      r.r = initialRiskPips > 0 ? r.pips / initialRiskPips : 0;
      r.result = r.pips > 0 ? 'WIN' : 'LOSS';
      return r;
    }

    // Check TPs
    if (isLong) {
      if (c.high >= tp3) {
        r.exitPrice = tp3; r.exitTime = c.timestamp; r.exitReason = 'TP3';
        r.pips = (tp3 - entry) / pip - costPips;
        r.r = initialRiskPips > 0 ? r.pips / initialRiskPips : 0;
        r.result = 'WIN'; return r;
      }
      if (c.high >= tp2) {
        r.exitPrice = tp2; r.exitTime = c.timestamp; r.exitReason = 'TP2';
        r.pips = (tp2 - entry) / pip - costPips;
        r.r = initialRiskPips > 0 ? r.pips / initialRiskPips : 0;
        r.result = 'WIN'; return r;
      }
      if (c.high >= tp1) {
        r.exitPrice = tp1; r.exitTime = c.timestamp; r.exitReason = 'TP1';
        r.pips = (tp1 - entry) / pip - costPips;
        r.r = initialRiskPips > 0 ? r.pips / initialRiskPips : 0;
        r.result = 'WIN'; return r;
      }
    } else {
      if (c.low <= tp3) {
        r.exitPrice = tp3; r.exitTime = c.timestamp; r.exitReason = 'TP3';
        r.pips = (entry - tp3) / pip - costPips;
        r.r = initialRiskPips > 0 ? r.pips / initialRiskPips : 0;
        r.result = 'WIN'; return r;
      }
      if (c.low <= tp2) {
        r.exitPrice = tp2; r.exitTime = c.timestamp; r.exitReason = 'TP2';
        r.pips = (entry - tp2) / pip - costPips;
        r.r = initialRiskPips > 0 ? r.pips / initialRiskPips : 0;
        r.result = 'WIN'; return r;
      }
      if (c.low <= tp1) {
        r.exitPrice = tp1; r.exitTime = c.timestamp; r.exitReason = 'TP1';
        r.pips = (entry - tp1) / pip - costPips;
        r.r = initialRiskPips > 0 ? r.pips / initialRiskPips : 0;
        r.result = 'WIN'; return r;
      }
    }
  }

  // Trade still open
  const lastIdx = maxLookahead - 1;
  const last = candles[lastIdx]?.close ?? entry;
  r.exitPrice = last; r.exitTime = candles[lastIdx]?.timestamp ?? entryTime;
  r.exitReason = 'OPEN'; r.result = 'OPEN';
  r.pips = (isLong ? (last - entry) / pip : (entry - last) / pip) - costPips;
  r.r = initialRiskPips > 0 ? r.pips / initialRiskPips : 0;
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
  const avgTp1Pips = trades.length ? trades.reduce((s, t) => s + t.tp1Pips, 0) / trades.length : 0;

  const grossProfit = closed.filter(t => t.r && t.r > 0).reduce((sum, t) => sum + (t.r || 0), 0);
  const grossLoss = Math.abs(closed.filter(t => t.r && t.r < 0).reduce((sum, t) => sum + (t.r || 0), 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  console.log(`  ${label.padEnd(40)} signals:${String(trades.length).padStart(4)} closed:${String(closed.length).padStart(4)} WR:${winRate.toFixed(1).padStart(6)}%  avgR:${avgR.toFixed(3).padStart(7)}  PF:${profitFactor.toFixed(2).padStart(6)}  maxDD(R):${maxDD.toFixed(2).padStart(6)}  avgSL(pips):${avgSlPips.toFixed(1).padStart(6)}  avgTP1(pips):${avgTp1Pips.toFixed(1).padStart(6)}`);

  return { label, signals: trades.length, closed: closed.length, winRate, avgR, profitFactor, maxDD, avgSlPips, avgTp1Pips };
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
  console.log('FOREX MEAN-REVERSION WITH CONFIRMATION DELAY');
  console.log('Option B: Wait 2 candles to confirm reversal before entering');
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
    allSignals[pair] = scanMeanReversionWithConfirmation(pair, m5, 2); // 2-candle confirmation
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
      const trade = simulateTrade(
        pair, sig.direction, sig.entry, sig.sl, sig.tp1, sig.tp2, sig.tp3,
        m5[sig.candleIndex].timestamp, m5, sig.candleIndex, sig.confidence
      );
      fullPeriodTrades.push(trade);
    }
  }
  const fullStats = analyze('Confirmation delay (full period)', fullPeriodTrades);

  // Walk-forward: in-sample vs out-of-sample
  console.log('\n--- Walk-forward validation (with real per-pair costs) ---\n');
  const inSample: Trade[] = [];
  const outSample: Trade[] = [];
  for (const [pair, signals] of Object.entries(allSignals)) {
    const m5 = allCandles[pair];
    for (const sig of signals) {
      const trade = simulateTrade(
        pair, sig.direction, sig.entry, sig.sl, sig.tp1, sig.tp2, sig.tp3,
        m5[sig.candleIndex].timestamp, m5, sig.candleIndex, sig.confidence
      );
      const ts = new Date(m5[sig.candleIndex].timestamp).getTime();
      if (ts < splitTime) inSample.push(trade);
      else outSample.push(trade);
    }
  }
  const inStats = analyze('Confirmation delay (in-sample)', inSample);
  const outStats = analyze('Confirmation delay (out-of-sample)', outSample);

  // Comparison with current strategy
  console.log('\n===================================================================');
  console.log('COMPARISON: Confirmation Delay vs Current (no confirmation)');
  console.log('===================================================================\n');
  console.log('                    | Confirmation Delay | Current (from previous tests)');
  console.log('  ------------------+--------------------+--------------------------------');
  console.log(`  Full period WR    | ${fullStats.winRate.toFixed(1).padStart(5)}%           | 77.0% (with costs)`);
  console.log(`  Full period avgR  | ${fullStats.avgR.toFixed(3).padStart(7)}           | -0.004 (with costs)`);
  console.log(`  Full period PF    | ${fullStats.profitFactor.toFixed(2).padStart(6)}             | 0.98 (with costs)`);
  console.log(`  In-sample WR      | ${inStats.winRate.toFixed(1).padStart(5)}%           | 76.6% (with costs)`);
  console.log(`  In-sample avgR    | ${inStats.avgR.toFixed(3).padStart(7)}           | -0.046 (with costs)`);
  console.log(`  Out-of-sample WR  | ${outStats.winRate.toFixed(1).padStart(5)}%           | 79.0% (with costs)`);
  console.log(`  Out-of-sample avgR| ${outStats.avgR.toFixed(3).padStart(7)}           | -0.051 (with costs)`);

  // Verdict
  console.log('\n=== VERDICT ===\n');
  const passes = outStats.avgR > 0 && outStats.winRate > 55;
  
  if (passes) {
    console.log('✅ Confirmation delay PASSES walk-forward validation.');
    console.log(`   Out-of-sample avgR: ${outStats.avgR.toFixed(3)}, WR: ${outStats.winRate.toFixed(1)}%`);
    console.log('   The 2-candle confirmation produces bigger moves that survive costs.');
    console.log('   Recommendation: Worth considering for deployment after further testing.');
  } else {
    console.log('❌ Confirmation delay FAILS walk-forward validation.');
    console.log(`   Out-of-sample avgR: ${outStats.avgR.toFixed(3)}, WR: ${outStats.winRate.toFixed(1)}%`);
    console.log('   The confirmation delay does not improve profitability enough.');
    console.log('   Recommendation: Forex mean-reversion entry logic is not viable after costs.');
    console.log('   Consider a completely different strategy (trend-following, breakout, etc.).');
  }

  fs.default.writeFileSync('confirmation-delay-results.json', JSON.stringify({
    splitTime: new Date(splitTime).toISOString(),
    fullPeriod: fullStats,
    inSample: inStats,
    outOfSample: outStats,
  }, null, 0));
  console.log('\nSaved to confirmation-delay-results.json');
}

main().catch(e => { console.error(e); process.exit(1); });
