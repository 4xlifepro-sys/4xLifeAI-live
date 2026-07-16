import type { Candle, Signal } from '../src/types.js';
import { getPipMultiplier } from './engine2.js';
import crypto from 'crypto';

export interface TrendBreakoutSignal {
  symbol: string;
  direction: 'LONG' | 'SHORT';
  entry: number;
  sl: number;
  tp1: number; // informational reference only (1.5R) - real exit is the EMA trail below
  tp2: number; // informational reference only (3R)
  tp3: number; // informational reference only (5R)
  trailEmaPeriod: number; // the moving average used to trail the stop / take profit
  confidence: number;
  reason: string;
  candleIndex: number;
}

// ---------------------------------------------------------------------------
// Shared indicator math (self-contained - does not import/modify anything
// from engine-mean-reversion.ts).
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

function stddev(values: number[], smaArr: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = period - 1; i < values.length; i++) {
    const mean = smaArr[i - (period - 1)];
    let sumSq = 0;
    for (let j = i - period + 1; j <= i; j++) sumSq += (values[j] - mean) ** 2;
    result.push(Math.sqrt(sumSq / period));
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

/**
 * Rolling Donchian channel high/low over `period` bars, STRICTLY EXCLUDING
 * the current bar (so "breakout" means the current close trades beyond the
 * prior N bars' range, not beyond a range that already includes itself).
 * donchianHigh(i)/donchianLow(i) require i >= period.
 */
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

// ---------------------------------------------------------------------------
// Floor/max risk (SL distance) bounds per pair.
//
// BUG FIX: pairs NOT in the explicit map used to fall back to a fixed
// forex-style formula (6-8x / 20-25x pipMultiplier, with pipMultiplier=1 for
// crypto). For low-priced coins like XRPUSD (~$1), ADAUSD (~$0.5) and
// DOGEUSD (~$0.08), that produced a floor/max risk of several DOLLARS -
// multiples of the entire price - so trades' stops were effectively
// unreachable and positions never closed within the backtest window.
//
// Fix: when a pair isn't explicitly mapped, size the floor/max risk off the
// asset's OWN current volatility (ATR) instead of a fixed forex-scale
// number, so it scales correctly whether the asset trades at $0.08 or
// $60,000. Explicitly-mapped pairs (already hand-tuned) are unchanged.
// ---------------------------------------------------------------------------
function getFloorRisk(pair: string, pipMultiplier: number, currentAtr?: number): number {
  const minimumStopByPair: Record<string, number> = {
    AUDUSD: 6 * 0.0001, USDCAD: 6 * 0.0001, EURNZD: 8 * 0.0001,
    GBPAUD: 8 * 0.0001, GBPNZD: 10 * 0.0001, CADJPY: 8 * 0.01,
    NZDJPY: 8 * 0.01, XAUUSD: 12, XAGUSD: 0.50, BTCUSD: 250,
    ETHUSD: 15, SOLUSD: 1.5, LTCUSD: 0.8, BNBUSD: 2.5,
  };
  if (minimumStopByPair[pair] !== undefined) return minimumStopByPair[pair];
  if (currentAtr !== undefined && currentAtr > 0) return currentAtr * 0.5; // ATR-based, price-relative
  return pair.includes('JPY') ? 8 * pipMultiplier : 6 * pipMultiplier; // legacy fallback if ATR unavailable
}

function getMaxRisk(pair: string, pipMultiplier: number, currentAtr?: number): number {
  const maximumStopByPair: Record<string, number> = {
    AUDUSD: 20 * 0.0001, USDCAD: 20 * 0.0001, EURNZD: 25 * 0.0001,
    GBPAUD: 25 * 0.0001, GBPNZD: 100 * 0.0001, CADJPY: 25 * 0.01,
    NZDJPY: 25 * 0.01, XAUUSD: 30, XAGUSD: 1.50, BTCUSD: 2500,
    ETHUSD: 50, SOLUSD: 5, LTCUSD: 3, BNBUSD: 8,
  };
  if (maximumStopByPair[pair] !== undefined) return maximumStopByPair[pair];
  if (currentAtr !== undefined && currentAtr > 0) return currentAtr * 3; // ATR-based, price-relative
  return pair.includes('JPY') ? 25 * pipMultiplier : 20 * pipMultiplier; // legacy fallback if ATR unavailable
}

const MIN_STOP_PCT_OF_PRICE = 0.003; // 0.3% of entry price - absolute rounding-floor safety net

// BUG FIX (rounding step only): risk used to be rounded to whole "pips" with
// a hardcoded floor of Math.max(2, ...) pips. For low-priced coins where
// pipMultiplier=1 (DOGEUSD ~$0.08 etc.), that forced a minimum $2 stop -
// bigger than the entire price - making the SL unreachable so trades never
// closed. This picks whichever is SMALLER: the legacy 2-pip floor (kept
// as-is for normal-priced pairs, where 2 pips is tiny relative to price) or
// a small percentage of the entry price expressed in pips (scales correctly
// for low-priced assets). Does not touch the floor/max-risk helper above,
// which was already fixed separately.
function minRiskFloorPips(entry: number, pipMultiplier: number): number {
  const priceRelativePips = (entry * MIN_STOP_PCT_OF_PRICE) / pipMultiplier;
  return Math.min(2, priceRelativePips);
}

function isGoodSession(timestamp: string): boolean {
  const hour = new Date(timestamp).getUTCHours();
  return hour >= 7 && hour <= 21;
}

const CRYPTO_PAIRS = new Set(['BTCUSD', 'ETHUSD', 'SOLUSD', 'XRPUSD', 'BNBUSD', 'ADAUSD', 'LTCUSD', 'DOGEUSD']);
const METALS_PAIRS = new Set(['XAUUSD', 'XAGUSD']);

function getAssetClass(pair: string): 'CRYPTO' | 'METALS' | 'FOREX' {
  if (CRYPTO_PAIRS.has(pair)) return 'CRYPTO';
  if (METALS_PAIRS.has(pair)) return 'METALS';
  return 'FOREX';
}

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------
const EMA_TREND_PERIOD = 200;
const EMA_SLOPE_LOOKBACK = 20;      // bars used to measure EMA200 slope
const EMA_SLOPE_THRESHOLD = 0.003;  // 0.3% move in EMA200 over the lookback = "clearly angled"
const DONCHIAN_PERIOD = 20;
const BB_PERIOD = 20;
const BB_STDDEV = 2;
const RANGE_AVG_PERIOD = 20;        // participation proxy lookback (see note below)
const ATR_PERIOD = 14;
const ATR_EXPANSION_LOOKBACK = 10;  // ATR must exceed its own N-period average
const STRONG_CLOSE_FRACTION = 0.30; // close must be within the top/bottom 30% of the candle's range
const TRAIL_EMA_PERIOD = 20;        // EMA used to trail the stop/TP in the backtest
const MIN_SIGNAL_GAP_MS = 30 * 60 * 1000; // 30 min minimum gap between signals per pair

/**
 * NOTE ON "VOLUME": the OHLC candle data available in this pipeline
 * (server/download-*.ts, .cache/*.json) does NOT include real tick/exchange
 * volume for any of these instruments - only open/high/low/close. Real
 * volume confirmation as literally specified is therefore not possible with
 * the current data source. As a documented proxy, this engine uses candle
 * RANGE (high - low) vs its own 20-period average as a stand-in for
 * "participation" (wide-range breakout candle = real move, narrow-range =
 * likely fakeout). TODO: replace with real tick volume once a data source
 * that provides it is wired up.
 */
function computeRangeProxy(candles: Candle[]): { range: number[]; rangeAvg: number[] } {
  const range = candles.map(c => c.high - c.low);
  const rangeAvg = sma(range, RANGE_AVG_PERIOD);
  return { range, rangeAvg };
}

export interface TrendBreakoutContext {
  closes: number[];
  ema200: number[];
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
  trailEma: number[];
  trailEmaAt: (i: number) => number | undefined;
}

function buildContext(candles: Candle[]): TrendBreakoutContext {
  const closes = candles.map(c => c.close);

  const ema200 = ema(closes, EMA_TREND_PERIOD);
  const ema200At = (i: number) => {
    const j = i - (EMA_TREND_PERIOD - 1);
    return (j >= 0 && j < ema200.length) ? ema200[j] : undefined;
  };

  const smaArr = sma(closes, BB_PERIOD);
  const stdArr = stddev(closes, smaArr, BB_PERIOD);
  const bbAt = (i: number) => {
    const j = i - (BB_PERIOD - 1);
    return (j >= 0 && j < smaArr.length) ? { mean: smaArr[j], std: stdArr[j] } : undefined;
  };
  const bbUpper = (i: number) => { const b = bbAt(i); return b ? b.mean + BB_STDDEV * b.std : undefined; };
  const bbLower = (i: number) => { const b = bbAt(i); return b ? b.mean - BB_STDDEV * b.std : undefined; };

  const rsiArr = rsi(closes, 14);
  const rsiAt = (i: number) => { const j = i - 14; return (j >= 0 && j < rsiArr.length) ? rsiArr[j] : undefined; };

  const atrArr = atr(candles, ATR_PERIOD);
  const atrAt = (i: number) => { const j = i - ATR_PERIOD; return (j >= 0 && j < atrArr.length) ? atrArr[j] : undefined; };
  const atrAvgArr = sma(atrArr, ATR_EXPANSION_LOOKBACK);
  // atrArr index (i-ATR_PERIOD) maps to atrAvgArr index ((i-ATR_PERIOD)-(ATR_EXPANSION_LOOKBACK-1))
  const atrAvgAt = (i: number) => {
    const j = (i - ATR_PERIOD) - (ATR_EXPANSION_LOOKBACK - 1);
    return (j >= 0 && j < atrAvgArr.length) ? atrAvgArr[j] : undefined;
  };

  const { range, rangeAvg } = computeRangeProxy(candles);
  const rangeAt = (i: number) => range[i];
  const rangeAvgAt = (i: number) => {
    const j = i - (RANGE_AVG_PERIOD - 1);
    return (j >= 0 && j < rangeAvg.length) ? rangeAvg[j] : undefined;
  };

  const { highs: donHigh, lows: donLow } = donchian(candles, DONCHIAN_PERIOD);

  const trailEma = ema(closes, TRAIL_EMA_PERIOD);
  const trailEmaAt = (i: number) => {
    const j = i - (TRAIL_EMA_PERIOD - 1);
    return (j >= 0 && j < trailEma.length) ? trailEma[j] : undefined;
  };

  return { closes, ema200, ema200At, bbUpper, bbLower, rsiAt, atrAt, atrAvgAt, rangeAt, rangeAvgAt, donHigh, donLow, trailEma, trailEmaAt };
}

function ema200Slope(ctx: TrendBreakoutContext, i: number): number {
  const cur = ctx.ema200At(i);
  const prev = ctx.ema200At(i - EMA_SLOPE_LOOKBACK);
  if (cur === undefined || prev === undefined || prev === 0) return 0;
  return (cur - prev) / prev;
}

/**
 * Core breakout/continuation entry check, shared by crypto and metals paths.
 * Returns a signal or null. `atrSlBufferMult` and `riskMult` let each asset
 * class widen the initial stop appropriately (breakout trades need more room
 * than the mean-reversion engine's tight scalp stops, since a normal pullback
 * inside a genuine trend must not stop the trade out).
 */
// Breakout trades need more room than the mean-reversion engine's tight
// scalp stops (a normal pullback inside a genuine trend must not stop the
// trade out), so the ATR-derived floor/max risk is widened by this factor.
const BREAKOUT_RISK_WIDEN_MULT = 2;

function evaluateBreakout(
  pair: string,
  candles: Candle[],
  ctx: TrendBreakoutContext,
  i: number,
  pipMultiplier: number,
  atrSlBufferMult: number,
  assetTag: string,
  momentumThresholds?: { longMin: number; shortMax: number }
): TrendBreakoutSignal | null {
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

  if (ema200 === undefined || rsiVal === undefined || !currentAtr || atrAvg === undefined ||
      rangeVal === undefined || rangeAvg === undefined) return null;

  // Volatility expansion filter: skip low-volume fakeouts / dead-market breakouts
  if (currentAtr <= atrAvg) return null;

  const range = current.high - current.low;
  if (range <= 0) return null;

  // Floor/max risk computed per-candle from this asset's OWN current ATR
  // (bug fix - see getFloorRisk/getMaxRisk comment above). Unmapped
  // low-priced coins (XRP/ADA/DOGE) now get a price-relative SL instead of
  // a fixed forex-scale one; already-tuned pairs (BTC/ETH/SOL/LTC/BNB, XAU,
  // XAG) are unaffected since they still resolve via the explicit map first.
  const floorRisk = getFloorRisk(pair, pipMultiplier, currentAtr) * BREAKOUT_RISK_WIDEN_MULT;
  const maxRisk = getMaxRisk(pair, pipMultiplier, currentAtr) * BREAKOUT_RISK_WIDEN_MULT;

  // --- LONG breakout ---
  const trendUpOk = current.close > ema200 && slope > EMA_SLOPE_THRESHOLD;
  const brokeOutLong = (donHi !== undefined && current.close > donHi) || (bbUp !== undefined && current.close > bbUp);
  const strongCloseLong = current.close >= current.low + (1 - STRONG_CLOSE_FRACTION) * range;
  const participationOk = rangeVal > rangeAvg; // volume proxy (see note above)
  const momentumLongOk = rsiVal > (momentumThresholds?.longMin ?? 55);

  if (trendUpOk && brokeOutLong && strongCloseLong && participationOk && momentumLongOk) {
    const entry = current.close;
    let risk = Math.min(Math.max((entry - current.low) + currentAtr * atrSlBufferMult, floorRisk), maxRisk);
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
      if (rsiVal >= 55 && rsiVal <= 70) confidence += 7; // strong but not exhausted
      if (rangeVal > rangeAvg * 1.5) confidence += 5;
      return {
        symbol: pair, direction: 'LONG',
        entry: Math.round(entry / pipMultiplier) * pipMultiplier,
        sl: Math.round(sl / pipMultiplier) * pipMultiplier,
        tp1: Math.round(tp1 / pipMultiplier) * pipMultiplier,
        tp2: Math.round(tp2 / pipMultiplier) * pipMultiplier,
        tp3: Math.round(tp3 / pipMultiplier) * pipMultiplier,
        trailEmaPeriod: TRAIL_EMA_PERIOD,
        confidence: Math.min(confidence, 85),
        reason: `Trend breakout LONG (${assetTag}) | EMA200 sloped up ${(slope * 100).toFixed(2)}%, closed above ${DONCHIAN_PERIOD}-bar high/BB upper with strong close, RSI ${rsiVal.toFixed(1)}, ATR expanding, range ${rangeVal.toFixed(4)} > avg ${rangeAvg.toFixed(4)} (participation proxy)`,
        candleIndex: i
      };
    }
  }

  // --- SHORT breakout ---
  const trendDownOk = current.close < ema200 && slope < -EMA_SLOPE_THRESHOLD;
  const brokeOutShort = (donLo !== undefined && current.close < donLo) || (bbLo !== undefined && current.close < bbLo);
  const strongCloseShort = current.close <= current.high - (1 - STRONG_CLOSE_FRACTION) * range;
  const momentumShortOk = rsiVal < (momentumThresholds?.shortMax ?? 45);

  if (trendDownOk && brokeOutShort && strongCloseShort && participationOk && momentumShortOk) {
    const entry = current.close;
    let risk = Math.min(Math.max((current.high - entry) + currentAtr * atrSlBufferMult, floorRisk), maxRisk);
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
      if (rsiVal <= 45 && rsiVal >= 30) confidence += 7;
      if (rangeVal > rangeAvg * 1.5) confidence += 5;
      return {
        symbol: pair, direction: 'SHORT',
        entry: Math.round(entry / pipMultiplier) * pipMultiplier,
        sl: Math.round(sl / pipMultiplier) * pipMultiplier,
        tp1: Math.round(tp1 / pipMultiplier) * pipMultiplier,
        tp2: Math.round(tp2 / pipMultiplier) * pipMultiplier,
        tp3: Math.round(tp3 / pipMultiplier) * pipMultiplier,
        trailEmaPeriod: TRAIL_EMA_PERIOD,
        confidence: Math.min(confidence, 85),
        reason: `Trend breakout SHORT (${assetTag}) | EMA200 sloped down ${(slope * 100).toFixed(2)}%, closed below ${DONCHIAN_PERIOD}-bar low/BB lower with strong close, RSI ${rsiVal.toFixed(1)}, ATR expanding, range ${rangeVal.toFixed(4)} > avg ${rangeAvg.toFixed(4)} (participation proxy)`,
        candleIndex: i
      };
    }
  }

  return null;
}

