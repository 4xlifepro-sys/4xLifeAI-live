import type { Candle } from '../src/types.js';
import { scanEmaTrendSignals, buildContext, EMA_SLOPE_THRESHOLD } from './engine-ema-trend.js';

// ---------------------------------------------------------------------------
// BACKTEST RUNNER - EMA200/EMA110 TREND-CONTINUATION ENGINE (FOREX ONLY)
//
// Fully isolated: does not import/modify engine-mean-reversion.ts,
// engine-trend-breakout.ts, backtest-walkforward.ts, or scanner.ts.
// Mirrors the trailing-exit simulation pattern used in
// backtest-walkforward.ts (simulateTrailingExit) but as an independent
// copy, per the isolation requirement for this new engine.
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
  confidence?: number;
  slPips: number;
  regime: 'TRENDING' | 'CHOPPY';
}

function getPipMultiplier(pair: string): number {
  if (pair.includes('JPY')) return 0.01;
  return 0.0001;
}

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

// ---- Trailing-exit simulation (EMA110 trail), independent copy ----

function simulateTrailingExit(
  trade: { pair: string; direction: 'LONG' | 'SHORT'; entry: number; sl: number; entryTime: string; confidence: number; slPips: number; regime: 'TRENDING' | 'CHOPPY' },
  candles: Candle[],
  candleIndex: number,
  trailEmaAt: (i: number) => number | undefined
): Trade {
  const isLong = trade.direction === 'LONG';
  const pip = getPipMultiplier(trade.pair);
  const initialRiskPips = Math.abs(trade.entry - trade.sl) / pip;
  const r: Trade = { ...trade };

  const maxLookahead = Math.min(candleIndex + 2001, candles.length);
  for (let i = candleIndex + 1; i < maxLookahead; i++) {
    const c = candles[i];

    if (isLong && c.low <= trade.sl) {
      r.exitPrice = trade.sl; r.exitTime = c.timestamp; r.exitReason = 'SL';
      r.pips = (trade.sl - trade.entry) / pip;
      r.r = initialRiskPips > 0 ? r.pips / initialRiskPips : 0;
      r.result = r.pips > 0 ? 'WIN' : 'LOSS';
      return r;
    }
    if (!isLong && c.high >= trade.sl) {
      r.exitPrice = trade.sl; r.exitTime = c.timestamp; r.exitReason = 'SL';
      r.pips = (trade.entry - trade.sl) / pip;
      r.r = initialRiskPips > 0 ? r.pips / initialRiskPips : 0;
      r.result = r.pips > 0 ? 'WIN' : 'LOSS';
      return r;
    }

    const trail = trailEmaAt(i);
    if (trail !== undefined) {
      const favorablePips = isLong ? (c.close - trade.entry) / pip : (trade.entry - c.close) / pip;
      if (favorablePips >= initialRiskPips) {
        const closedThroughTrail = isLong ? c.close < trail : c.close > trail;
        if (closedThroughTrail) {
          r.exitPrice = c.close; r.exitTime = c.timestamp; r.exitReason = 'TRAIL_EMA110';
          r.pips = isLong ? (c.close - trade.entry) / pip : (trade.entry - c.close) / pip;
          r.r = initialRiskPips > 0 ? r.pips / initialRiskPips : 0;
          r.result = r.pips > 0 ? 'WIN' : 'LOSS';
          return r;
        }
      }
    }
  }

  const lastIdx = maxLookahead - 1;
  const last = candles[lastIdx]?.close ?? trade.entry;
  r.exitPrice = last;
  r.exitTime = candles[lastIdx]?.timestamp ?? trade.entryTime;
  r.exitReason = 'OPEN';
  r.result = 'OPEN';
  r.pips = isLong ? (last - trade.entry) / pip : (trade.entry - last) / pip;
  r.r = initialRiskPips > 0 ? r.pips / initialRiskPips : 0;
  return r;
}

