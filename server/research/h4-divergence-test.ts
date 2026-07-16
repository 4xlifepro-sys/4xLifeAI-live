import type { Candle } from '../src/types.js';

// ---------------------------------------------------------------------------
// H4 RSI-DIVERGENCE TREND-REVERSAL STRATEGY
//
// Core idea: H4 moves are much larger than M5, so costs (1.3-2.3 pips) are
// a smaller % of the total move. This may finally overcome the cost problem.
//
// Entry: RSI divergence + break of swing point (confirms reversal)
// SL: Wide (H4 ATR-based, above/below recent swing)
// Exit: Trailing EMA50 (let the reversal run)
//
// Real costs applied from start (Pepperstone RAW spreads + commission).
// Backtest only. No live files touched.
// ---------------------------------------------------------------------------

interface Signal {
  pair: string;
  direction: 'LONG' | 'SHORT';
  entry: number;
  sl: number;
  candleIndex: number;
  confidence: number;
  reason: string;
}

interface Trade {
  pair: string;
  direction: 'LONG' | 'SHORT';
  entry: number;
  sl: number;
  entryTime: string;
  exitTime?: string;
  exitPrice?: number;
  exitReason?: string;
  pips?: number;
  r?: number;
  result?: string;
  confidence: number;
  slPips: number;
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

// --- Indicator math ---
function ema(values: number[], period: number): number[] {
  const result: number[] = [];
  if (values.length < period) return result;
  const k = 2 / (period + 1);
  let prev = 0;
  for (let i = 0; i < period; i++) prev += values[i];
  prev /= period;
  result.push(prev);
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    result.push(prev);
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
    if (i > period) {
      const change = closes[i] - closes[i - 1];
      const gain = change > 0 ? change : 0;
      const loss = change < 0 ? Math.abs(change) : 0;
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
    }
    if (avgLoss === 0) result.push(100);
    else {
      const rs = avgGain / avgLoss;
      result.push(100 - (100 / (1 + rs)));
    }
  }
  return result;
}

function atr(candles: Candle[], period: number = 14): number[] {
  const result: number[] = [];
  if (candles.length < period) return result;
  const trueRanges: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    );
    trueRanges.push(tr);
  }
  let avg = 0;
  for (let i = 0; i < period; i++) avg += trueRanges[i];
  avg /= period;
  result.push(avg);
  for (let i = period; i < trueRanges.length; i++) {
    avg = (avg * (period - 1) + trueRanges[i]) / period;
    result.push(avg);
  }
  return result;
}

// Aggregate M5 candles to H4
function aggregateToH4(m5Candles: Candle[]): Candle[] {
  const h4Candles: Candle[] = [];
  let current: Candle | null = null;
  
  for (const m5 of m5Candles) {
    const m5Hour = new Date(m5.timestamp).getUTCHours();
    const m5Min = new Date(m5.timestamp).getUTCMinutes();
    
    // New H4 candle every 4 hours (0, 4, 8, 12, 16, 20)
    if (m5Hour % 4 === 0 && m5Min === 0) {
      if (current !== null) h4Candles.push(current);
      current = { ...m5 };
    } else if (current !== null) {
      current.high = Math.max(current.high, m5.high);
      current.low = Math.min(current.low, m5.low);
      current.close = m5.close;
    }
  }
  if (current !== null) h4Candles.push(current);
  
  return h4Candles;
}

// Find swing highs/lows
function findSwingHighs(candles: Candle[], lookback: number = 5): number[] {
  const swingHighs: number[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    let isSwing = true;
    for (let j = 1; j <= lookback; j++) {
      if (candles[i].high <= candles[i - j].high || candles[i].high <= candles[i + j].high) {
        isSwing = false;
        break;
      }
    }
    if (isSwing) swingHighs.push(i);
  }
  return swingHighs;
}

function findSwingLows(candles: Candle[], lookback: number = 5): number[] {
  const swingLows: number[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    let isSwing = true;
    for (let j = 1; j <= lookback; j++) {
      if (candles[i].low >= candles[i - j].low || candles[i].low >= candles[i + j].low) {
        isSwing = false;
        break;
      }
    }
    if (isSwing) swingLows.push(i);
  }
  return swingLows;
}

