import type { Candle } from '../src/types.js';

// ---------------------------------------------------------------------------
// BACKTEST RUNNER - TREND-BREAKOUT STRATEGY APPLIED TO FOREX (ISOLATED TEST)
//
// This is a self-contained copy of the SAME breakout logic used by the live
// METALS_TREND_BREAKOUT engine (server/engine-trend-breakout.ts) - EMA200
// slope trend filter, Donchian/BB breakout with strong close, range
// (volume-proxy) participation, RSI momentum confirmation, ATR expansion
// filter, ATR-buffered SL, trailing EMA20 exit (no fixed TP).
//
// Fully isolated: does NOT modify engine-trend-breakout.ts, does NOT touch
// scanner.ts (no live routing changed). Forex is intentionally NOT
// implemented in the live engine ("there is no FOREX path here" - see that
// file's router comment) - this script exists purely to test, as a one-off
// comparison, whether the SAME strategy that works for metals also works
// for forex, run here in isolation only.
// ---------------------------------------------------------------------------

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
  slPips: number;
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
function rsi(closes: number[], period = 14): number[] {
  const result: number[] = [];
  if (closes.length < period + 1) return result;
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) avgGain += change; else avgLoss += Math.abs(change);
  }
  avgGain /= period; avgLoss /= period;
  for (let i = period; i < closes.length; i++) {
    if (i > period) {
      const change = closes[i] - closes[i - 1];
      const gain = change > 0 ? change : 0;
      const loss = change < 0 ? Math.abs(change) : 0;
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
    }
    if (avgLoss === 0) result.push(100);
    else { const rs = avgGain / avgLoss; result.push(100 - (100 / (1 + rs))); }
  }
  return result;
}
function atr(candles: Candle[], period = 14): number[] {
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
  for (let i = period; i < trueRanges.length; i++) { avg = (avg * (period - 1) + trueRanges[i]) / period; result.push(avg); }
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
  for (let i = period; i < values.length; i++) { prev = values[i] * k + prev * (1 - k); result.push(prev); }
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
    highs[i] = hi; lows[i] = lo;
  }
  return { highs, lows };
}
function getPipMultiplier(pair: string): number { return pair.includes('JPY') ? 0.01 : 0.0001; }
function isGoodSession(timestamp: string): boolean {
  const hour = new Date(timestamp).getUTCHours();
  return hour >= 7 && hour <= 21;
}

// Same constants as the live metals path in engine-trend-breakout.ts
const EMA_TREND_PERIOD = 200;
const EMA_SLOPE_LOOKBACK = 20;
const EMA_SLOPE_THRESHOLD = 0.003;
const DONCHIAN_PERIOD = 20;
const BB_PERIOD = 20;
const BB_STDDEV = 2;
const RANGE_AVG_PERIOD = 20;
const ATR_PERIOD = 14;
const ATR_EXPANSION_LOOKBACK = 10;
const STRONG_CLOSE_FRACTION = 0.30;
const TRAIL_EMA_PERIOD = 20;
const MIN_SIGNAL_GAP_MS = 30 * 60 * 1000;
const FOREX_ATR_SL_BUFFER = 0.75; // same buffer as metals (METALS_ATR_SL_BUFFER)

// Same floor/max-risk pattern from engine-trend-breakout.ts (forex not in
// the explicit map -> ATR-based fallback governs sizing here)
function getFloorRisk(pair: string, pipMultiplier: number, currentAtr?: number): number {
  if (currentAtr !== undefined && currentAtr > 0) return currentAtr * 0.5;
  return pair.includes('JPY') ? 8 * pipMultiplier : 6 * pipMultiplier;
}
function getMaxRisk(pair: string, pipMultiplier: number, currentAtr?: number): number {
  if (currentAtr !== undefined && currentAtr > 0) return currentAtr * 3;
  return pair.includes('JPY') ? 25 * pipMultiplier : 20 * pipMultiplier;
}
const MIN_STOP_PCT_OF_PRICE = 0.003;
function minRiskFloorPips(entry: number, pipMultiplier: number): number {
  const priceRelativePips = (entry * MIN_STOP_PCT_OF_PRICE) / pipMultiplier;
  return Math.min(2, priceRelativePips);
}