function ema200SlopeAtIndex(closesEma200At: (i: number) => number | undefined, i: number, lookback: number): number {
  const cur = closesEma200At(i);
  const prev = closesEma200At(i - lookback);
  if (cur === undefined || prev === undefined || prev === 0) return 0;
  return (cur - prev) / prev;
}

function runEmaTrendForexFull(pair: string, m5: Candle[]): Trade[] {
  const trades: Trade[] = [];
  const signals = scanEmaTrendSignals(pair, m5);
  if (signals.length === 0) return trades;

  const ctx = buildContext(m5);
  const pipMultiplier = getPipMultiplier(pair);
  const EMA_SLOPE_LOOKBACK = 20;

  for (const sig of signals) {
    const slPips = Math.abs(sig.entry - sig.sl) / pipMultiplier;
    // Regime classifier: EMA200 slope magnitude at signal candle vs threshold
    const slope = ema200SlopeAtIndex(ctx.ema200At, sig.candleIndex, EMA_SLOPE_LOOKBACK);
    const regime: 'TRENDING' | 'CHOPPY' = Math.abs(slope) > EMA_SLOPE_THRESHOLD * 2 ? 'TRENDING' : 'CHOPPY';

    const completed = simulateTrailingExit(
      {
        pair, direction: sig.direction, entry: sig.entry, sl: sig.sl,
        entryTime: m5[sig.candleIndex].timestamp, confidence: sig.confidence,
        slPips, regime,
      },
      m5,
      sig.candleIndex,
      ctx.trailEmaAt
    );
    trades.push(completed);
  }
  return trades;
}

// ---- Split + stats ----

function splitByTime(trades: Trade[], cutoffISO: string): { inSample: Trade[]; outOfSample: Trade[] } {
  const cutoff = new Date(cutoffISO).getTime();
  const inSample: Trade[] = [];
  const outOfSample: Trade[] = [];
  for (const t of trades) {
    const ts = new Date(t.entryTime).getTime();
    if (ts < cutoff) inSample.push(t);
    else outOfSample.push(t);
  }
  return { inSample, outOfSample };
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

  console.log(`  ${label.padEnd(28)} signals:${String(trades.length).padStart(4)} closed:${String(closed.length).padStart(4)} WR:${winRate.toFixed(1).padStart(6)}%  avgR:${avgR.toFixed(3).padStart(7)}  maxDD(R):${maxDD.toFixed(2).padStart(6)}  avgSL(pips):${avgSlPips.toFixed(1).padStart(6)}`);

  return { label, signals: trades.length, closed: closed.length, winRate, avgR, maxDD, avgSlPips };
}

function analyzeRegime(label: string, trades: Trade[]) {
  const trending = trades.filter(t => t.regime === 'TRENDING');
  const choppy = trades.filter(t => t.regime === 'CHOPPY');
  console.log(`\n  Regime breakdown - ${label}:`);
  analyze('TRENDING (|slope| > 2x threshold)', trending);
  analyze('CHOPPY (|slope| <= 2x threshold)', choppy);
}

