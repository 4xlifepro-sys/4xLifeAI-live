import type { Candle } from '../src/types.js';

// ---------------------------------------------------------------------------
// FOREX TREND-BREAKOUT: Adapted from proven metals trend-breakout engine
//
// Same core logic: EMA200 trend filter, Donchian/BB breakout with strong
// close, RSI momentum confirmation, ATR expansion filter, trailing EMA20 exit.
//
// Key adaptations for forex:
// - Lower EMA slope threshold (forex moves are smaller in % terms)
// - Session filter (07:00-21:00 UTC, London/NY)
// - Tighter ATR SL buffer (forex wicks smaller than crypto)
// - Real costs applied from start (Pepperstone RAW spreads + commission)
//
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

// --- Indicator math (same as engine-trend-breakout.ts) ---
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

function donchian(candles: Candle[], period: number): { highs: (number | undefined)[]; lows: (number | undefined)[] } {
  const highs: (number | undefined)[] = new Array(candles.length).fill(undefined);
  const lows: (number | undefined)[] = new Array(candles.length).fill(undefined);
  for (let i = period; i < candles.length; i++) {
    let hi = -Infinity, lo = Infinity;
    for (let j = i - period; j < i; j++) {
      if (candles[j].high > hi) hi = candles[j].high;
      if (candles[j].low < lo) lo = candles[j].low;
    }
    highs[i] = hi;
    lows[i] = lo;
  }
  return { highs, lows };
}

// --- Forex-specific constants ---
const EMA_TREND_PERIOD = 200;
const EMA_SLOPE_LOOKBACK = 20;
// KEY ADAPTATION: forex moves are smaller in % terms than metals/crypto.
// Metals uses 0.003 (0.3%) which produced 0 signals on forex.
// Testing 0.0008 (0.08%) - still requires clearly angled EMA but achievable for forex.
const EMA_SLOPE_THRESHOLD = 0.0008;
const DONCHIAN_PERIOD = 20;
const BB_PERIOD = 20;
const BB_STDDEV = 2;
const RANGE_AVG_PERIOD = 20;
const ATR_PERIOD = 14;
const ATR_EXPANSION_LOOKBACK = 10;
const STRONG_CLOSE_FRACTION = 0.30;
const TRAIL_EMA_PERIOD = 20;
const MIN_SIGNAL_GAP_MS = 30 * 60 * 1000; // 30 min gap
const FOREX_ATR_SL_BUFFER = 1.5; // between metals (2.0) and crypto (1.0)

function isGoodSession(timestamp: string): boolean {
  const hour = new Date(timestamp).getUTCHours();
  return hour >= 7 && hour <= 21;
}

