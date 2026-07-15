// TEMPORARY experimentation script - crypto-only, does not touch engine files.
// Used to explore parameter variants for the crypto trend-breakout and
// mean-reversion paths before committing a final change to the real engine
// files. Safe to delete after the task is done.
import type { Candle } from './src/types.js';

const fs = await import('fs');
const path = await import('path');
const CACHE = path.default.join(process.cwd(), '.cache');

function cacheKey(pair: string, interval: string, months: number) {
  return path.default.join(CACHE, `${pair}_${interval}_${months}m.json`);
}
function normalizeTimestamp(ts: string): string {
  if (ts.includes('T') || ts.endsWith('Z')) return ts;
  return ts.replace(' ', 'T') + 'Z';
}
function loadCache(pair: string, interval: string, months: number): Candle[] | null {
  const f = cacheKey(pair, interval, months);
  if (fs.default.existsSync(f)) {
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
  return null;
}

function getPipMultiplier(pair: string): number {
  return 1; // all crypto pairs here
}

// ---------------- indicator helpers (copied, self-contained) ----------------
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
    highs[i] = hi; lows[i] = lo;
  }
  return { highs, lows };
}

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
  return { ema200At, bbUpper, bbLower, rsiAt, atrAt, atrAvgAt, rangeAt, rangeAvgAt, donHigh, donLow };
}

function ema200Slope(ctx: Ctx, i: number): number {
  const cur = ctx.ema200At(i);
  const prev = ctx.ema200At(i - EMA_SLOPE_LOOKBACK);
  if (cur === undefined || prev === undefined || prev === 0) return 0;
  return (cur - prev) / prev;
}

function getFloorRisk(pair: string, currentAtr: number): number {
  const minimumStopByPair: Record<string, number> = {
    BTCUSD: 250, ETHUSD: 15, SOLUSD: 1.5, LTCUSD: 0.8, BNBUSD: 2.5,
  };
  if (minimumStopByPair[pair] !== undefined) return minimumStopByPair[pair];
  return currentAtr * 0.5;
}
function getMaxRisk(pair: string, currentAtr: number): number {
  const maximumStopByPair: Record<string, number> = {
    BTCUSD: 2500, ETHUSD: 50, SOLUSD: 5, LTCUSD: 3, BNBUSD: 8,
  };
  if (maximumStopByPair[pair] !== undefined) return maximumStopByPair[pair];
  return currentAtr * 3;
}
const MIN_STOP_PCT_OF_PRICE = 0.003;
function minRiskFloorPips(entry: number): number {
  return Math.min(2, entry * MIN_STOP_PCT_OF_PRICE);
}

const BREAKOUT_RISK_WIDEN_MULT = 2;
const CRYPTO_ATR_SL_BUFFER = 1.0;

interface Signal {
  pair: string; direction: 'LONG' | 'SHORT'; entry: number; sl: number;
  candleIndex: number; tp1R: number;
}

interface VariantOpts {
  rsiLongMin: number;
  rsiShortMax: number;
  atrExpansionMult: number; // currentAtr must be > atrAvg * mult
  requireMultiBarConfirm: boolean; // previous candle must also have closed beyond donchian/bb (weaker: beyond bb only)
  requireStrongerClose: number; // fraction (0.30 default)
  minSlopeMult: number; // multiplier on EMA_SLOPE_THRESHOLD
  participationMult: number; // rangeVal > rangeAvg * mult
  tp1R: number; // for fixed-TP simulation
  minGapMs: number;
}

const DEFAULT_OPTS: VariantOpts = {
  rsiLongMin: 55, rsiShortMax: 45, atrExpansionMult: 1.0,
  requireMultiBarConfirm: false, requireStrongerClose: 0.30,
  minSlopeMult: 1.0, participationMult: 1.0, tp1R: 1.5, minGapMs: 30 * 60 * 1000
};