async function main() {
  const FOREX_PAIRS = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'USDCAD', 'AUDUSD', 'NZDUSD', 'EURGBP', 'EURJPY', 'GBPJPY', 'AUDJPY', 'CADJPY', 'CHFJPY', 'NZDJPY', 'EURAUD'];

  function computeCutoff(allCandles: Candle[][]): string {
    let minTs = Infinity, maxTs = -Infinity;
    for (const series of allCandles) {
      if (series.length === 0) continue;
      const first = new Date(series[0].timestamp).getTime();
      const last = new Date(series[series.length - 1].timestamp).getTime();
      if (first < minTs) minTs = first;
      if (last > maxTs) maxTs = last;
    }
    const cutoff = minTs + (maxTs - minTs) * (4 / 6);
    return new Date(cutoff).toISOString();
  }

  console.log('\n=========================================================');
  console.log('EMA200/EMA110 TREND-CONTINUATION ENGINE - ISOLATED BACKTEST');
  console.log('(new engine-ema-trend.ts, forex only, not wired into scanner.ts)');
  console.log('=========================================================');

  const forexSeries: Candle[][] = [];
  const forexTradesFull: Record<string, Trade[]> = {};
  for (const pair of FOREX_PAIRS) {
    const m5 = loadCache(pair, '5min', 6);
    if (!m5 || m5.length < 300) { console.warn(`SKIP ${pair}: no/short cache`); continue; }
    forexSeries.push(m5);
    forexTradesFull[pair] = runEmaTrendForexFull(pair, m5);
  }
  const cutoff = computeCutoff(forexSeries);
  console.log(`Cutoff (in-sample vs out-of-sample): ${cutoff}`);

  const allInSample: Trade[] = [];
  const allOutOfSample: Trade[] = [];
  const allTrades: Trade[] = [];

  console.log('\nPer-pair (in-sample | out-of-sample):');
  for (const [pair, trades] of Object.entries(forexTradesFull)) {
    allTrades.push(...trades);
    const { inSample, outOfSample } = splitByTime(trades, cutoff);
    allInSample.push(...inSample);
    allOutOfSample.push(...outOfSample);
    analyze(`${pair} IN-SAMPLE`, inSample);
    analyze(`${pair} OUT-OF-SAMPLE`, outOfSample);
  }

  console.log('\nCOMBINED (all 15 forex pairs):');
  const inStats = analyze('IN-SAMPLE (months 1-4)', allInSample);
  const outStats = analyze('OUT-OF-SAMPLE (months 5-6)', allOutOfSample);

  const passFail = (outStats.closed > 0 && outStats.avgR > 0 && outStats.avgR > inStats.avgR * 0.3)
    ? 'WEAK PASS (avgR positive out-of-sample, did not collapse)'
    : (outStats.closed === 0 ? 'INCONCLUSIVE (no closed out-of-sample trades)' : 'FAIL (avgR collapsed or flipped negative out-of-sample)');
  console.log(`\nPass/Fail check: ${passFail}`);

  // Bonus: trending vs choppy regime breakdown, using EMA200 slope as classifier
  console.log('\n=== BONUS: TRENDING vs CHOPPY REGIME BREAKDOWN ===');
  analyzeRegime('ALL TRADES (full 6-month window)', allTrades);
  analyzeRegime('IN-SAMPLE', allInSample);
  analyzeRegime('OUT-OF-SAMPLE', allOutOfSample);

  console.log('\n\n========================= SUMMARY TABLE =========================');
  console.log('STRATEGY              | PERIOD               | Closed | WinRate | AvgR   | MaxDD(R) | AvgSL(pips)');
  console.log('---------------------------------------------------------------------------------------------------');
  const row = (name: string, period: string, s: { closed: number; winRate: number; avgR: number; maxDD: number; avgSlPips: number }) =>
    console.log(`${name.padEnd(23)}| ${period.padEnd(21)}| ${String(s.closed).padStart(6)} | ${s.winRate.toFixed(1).padStart(6)}% | ${s.avgR.toFixed(3).padStart(6)} | ${s.maxDD.toFixed(2).padStart(8)} | ${s.avgSlPips.toFixed(1).padStart(11)}`);
  row('EMA200/110 trend-cont', 'In-sample (1-4m)', inStats);
  row('EMA200/110 trend-cont', 'Out-of-sample (5-6m)', outStats);

  fs.default.writeFileSync('backtest-ema-trend-results.json', JSON.stringify({
    cutoff, inStats, outStats, passFail, forexTradesFull,
  }, null, 0));
  console.log('\nSaved to backtest-ema-trend-results.json');
  console.log('\nNOTE: this is a new, fully isolated backtest-only script');
  console.log('(server/backtest-ema-trend.ts). engine-ema-trend.ts is not');
  console.log('imported by scanner.ts or any live routing file - nothing deployed.');
}

main().catch(e => { console.error(e); process.exit(1); });