// Detect RSI divergence
function detectDivergence(
  candles: Candle[],
  rsiValues: number[],
  currentIndex: number,
  lookback: number = 30
): { type: 'BULLISH' | 'BEARISH' | null; swingIndex: number } {
  if (currentIndex < lookback + 10) return { type: null, swingIndex: -1 };
  
  // Find recent swing highs and lows
  const recentCandles = candles.slice(Math.max(0, currentIndex - lookback), currentIndex + 1);
  const recentRsi = rsiValues.slice(Math.max(0, currentIndex - lookback), currentIndex + 1);
  
  const swingHighs = findSwingHighs(recentCandles, 3);
  const swingLows = findSwingLows(recentCandles, 3);
  
  // Check for bearish divergence (for SELL setups)
  // Price makes higher high, RSI makes lower high
  if (swingHighs.length >= 2) {
    const lastSwing = swingHighs[swingHighs.length - 1];
    const prevSwing = swingHighs[swingHighs.length - 2];
    
    const priceHigher = recentCandles[lastSwing].high > recentCandles[prevSwing].high;
    const rsiLower = recentRsi[lastSwing] < recentRsi[prevSwing];
    
    if (priceHigher && rsiLower) {
      return { type: 'BEARISH', swingIndex: Math.max(0, currentIndex - lookback) + lastSwing };
    }
  }
  
  // Check for bullish divergence (for BUY setups)
  // Price makes lower low, RSI makes higher low
  if (swingLows.length >= 2) {
    const lastSwing = swingLows[swingLows.length - 1];
    const prevSwing = swingLows[swingLows.length - 2];
    
    const priceLower = recentCandles[lastSwing].low < recentCandles[prevSwing].low;
    const rsiHigher = recentRsi[lastSwing] > recentRsi[prevSwing];
    
    if (priceLower && rsiHigher) {
      return { type: 'BULLISH', swingIndex: Math.max(0, currentIndex - lookback) + lastSwing };
    }
  }
  
  return { type: null, swingIndex: -1 };
}

// --- Scan for H4 RSI divergence signals ---
function scanH4Divergence(pair: string, m5Candles: Candle[]): Signal[] {
  const signals: Signal[] = [];
  if (m5Candles.length < 5000) return signals; // Need enough M5 data for H4

  const pipMultiplier = getPipMultiplier(pair);
  
  // Aggregate M5 to H4
  const h4Candles = aggregateToH4(m5Candles);
  if (h4Candles.length < 200) return signals;
  
  // H4 indicators
  const h4Closes = h4Candles.map(c => c.close);
  const h4Ema20 = ema(h4Closes, 20);
  const h4Ema50 = ema(h4Closes, 50);
  const h4Ema100 = ema(h4Closes, 100);
  const h4Rsi = rsi(h4Closes, 14);
  const h4Atr = atr(h4Candles, 14);
  
  const MIN_SIGNAL_GAP_H4 = 6; // Minimum 6 H4 candles between signals (24 hours)
  let lastSignalH4Idx = -100;
  
  // Start from index 150 (need EMAs warmed up)
  for (let i = 150; i < h4Candles.length - 5; i++) {
    if (i - lastSignalH4Idx < MIN_SIGNAL_GAP_H4) continue;
    
    const current = h4Candles[i];
    const ema20 = h4Ema20[i - 19];
    const ema50 = h4Ema50[i - 49];
    const ema100 = h4Ema100[i - 99];
    const rsiVal = h4Rsi[i - 14];
    const atrVal = h4Atr[i - 14];
    
    if (ema20 === undefined || ema50 === undefined || ema100 === undefined || 
        rsiVal === undefined || atrVal === undefined) continue;
    
    // Detect divergence
    const divergence = detectDivergence(h4Candles, h4Rsi, i, 30);
    if (divergence.type === null) continue;
    
    // Entry trigger: wait for break of swing point after divergence
    const swingIdx = divergence.swingIndex;
    if (swingIdx < 0 || swingIdx >= i - 2) continue; // Need at least 2 candles after swing
    
    const swingPrice = divergence.type === 'BEARISH' 
      ? h4Candles[swingIdx].high 
      : h4Candles[swingIdx].low;
    
    // Check if price has broken the swing point (confirms reversal)
    const brokenSwing = divergence.type === 'BEARISH'
      ? current.close < swingPrice
      : current.close > swingPrice;
    
    if (!brokenSwing) continue;
    
    // Entry on the break
    const entry = current.close;
    
    // SL: above/below the swing with ATR buffer
    const slBuffer = atrVal * 0.5;
    const sl = divergence.type === 'BEARISH'
      ? swingPrice + slBuffer
      : swingPrice - slBuffer;
    
    // Confidence: base 70, adjust based on trend context
    let confidence = 70;
    
    // Trend context (not required to be perfect, but helps)
    if (divergence.type === 'BEARISH') {
      // For SELL: prefer if price was above EMAs (uptrend exhausting)
      if (current.close > ema20 && current.close > ema50) confidence += 5;
      if (rsiVal > 60) confidence += 5; // RSI was elevated
    } else {
      // For BUY: prefer if price was below EMAs (downtrend exhausting)
      if (current.close < ema20 && current.close < ema50) confidence += 5;
      if (rsiVal < 40) confidence += 5; // RSI was depressed
    }
    
    const direction = divergence.type === 'BEARISH' ? 'SHORT' : 'LONG';
    const slPips = Math.abs(entry - sl) / pipMultiplier;
    
    signals.push({
      pair, direction, entry, sl,
      candleIndex: i, // H4 index
      confidence: Math.min(confidence, 85),
      reason: `H4 RSI ${divergence.type} divergence, break of swing ${slPips.toFixed(0)} pips SL`
    });
    
    lastSignalH4Idx = i;
  }
  
  return signals;
}

