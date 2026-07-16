import type { Candle } from '../src/types.js';

// ---------------------------------------------------------------------------
// D1 MULTI-INDICATOR CONFLUENCE STRATEGY
//
// Final attempt: Daily timeframe with 5-indicator confluence
// - EMA200 (trend direction)
// - RSI (momentum)
// - MACD (confirmation)
// - Bollinger Bands (volatility)
// - ATR (SL sizing)
// - Trailing EMA50 (exit)
//
// If this fails, forex is not viable for this signal-service model.
// Real costs applied from start (Pepperstone RAW spreads + commission).
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

function macd(closes: number[], fast: number = 12, slow: number = 26, signal: number = 9): { macd: number[]; signal: number[]; histogram: number[] } {
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const macdLine: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < slow - 1) {
      macdLine.push(0);
    } else {
      macdLine.push(emaFast[i] - emaSlow[i]);
    }
  }
  const signalLine = ema(macdLine, signal);
  const histogram: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    histogram.push(macdLine[i] - signalLine[i]);
  }
  return { macd: macdLine, signal: signalLine, histogram };
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

// Aggregate M5 candles to D1
function aggregateToD1(m5Candles: Candle[]): Candle[] {
  const d1Candles: Candle[] = [];
  let current: Candle | null = null;
  
  for (const m5 of m5Candles) {
    const m5Hour = new Date(m5.timestamp).getUTCHours();
    const m5Min = new Date(m5.timestamp).getUTCMinutes();
    
    // New D1 candle at midnight UTC
    if (m5Hour === 0 && m5Min === 0) {
      if (current !== null) d1Candles.push(current);
      current = { ...m5 };
    } else if (current !== null) {
      current.high = Math.max(current.high, m5.high);
      current.low = Math.min(current.low, m5.low);
      current.close = m5.close;
    }
  }
  if (current !== null) d1Candles.push(current);
  
  return d1Candles;
}