interface Ctx {
  ema200At: (i: number) => number | undefined;
  bbUpper: (i: number) => number | undefined;
  bbLower: (i: number) => number | undefined;
  rsiAt: (i: number) => number | undefined;
  atrAt: (i: number) => number | undefined;
  atrAvgAt: (i: number) => number | undefined;
  rangeAt: (i: number) => number | undefined;
  rangeAvgAt: (i: number) => number | undefined;
  donHigh: (number | undefined)[];
  donLow: (number | undefined)[];
  trailEmaAt: (i: number) => number | undefined;
}

function buildContext(candles: Candle[]): Ctx {
  const closes = candles.map(c => c.close);
  const ema200 = ema(closes, EMA_TREND_PERIOD);
  const ema200At = (i: number) => { const j = i - (EMA_TREND_PERIOD - 1); return (j >= 0 && j < ema200.length) ? ema200[j] : undefined; };

  const smaArr = sma(closes, BB_PERIOD);
  const stdArr = stddev(closes, smaArr, BB_PERIOD);
  const bbAt = (i: number) => { const j = i - (BB_PERIOD - 1); return (j >= 0 && j < smaArr.length) ? { mean: smaArr[j], std: stdArr[j] } : undefined; };
  const bbUpper = (i: number) => { const b = bbAt(i); return b ? b.mean + BB_STDDEV * b.std : undefined; };
  const bbLower = (i: number) => { const b = bbAt(i); return b ? b.mean - BB_STDDEV * b.std : undefined; };

  const rsiArr = rsi(closes, 14);
  const rsiAt = (i: number) => { const j = i - 14; return (j >= 0 && j < rsiArr.length) ? rsiArr[j] : undefined; };

  const atrArr = atr(candles, ATR_PERIOD);
  const atrAt = (i: number) => { const j = i - ATR_PERIOD; return (j >= 0 && j < atrArr.length) ? atrArr[j] : undefined; };
  const atrAvgArr = sma(atrArr, ATR_EXPANSION_LOOKBACK);
  const atrAvgAt = (i: number) => { const j = (i - ATR_PERIOD) - (ATR_EXPANSION_LOOKBACK - 1); return (j >= 0 && j < atrAvgArr.length) ? atrAvgArr[j] : undefined; };

  const range = candles.map(c => c.high - c.low);
  const rangeAvg = sma(range, RANGE_AVG_PERIOD);
  const rangeAt = (i: number) => range[i];
  const rangeAvgAt = (i: number) => { const j = i - (RANGE_AVG_PERIOD - 1); return (j >= 0 && j < rangeAvg.length) ? rangeAvg[j] : undefined; };

  const { highs: donHigh, lows: donLow } = donchian(candles, DONCHIAN_PERIOD);

  const trailEma = ema(closes, TRAIL_EMA_PERIOD);
  const trailEmaAt = (i: number) => { const j = i - (TRAIL_EMA_PERIOD - 1); return (j >= 0 && j < trailEma.length) ? trailEma[j] : undefined; };

  return { ema200At, bbUpper, bbLower, rsiAt, atrAt, atrAvgAt, rangeAt, rangeAvgAt, donHigh, donLow, trailEmaAt };
}

function ema200Slope(ctx: Ctx, i: number): number {
  const cur = ctx.ema200At(i);
  const prev = ctx.ema200At(i - EMA_SLOPE_LOOKBACK);
  if (cur === undefined || prev === undefined || prev === 0) return 0;
  return (cur - prev) / prev;
}

interface Signal { direction: 'LONG' | 'SHORT'; entry: number; sl: number; slPips: number; candleIndex: number; confidence: number; }