/**
 * Router: dispatches to a dedicated implementation per asset class.
 * This engine is entirely new and isolated - it does not import from or
 * modify engine-mean-reversion.ts, and there is no FOREX path here (forex
 * continues to run only on the existing mean-reversion engine, untouched).
 */
export function scanTrendBreakoutSignals(pair: string, m5Candles: Candle[], opts?: { metalsSessionFilter?: boolean }): TrendBreakoutSignal[] {
  const cls = getAssetClass(pair);
  if (cls === 'CRYPTO') return scanCryptoTrendBreakout(pair, m5Candles);
  if (cls === 'METALS') return scanMetalsTrendBreakout(pair, m5Candles, opts?.metalsSessionFilter ?? true);
  // Forex is intentionally not implemented in this engine - use
  // engine-mean-reversion.ts's scanForexMeanReversion for forex.
  return [];
}

// ---------------------------------------------------------------------------
// CRYPTO - 24/7, no session filter. Wider ATR SL buffer (crypto wicks run big).
// ---------------------------------------------------------------------------
const CRYPTO_ATR_SL_BUFFER = 1.0; // wider than metals/forex - crypto pullbacks inside a trend can be large

// Per-coin momentum threshold overrides (crypto-only tweak, Step 3): the
// worst performers (BTCUSD, XRPUSD, BNBUSD - confirmed 0%/0%/25% WR and
// negative avgR in the isolated backtest) get a stricter momentum
// confirmation requirement than the default 55/45, to filter out weaker
// breakouts. Coins not listed keep the default (unchanged) thresholds.
// Env-var override lets the backtest sweep values without editing this file.
const CRYPTO_MOMENTUM_LONG_MIN_DEFAULT = 55;
const CRYPTO_MOMENTUM_SHORT_MAX_DEFAULT = 45;
const CRYPTO_MOMENTUM_OVERRIDES: Record<string, { longMin: number; shortMax: number }> = (() => {
  const tightLongMin = Number(process.env.CRYPTO_TIGHT_MOMENTUM_LONG_MIN ?? 60);
  const tightShortMax = Number(process.env.CRYPTO_TIGHT_MOMENTUM_SHORT_MAX ?? 40);
  const targets = (process.env.CRYPTO_TIGHT_MOMENTUM_PAIRS ?? 'BTCUSD,XRPUSD,BNBUSD').split(',').map(s => s.trim()).filter(Boolean);
  const map: Record<string, { longMin: number; shortMax: number }> = {};
  for (const p of targets) map[p] = { longMin: tightLongMin, shortMax: tightShortMax };
  return map;
})();

