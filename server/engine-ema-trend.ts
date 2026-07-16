import type { Candle } from '../src/types.js';
import { getPipMultiplier } from './engine2.js';

// ---------------------------------------------------------------------------
// EMA200 / EMA110 TREND-CONTINUATION ENGINE - BACKTEST ONLY
//
// Fully self-contained: does NOT import from or modify
// engine-mean-reversion.ts or engine-trend-breakout.ts, and is NOT wired
// into scanner.ts (no live routing touched). Same isolation rules as the
// existing trend-breakout engine.
//
// Strategy: trend continuation via pullback to EMA110, inside an EMA200-
// confirmed trend, exiting via a trailing EMA110 cross (no fixed TP) - same
// trailing-exit philosophy as engine-trend-breakout.ts's metals path, but a
// DIFFERENT entry style (pullback-continuation, not breakout).
// ---------------------------------------------------------------------------

export interface EmaTrendSignal {
  symbol: string;
  direction: 'LONG' | 'SHORT';
  entry: number;
  sl: number;
  tp1: number; // informational reference only (1.5R) - real exit is the EMA110 trail
  tp2: number; // informational reference only (3R)
  tp3: number; // informational reference only (5R)
  trailEmaPeriod: number;
  confidence: number;
  reason: string;
  candleIndex: number;
}

// ---------------------------------------------------------------------------
// Shared indicator math (self-contained, mirrors engine-trend-breakout.ts's
// own self-contained copies - not imported/shared, to keep both engines
// fully isolated from one another).
// ---------------------------------------------------------------------------
function sma(values: number[], period: number): number[] {
  const result: number[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) result.push(sum / period);
  }
  return result; // result[0] aligns with index (period-1)
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
  return result; // result[0] aligns with index `period`
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
  return result; // result[0] aligns with index `period`
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
  return result; // result[0] aligns with index (period-1)
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const EMA_TREND_PERIOD = 200;
const EMA_PULLBACK_PERIOD = 110;   // also the trailing-exit EMA
const EMA_SLOPE_LOOKBACK = 20;     // bars used to measure EMA200 slope
const EMA_SLOPE_THRESHOLD = 0.0005; // 0.05% move in EMA200 over the lookback = "clearly angled"; flat = skip
const RSI_PERIOD = 14;
const ATR_PERIOD = 14;
const ATR_AVG_LOOKBACK = 20;       // "dead" volatility = ATR below its own 20-period average
const TOUCH_LOOKBACK = 4;          // bars (incl. current) scanned for the EMA110 touch/pullback
const CRASH_MULT = 1.5;            // pullback must not undercut EMA110 by more than this many ATRs ("not crashing violently through")
const SL_EMA_ATR_MULT = 2;         // wider stop: 2x ATR buffer beyond EMA110 (vs a tighter 1x)
const SL_LOW_BUFFER_MULT = 0.2;    // small ATR buffer beyond the pullback low/high
const MIN_SIGNAL_GAP_MS = 30 * 60 * 1000; // 30 min minimum gap between signals per pair
const TRAIL_EMA_PERIOD = EMA_PULLBACK_PERIOD; // exit = close crosses back through EMA110 against direction

// Same self-contained floor/max-risk bounds pattern as engine-trend-breakout.ts
// (kept as an independent copy, not shared, per isolation requirement). Only
// forex pairs are exercised in this first pass, so the ATR-based fallback is
// what actually governs sizing here; the explicit map is kept for parity/
// future reuse if this engine is ever extended to metals/crypto.
function getFloorRisk(pair: string, pipMultiplier: number, currentAtr?: number): number {
  const minimumStopByPair: Record<string, number> = {
    AUDUSD: 6 * 0.0001, USDCAD: 6 * 0.0001, EURNZD: 8 * 0.0001,
    GBPAUD: 8 * 0.0001, GBPNZD: 10 * 0.0001, CADJPY: 8 * 0.01, NZDJPY: 8 * 0.01,
  };
  if (minimumStopByPair[pair] !== undefined) return minimumStopByPair[pair];
  if (currentAtr !== undefined && currentAtr > 0) return currentAtr * 0.5;
  return pair.includes('JPY') ? 8 * pipMultiplier : 6 * pipMultiplier;
}