function evaluateBreakout(pair: string, candles: Candle[], ctx: Ctx, i: number, pipMultiplier: number): Signal | null {
  const current = candles[i];
  const ema200 = ctx.ema200At(i);
  const slope = ema200Slope(ctx, i);
  const rsiVal = ctx.rsiAt(i);
  const currentAtr = ctx.atrAt(i);
  const atrAvg = ctx.atrAvgAt(i);
  const rangeVal = ctx.rangeAt(i);
  const rangeAvg = ctx.rangeAvgAt(i);
  const donHi = ctx.donHigh[i];
  const donLo = ctx.donLow[i];
  const bbUp = ctx.bbUpper(i);
  const bbLo = ctx.bbLower(i);

  if (ema200 === undefined || rsiVal === undefined || !currentAtr || atrAvg === undefined || rangeVal === undefined || rangeAvg === undefined) return null;
  if (currentAtr <= atrAvg) return null;

  const range = current.high - current.low;
  if (range <= 0) return null;

  const floorRisk = getFloorRisk(pair, pipMultiplier, currentAtr);
  const maxRisk = getMaxRisk(pair, pipMultiplier, currentAtr);

  const trendUpOk = current.close > ema200 && slope > EMA_SLOPE_THRESHOLD;
  const brokeOutLong = (donHi !== undefined && current.close > donHi) || (bbUp !== undefined && current.close > bbUp);
  const strongCloseLong = current.close >= current.low + (1 - STRONG_CLOSE_FRACTION) * range;
  const participationOk = rangeVal > rangeAvg;
  const momentumLongOk = rsiVal > 55;

  if (trendUpOk && brokeOutLong && strongCloseLong && participationOk && momentumLongOk) {
    const entry = current.close;
    let risk = Math.min(Math.max((entry - current.low) + currentAtr * FOREX_ATR_SL_BUFFER, floorRisk), maxRisk);
    const riskPips = risk / pipMultiplier;
    const evenRiskPips = Math.max(minRiskFloorPips(entry, pipMultiplier), Math.round(riskPips / 2) * 2);
    risk = evenRiskPips * pipMultiplier;
    if (risk > 0) {
      let confidence = 65;
      if (slope > EMA_SLOPE_THRESHOLD * 2) confidence += 8;
      if (rsiVal >= 55 && rsiVal <= 70) confidence += 7;
      if (rangeVal > rangeAvg * 1.5) confidence += 5;
      return { direction: 'LONG', entry, sl: entry - risk, slPips: risk / pipMultiplier, candleIndex: i, confidence: Math.min(confidence, 85) };
    }
  }

  const trendDownOk = current.close < ema200 && slope < -EMA_SLOPE_THRESHOLD;
  const brokeOutShort = (donLo !== undefined && current.close < donLo) || (bbLo !== undefined && current.close < bbLo);
  const strongCloseShort = current.close <= current.high - (1 - STRONG_CLOSE_FRACTION) * range;
  const momentumShortOk = rsiVal < 45;

  if (trendDownOk && brokeOutShort && strongCloseShort && participationOk && momentumShortOk) {
    const entry = current.close;
    let risk = Math.min(Math.max((current.high - entry) + currentAtr * FOREX_ATR_SL_BUFFER, floorRisk), maxRisk);
    const riskPips = risk / pipMultiplier;
    const evenRiskPips = Math.max(minRiskFloorPips(entry, pipMultiplier), Math.round(riskPips / 2) * 2);
    risk = evenRiskPips * pipMultiplier;
    if (risk > 0) {
      let confidence = 65;
      if (slope < -EMA_SLOPE_THRESHOLD * 2) confidence += 8;
      if (rsiVal <= 45 && rsiVal >= 30) confidence += 7;
      if (rangeVal > rangeAvg * 1.5) confidence += 5;
      return { direction: 'SHORT', entry, sl: entry + risk, slPips: risk / pipMultiplier, candleIndex: i, confidence: Math.min(confidence, 85) };
    }
  }
  return null;
}