function scanCrypto(pair: string, candles: Candle[], opts: VariantOpts): Signal[] {
  const signals: Signal[] = [];
  if (candles.length < 250) return signals;
  const ctx = buildContext(candles);
  let lastTs = 0;

  for (let i = 250; i < candles.length; i++) {
    const current = candles[i];
    const ts = new Date(current.timestamp).getTime();
    if (ts - lastTs < opts.minGapMs) continue;

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
        rangeVal === undefined || rangeAvg === undefined) continue;

    if (currentAtr <= atrAvg * opts.atrExpansionMult) continue;

    const range = current.high - current.low;
    if (range <= 0) continue;

    const floorRisk = getFloorRisk(pair, currentAtr) * BREAKOUT_RISK_WIDEN_MULT;
    const maxRisk = getMaxRisk(pair, currentAtr) * BREAKOUT_RISK_WIDEN_MULT;

    const slopeThresh = EMA_SLOPE_THRESHOLD * opts.minSlopeMult;

    // LONG
    const trendUpOk = current.close > ema200 && slope > slopeThresh;
    const brokeOutLong = (donHi !== undefined && current.close > donHi) || (bbUp !== undefined && current.close > bbUp);
    const strongCloseLong = current.close >= current.low + (1 - opts.requireStrongerClose) * range;
    const participationOk = rangeVal > rangeAvg * opts.participationMult;
    const momentumLongOk = rsiVal > opts.rsiLongMin;

    let multiBarLongOk = true;
    if (opts.requireMultiBarConfirm) {
      const prev = candles[i - 1];
      const prevBbUp = ctx.bbUpper(i - 1);
      const prevClose = prev.close;
      multiBarLongOk = prevBbUp !== undefined && prevClose > (ctx.ema200At(i - 1) ?? -Infinity) && prevClose > (prevBbUp * 0.999);
    }

    let signal: Signal | null = null;
    if (trendUpOk && brokeOutLong && strongCloseLong && participationOk && momentumLongOk && multiBarLongOk) {
      const entry = current.close;
      let risk = Math.min(Math.max((entry - current.low) + currentAtr * CRYPTO_ATR_SL_BUFFER, floorRisk), maxRisk);
      const evenRiskPips = Math.max(minRiskFloorPips(entry), Math.round(risk / 2) * 2);
      risk = evenRiskPips;
      if (risk > 0) {
        signal = { pair, direction: 'LONG', entry, sl: entry - risk, candleIndex: i, tp1R: opts.tp1R };
      }
    }

    // SHORT
    if (!signal) {
      const trendDownOk = current.close < ema200 && slope < -slopeThresh;
      const brokeOutShort = (donLo !== undefined && current.close < donLo) || (bbLo !== undefined && current.close < bbLo);
      const strongCloseShort = current.close <= current.high - (1 - opts.requireStrongerClose) * range;
      const momentumShortOk = rsiVal < opts.rsiShortMax;

      let multiBarShortOk = true;
      if (opts.requireMultiBarConfirm) {
        const prev = candles[i - 1];
        const prevBbLo = ctx.bbLower(i - 1);
        const prevClose = prev.close;
        multiBarShortOk = prevBbLo !== undefined && prevClose < (ctx.ema200At(i - 1) ?? Infinity) && prevClose < (prevBbLo * 1.001);
      }

      if (trendDownOk && brokeOutShort && strongCloseShort && participationOk && momentumShortOk && multiBarShortOk) {
        const entry = current.close;
        let risk = Math.min(Math.max((current.high - entry) + currentAtr * CRYPTO_ATR_SL_BUFFER, floorRisk), maxRisk);
        const evenRiskPips = Math.max(minRiskFloorPips(entry), Math.round(risk / 2) * 2);
        risk = evenRiskPips;
        if (risk > 0) {
          signal = { pair, direction: 'SHORT', entry, sl: entry + risk, candleIndex: i, tp1R: opts.tp1R };
        }
      }
    }

    if (signal) { signals.push(signal); lastTs = ts; }
  }
  return signals;
}

// Fixed-TP simulation (TP1 = tp1R * risk, first touch of TP or SL wins/loses; if neither touched within horizon -> OPEN)
interface SimTrade extends Signal {
  result: 'WIN' | 'LOSS' | 'OPEN';
  r: number;
}
function simulateFixedTP(sig: Signal, candles: Candle[], maxLookahead = 2000): SimTrade {
  const isLong = sig.direction === 'LONG';
  const risk = Math.abs(sig.entry - sig.sl);
  const tp = isLong ? sig.entry + risk * sig.tp1R : sig.entry - risk * sig.tp1R;
  const end = Math.min(sig.candleIndex + 1 + maxLookahead, candles.length);
  for (let i = sig.candleIndex + 1; i < end; i++) {
    const c = candles[i];
    if (isLong) {
      if (c.low <= sig.sl) return { ...sig, result: 'LOSS', r: -1 };
      if (c.high >= tp) return { ...sig, result: 'WIN', r: sig.tp1R };
    } else {
      if (c.high >= sig.sl) return { ...sig, result: 'LOSS', r: -1 };
      if (c.low <= tp) return { ...sig, result: 'WIN', r: sig.tp1R };
    }
  }
  return { ...sig, result: 'OPEN', r: 0 };
}