function getMaxRisk(pair: string, pipMultiplier: number, currentAtr?: number): number {
  const maximumStopByPair: Record<string, number> = {
    AUDUSD: 20 * 0.0001, USDCAD: 20 * 0.0001, EURNZD: 25 * 0.0001,
    GBPAUD: 25 * 0.0001, GBPNZD: 100 * 0.0001, CADJPY: 25 * 0.01, NZDJPY: 25 * 0.01,
  };
  if (maximumStopByPair[pair] !== undefined) return maximumStopByPair[pair];
  if (currentAtr !== undefined && currentAtr > 0) return currentAtr * 4; // wider ceiling than breakout engine - this strategy intentionally uses a wider stop
  return pair.includes('JPY') ? 40 * pipMultiplier : 32 * pipMultiplier;
}

const MIN_STOP_PCT_OF_PRICE = 0.003;
function minRiskFloorPips(entry: number, pipMultiplier: number): number {
  const priceRelativePips = (entry * MIN_STOP_PCT_OF_PRICE) / pipMultiplier;
  return Math.min(2, priceRelativePips);
}

// ---------------------------------------------------------------------------
// Context builder
// ---------------------------------------------------------------------------
export interface EmaTrendContext {
  closes: number[];
  ema200: number[];
  ema200At: (i: number) => number | undefined;
  ema110: number[];
  ema110At: (i: number) => number | undefined;
  rsiAt: (i: number) => number | undefined;
  atrAt: (i: number) => number | undefined;
  atrAvgAt: (i: number) => number | undefined;
  trailEma: number[];
  trailEmaAt: (i: number) => number | undefined;
}

export function buildContext(candles: Candle[]): EmaTrendContext {
  const closes = candles.map(c => c.close);

  const ema200 = ema(closes, EMA_TREND_PERIOD);
  const ema200At = (i: number) => {
    const j = i - (EMA_TREND_PERIOD - 1);
    return (j >= 0 && j < ema200.length) ? ema200[j] : undefined;
  };

  const ema110 = ema(closes, EMA_PULLBACK_PERIOD);
  const ema110At = (i: number) => {
    const j = i - (EMA_PULLBACK_PERIOD - 1);
    return (j >= 0 && j < ema110.length) ? ema110[j] : undefined;
  };

  const rsiArr = rsi(closes, RSI_PERIOD);
  const rsiAt = (i: number) => { const j = i - RSI_PERIOD; return (j >= 0 && j < rsiArr.length) ? rsiArr[j] : undefined; };

  const atrArr = atr(candles, ATR_PERIOD);
  const atrAt = (i: number) => { const j = i - ATR_PERIOD; return (j >= 0 && j < atrArr.length) ? atrArr[j] : undefined; };
  const atrAvgArr = sma(atrArr, ATR_AVG_LOOKBACK);
  const atrAvgAt = (i: number) => {
    const j = (i - ATR_PERIOD) - (ATR_AVG_LOOKBACK - 1);
    return (j >= 0 && j < atrAvgArr.length) ? atrAvgArr[j] : undefined;
  };

  // Trailing-exit EMA is the same EMA110 series - exposed separately so the
  // backtest script's simulation reads it the same way the metals engine's
  // trailEmaAt is read, without caring that it happens to equal ema110At.
  return { closes, ema200, ema200At, ema110, ema110At, rsiAt, atrAt, atrAvgAt, trailEma: ema110, trailEmaAt: ema110At };
}

function ema200Slope(ctx: EmaTrendContext, i: number): number {
  const cur = ctx.ema200At(i);
  const prev = ctx.ema200At(i - EMA_SLOPE_LOOKBACK);
  if (cur === undefined || prev === undefined || prev === 0) return 0;
  return (cur - prev) / prev;
}