function scanCryptoTrendBreakout(pair: string, m5Candles: Candle[]): TrendBreakoutSignal[] {
  const signals: TrendBreakoutSignal[] = [];
  if (m5Candles.length < 250) return signals; // need enough bars for EMA200 + slope lookback

  const ctx = buildContext(m5Candles);
  const pipMultiplier = getPipMultiplier(pair);
  const momentumThresholds = CRYPTO_MOMENTUM_OVERRIDES[pair] ?? { longMin: CRYPTO_MOMENTUM_LONG_MIN_DEFAULT, shortMax: CRYPTO_MOMENTUM_SHORT_MAX_DEFAULT };

  let lastTs = 0;
  for (let i = 250; i < m5Candles.length; i++) {
    const ts = new Date(m5Candles[i].timestamp).getTime();
    if (ts - lastTs < MIN_SIGNAL_GAP_MS) continue;

    const signal = evaluateBreakout(pair, m5Candles, ctx, i, pipMultiplier, CRYPTO_ATR_SL_BUFFER, 'CRYPTO', momentumThresholds);
    if (signal) {
      signals.push(signal);
      lastTs = ts;
    }
  }
  return signals;
}

// ---------------------------------------------------------------------------
// METALS - optional session filter (default true) so the isolated backtest
// can run a with/without comparison, per the task's requirement to test
// whether the forex session assumption (07:00-21:00 UTC) actually applies
// to gold/silver breakout trades.
// ---------------------------------------------------------------------------
const METALS_ATR_SL_BUFFER = 0.75;