function analyze(label: string, trades: SimTrade[]) {
  const closed = trades.filter(t => t.result !== 'OPEN');
  const wins = closed.filter(t => t.result === 'WIN');
  const wr = closed.length ? (wins.length / closed.length) * 100 : 0;
  const totalR = closed.reduce((s, t) => s + t.r, 0);
  const avgR = closed.length ? totalR / closed.length : 0;
  let running = 0, peak = 0, maxDD = 0;
  for (const t of closed) {
    running += t.r;
    if (running > peak) peak = running;
    const dd = peak - running;
    if (dd > maxDD) maxDD = dd;
  }
  console.log(`${label}: signals=${trades.length} closed=${closed.length} WR=${wr.toFixed(1)}% avgR=${avgR.toFixed(3)} maxDD=${maxDD.toFixed(2)}R`);
  return { label, signals: trades.length, closed: closed.length, wr, avgR, maxDD };
}

const CRYPTO_PAIRS = ['BTCUSD', 'ETHUSD', 'SOLUSD', 'XRPUSD', 'BNBUSD', 'ADAUSD', 'LTCUSD', 'DOGEUSD'];

async function runVariant(name: string, opts: VariantOpts) {
  const allTrades: SimTrade[] = [];
  const perSymbol: Record<string, ReturnType<typeof analyze>> = {};
  for (const pair of CRYPTO_PAIRS) {
    const m5 = loadCache(pair, '5min', 6);
    if (!m5 || m5.length < 250) continue;
    const sigs = scanCrypto(pair, m5, opts);
    const trades = sigs.map(s => simulateFixedTP(s, m5));
    allTrades.push(...trades);
    if (trades.length > 0) perSymbol[pair] = analyze(`  ${pair}`, trades);
  }
  console.log(`\n=== ${name} (TP1=${opts.tp1R}R) ===`);
  for (const pair of CRYPTO_PAIRS) {
    if (perSymbol[pair]) console.log(`  ${pair}: signals=${perSymbol[pair].signals} closed=${perSymbol[pair].closed} WR=${perSymbol[pair].wr.toFixed(1)}% avgR=${perSymbol[pair].avgR.toFixed(3)}`);
  }
  const combined = analyze(`COMBINED [${name}]`, allTrades);
  console.log('');
  return combined;
}

async function main() {
  const results: any[] = [];

  results.push(await runVariant('BASELINE (matches engine defaults, TP1=1.5R fixed-TP sim)', DEFAULT_OPTS));

  results.push(await runVariant('ITER1: tighter RSI momentum (60/40) + multi-bar confirm', {
    ...DEFAULT_OPTS, rsiLongMin: 60, rsiShortMax: 40, requireMultiBarConfirm: true
  }));

  results.push(await runVariant('ITER2: ITER1 + tighter TP1=1.0R', {
    ...DEFAULT_OPTS, rsiLongMin: 60, rsiShortMax: 40, requireMultiBarConfirm: true, tp1R: 1.0
  }));

  results.push(await runVariant('ITER3: ITER1 + TP1=0.8R', {
    ...DEFAULT_OPTS, rsiLongMin: 60, rsiShortMax: 40, requireMultiBarConfirm: true, tp1R: 0.8
  }));

  results.push(await runVariant('ITER4: ITER1 + stricter ATR expansion(1.3x) + stronger close(0.20) + TP1=1.0R', {
    ...DEFAULT_OPTS, rsiLongMin: 60, rsiShortMax: 40, requireMultiBarConfirm: true,
    atrExpansionMult: 1.3, requireStrongerClose: 0.20, tp1R: 1.0
  }));

  results.push(await runVariant('ITER5: ITER1 + stronger slope(2x) + participation(1.3x) + TP1=1.0R', {
    ...DEFAULT_OPTS, rsiLongMin: 60, rsiShortMax: 40, requireMultiBarConfirm: true,
    minSlopeMult: 2.0, participationMult: 1.3, tp1R: 1.0
  }));

  results.push(await runVariant('ITER6: ITER5 + TP1=0.7R (very tight target)', {
    ...DEFAULT_OPTS, rsiLongMin: 60, rsiShortMax: 40, requireMultiBarConfirm: true,
    minSlopeMult: 2.0, participationMult: 1.3, tp1R: 0.7
  }));

  results.push(await runVariant('ITER7: rsi extreme 65/35 + multiBar + slope2x + partic1.3x + TP1=1.0R', {
    ...DEFAULT_OPTS, rsiLongMin: 65, rsiShortMax: 35, requireMultiBarConfirm: true,
    minSlopeMult: 2.0, participationMult: 1.3, tp1R: 1.0
  }));

  console.log('\n\n========== SUMMARY TABLE ==========');
  for (const r of results) {
    console.log(`${r.label.padEnd(70)} closed=${String(r.closed).padStart(4)} WR=${r.wr.toFixed(1).padStart(6)}% avgR=${r.avgR.toFixed(3).padStart(7)} maxDD=${r.maxDD.toFixed(2)}R`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