// --- Scan for D1 multi-indicator confluence signals ---
function scanD1Confluence(pair: string, m5Candles: Candle[]): Signal[] {
  const signals: Signal[] = [];
  if (m5Candles.length < 5000) return signals; // Need enough M5 data for D1

  const pipMultiplier = getPipMultiplier(pair);
  
  // Aggregate M5 to D1
  const d1Candles = aggregateToD1(m5Candles);
  if (d1Candles.length < 100) return signals;
  
  // D1 indicators (use EMA100 instead of EMA200 since we only have ~180 D1 candles)
  const d1Closes = d1Candles.map(c => c.close);
  const d1Ema100 = ema(d1Closes, 100);
  const d1Ema50 = ema(d1Closes, 50);
  const d1Rsi = rsi(d1Closes, 14);
  const d1Macd = macd(d1Closes, 12, 26, 9);
  const d1Atr = atr(d1Candles, 14);
  
  // Bollinger Bands
  const d1Sma20 = sma(d1Closes, 20);
  const d1Std20 = stddev(d1Closes, d1Sma20, 20);
  
  const MIN_SIGNAL_GAP_D1 = 3; // Minimum 3 days between signals
  let lastSignalD1Idx = -100;
  
  // Start from index 100 (need EMA100 warmed up)
  for (let i = 100; i < d1Candles.length - 5; i++) {
    if (i - lastSignalD1Idx < MIN_SIGNAL_GAP_D1) continue;
    
    const current = d1Candles[i];
    const ema100 = d1Ema100[i - 99];
    const ema50 = d1Ema50[i - 49];
    const rsiVal = d1Rsi[i - 14];
    const macdVal = d1Macd.macd[i];
    const macdSignal = d1Macd.signal[i];
    const macdHist = d1Macd.histogram[i];
    const atrVal = d1Atr[i - 14];
    const sma20 = d1Sma20[i - 19];
    const std20 = d1Sma20.length > i - 19 ? d1Std20[i - 19] : undefined;
    
    if (ema100 === undefined || ema50 === undefined || rsiVal === undefined || 
        atrVal === undefined || sma20 === undefined || std20 === undefined) continue;
    
    const bbUpper = sma20 + 2 * std20;
    const bbLower = sma20 - 2 * std20;
    
    // --- LONG setup (3-of-5 indicator confluence) ---
    let longScore = 0;
    if (current.close > ema100) longScore++;
    if (rsiVal >= 40 && rsiVal <= 70) longScore++;
    if (macdHist > 0 || macdVal > macdSignal) longScore++;
    if (current.close <= bbLower || current.close <= sma20) longScore++;
    const atrAvg20 = d1Atr.slice(Math.max(0, i - 33), i - 14).reduce((a, b) => a + b, 0) / Math.min(20, i - 14);
    const atrExpansion = atrVal > atrAvg20;
    if (atrExpansion) longScore++;
    
    if (longScore >= 3) {
      const entry = current.close;
      const sl = entry - atrVal * 2;
      const slPips = Math.abs(entry - sl) / pipMultiplier;
      
      let confidence = 65 + longScore * 5;
      if (rsiVal >= 45 && rsiVal <= 60) confidence += 3;
      if (current.close > ema50) confidence += 3;
      
      signals.push({
        pair, direction: 'LONG', entry, sl,
        candleIndex: i, confidence: Math.min(confidence, 90),
        reason: `D1 ${longScore}/5 confluence LONG: EMA100${current.close > ema100 ? '+' : '-'}, RSI${rsiVal.toFixed(0)}, MACD${macdHist > 0 ? '+' : '-'}, BB${current.close <= sma20 ? 'pullback' : 'above'}, ATR${atrExpansion ? 'exp' : 'flat'}, SL ${slPips.toFixed(0)} pips`
      });
      lastSignalD1Idx = i;
      continue;
    }
    
    // --- SHORT setup (3-of-5 indicator confluence) ---
    let shortScore = 0;
    if (current.close < ema100) shortScore++;
    if (rsiVal >= 30 && rsiVal <= 60) shortScore++;
    if (macdHist < 0 || macdVal < macdSignal) shortScore++;
    if (current.close >= bbUpper || current.close >= sma20) shortScore++;
    const atrExpansionShort = atrVal > atrAvg20;
    if (atrExpansionShort) shortScore++;
    
    if (shortScore >= 3) {
      const entry = current.close;
      const sl = entry + atrVal * 2;
      const slPips = Math.abs(entry - sl) / pipMultiplier;
      
      let confidence = 65 + shortScore * 5;
      if (rsiVal >= 40 && rsiVal <= 55) confidence += 3;
      if (current.close < ema50) confidence += 3;
      
      signals.push({
        pair, direction: 'SHORT', entry, sl,
        candleIndex: i, confidence: Math.min(confidence, 90),
        reason: `D1 ${shortScore}/5 confluence SHORT: EMA100${current.close < ema100 ? '-' : '+'}, RSI${rsiVal.toFixed(0)}, MACD${macdHist < 0 ? '-' : '+'}, BB${current.close >= sma20 ? 'pullback' : 'below'}, ATR${atrExpansionShort ? 'exp' : 'flat'}, SL ${slPips.toFixed(0)} pips`
      });
      lastSignalD1Idx = i;
    }
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
  d1Candles: Candle[],
  d1CandleIndex: number,
  confidence: number
): Trade {
  const isLong = direction === 'LONG';
  const pip = getPipMultiplier(pair);
  const initialRiskPips = Math.abs(entry - sl) / pip;
  const costPips = getRealCost(pair);

  // Build trailing EMA50
  const trailEmaPeriod = 50;
  const trailStartIdx = Math.max(0, d1CandleIndex - trailEmaPeriod + 1);
  const trailCloses = [];
  for (let i = trailStartIdx; i <= d1CandleIndex; i++) {
    trailCloses.push(d1Candles[i].close);
  }
  const trailEma = ema(trailCloses, trailEmaPeriod);
  let currentTrailEma = trailEma[trailEma.length - 1];

  const r: Trade = {
    pair, direction, entry, sl, entryTime, confidence,
    slPips: initialRiskPips
  };

  const maxLookahead = Math.min(d1CandleIndex + 50, d1Candles.length); // Max 50 days
  const alpha = 2 / (trailEmaPeriod + 1);

  for (let i = d1CandleIndex + 1; i < maxLookahead; i++) {
    const c = d1Candles[i];

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
  const last = d1Candles[lastIdx]?.close ?? entry;
  r.exitPrice = last; r.exitTime = d1Candles[lastIdx]?.timestamp ?? entryTime;
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
  console.log('D1 MULTI-INDICATOR CONFLUENCE STRATEGY (FINAL ATTEMPT)');
  console.log('5 indicators: EMA200 + RSI + MACD + Bollinger + ATR');
  console.log('If this fails, forex is not viable for this signal-service model.');
  console.log('Real costs applied from start (Pepperstone RAW spreads + commission)');
  console.log('===================================================================\n');

  // Load all forex data and generate signals
  const allSignals: Record<string, Signal[]> = {};
  const allD1Candles: Record<string, Candle[]> = {};
  for (const pair of FOREX_PAIRS) {
    const m5 = loadCache(pair);
    if (!m5 || m5.length < 10000) {
      console.warn(`SKIP ${pair}: no/short cache`);
      continue;
    }
    const d1 = aggregateToD1(m5);
    allD1Candles[pair] = d1;
    allSignals[pair] = scanD1Confluence(pair, m5);
    console.log(`  ${pair}: ${allSignals[pair].length} signals`);
  }

  const totalSignals = Object.values(allSignals).reduce((s, a) => s + a.length, 0);
  console.log(`\nTotal signals across ${FOREX_PAIRS.length} pairs: ${totalSignals}\n`);

  if (totalSignals === 0) {
    console.log('ZERO signals generated. Strategy too restrictive.');
    return;
  }

  // Determine split time
  const allTimestamps: number[] = [];
  for (const d1 of Object.values(allD1Candles)) {
    allTimestamps.push(new Date(d1[0].timestamp).getTime());
    allTimestamps.push(new Date(d1[d1.length - 1].timestamp).getTime());
  }
  const minTs = Math.min(...allTimestamps);
  const maxTs = Math.max(...allTimestamps);
  const splitTime = minTs + (maxTs - minTs) * 0.67;
  console.log(`Walk-forward split: ${new Date(splitTime).toISOString().split('T')[0]}\n`);

  // Full period
  console.log('--- Full 6-month period (with real per-pair costs) ---\n');
  const fullPeriodTrades: Trade[] = [];
  for (const [pair, signals] of Object.entries(allSignals)) {
    const d1 = allD1Candles[pair];
    for (const sig of signals) {
      const trade = simulateTrade(
        pair, sig.direction, sig.entry, sig.sl,
        d1[sig.candleIndex].timestamp, d1, sig.candleIndex, sig.confidence
      );
      fullPeriodTrades.push(trade);
    }
  }
  const fullStats = analyze('D1 confluence (full period)', fullPeriodTrades);

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
    const d1 = allD1Candles[pair];
    for (const sig of signals) {
      const trade = simulateTrade(
        pair, sig.direction, sig.entry, sig.sl,
        d1[sig.candleIndex].timestamp, d1, sig.candleIndex, sig.confidence
      );
      const ts = new Date(d1[sig.candleIndex].timestamp).getTime();
      if (ts < splitTime) inSample.push(trade);
      else outSample.push(trade);
    }
  }
  const inStats = analyze('D1 confluence (in-sample)', inSample);
  const outStats = analyze('D1 confluence (out-of-sample)', outSample);

  // Exit reason breakdown
  console.log('\n--- Exit reason breakdown (full period) ---\n');
  const trailExits = fullPeriodTrades.filter(t => t.exitReason === 'TRAIL_EMA50');
  const slHits = fullPeriodTrades.filter(t => t.exitReason === 'SL');
  const openTrades = fullPeriodTrades.filter(t => t.exitReason === 'OPEN');
  console.log(`  Trailing EMA50 exit: ${trailExits.length} (${(trailExits.length / fullPeriodTrades.length * 100).toFixed(1)}%)`);
  console.log(`  Stop loss hit: ${slHits.length} (${(slHits.length / fullPeriodTrades.length * 100).toFixed(1)}%)`);
  console.log(`  Still open: ${openTrades.length} (${(openTrades.length / fullPeriodTrades.length * 100).toFixed(1)}%)`);

  // Final comparison
  console.log('\n===================================================================');
  console.log('FINAL COMPARISON: All 9 Forex Strategies Tested');
  console.log('===================================================================\n');
  console.log('# | Strategy                    | TF  | WR     | avgR    | PF');
  console.log('--+-----------------------------+-----+--------+---------+------');
  console.log('1 | Mean-reversion (0.35R)      | M5  | 79.0%  | -0.051  | 0.80');
  console.log('2 | Mean-reversion (TP1 min 8)  | M5  | 65.5%  | +0.004  | 1.01 ⚠️');
  console.log('3 | Mean-reversion (single TP)  | M5  | 47.5%  | -0.128  | 0.80');
  console.log('4 | Confirmation delay          | M5  | 73.0%  | -0.182  | 0.50');
  console.log('5 | Target SMA20                | M5  | 20.4%  | -0.389  | 0.43');
  console.log('6 | Trend-breakout (metals)     | M5  | 16.1%  | -0.714  | 0.23');
  console.log('7 | H1 trend + M5 pullback      | M5  | 14.2%  | -0.724  | 0.19');
  console.log('8 | H4 RSI Divergence           | H4  | 31.1%  | -0.181  | 0.75');
  console.log(`9 | D1 Multi-Indicator          | D1  | ${outStats.winRate.toFixed(1).padStart(5)}%  | ${outStats.avgR.toFixed(3).padStart(7)} | ${outStats.profitFactor.toFixed(2).padStart(4)}`);

  // Final verdict
  console.log('\n=== FINAL VERDICT ===\n');
  const passes = outStats.avgR > 0 && outStats.winRate > 40 && outStats.profitFactor > 1.0;

  if (passes) {
    console.log('✅ D1 Multi-Indicator Confluence PASSES!');
    console.log(`   Out-of-sample: ${outStats.winRate.toFixed(1)}% WR, ${outStats.avgR.toFixed(3)} avgR, PF ${outStats.profitFactor.toFixed(2)}`);
    console.log('   Forex IS viable on daily timeframe with multi-indicator confluence.');
    console.log('   Recommendation: DEPLOY THIS STRATEGY.');
  } else {
    console.log('❌ D1 Multi-Indicator Confluence FAILS.');
    console.log(`   Out-of-sample: ${outStats.winRate.toFixed(1)}% WR, ${outStats.avgR.toFixed(3)} avgR, PF ${outStats.profitFactor.toFixed(2)}`);
    console.log('\n   FINAL CONCLUSION: Forex is NOT viable for this signal-service model.');
    console.log('   Tested 9 strategies across M5/H1/H4/D1 timeframes.');
    console.log('   All failed after realistic trading costs (1.3-2.3 pips).');
    console.log('   Only metals trend-breakout is profitable (+0.140 avgR, PF 1.46).');
    console.log('\n   Recommendation: Disable forex, keep metals only.');
  }

  fs.default.writeFileSync('d1-confluence-final-results.json', JSON.stringify({
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
  console.log('\nSaved to d1-confluence-final-results.json');
}

main().catch(e => { console.error(e); process.exit(1); });