function scanMetalsTrendBreakout(pair: string, m5Candles: Candle[], useSessionFilter: boolean): TrendBreakoutSignal[] {
  const signals: TrendBreakoutSignal[] = [];
  if (m5Candles.length < 250) return signals;

  const ctx = buildContext(m5Candles);
  const pipMultiplier = getPipMultiplier(pair);

  let lastTs = 0;
  for (let i = 250; i < m5Candles.length; i++) {
    const current = m5Candles[i];
    if (useSessionFilter && !isGoodSession(current.timestamp)) continue;

    const ts = new Date(current.timestamp).getTime();
    if (ts - lastTs < MIN_SIGNAL_GAP_MS) continue;

    const signal = evaluateBreakout(pair, m5Candles, ctx, i, pipMultiplier, METALS_ATR_SL_BUFFER, 'METALS');
    if (signal) {
      signals.push(signal);
      lastTs = ts;
    }
  }
  return signals;
}

// Exported for the backtest script's trailing-stop simulation - build once
// per pair and reuse trailEmaAt(i), do not rebuild per-index (O(n) each call).
export { TRAIL_EMA_PERIOD, buildContext, evaluateBreakout, METALS_ATR_SL_BUFFER, MIN_SIGNAL_GAP_MS };

// ---------------------------------------------------------------------------
// LIVE adapter - all 8 backtested crypto coins deployed per explicit request.
// ETHUSD, SOLUSD, LTCUSD, ADAUSD, DOGEUSD were the confirmed-profitable
// subset. BTCUSD/BNBUSD/XRPUSD showed weaker/negative avgR in the isolated
// backtest but keep the stricter CRYPTO_MOMENTUM_OVERRIDES threshold above
// (applied by default to these 3) to reduce weak-breakout entries live.
//
// Mirrors the { signal, scores, regime, regimeReason } shape returned by
// engine2.ts's detectTrendMomentumScannerV5 so scanner.ts's downstream logic
// (confidence gate, duplicate-trade check, DB writes, market state) works
// unchanged regardless of which engine produced the signal.
// ---------------------------------------------------------------------------
export const CURATED_LIVE_CRYPTO_PAIRS = new Set(['ETHUSD', 'SOLUSD', 'LTCUSD', 'ADAUSD', 'DOGEUSD', 'BTCUSD', 'BNBUSD', 'XRPUSD']);