// --- Scan for forex trend-breakout signals ---
function scanForexBreakout(pair: string, m5Candles: Candle[]): Signal[] {
  const signals: Signal[] = [];
  if (m5Candles.length < 250) return signals;

  const closes = m5Candles.map(c => c.close);
  const pipMultiplier = getPipMultiplier(pair);

  // Build indicators
  const ema200 = ema(closes, EMA_TREND_PERIOD);
  const rsiArr = rsi(closes, 14);
  const atrArr = atr(m5Candles, ATR_PERIOD);
  const atrAvgArr = sma(atrArr, ATR_EXPANSION_LOOKBACK);
  const range = m5Candles.map(c => c.high - c.low);
  const rangeAvg = sma(range, RANGE_AVG_PERIOD);
  const { highs: donHigh, lows: donLow } = donchian(m5Candles, DONCHIAN_PERIOD);

  const smaArr = sma(closes, BB_PERIOD);
  const stdArr = stddev(closes, smaArr, BB_PERIOD);

  let lastTs = 0;

  for (let i = 250; i < m5Candles.length; i++) {
    const ts = new Date(m5Candles[i].timestamp).getTime();
    if (ts - lastTs < MIN_SIGNAL_GAP_MS) continue;

    // Session filter
    if (!isGoodSession(m5Candles[i].timestamp)) continue;

    const current = m5Candles[i];
    const emaIdx = i - (EMA_TREND_PERIOD - 1);
    const emaPrevIdx = i - (EMA_TREND_PERIOD - 1) - EMA_SLOPE_LOOKBACK;
    const rsiIdx = i - 14;
    const atrIdx = i - ATR_PERIOD;
    const atrAvgIdx = atrIdx - (ATR_EXPANSION_LOOKBACK - 1);
    const rangeAvgIdx = i - (RANGE_AVG_PERIOD - 1);
    const bbIdx = i - (BB_PERIOD - 1);

    if (emaIdx < 0 || emaPrevIdx < 0 || rsiIdx < 0 || atrIdx < 0 ||
        atrAvgIdx < 0 || rangeAvgIdx < 0 || bbIdx < 0) continue;
    if (emaIdx >= ema200.length || rsiIdx >= rsiArr.length || atrIdx >= atrArr.length ||
        atrAvgIdx >= atrAvgArr.length || rangeAvgIdx >= rangeAvg.length || bbIdx >= smaArr.length) continue;

    const ema200Val = ema200[emaIdx];
    const ema200Prev = ema200[emaPrevIdx];
    const slope = ema200Prev !== 0 ? (ema200Val - ema200Prev) / ema200Prev : 0;
    const rsiVal = rsiArr[rsiIdx];
    const currentAtr = atrArr[atrIdx];
    const atrAvg = atrAvgArr[atrAvgIdx];
    const rangeVal = range[i];
    const rangeAvgVal = rangeAvg[rangeAvgIdx];
    const donHi = donHigh[i];
    const donLo = donLow[i];
    const bbUp = smaArr[bbIdx] + BB_STDDEV * stdArr[bbIdx];
    const bbLo = smaArr[bbIdx] - BB_STDDEV * stdArr[bbIdx];

    // Volatility expansion filter
    if (currentAtr <= atrAvg) continue;

    const candleRange = current.high - current.low;
    if (candleRange <= 0) continue;

    // Floor/max risk for forex
    const floorRisk = 6 * pipMultiplier * 2; // 6 pips * 2x breakout widen
    const maxRisk = 25 * pipMultiplier * 2;  // 25 pips * 2x breakout widen

    // --- LONG breakout ---
    const trendUpOk = current.close > ema200Val && slope > EMA_SLOPE_THRESHOLD;
    const brokeOutLong = (donHi !== undefined && current.close > donHi) || (current.close > bbUp);
    const strongCloseLong = current.close >= current.low + (1 - STRONG_CLOSE_FRACTION) * candleRange;
    const participationOk = rangeVal > rangeAvgVal;
    const momentumLongOk = rsiVal > 55;

    if (trendUpOk && brokeOutLong && strongCloseLong && participationOk && momentumLongOk) {
      const entry = current.close;
      let risk = Math.min(Math.max((entry - current.low) + currentAtr * FOREX_ATR_SL_BUFFER, floorRisk), maxRisk);
      const riskPips = risk / pipMultiplier;
      const evenRiskPips = Math.max(2, Math.round(riskPips / 2) * 2);
      risk = evenRiskPips * pipMultiplier;
      if (risk > 0) {
        const sl = entry - risk;
        let confidence = 65;
        if (slope > EMA_SLOPE_THRESHOLD * 2) confidence += 8;
        if (rsiVal >= 55 && rsiVal <= 70) confidence += 7;
        if (rangeVal > rangeAvgVal * 1.5) confidence += 5;

        signals.push({
          pair, direction: 'LONG', entry, sl,
          candleIndex: i, confidence: Math.min(confidence, 85),
          reason: `Forex trend breakout LONG | EMA200 sloped up ${(slope * 100).toFixed(3)}%, closed above ${DONCHIAN_PERIOD}-bar high/BB upper, RSI ${rsiVal.toFixed(1)}, ATR expanding`
        });
        lastTs = ts;
        continue;
      }
    }

    // --- SHORT breakout ---
    const trendDownOk = current.close < ema200Val && slope < -EMA_SLOPE_THRESHOLD;
    const brokeOutShort = (donLo !== undefined && current.close < donLo) || (current.close < bbLo);
    const strongCloseShort = current.close <= current.high - (1 - STRONG_CLOSE_FRACTION) * candleRange;
    const momentumShortOk = rsiVal < 45;

    if (trendDownOk && brokeOutShort && strongCloseShort && participationOk && momentumShortOk) {
      const entry = current.close;
      let risk = Math.min(Math.max((current.high - entry) + currentAtr * FOREX_ATR_SL_BUFFER, floorRisk), maxRisk);
      const riskPips = risk / pipMultiplier;
      const evenRiskPips = Math.max(2, Math.round(riskPips / 2) * 2);
      risk = evenRiskPips * pipMultiplier;
      if (risk > 0) {
        const sl = entry + risk;
        let confidence = 65;
        if (slope < -EMA_SLOPE_THRESHOLD * 2) confidence += 8;
        if (rsiVal <= 45 && rsiVal >= 30) confidence += 7;
        if (rangeVal > rangeAvgVal * 1.5) confidence += 5;

        signals.push({
          pair, direction: 'SHORT', entry, sl,
          candleIndex: i, confidence: Math.min(confidence, 85),
          reason: `Forex trend breakout SHORT | EMA200 sloped down ${(slope * 100).toFixed(3)}%, closed below ${DONCHIAN_PERIOD}-bar low/BB lower, RSI ${rsiVal.toFixed(1)}, ATR expanding`
        });
        lastTs = ts;
      }
    }
  }

  return signals;
}

