// TEMPORARY experimentation script - crypto MEAN REVERSION path only.
// Explores parameter variants before committing final change to
// server/engine-mean-reversion.ts (crypto path only). Safe to delete after task.
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

function sma(closes: number[], period: number): number[] {
  const result: number[] = [];
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i];
    if (i >= period) sum -= closes[i - period];
    if (i >= period - 1) result.push(sum / period);
  }
  return result;
}
function stddev(closes: number[], smaArr: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = period - 1; i < closes.length; i++) {
    const mean = smaArr[i - (period - 1)];
    let sumSq = 0;
    for (let j = i - period + 1; j <= i; j++) sumSq += (closes[j] - mean) ** 2;
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

interface HourBucket { bucketStartMs: number; open: number; high: number; low: number; close: number; }
function resampleToH1(m5Candles: Candle[]): HourBucket[] {
  const buckets: HourBucket[] = [];
  let current: HourBucket | null = null;
  let currentKey = '';
  for (const c of m5Candles) {
    const d = new Date(c.timestamp);
    const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}-${d.getUTCHours()}`;
    if (key !== currentKey) {
      if (current) buckets.push(current);
      const bucketStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours());
      current = { bucketStartMs: bucketStart, open: c.open, high: c.high, low: c.low, close: c.close };
      currentKey = key;
    } else if (current) {
      current.high = Math.max(current.high, c.high);
      current.low = Math.min(current.low, c.low);
      current.close = c.close;
    }
  }
  if (current) buckets.push(current);
  return buckets;
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
function minRiskFloorPips(entry: number): number {
  return Math.min(2, entry * 0.003);
}

interface VariantOpts {
  rsiSellThresh: number;    // sell when RSI > this
  rsiBuyThresh: number;     // buy when RSI < this
  bbStdMult: number;        // band width multiplier (default 2)
  atrSlMult: number;        // ATR SL buffer multiplier (default 1.75)
  h1TrendThreshold: number; // trend filter threshold
  volFilterMult: number;    // currentAtr > atrAvg * mult (default 1.0 = must exceed average)
  requireMultiBarConfirm: boolean; // require PRIOR candle also showed extreme (2-candle confirmation), enter on current candle (which is the confirming reversal candle)
  rejectionFraction: number; // default 0.45
  tp1R: number; // R-multiple for TP1 in fixed-TP simulation (risk-based)
  minGapMs: number;
}
const DEFAULT_OPTS: VariantOpts = {
  rsiSellThresh: 85, rsiBuyThresh: 15, bbStdMult: 2, atrSlMult: 1.75,
  h1TrendThreshold: 0.015, volFilterMult: 1.0, requireMultiBarConfirm: false,
  rejectionFraction: 0.45, tp1R: 0.35, minGapMs: 30 * 60 * 1000
};

interface Signal {
  pair: string; direction: 'LONG' | 'SHORT'; entry: number; sl: number; candleIndex: number; tp1R: number;
  tp1: number; tp2: number; tp3: number;
}

function scanCryptoMeanRev(pair: string, m5Candles: Candle[], opts: VariantOpts): Signal[] {
  const signals: Signal[] = [];
  if (m5Candles.length < 60) return signals;

  const closes = m5Candles.map(c => c.close);
  const BB_PERIOD = 20;
  const smaArr = sma(closes, BB_PERIOD);
  const stdArr = stddev(closes, smaArr, BB_PERIOD);
  const rsiArr = rsi(closes, 14);
  const atrArr = atr(m5Candles, 14);
  const atrAvgArr = sma(atrArr, 20);

  const smaAt = (i: number) => (i - 19 >= 0 && i - 19 < smaArr.length) ? smaArr[i - 19] : undefined;
  const stdAt = (i: number) => (i - 19 >= 0 && i - 19 < stdArr.length) ? stdArr[i - 19] : undefined;
  const rsiAt = (i: number) => (i - 14 >= 0 && i - 14 < rsiArr.length) ? rsiArr[i - 14] : undefined;
  const atrAt = (i: number) => (i - 14 >= 0 && i - 14 < atrArr.length) ? atrArr[i - 14] : undefined;
  const atrAvgAt = (i: number) => (i - 33 >= 0 && i - 33 < atrAvgArr.length) ? atrAvgArr[i - 33] : undefined;

  const h1 = resampleToH1(m5Candles);
  const h1Closes = h1.map(b => b.close);
  const h1Ema200 = ema(h1Closes, 200);
  const h1EmaAt = (h1Idx: number) => { const j = h1Idx - 199; return (j >= 0 && j < h1Ema200.length) ? h1Ema200[j] : undefined; };
  function h1TrendDirection(h1Idx: number): number {
    const cur = h1EmaAt(h1Idx);
    const prev = h1EmaAt(h1Idx - 10);
    if (cur === undefined || prev === undefined || prev === 0) return 0;
    return (cur - prev) / prev;
  }

  let lastTs = 0;
  let hp = -1;

  for (let i = 60; i < m5Candles.length; i++) {
    const current = m5Candles[i];
    const ts = new Date(current.timestamp).getTime();

    const d = new Date(current.timestamp);
    const currentBucketStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours());
    while (hp + 1 < h1.length && h1[hp + 1].bucketStartMs < currentBucketStart) hp++;

    if (ts - lastTs < opts.minGapMs) continue;

    const mean = smaAt(i);
    const std = stdAt(i);
    const currentRsi = rsiAt(i);
    const currentAtr = atrAt(i);
    const atrAvg = atrAvgAt(i);
    if (mean === undefined || std === undefined || currentRsi === undefined || !currentAtr || std === 0) continue;
    if (atrAvg === undefined || currentAtr <= atrAvg * opts.volFilterMult) continue;

    const floorRisk = getFloorRisk(pair, currentAtr);
    const maxRisk = getMaxRisk(pair, currentAtr);

    const upperBand = mean + opts.bbStdMult * std;
    const lowerBand = mean - opts.bbStdMult * std;
    const trendDir = h1TrendDirection(hp);

    // multi-bar confirm: previous candle (i-1) must ALSO have been beyond the band with extreme RSI
    // (i.e. this is the 2nd consecutive extreme candle - "confirmed" extreme, not a single-bar spike)
    function priorAlsoExtreme(dir: 'SELL' | 'BUY'): boolean {
      if (!opts.requireMultiBarConfirm) return true;
      const prevMean = smaAt(i - 1);
      const prevStd = stdAt(i - 1);
      const prevRsi = rsiAt(i - 1);
      if (prevMean === undefined || prevStd === undefined || prevRsi === undefined) return false;
      const prevUpper = prevMean + opts.bbStdMult * prevStd;
      const prevLower = prevMean - opts.bbStdMult * prevStd;
      const prev = m5Candles[i - 1];
      if (dir === 'SELL') return prev.close >= prevUpper && prevRsi > opts.rsiSellThresh - 5;
      return prev.close <= prevLower && prevRsi < opts.rsiBuyThresh + 5;
    }

    let signal: Signal | null = null;

    if (current.close >= upperBand && currentRsi > opts.rsiSellThresh &&
        current.close < current.high - (current.high - current.low) * opts.rejectionFraction) {
      if (trendDir <= opts.h1TrendThreshold && priorAlsoExtreme('SELL')) {
        const entry = current.close;
        const distToMean = entry - mean;
        if (distToMean > 0) {
          let risk = Math.min(Math.max((current.high + currentAtr * 0.15 * opts.atrSlMult) - entry, floorRisk), maxRisk);
          const evenRiskPips = Math.max(minRiskFloorPips(entry), Math.round(risk / 2) * 2);
          risk = evenRiskPips;
          if (risk > 0) signal = {
            pair, direction: 'SHORT', entry, sl: entry + risk, candleIndex: i, tp1R: opts.tp1R,
            tp1: entry - risk * 0.35, tp2: entry - risk * 0.9, tp3: entry - risk * 1.8
          };
        }
      }
    }

    if (!signal && current.close <= lowerBand && currentRsi < opts.rsiBuyThresh &&
        current.close > current.low + (current.high - current.low) * opts.rejectionFraction) {
      if (trendDir >= -opts.h1TrendThreshold && priorAlsoExtreme('BUY')) {
        const entry = current.close;
        const distToMean = mean - entry;
        if (distToMean > 0) {
          let risk = Math.min(Math.max(entry - (current.low - currentAtr * 0.15 * opts.atrSlMult), floorRisk), maxRisk);
          const evenRiskPips = Math.max(minRiskFloorPips(entry), Math.round(risk / 2) * 2);
          risk = evenRiskPips;
          if (risk > 0) signal = {
            pair, direction: 'LONG', entry, sl: entry - risk, candleIndex: i, tp1R: opts.tp1R,
            tp1: entry + risk * 0.35, tp2: entry + risk * 0.9, tp3: entry + risk * 1.8
          };
        }
      }
    }

    if (signal) { signals.push(signal); lastTs = ts; }
  }
  return signals;
}

interface SimTrade extends Signal { result: 'WIN_TP1' | 'WIN_TP2' | 'WIN_TP3' | 'LOSS' | 'OPEN'; r: number; }
function simulateLadder(sig: Signal, candles: Candle[], maxLookahead = 100): SimTrade {
  const isLong = sig.direction === 'LONG';
  const risk = Math.abs(sig.entry - sig.sl);
  let bestTp: 'TP3' | 'TP2' | 'TP1' | null = null;
  const end = Math.min(sig.candleIndex + 1 + maxLookahead, candles.length);
  for (let i = sig.candleIndex + 1; i < end; i++) {
    const c = candles[i];
    if (isLong) {
      if (c.low <= sig.sl) {
        const result = bestTp ? (('WIN_' + bestTp) as any) : 'LOSS';
        const exitAt = bestTp === 'TP3' ? sig.tp3 : bestTp === 'TP2' ? sig.tp2 : bestTp === 'TP1' ? sig.tp1 : sig.sl;
        const r = (exitAt - sig.entry) / risk;
        return { ...sig, result, r };
      }
      if (c.high >= sig.tp3) bestTp = 'TP3';
      else if (c.high >= sig.tp2) bestTp = 'TP2';
      else if (c.high >= sig.tp1) bestTp = 'TP1';
    } else {
      if (c.high >= sig.sl) {
        const result = bestTp ? (('WIN_' + bestTp) as any) : 'LOSS';
        const exitAt = bestTp === 'TP3' ? sig.tp3 : bestTp === 'TP2' ? sig.tp2 : bestTp === 'TP1' ? sig.tp1 : sig.sl;
        const r = (sig.entry - exitAt) / risk;
        return { ...sig, result, r };
      }
      if (c.low <= sig.tp3) bestTp = 'TP3';
      else if (c.low <= sig.tp2) bestTp = 'TP2';
      else if (c.low <= sig.tp1) bestTp = 'TP1';
    }
  }
  return { ...sig, result: 'OPEN', r: 0 };
}

function analyze(label: string, trades: SimTrade[]) {
  const closed = trades.filter(t => t.result !== 'OPEN');
  const wins = closed.filter(t => t.result.startsWith('WIN'));
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
  return { label, signals: trades.length, closed: closed.length, wr, avgR, maxDD };
}

const CRYPTO_PAIRS = ['BTCUSD', 'ETHUSD', 'SOLUSD', 'XRPUSD', 'BNBUSD', 'ADAUSD', 'LTCUSD', 'DOGEUSD'];

async function runVariant(name: string, opts: VariantOpts) {
  const allTrades: SimTrade[] = [];
  const perSymbol: Record<string, ReturnType<typeof analyze>> = {};
  for (const pair of CRYPTO_PAIRS) {
    const m5 = loadCache(pair, '5min', 6);
    if (!m5 || m5.length < 60) continue;
    const sigs = scanCryptoMeanRev(pair, m5, opts);
    const trades = sigs.map(s => simulateLadder(s, m5));
    allTrades.push(...trades);
    perSymbol[pair] = analyze(pair, trades);
  }
  console.log(`\n=== ${name} ===`);
  for (const pair of CRYPTO_PAIRS) {
    const p = perSymbol[pair];
    if (p && p.signals > 0) console.log(`  ${pair}: signals=${p.signals} closed=${p.closed} WR=${p.wr.toFixed(1)}% avgR=${p.avgR.toFixed(3)}`);
  }
  const combined = analyze(`COMBINED`, allTrades);
  console.log(`  COMBINED: signals=${combined.signals} closed=${combined.closed} WR=${combined.wr.toFixed(1)}% avgR=${combined.avgR.toFixed(3)} maxDD=${combined.maxDD.toFixed(2)}R`);
  return combined;
}

async function main() {
  const results: any[] = [];

  results.push({ name: 'BASELINE (matches current engine, tp1=0.35R fixed-TP sim)', ...await runVariant('BASELINE', DEFAULT_OPTS) });

  // ITER1: loosen RSI thresholds a bit (80/20 instead of 85/15) to get more samples, add multi-bar confirm
  results.push({ name: 'ITER1: RSI 80/20 + multi-bar confirm (2 consecutive extreme closes)', ...await runVariant('ITER1', {
    ...DEFAULT_OPTS, rsiSellThresh: 80, rsiBuyThresh: 20, requireMultiBarConfirm: true
  })});

  // ITER2: ITER1 but keep tp1R at 0.35R (already tight) -- try wider band (2.2 std) for more selective entries
  results.push({ name: 'ITER2: ITER1 + wider BB(2.2std)', ...await runVariant('ITER2', {
    ...DEFAULT_OPTS, rsiSellThresh: 80, rsiBuyThresh: 20, requireMultiBarConfirm: true, bbStdMult: 2.2
  })});

  // ITER3: ITER1 + no volatility filter requirement (relax to 0.8x, i.e. don't require above-average)
  results.push({ name: 'ITER3: ITER1 + relaxed volatility filter (0.8x avg)', ...await runVariant('ITER3', {
    ...DEFAULT_OPTS, rsiSellThresh: 80, rsiBuyThresh: 20, requireMultiBarConfirm: true, volFilterMult: 0.8
  })});

  // ITER4: ITER1 + relaxed vol filter + relaxed h1 trend threshold (looser, allow more setups) to boost N
  results.push({ name: 'ITER4: ITER1 + relaxed vol(0.8x) + relaxed H1 trend(0.025)', ...await runVariant('ITER4', {
    ...DEFAULT_OPTS, rsiSellThresh: 80, rsiBuyThresh: 20, requireMultiBarConfirm: true, volFilterMult: 0.8, h1TrendThreshold: 0.025
  })});

  // ITER5: ITER4 but stricter RSI extreme back to 85/15 with multi-bar confirm + relaxed vol/trend for more N
  results.push({ name: 'ITER5: RSI 85/15 + multiBar + relaxed vol(0.8x) + relaxed H1(0.025)', ...await runVariant('ITER5', {
    ...DEFAULT_OPTS, rsiSellThresh: 85, rsiBuyThresh: 15, requireMultiBarConfirm: true, volFilterMult: 0.8, h1TrendThreshold: 0.025
  })});

  // ITER6: ITER5 + tighter rejection fraction (needs stronger rejection candle: 0.55 instead of 0.45)
  results.push({ name: 'ITER6: ITER5 + stronger rejection(0.55) + wider SL mult(2.0x)', ...await runVariant('ITER6', {
    ...DEFAULT_OPTS, rsiSellThresh: 85, rsiBuyThresh: 15, requireMultiBarConfirm: true, volFilterMult: 0.8, h1TrendThreshold: 0.025,
    rejectionFraction: 0.55, atrSlMult: 2.0
  })});

  // ITER7: ITER6 but no multiBar confirm requirement (isolate effect) - relaxed vol + relaxed trend + strong rejection
  results.push({ name: 'ITER7: no multiBar, RSI85/15, relaxed vol/trend, rejection0.55', ...await runVariant('ITER7', {
    ...DEFAULT_OPTS, rsiSellThresh: 85, rsiBuyThresh: 15, requireMultiBarConfirm: false, volFilterMult: 0.8, h1TrendThreshold: 0.025,
    rejectionFraction: 0.55, atrSlMult: 2.0
  })});

  console.log('\n\n========== SUMMARY TABLE (crypto mean-reversion, TP1=0.35R fixed) ==========');
  for (const r of results) {
    console.log(`${r.name.padEnd(75)} closed=${String(r.closed).padStart(4)} WR=${r.wr.toFixed(1).padStart(6)}% avgR=${r.avgR.toFixed(3).padStart(7)} maxDD=${r.maxDD.toFixed(2)}R`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