export function detectCryptoTrendBreakoutLive(pair: string, entryTf: Candle[]): {
  signal: Signal;
  scores: { strengthScore: number; momentumScore: number; atrScore: number; trendScore: number };
  regime: string;
  regimeReason: string;
} {
  const noSignal = (reason: string): Signal => ({
    id: crypto.randomUUID(),
    pair,
    direction: 'LONG',
    bias: 'NEUTRAL',
    score: 0,
    entry: 0,
    sl: 0,
    tp1: 0,
    tp2: 0,
    tp3: 0,
    aiConfidence: 0,
    tier: 'Reject',
    status: 'REJECTED',
    timestamp: new Date().toISOString(),
    aiReason: reason,
    rejection_reason: reason,
  });

  if (!entryTf || entryTf.length < 250) {
    return { signal: noSignal('INSUFFICIENT_M5_HISTORY'), scores: { strengthScore: 0, momentumScore: 0, atrScore: 0, trendScore: 0 }, regime: 'CRYPTO_TREND_BREAKOUT', regimeReason: 'INSUFFICIENT_M5_HISTORY' };
  }

  const signals = scanCryptoTrendBreakout(pair, entryTf);
  const last = signals[signals.length - 1];
  const isFresh = last && last.candleIndex === entryTf.length - 1;

  if (!isFresh) {
    const reason = last ? 'NO_FRESH_SIGNAL_ON_LATEST_CANDLE' : 'NO_BREAKOUT_SETUP';
    return { signal: noSignal(reason), scores: { strengthScore: 0, momentumScore: 0, atrScore: 0, trendScore: 0 }, regime: 'CRYPTO_TREND_BREAKOUT', regimeReason: reason };
  }

  let tier: 'Strong' | 'Good' | 'Valid' | 'Reject' = 'Valid';
  if (last.confidence >= 75) tier = 'Strong';
  else if (last.confidence >= 65) tier = 'Good';

  const lastCandle = entryTf[entryTf.length - 1];

  const signal: Signal = {
    id: crypto.randomUUID(),
    pair,
    direction: last.direction,
    bias: last.direction === 'LONG' ? 'BULLISH' : 'BEARISH',
    score: last.confidence,
    entry: last.entry,
    sl: last.sl,
    tp1: last.tp1,
    tp2: last.tp2,
    tp3: last.tp3,
    aiConfidence: last.confidence,
    tier,
    status: 'ACTIVE',
    timestamp: lastCandle?.timestamp || new Date().toISOString(),
    aiReason: last.reason,
    diagnostics: {
      regimeState: last.direction === 'LONG' ? 'TRENDING_BULL' : 'TRENDING_BEAR',
      engine: 'CRYPTO_TREND_BREAKOUT_CURATED',
      trailEmaPeriod: last.trailEmaPeriod,
    },
  };

  return {
    signal,
    scores: { strengthScore: last.confidence, momentumScore: last.confidence, atrScore: last.confidence, trendScore: last.confidence },
    regime: last.direction === 'LONG' ? 'TRENDING_BULL' : 'TRENDING_BEAR',
    regimeReason: last.reason,
  };
}