function scanForexBreakout(pair: string, m5: Candle[], useSessionFilter: boolean): Signal[] {
  const signals: Signal[] = [];
  if (m5.length < 250) return signals;
  const ctx = buildContext(m5);
  const pipMultiplier = getPipMultiplier(pair);
  let lastTs = 0;
  for (let i = 250; i < m5.length; i++) {
    const current = m5[i];
    if (useSessionFilter && !isGoodSession(current.timestamp)) continue;
    const ts = new Date(current.timestamp).getTime();
    if (ts - lastTs < MIN_SIGNAL_GAP_MS) continue;
    const sig = evaluateBreakout(pair, m5, ctx, i, pipMultiplier);
    if (sig) { signals.push(sig); lastTs = ts; }
  }
  return signals;
}

function simulateTrailingExit(pair: string, sig: Signal, candles: Candle[], trailEmaAt: (i: number) => number | undefined): Trade {
  const isLong = sig.direction === 'LONG';
  const pip = getPipMultiplier(pair);
  const initialRiskPips = sig.slPips;
  const entryTime = candles[sig.candleIndex].timestamp;
  const r: Trade = { pair, direction: sig.direction, entry: sig.entry, sl: sig.sl, entryTime, slPips: sig.slPips };

  const maxLookahead = Math.min(sig.candleIndex + 2001, candles.length);
  for (let i = sig.candleIndex + 1; i < maxLookahead; i++) {
    const c = candles[i];
    if (isLong && c.low <= sig.sl) {
      r.exitPrice = sig.sl; r.exitTime = c.timestamp; r.exitReason = 'SL';
      r.pips = (sig.sl - sig.entry) / pip; r.r = initialRiskPips > 0 ? r.pips / initialRiskPips : 0;
      r.result = r.pips > 0 ? 'WIN' : 'LOSS';
      return r;
    }
    if (!isLong && c.high >= sig.sl) {
      r.exitPrice = sig.sl; r.exitTime = c.timestamp; r.exitReason = 'SL';
      r.pips = (sig.entry - sig.sl) / pip; r.r = initialRiskPips > 0 ? r.pips / initialRiskPips : 0;
      r.result = r.pips > 0 ? 'WIN' : 'LOSS';
      return r;
    }
    const trail = trailEmaAt(i);
    if (trail !== undefined) {
      const favorablePips = isLong ? (c.close - sig.entry) / pip : (sig.entry - c.close) / pip;
      if (favorablePips >= initialRiskPips) {
        const closedThroughTrail = isLong ? c.close < trail : c.close > trail;
        if (closedThroughTrail) {
          r.exitPrice = c.close; r.exitTime = c.timestamp; r.exitReason = 'TRAIL_EMA20';
          r.pips = isLong ? (c.close - sig.entry) / pip : (sig.entry - c.close) / pip;
          r.r = initialRiskPips > 0 ? r.pips / initialRiskPips : 0;
          r.result = r.pips > 0 ? 'WIN' : 'LOSS';
          return r;
        }
      }
    }
  }
  const lastIdx = maxLookahead - 1;
  const last = candles[lastIdx]?.close ?? sig.entry;
  r.exitPrice = last; r.exitTime = candles[lastIdx]?.timestamp ?? entryTime; r.exitReason = 'OPEN'; r.result = 'OPEN';
  r.pips = isLong ? (last - sig.entry) / pip : (sig.entry - last) / pip;
  r.r = initialRiskPips > 0 ? r.pips / initialRiskPips : 0;
  return r;
}

const fs = await import('fs');
const path = await import('path');
const CACHE = path.default.join(process.cwd(), '.cache');

function normalizeTimestamp(ts: string): string { return (ts.includes('T') || ts.endsWith('Z')) ? ts : ts.replace(' ', 'T') + 'Z'; }