// --- Simulate trade with trailing EMA20 exit + real costs ---
function simulateTrade(
  pair: string,
  direction: 'LONG' | 'SHORT',
  entry: number,
  sl: number,
  entryTime: string,
  candles: Candle[],
  candleIndex: number,
  confidence: number
): Trade {
  const isLong = direction === 'LONG';
  const pip = getPipMultiplier(pair);
  const initialRiskPips = Math.abs(entry - sl) / pip;
  const costPips = getRealCost(pair);

  // Build trailing EMA20 from entry point
  const trailEmaPeriod = TRAIL_EMA_PERIOD;
  const trailStartIdx = Math.max(0, candleIndex - trailEmaPeriod + 1);
  const trailCloses = [];
  for (let i = trailStartIdx; i <= candleIndex; i++) {
    trailCloses.push(candles[i].close);
  }
  const trailEma = ema(trailCloses, trailEmaPeriod);
  let currentTrailEma = trailEma[trailEma.length - 1];

  const r: Trade = {
    pair, direction, entry, sl, entryTime, confidence,
    slPips: initialRiskPips
  };

  const maxLookahead = Math.min(candleIndex + 2001, candles.length);
  const alpha = 2 / (trailEmaPeriod + 1);

  for (let i = candleIndex + 1; i < maxLookahead; i++) {
    const c = candles[i];

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

    // Check trailing EMA exit (only after trade is >= 1R in profit)
    const favorablePips = isLong ? (c.close - entry) / pip : (entry - c.close) / pip;
    if (favorablePips >= initialRiskPips) {
      const closedThroughTrail = isLong ? c.close < currentTrailEma : c.close > currentTrailEma;
      if (closedThroughTrail) {
        r.exitPrice = c.close; r.exitTime = c.timestamp; r.exitReason = 'TRAIL_EMA';
        r.pips = (isLong ? (c.close - entry) / pip : (entry - c.close) / pip) - costPips;
        r.r = initialRiskPips > 0 ? r.pips / initialRiskPips : 0;
        r.result = r.pips > 0 ? 'WIN' : 'LOSS';
        return r;
      }
    }
  }

  // Trade still open at end of window
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

  const grossProfit = closed.filter(t => t.r && t.r > 0).reduce((sum, t) => sum + (t.r || 0), 0);
  const grossLoss = Math.abs(closed.filter(t => t.r && t.r < 0).reduce((sum, t) => sum + (t.r || 0), 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  console.log(`  ${label.padEnd(40)} signals:${String(trades.length).padStart(4)} closed:${String(closed.length).padStart(4)} WR:${winRate.toFixed(1).padStart(6)}%  avgR:${avgR.toFixed(3).padStart(7)}  PF:${profitFactor.toFixed(2).padStart(6)}  maxDD(R):${maxDD.toFixed(2).padStart(6)}  avgSL(pips):${avgSlPips.toFixed(1).padStart(6)}`);

  return { label, signals: trades.length, closed: closed.length, winRate, avgR, profitFactor, maxDD, avgSlPips };
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
  console.log('FOREX TREND-BREAKOUT: Adapted from proven metals engine');
  console.log('Same logic: EMA200 trend + Donchian/BB breakout + trailing EMA20');
  console.log('Adaptations: lower slope threshold (0.08%), session filter, 1.5x ATR SL');
  console.log('Real costs applied from start (Pepperstone RAW spreads + commission)');
  console.log('===================================================================\n');

  // Load all forex data and generate signals
  const allSignals: Record<string, Signal[]> = {};
  const allCandles: Record<string, Candle[]> = {};
  for (const pair of FOREX_PAIRS) {
    const m5 = loadCache(pair);
    if (!m5 || m5.length < 250) {
      console.warn(`SKIP ${pair}: no/short cache`);
      continue;
    }
    allCandles[pair] = m5;
    allSignals[pair] = scanForexBreakout(pair, m5);
    console.log(`  ${pair}: ${allSignals[pair].length} signals`);
  }

  const totalSignals = Object.values(allSignals).reduce((s, a) => s + a.length, 0);
  console.log(`\nTotal signals across ${FOREX_PAIRS.length} pairs: ${totalSignals}\n`);

  if (totalSignals === 0) {
    console.log('ZERO signals generated. The EMA slope threshold or other filters');
    console.log('are still too restrictive for forex. This approach fails.');
    return;
  }

  // Determine split time
  const allTimestamps: number[] = [];
  for (const m5 of Object.values(allCandles)) {
    allTimestamps.push(new Date(m5[0].timestamp).getTime());
    allTimestamps.push(new Date(m5[m5.length - 1].timestamp).getTime());
  }
  const minTs = Math.min(...allTimestamps);
  const maxTs = Math.max(...allTimestamps);
  const splitTime = minTs + (maxTs - minTs) * 0.67;
  console.log(`Walk-forward split: ${new Date(splitTime).toISOString().split('T')[0]}\n`);

  // Full period
  console.log('--- Full 6-month period (with real per-pair costs) ---\n');
  const fullPeriodTrades: Trade[] = [];
  for (const [pair, signals] of Object.entries(allSignals)) {
    const m5 = allCandles[pair];
    for (const sig of signals) {
      const trade = simulateTrade(
        pair, sig.direction, sig.entry, sig.sl,
        m5[sig.candleIndex].timestamp, m5, sig.candleIndex, sig.confidence
      );
      fullPeriodTrades.push(trade);
    }
  }
  const fullStats = analyze('Forex breakout (full period)', fullPeriodTrades);

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
    const m5 = allCandles[pair];
    for (const sig of signals) {
      const trade = simulateTrade(
        pair, sig.direction, sig.entry, sig.sl,
        m5[sig.candleIndex].timestamp, m5, sig.candleIndex, sig.confidence
      );
      const ts = new Date(m5[sig.candleIndex].timestamp).getTime();
      if (ts < splitTime) inSample.push(trade);
      else outSample.push(trade);
    }
  }
  const inStats = analyze('Forex breakout (in-sample)', inSample);
  const outStats = analyze('Forex breakout (out-of-sample)', outSample);

  // Exit reason breakdown
  console.log('\n--- Exit reason breakdown (full period) ---\n');
  const trailExits = fullPeriodTrades.filter(t => t.exitReason === 'TRAIL_EMA');
  const slHits = fullPeriodTrades.filter(t => t.exitReason === 'SL');
  const openTrades = fullPeriodTrades.filter(t => t.exitReason === 'OPEN');
  console.log(`  Trailing EMA exit: ${trailExits.length} (${(trailExits.length / fullPeriodTrades.length * 100).toFixed(1)}%)`);
  console.log(`  Stop loss hit: ${slHits.length} (${(slHits.length / fullPeriodTrades.length * 100).toFixed(1)}%)`);
  console.log(`  Still open: ${openTrades.length} (${(openTrades.length / fullPeriodTrades.length * 100).toFixed(1)}%)`);

  // Comparison
  console.log('\n===================================================================');
  console.log('COMPARISON: Forex Trend-Breakout vs Metals Trend-Breakout');
  console.log('===================================================================\n');
  console.log('                    | Forex Breakout | Metals Breakout (proven)');
  console.log('  ------------------+----------------+--------------------------');
  console.log(`  Full period WR    | ${fullStats.winRate.toFixed(1).padStart(5)}%        | 39.9%`);
  console.log(`  Full period avgR  | ${fullStats.avgR.toFixed(3).padStart(7)}        | +0.140`);
  console.log(`  Full period PF    | ${fullStats.profitFactor.toFixed(2).padStart(6)}          | 1.46`);
  console.log(`  In-sample WR      | ${inStats.winRate.toFixed(1).padStart(5)}%        | (similar)`);
  console.log(`  In-sample avgR    | ${inStats.avgR.toFixed(3).padStart(7)}        | (similar)`);
  console.log(`  Out-of-sample WR  | ${outStats.winRate.toFixed(1).padStart(5)}%        | (similar)`);
  console.log(`  Out-of-sample avgR| ${outStats.avgR.toFixed(3).padStart(7)}        | (similar)`);

  // Verdict
  console.log('\n=== VERDICT ===\n');
  const passes = outStats.avgR > 0 && outStats.winRate > 30 && outStats.profitFactor > 1.0;

  if (passes) {
    console.log('✅ Forex trend-breakout PASSES walk-forward validation.');
    console.log(`   Out-of-sample avgR: ${outStats.avgR.toFixed(3)}, WR: ${outStats.winRate.toFixed(1)}%, PF: ${outStats.profitFactor.toFixed(2)}`);
    console.log('   The same breakout logic that works on metals also works on forex.');
    console.log('   Recommendation: Worth considering for deployment after further testing.');
  } else {
    console.log('❌ Forex trend-breakout FAILS walk-forward validation.');
    console.log(`   Out-of-sample avgR: ${outStats.avgR.toFixed(3)}, WR: ${outStats.winRate.toFixed(1)}%, PF: ${outStats.profitFactor.toFixed(2)}`);
    console.log('   The breakout logic that works on metals does NOT transfer to forex.');
    console.log('   Forex may need a completely different approach, or may not be tradeable');
    console.log('   profitably after realistic costs with any simple systematic strategy.');
  }

  fs.default.writeFileSync('forex-breakout-results.json', JSON.stringify({
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
  console.log('\nSaved to forex-breakout-results.json');
}

main().catch(e => { console.error(e); process.exit(1); });