// ---------------------------------------------------------------------------
// LIVE adapter - METALS trend-breakout only (walk-forward validated: session
// filter ON confirmed better than OFF, 38.3% WR / +0.184 avgR combined
// in+out-of-sample, 183 closed trades). Mirrors the same
// { signal, scores, regime, regimeReason } shape as detectCryptoTrendBreakoutLive
// / engine2.ts's detectTrendMomentumScannerV5 so scanner.ts's downstream logic
// (confidence gate, duplicate-trade check, DB writes, market state) works
// unchanged regardless of which engine produced the signal.
//
// NOT yet wired into scanner.ts routing - defined here for review, per the
// approved plan (forex + metals live, crypto stays on existing routing).
// ---------------------------------------------------------------------------
export function detectMetalsTrendBreakoutLive(pair: string, entryTf: Candle[]): {
  signal: Signal;
  scores: { strengthScore: number; momentumScore: number; atrScore: number; trendScore: number };
  regime: string;
  regimeReason: string;
} {
  const noSignal = (reason: string): Signal => ({
    id: crypto.randomUUID(),
    pair,
    direction: 'LONG',
    bias: 'NEUTRAL',
    score: 0,
    entry: 0,
    sl: 0,
    tp1: 0,
    tp2: 0,
    tp3: 0,
    aiConfidence: 0,
    tier: 'Reject',
    status: 'REJECTED',
    timestamp: new Date().toISOString(),
    aiReason: reason,
    rejection_reason: reason,
  });

  if (!entryTf || entryTf.length < 250) {
    return { signal: noSignal('INSUFFICIENT_M5_HISTORY'), scores: { strengthScore: 0, momentumScore: 0, atrScore: 0, trendScore: 0 }, regime: 'METALS_TREND_BREAKOUT', regimeReason: 'INSUFFICIENT_M5_HISTORY' };
  }

  // metalsSessionFilter: true - confirmed better than OFF in walk-forward validation.
  const signals = scanMetalsTrendBreakout(pair, entryTf, true);
  const last = signals[signals.length - 1];
  const isFresh = last && last.candleIndex === entryTf.length - 1;

  if (!isFresh) {
    const reason = last ? 'NO_FRESH_SIGNAL_ON_LATEST_CANDLE' : 'NO_BREAKOUT_SETUP';
    return { signal: noSignal(reason), scores: { strengthScore: 0, momentumScore: 0, atrScore: 0, trendScore: 0 }, regime: 'METALS_TREND_BREAKOUT', regimeReason: reason };
  }

  let tier: 'Strong' | 'Good' | 'Valid' | 'Reject' = 'Valid';
  if (last.confidence >= 75) tier = 'Strong';
  else if (last.confidence >= 65) tier = 'Good';

  const lastCandle = entryTf[entryTf.length - 1];

  const signal: Signal = {
    id: crypto.randomUUID(),
    pair,
    direction: last.direction,
    bias: last.direction === 'LONG' ? 'BULLISH' : 'BEARISH',
    score: last.confidence,
    entry: last.entry,
    sl: last.sl,
    tp1: last.tp1,
    tp2: last.tp2,
    tp3: last.tp3,
    aiConfidence: last.confidence,
    tier,
    status: 'ACTIVE',
    timestamp: lastCandle?.timestamp || new Date().toISOString(),
    aiReason: last.reason,
    diagnostics: {
      regimeState: last.direction === 'LONG' ? 'TRENDING_BULL' : 'TRENDING_BEAR',
      engine: 'METALS_TREND_BREAKOUT',
      trailEmaPeriod: last.trailEmaPeriod,
      // Walk-forward validated risk sizing guidance (maxDD 16.71R in-sample,
      // targeting <=15-20% max account drawdown). Surfaced downstream by
      // scanner.ts in the Telegram message and/or DB record.
      recommendedRiskPercent: 0.9,
    },
  };

  return {
    signal,
    scores: { strengthScore: last.confidence, momentumScore: last.confidence, atrScore: last.confidence, trendScore: last.confidence },
    regime: last.direction === 'LONG' ? 'TRENDING_BULL' : 'TRENDING_BEAR',
    regimeReason: last.reason,
  };
}