function loadCache(pair: string): Candle[] | null {
  const f = path.default.join(CACHE, `${pair}_5min_6m.json`);
  if (!fs.default.existsSync(f)) return null;
  const raw: Candle[] = JSON.parse(fs.default.readFileSync(f, 'utf-8'));
  const normalized = raw.map(c => ({ ...c, timestamp: normalizeTimestamp(c.timestamp) }));
  const seen = new Set<string>();
  const dedup = normalized.filter(c => { if (seen.has(c.timestamp)) return false; seen.add(c.timestamp); return true; });
  dedup.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  return dedup;
}

function analyze(label: string, trades: Trade[]) {
  const closed = trades.filter(t => t.result !== 'OPEN');
  const wins = closed.filter(t => t.result === 'WIN');
  const winRate = closed.length ? (wins.length / closed.length) * 100 : 0;
  let totalR = 0, peak = 0, running = 0, maxDD = 0;
  for (const t of closed) { const r = t.r ?? 0; totalR += r; running += r; if (running > peak) peak = running; const dd = peak - running; if (dd > maxDD) maxDD = dd; }
  const avgR = closed.length ? totalR / closed.length : 0;
  const avgSlPips = trades.length ? trades.reduce((s, t) => s + t.slPips, 0) / trades.length : 0;
  console.log(`  ${label.padEnd(28)} signals:${String(trades.length).padStart(4)} closed:${String(closed.length).padStart(4)} WR:${winRate.toFixed(1).padStart(6)}%  avgR:${avgR.toFixed(3).padStart(7)}  maxDD(R):${maxDD.toFixed(2).padStart(6)}  avgSL(pips):${avgSlPips.toFixed(1).padStart(6)}`);
  return { label, signals: trades.length, closed: closed.length, winRate, avgR, maxDD, avgSlPips };
}

async function main() {
  const FOREX_PAIRS = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'USDCAD', 'AUDUSD', 'NZDUSD', 'EURGBP', 'EURJPY', 'GBPJPY', 'AUDJPY', 'CADJPY', 'CHFJPY', 'NZDJPY', 'EURAUD'];

  console.log('\n===================================================================');
  console.log('METALS TREND-BREAKOUT STRATEGY - ISOLATED TEST ON FOREX (session ON)');
  console.log('(same logic as live engine-trend-breakout.ts metals path; forex is');
  console.log(' NOT wired into the live engine or scanner.ts - backtest only)');
  console.log('===================================================================');

  const allTrades: Trade[] = [];
  const perPair: Record<string, ReturnType<typeof analyze>> = {};

  console.log('\nPer-pair:');
  for (const pair of FOREX_PAIRS) {
    const m5 = loadCache(pair);
    if (!m5 || m5.length < 300) { console.warn(`SKIP ${pair}: no/short cache`); continue; }
    const signals = scanForexBreakout(pair, m5, true);
    const trades = signals.map(sig => simulateTrailingExit(pair, sig, m5, buildContext(m5).trailEmaAt));
    allTrades.push(...trades);
    perPair[pair] = analyze(pair, trades);
  }

  console.log('\nCOMBINED (all 15 forex pairs, trend-breakout strategy):');
  const combined = analyze('COMBINED', allTrades);

  console.log('\n=== COMPARISON: Metals trend-breakout live results vs forex test ===');
  console.log('METALS (live, walk-forward):  183 closed, 38.3% WR, +0.184 avgR');
  console.log(`FOREX (this test):            ${combined.closed} closed, ${combined.winRate.toFixed(1)}% WR, ${combined.avgR >= 0 ? '+' : ''}${combined.avgR.toFixed(3)} avgR`);

  fs.default.writeFileSync('backtest-trend-breakout-forex-results.json', JSON.stringify({ perPair, combined, allTrades }, null, 0));
  console.log('\nSaved to backtest-trend-breakout-forex-results.json');
  console.log('NOTE: isolated backtest-only script (server/backtest-trend-breakout-forex.ts).');
  console.log('engine-trend-breakout.ts and scanner.ts were NOT modified - nothing deployed.');
}

main().catch(e => { console.error(e); process.exit(1); });