// --- Simulate trade with trailing EMA50 exit + real costs ---
function simulateTrade(
  pair: string,
  direction: 'LONG' | 'SHORT',
  entry: number,
  sl: number,
  entryTime: string,
  h4Candles: Candle[],
  h4CandleIndex: number,
  confidence: number
): Trade {
  const isLong = direction === 'LONG';
  const pip = getPipMultiplier(pair);
  const initialRiskPips = Math.abs(entry - sl) / pip;
  const costPips = getRealCost(pair);

  // Build trailing EMA50
  const trailEmaPeriod = 50;
  const trailStartIdx = Math.max(0, h4CandleIndex - trailEmaPeriod + 1);
  const trailCloses = [];
  for (let i = trailStartIdx; i <= h4CandleIndex; i++) {
    trailCloses.push(h4Candles[i].close);
  }
  const trailEma = ema(trailCloses, trailEmaPeriod);
  let currentTrailEma = trailEma[trailEma.length - 1];

  const r: Trade = {
    pair, direction, entry, sl, entryTime, confidence,
    slPips: initialRiskPips
  };

  const maxLookahead = Math.min(h4CandleIndex + 100, h4Candles.length); // Max 100 H4 candles (400 hours)
  const alpha = 2 / (trailEmaPeriod + 1);

  for (let i = h4CandleIndex + 1; i < maxLookahead; i++) {
    const c = h4Candles[i];

    // Update trailing EMA
    currentTrailEma = alpha * c.close + (1 - alpha) * currentTrailEma;

    // Check SL first
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

    // Check trailing EMA exit (only after >= 1R profit)
    const favorablePips = isLong ? (c.close - entry) / pip : (entry - c.close) / pip;
    if (favorablePips >= initialRiskPips) {
      const closedThroughTrail = isLong ? c.close < currentTrailEma : c.close > currentTrailEma;
      if (closedThroughTrail) {
        r.exitPrice = c.close; r.exitTime = c.timestamp; r.exitReason = 'TRAIL_EMA50';
        r.pips = (isLong ? (c.close - entry) / pip : (entry - c.close) / pip) - costPips;
        r.r = initialRiskPips > 0 ? r.pips / initialRiskPips : 0;
        r.result = r.pips > 0 ? 'WIN' : 'LOSS';
        return r;
      }
    }
  }

  // Still open
  const lastIdx = maxLookahead - 1;
  const last = h4Candles[lastIdx]?.close ?? entry;
  r.exitPrice = last; r.exitTime = h4Candles[lastIdx]?.timestamp ?? entryTime;
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
  const avgWinPips = wins.length ? wins.reduce((s, t) => s + (t.pips || 0), 0) / wins.length : 0;

  const grossProfit = closed.filter(t => t.r && t.r > 0).reduce((sum, t) => sum + (t.r || 0), 0);
  const grossLoss = Math.abs(closed.filter(t => t.r && t.r < 0).reduce((sum, t) => sum + (t.r || 0), 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  console.log(`  ${label.padEnd(40)} signals:${String(trades.length).padStart(4)} closed:${String(closed.length).padStart(4)} WR:${winRate.toFixed(1).padStart(6)}%  avgR:${avgR.toFixed(3).padStart(7)}  PF:${profitFactor.toFixed(2).padStart(6)}  maxDD(R):${maxDD.toFixed(2).padStart(6)}  avgSL(pips):${avgSlPips.toFixed(1).padStart(6)}  avgWin(pips):${avgWinPips.toFixed(1).padStart(6)}`);

  return { label, signals: trades.length, closed: closed.length, winRate, avgR, profitFactor, maxDD, avgSlPips, avgWinPips };
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
  console.log('H4 RSI-DIVERGENCE TREND-REVERSAL STRATEGY');
  console.log('Core idea: H4 moves are larger, costs are smaller % of move');
  console.log('Entry: RSI divergence + break of swing point');
  console.log('SL: Wide (H4 ATR-based), Exit: Trailing EMA50');
  console.log('Real costs applied from start (Pepperstone RAW spreads + commission)');
  console.log('===================================================================\n');

  // Load all forex data and generate signals
  const allSignals: Record<string, Signal[]> = {};
  const allH4Candles: Record<string, Candle[]> = {};
  for (const pair of FOREX_PAIRS) {
    const m5 = loadCache(pair);
    if (!m5 || m5.length < 5000) {
      console.warn(`SKIP ${pair}: no/short cache`);
      continue;
    }
    const h4 = aggregateToH4(m5);
    allH4Candles[pair] = h4;
    allSignals[pair] = scanH4Divergence(pair, m5);
    console.log(`  ${pair}: ${allSignals[pair].length} signals`);
  }

  const totalSignals = Object.values(allSignals).reduce((s, a) => s + a.length, 0);
  console.log(`\nTotal signals across ${FOREX_PAIRS.length} pairs: ${totalSignals}\n`);

  if (totalSignals === 0) {
    console.log('ZERO signals generated. Divergence detection too restrictive.');
    return;
  }

  // Determine split time
  const allTimestamps: number[] = [];
  for (const h4 of Object.values(allH4Candles)) {
    allTimestamps.push(new Date(h4[0].timestamp).getTime());
    allTimestamps.push(new Date(h4[h4.length - 1].timestamp).getTime());
  }
  const minTs = Math.min(...allTimestamps);
  const maxTs = Math.max(...allTimestamps);
  const splitTime = minTs + (maxTs - minTs) * 0.67;
  console.log(`Walk-forward split: ${new Date(splitTime).toISOString().split('T')[0]}\n`);

  // Full period
  console.log('--- Full 6-month period (with real per-pair costs) ---\n');
  const fullPeriodTrades: Trade[] = [];
  for (const [pair, signals] of Object.entries(allSignals)) {
    const h4 = allH4Candles[pair];
    for (const sig of signals) {
      const trade = simulateTrade(
        pair, sig.direction, sig.entry, sig.sl,
        h4[sig.candleIndex].timestamp, h4, sig.candleIndex, sig.confidence
      );
      fullPeriodTrades.push(trade);
    }
  }
  const fullStats = analyze('H4 divergence (full period)', fullPeriodTrades);

  // Per-pair breakdown
  console.log('\n--- Per-pair breakdown (full period, with costs) ---\n');
  for (const pair of FOREX_PAIRS) {
    const pairTrades = fullPeriodTrades.filter(t => t.pair === pair);
    if (pairTrades.length === 0) continue;
    analyze(`  ${pair}`, pairTrades);
  }

  // Walk-forward
  console.log('\n--- Walk-forward validation (with real per-pair costs) ---\n');
  const inSample: Trade[] = [];
  const outSample: Trade[] = [];
  for (const [pair, signals] of Object.entries(allSignals)) {
    const h4 = allH4Candles[pair];
    for (const sig of signals) {
      const trade = simulateTrade(
        pair, sig.direction, sig.entry, sig.sl,
        h4[sig.candleIndex].timestamp, h4, sig.candleIndex, sig.confidence
      );
      const ts = new Date(h4[sig.candleIndex].timestamp).getTime();
      if (ts < splitTime) inSample.push(trade);
      else outSample.push(trade);
    }
  }
  const inStats = analyze('H4 divergence (in-sample)', inSample);
  const outStats = analyze('H4 divergence (out-of-sample)', outSample);

  // Exit reason breakdown
  console.log('\n--- Exit reason breakdown (full period) ---\n');
  const trailExits = fullPeriodTrades.filter(t => t.exitReason === 'TRAIL_EMA50');
  const slHits = fullPeriodTrades.filter(t => t.exitReason === 'SL');
  const openTrades = fullPeriodTrades.filter(t => t.exitReason === 'OPEN');
  console.log(`  Trailing EMA50 exit: ${trailExits.length} (${(trailExits.length / fullPeriodTrades.length * 100).toFixed(1)}%)`);
  console.log(`  Stop loss hit: ${slHits.length} (${(slHits.length / fullPeriodTrades.length * 100).toFixed(1)}%)`);
  console.log(`  Still open: ${openTrades.length} (${(openTrades.length / fullPeriodTrades.length * 100).toFixed(1)}%)`);

  // Comparison
  console.log('\n===================================================================');
  console.log('COMPARISON: H4 Divergence vs All Previous Forex Tests');
  console.log('===================================================================\n');
  console.log('                    | H4 Divergence | Best Previous (TP1 min 8)');
  console.log('  ------------------+----------------+--------------------------');
  console.log(`  Full period WR    | ${fullStats.winRate.toFixed(1).padStart(5)}%        | 77.0%`);
  console.log(`  Full period avgR  | ${fullStats.avgR.toFixed(3).padStart(7)}        | -0.004`);
  console.log(`  Full period PF    | ${fullStats.profitFactor.toFixed(2).padStart(6)}          | 0.98`);
  console.log(`  Full period avgSL | ${fullStats.avgSlPips.toFixed(1).padStart(5)} pips       | 9.4 pips`);
  console.log(`  Full period avgWin| ${fullStats.avgWinPips.toFixed(1).padStart(5)} pips       | N/A`);
  console.log(`  In-sample WR      | ${inStats.winRate.toFixed(1).padStart(5)}%        | 76.6%`);
  console.log(`  In-sample avgR    | ${inStats.avgR.toFixed(3).padStart(7)}        | -0.046`);
  console.log(`  Out-of-sample WR  | ${outStats.winRate.toFixed(1).padStart(5)}%        | 65.5%`);
  console.log(`  Out-of-sample avgR| ${outStats.avgR.toFixed(3).padStart(7)}        | +0.004`);

  // Verdict
  console.log('\n=== VERDICT ===\n');
  const passes = outStats.avgR > 0 && outStats.winRate > 35 && outStats.profitFactor > 1.0;

  if (passes) {
    console.log('✅ H4 RSI Divergence PASSES walk-forward validation!');
    console.log(`   Out-of-sample avgR: ${outStats.avgR.toFixed(3)}, WR: ${outStats.winRate.toFixed(1)}%, PF: ${outStats.profitFactor.toFixed(2)}`);
    console.log(`   Average SL: ${outStats.avgSlPips.toFixed(0)} pips, Average Win: ${outStats.avgWinPips.toFixed(0)} pips`);
    console.log('   The H4 timeframe finally overcomes the cost problem!');
    console.log('   Recommendation: WORTH TESTING FOR DEPLOYMENT.');
  } else {
    console.log('❌ H4 RSI Divergence FAILS walk-forward validation.');
    console.log(`   Out-of-sample avgR: ${outStats.avgR.toFixed(3)}, WR: ${outStats.winRate.toFixed(1)}%, PF: ${outStats.profitFactor.toFixed(2)}`);
    console.log('   Even H4 timeframe does not overcome the cost problem for forex.');
    console.log('   This is strong evidence forex needs even longer timeframes (D1/W1)');
    console.log('   or is not viable for this signal-service model at all.');
  }

  fs.default.writeFileSync('h4-divergence-results.json', JSON.stringify({
    splitTime: new Date(splitTime).toISOString(),
    totalSignals,
    fullPeriod: fullStats,
    inSample: inStats,
    outOfSample: outStats,
    exitBreakdown: {
      trailExits: trailExits.length,
      slHits: slHits.length,
      openTrades: openTrades.length,
    }
  }, null, 0));
  console.log('\nSaved to h4-divergence-results.json');
}

main().catch(e => { console.error(e); process.exit(1); });