// ---------------------------------------------------------------------------
// Core entry evaluation
// ---------------------------------------------------------------------------
function evaluateEmaTrend(pair: string, candles: Candle[], ctx: EmaTrendContext, i: number, pipMultiplier: number): EmaTrendSignal | null {
  if (i - TOUCH_LOOKBACK + 1 < 0) return null;

  const current = candles[i];
  const ema200 = ctx.ema200At(i);
  const ema110 = ctx.ema110At(i);
  const slope = ema200Slope(ctx, i);
  const rsiVal = ctx.rsiAt(i);
  const currentAtr = ctx.atrAt(i);
  const atrAvg = ctx.atrAvgAt(i);

  if (ema200 === undefined || ema110 === undefined || rsiVal === undefined || !currentAtr || atrAvg === undefined) return null;

  // Volatility filter: skip flat/dead periods (ATR must be reasonably active)
  if (currentAtr <= atrAvg) return null;

  // Touch window: last TOUCH_LOOKBACK bars including current
  const windowStart = i - TOUCH_LOOKBACK + 1;
  const window = candles.slice(windowStart, i + 1);
  const windowRsi: number[] = [];
  for (let k = windowStart; k <= i; k++) {
    const v = ctx.rsiAt(k);
    if (v !== undefined) windowRsi.push(v);
  }
  if (windowRsi.length === 0) return null;

  // --- LONG: trend up, pullback down to EMA110, close back above ---
  const trendUpOk = current.close > ema200 && slope > EMA_SLOPE_THRESHOLD;
  if (trendUpOk) {
    const windowLow = Math.min(...window.map(c => c.low));
    const touchedEma110 = windowLow <= ema110; // dipped to/through EMA110 during the window
    const notCrashed = windowLow >= ema110 - currentAtr * CRASH_MULT; // didn't crash violently through it
    const closedBackAbove = current.close > ema110 && current.close > current.open; // bullish close, recovered above EMA110
    const rsiOk = rsiVal >= 45 && rsiVal <= 65;
    const rsiHeldDuringPullback = Math.min(...windowRsi) >= 40; // reject if RSI dropped below 40 during the pullback

    if (touchedEma110 && notCrashed && closedBackAbove && rsiOk && rsiHeldDuringPullback) {
      const entry = current.close;
      const floorRisk = getFloorRisk(pair, pipMultiplier, currentAtr);
      const maxRisk = getMaxRisk(pair, pipMultiplier, currentAtr);

      const riskBeyondEma = (entry - ema110) + currentAtr * SL_EMA_ATR_MULT;
      const riskBeyondLow = (entry - windowLow) + currentAtr * SL_LOW_BUFFER_MULT;
      let risk = Math.min(riskBeyondEma, riskBeyondLow); // whichever is TIGHTER
      risk = Math.min(Math.max(risk, floorRisk), maxRisk);

      const riskPips = risk / pipMultiplier;
      const evenRiskPips = Math.max(minRiskFloorPips(entry, pipMultiplier), Math.round(riskPips / 2) * 2);
      risk = evenRiskPips * pipMultiplier;

      if (risk > 0) {
        const sl = entry - risk;
        const tp1 = entry + risk * 1.5;
        const tp2 = entry + risk * 3;
        const tp3 = entry + risk * 5;
        let confidence = 65;
        if (slope > EMA_SLOPE_THRESHOLD * 2) confidence += 8;
        if (rsiVal >= 48 && rsiVal <= 58) confidence += 7; // healthy mid-range momentum
        if (currentAtr > atrAvg * 1.3) confidence += 5;
        return {
          symbol: pair, direction: 'LONG',
          entry: Math.round(entry / pipMultiplier) * pipMultiplier,
          sl: Math.round(sl / pipMultiplier) * pipMultiplier,
          tp1: Math.round(tp1 / pipMultiplier) * pipMultiplier,
          tp2: Math.round(tp2 / pipMultiplier) * pipMultiplier,
          tp3: Math.round(tp3 / pipMultiplier) * pipMultiplier,
          trailEmaPeriod: TRAIL_EMA_PERIOD,
          confidence: Math.min(confidence, 85),
          reason: `EMA trend-continuation LONG | EMA200 sloped up ${(slope * 100).toFixed(2)}%, pulled back to EMA110 (${ema110.toFixed(5)}) and closed back above, RSI ${rsiVal.toFixed(1)}, ATR active (${currentAtr.toFixed(5)} > avg ${atrAvg.toFixed(5)})`,
          candleIndex: i,
        };
      }
    }
  }

  // --- SHORT: trend down, pullback up to EMA110, close back below ---
  const trendDownOk = current.close < ema200 && slope < -EMA_SLOPE_THRESHOLD;
  if (trendDownOk) {
    const windowHigh = Math.max(...window.map(c => c.high));
    const touchedEma110 = windowHigh >= ema110;
    const notCrashed = windowHigh <= ema110 + currentAtr * CRASH_MULT;
    const closedBackBelow = current.close < ema110 && current.close < current.open;
    const rsiOk = rsiVal >= 35 && rsiVal <= 55;
    const rsiHeldDuringPullback = Math.max(...windowRsi) <= 60;

    if (touchedEma110 && notCrashed && closedBackBelow && rsiOk && rsiHeldDuringPullback) {
      const entry = current.close;
      const floorRisk = getFloorRisk(pair, pipMultiplier, currentAtr);
      const maxRisk = getMaxRisk(pair, pipMultiplier, currentAtr);

      const riskBeyondEma = (ema110 - entry) + currentAtr * SL_EMA_ATR_MULT;
      const riskBeyondHigh = (windowHigh - entry) + currentAtr * SL_LOW_BUFFER_MULT;
      let risk = Math.min(riskBeyondEma, riskBeyondHigh);
      risk = Math.min(Math.max(risk, floorRisk), maxRisk);

      const riskPips = risk / pipMultiplier;
      const evenRiskPips = Math.max(minRiskFloorPips(entry, pipMultiplier), Math.round(riskPips / 2) * 2);
      risk = evenRiskPips * pipMultiplier;

      if (risk > 0) {
        const sl = entry + risk;
        const tp1 = entry - risk * 1.5;
        const tp2 = entry - risk * 3;
        const tp3 = entry - risk * 5;
        let confidence = 65;
        if (slope < -EMA_SLOPE_THRESHOLD * 2) confidence += 8;
        if (rsiVal <= 52 && rsiVal >= 42) confidence += 7;
        if (currentAtr > atrAvg * 1.3) confidence += 5;
        return {
          symbol: pair, direction: 'SHORT',
          entry: Math.round(entry / pipMultiplier) * pipMultiplier,
          sl: Math.round(sl / pipMultiplier) * pipMultiplier,
          tp1: Math.round(tp1 / pipMultiplier) * pipMultiplier,
          tp2: Math.round(tp2 / pipMultiplier) * pipMultiplier,
          tp3: Math.round(tp3 / pipMultiplier) * pipMultiplier,
          trailEmaPeriod: TRAIL_EMA_PERIOD,
          confidence: Math.min(confidence, 85),
          reason: `EMA trend-continuation SHORT | EMA200 sloped down ${(slope * 100).toFixed(2)}%, pulled back to EMA110 (${ema110.toFixed(5)}) and closed back below, RSI ${rsiVal.toFixed(1)}, ATR active (${currentAtr.toFixed(5)} > avg ${atrAvg.toFixed(5)})`,
          candleIndex: i,
        };
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Public scan entry point - FOREX ONLY for this first pass (per task scope).
// Not wired into scanner.ts; backtest-only.
// ---------------------------------------------------------------------------
export function scanEmaTrendSignals(pair: string, m5Candles: Candle[]): EmaTrendSignal[] {
  const signals: EmaTrendSignal[] = [];
  if (m5Candles.length < 250) return signals; // need EMA200 + slope lookback warm-up

  const ctx = buildContext(m5Candles);
  const pipMultiplier = getPipMultiplier(pair);

  let lastTs = 0;
  for (let i = 250; i < m5Candles.length; i++) {
    const ts = new Date(m5Candles[i].timestamp).getTime();
    if (ts - lastTs < MIN_SIGNAL_GAP_MS) continue;

    const signal = evaluateEmaTrend(pair, m5Candles, ctx, i, pipMultiplier);
    if (signal) {
      signals.push(signal);
      lastTs = ts;
    }
  }
  return signals;
}

export { TRAIL_EMA_PERIOD, EMA_SLOPE_THRESHOLD, EMA_SLOPE_LOOKBACK };
