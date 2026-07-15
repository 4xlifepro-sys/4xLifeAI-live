import type { Candle } from '../src/types.js';
import { scanMeanReversionSignals } from './engine-mean-reversion.js';
import { scanTrendBreakoutSignals, buildContext } from './engine-trend-breakout.js';

// ---------------------------------------------------------------------------
// WALK-FORWARD ROBUSTNESS CHECK
//
// Both engines here use FIXED rule-based thresholds (no parameters fitted to
// data), so there is nothing to "re-fit" between periods the way a true ML
// walk-forward would. What this script actually verifies is the robustness
// check the user asked for: does the edge (forex mean-reversion, metals
// trend-breakout) hold up consistently across an EARLIER slice of the 6-month
// data vs a LATER slice, or was the previously reported combined edge really
// just one lucky sub-period propping up the average?
//
// Method: run the full scan over the entire cached candle series (so every
// indicator - EMA200, ATR, RSI, etc. - has its full warm-up history and
// signal detection is identical to the original single-period backtest),
// then split the resulting CLOSED trades into two buckets by entryTime:
//   - IN-SAMPLE   = first ~4 months of the 6-month window
//   - OUT-OF-SAMPLE = last ~2 months of the 6-month window
// This does not touch engine-mean-reversion.ts, engine-trend-breakout.ts, or
// any live/deployed file - backtest-only, new isolated script.
// ---------------------------------------------------------------------------

interface Trade {
  pair: string;
  direction: 'LONG' | 'SHORT';
  entry: number;
  sl: number;
  tp1?: number;
  tp2?: number;
  tp3?: number;
  entryTime: string;
  exitTime?: string;
  exitPrice?: number;
  exitReason?: string;
  pips?: number;
  r?: number;
  result?: string;
  confidence?: number;
}

function getPipMultiplier(pair: string): number {
  if (pair.includes('JPY')) return 0.01;
  if (pair.startsWith('X') && !pair.includes('XRP')) return 0.1;
  if (['BTCUSD', 'ETHUSD', 'SOLUSD', 'BNBUSD', 'LTCUSD', 'DOTUSD', 'ADAUSD', 'XRPUSD', 'DOGEUSD'].includes(pair)) return 1;
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

// ---- FOREX mean-reversion simulation (TP1/TP2/TP3 ladder, unchanged logic) ----

function simulateMeanReversion(trade: Trade, future: Candle[], pair: string): Trade {
  const isLong = trade.direction === 'LONG';
  const pip = getPipMultiplier(pair);
  const r = { ...trade };
  let bestTp: 'TP3' | 'TP2' | 'TP1' | null = null;

  for (let i = 0; i < future.length; i++) {
    const c = future[i];
    if (isLong) {
      if (c.low <= trade.sl) {
        r.exitPrice = trade.sl;
        r.exitTime = c.timestamp;
        r.exitReason = 'SL';
        r.result = bestTp ? ('WIN_' + bestTp) : 'LOSS';
        const exitAt = bestTp ? trade[bestTp === 'TP1' ? 'tp1' : bestTp === 'TP2' ? 'tp2' : 'tp3']! : trade.sl;
        r.pips = (exitAt - trade.entry) / pip;
        return r;
      }
      if (c.high >= trade.tp3!) bestTp = 'TP3';
      else if (c.high >= trade.tp2!) bestTp = 'TP2';
      else if (c.high >= trade.tp1!) bestTp = 'TP1';
    } else {
      if (c.high >= trade.sl) {
        r.exitPrice = trade.sl;
        r.exitTime = c.timestamp;
        r.exitReason = 'SL';
        r.result = bestTp ? ('WIN_' + bestTp) : 'LOSS';
        const exitAt = bestTp ? trade[bestTp === 'TP1' ? 'tp1' : bestTp === 'TP2' ? 'tp2' : 'tp3']! : trade.sl;
        r.pips = (trade.entry - exitAt) / pip;
        return r;
      }
      if (c.low <= trade.tp3!) bestTp = 'TP3';
      else if (c.low <= trade.tp2!) bestTp = 'TP2';
      else if (c.low <= trade.tp1!) bestTp = 'TP1';
    }
  }

  const last = future[future.length - 1]?.close || trade.entry;
  r.exitPrice = last;
  r.exitTime = future[future.length - 1]?.timestamp || trade.entryTime;
  r.exitReason = 'OPEN';
  r.result = 'OPEN';
  r.pips = isLong ? (last - trade.entry) / pip : (trade.entry - last) / pip;
  return r;
}

function runMeanReversionForexFull(pair: string, m5: Candle[]): Trade[] {
  const trades: Trade[] = [];
  const signals = scanMeanReversionSignals(pair, m5);

  for (const sig of signals) {
    const future = m5.slice(sig.candleIndex + 1, Math.min(sig.candleIndex + 101, m5.length));
    if (future.length === 0) continue;

    const completed = simulateMeanReversion({
      pair, direction: sig.direction,
      entry: sig.entry, sl: sig.sl,
      tp1: sig.tp1, tp2: sig.tp2, tp3: sig.tp3,
      entryTime: m5[sig.candleIndex].timestamp,
      confidence: sig.confidence
    }, future, pair);

    trades.push(completed);
  }

  return trades;
}

// ---- METALS trend-breakout simulation (trailing EMA exit, unchanged logic) ----

function simulateTrailingExit(
  trade: { pair: string; direction: 'LONG' | 'SHORT'; entry: number; sl: number; entryTime: string; confidence: number },
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
          r.exitPrice = c.close; r.exitTime = c.timestamp; r.exitReason = 'TRAIL_EMA';
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

function runTrendBreakoutMetalsFull(pair: string, m5: Candle[]): Trade[] {
  const trades: Trade[] = [];
  const signals = scanTrendBreakoutSignals(pair, m5, { metalsSessionFilter: true });
  if (signals.length === 0) return trades;

  const ctx = buildContext(m5);

  for (const sig of signals) {
    const completed = simulateTrailingExit(
      { pair, direction: sig.direction, entry: sig.entry, sl: sig.sl, entryTime: m5[sig.candleIndex].timestamp, confidence: sig.confidence },
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

function riskUnits(t: Trade): number {
  const pip = getPipMultiplier(t.pair);
  return Math.abs(t.entry - t.sl) / pip;
}

function analyze(label: string, trades: Trade[], useEngineR = false) {
  const closed = trades.filter(t => t.result !== 'OPEN');
  const wins = closed.filter(t => t.result?.startsWith('WIN'));
  const winRate = closed.length ? (wins.length / closed.length) * 100 : 0;

  let totalR = 0;
  let peak = 0, running = 0, maxDD = 0;
  for (const t of closed) {
    const r = useEngineR ? (t.r ?? 0) : (riskUnits(t) > 0 ? (t.pips || 0) / riskUnits(t) : 0);
    totalR += r;
    running += r;
    if (running > peak) peak = running;
    const dd = peak - running;
    if (dd > maxDD) maxDD = dd;
  }
  const avgR = closed.length ? totalR / closed.length : 0;

  console.log(`  ${label.padEnd(28)} signals:${String(trades.length).padStart(4)} closed:${String(closed.length).padStart(4)} WR:${winRate.toFixed(1).padStart(6)}%  avgR:${avgR.toFixed(3).padStart(7)}  maxDD(R):${maxDD.toFixed(2).padStart(6)}`);

  return { label, signals: trades.length, closed: closed.length, winRate, avgR, maxDD };
}

async function main() {
  const FOREX_PAIRS = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'USDCAD', 'AUDUSD', 'NZDUSD', 'EURGBP', 'EURJPY', 'GBPJPY', 'AUDJPY', 'CADJPY', 'CHFJPY', 'NZDJPY', 'EURAUD'];
  const METALS_PAIRS = ['XAUUSD', 'XAGUSD'];

  // 6-month cached window: split roughly 4 months in-sample / 2 months
  // out-of-sample. Determine the actual cutoff from the data itself (first
  // candle timestamp + 4/6 of the total span) rather than hardcoding a date,
  // since the cache's exact start date may shift as it's refreshed.
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
  console.log('WALK-FORWARD ROBUSTNESS CHECK');
  console.log('(fixed rule-based engines - no parameters refit; checks if the');
  console.log(' previously reported edge holds in early vs late sub-period)');
  console.log('=========================================================');

  // ---- FOREX mean-reversion ----
  console.log('\n### FOREX MEAN-REVERSION (engine-mean-reversion.ts, unchanged) ###');
  const forexSeries: Candle[][] = [];
  const forexTradesFull: Record<string, Trade[]> = {};
  for (const pair of FOREX_PAIRS) {
    const m5 = loadCache(pair, '5min', 6);
    if (!m5 || m5.length < 60) { console.warn(`SKIP ${pair}: no/short cache`); continue; }
    forexSeries.push(m5);
    forexTradesFull[pair] = runMeanReversionForexFull(pair, m5);
  }
  const forexCutoff = computeCutoff(forexSeries);
  console.log(`Cutoff (in-sample vs out-of-sample): ${forexCutoff}`);

  const forexInSample: Trade[] = [];
  const forexOutOfSample: Trade[] = [];
  console.log('\nPer-pair (in-sample | out-of-sample):');
  for (const [pair, trades] of Object.entries(forexTradesFull)) {
    const { inSample, outOfSample } = splitByTime(trades, forexCutoff);
    forexInSample.push(...inSample);
    forexOutOfSample.push(...outOfSample);
    analyze(`${pair} IN-SAMPLE`, inSample);
    analyze(`${pair} OUT-OF-SAMPLE`, outOfSample);
  }
  console.log('\nFOREX COMBINED:');
  const forexInStats = analyze('IN-SAMPLE (months 1-4)', forexInSample);
  const forexOutStats = analyze('OUT-OF-SAMPLE (months 5-6)', forexOutOfSample);

  // ---- METALS trend-breakout ----
  console.log('\n### METALS TREND-BREAKOUT (engine-trend-breakout.ts, session filter ON, unchanged) ###');
  const metalsSeries: Candle[][] = [];
  const metalsTradesFull: Record<string, Trade[]> = {};
  for (const pair of METALS_PAIRS) {
    const m5 = loadCache(pair, '5min', 6);
    if (!m5 || m5.length < 250) { console.warn(`SKIP ${pair}: no/short cache`); continue; }
    metalsSeries.push(m5);
    metalsTradesFull[pair] = runTrendBreakoutMetalsFull(pair, m5);
  }
  const metalsCutoff = computeCutoff(metalsSeries);
  console.log(`Cutoff (in-sample vs out-of-sample): ${metalsCutoff}`);

  const metalsInSample: Trade[] = [];
  const metalsOutOfSample: Trade[] = [];
  console.log('\nPer-pair (in-sample | out-of-sample):');
  for (const [pair, trades] of Object.entries(metalsTradesFull)) {
    const { inSample, outOfSample } = splitByTime(trades, metalsCutoff);
    metalsInSample.push(...inSample);
    metalsOutOfSample.push(...outOfSample);
    analyze(`${pair} IN-SAMPLE`, inSample, true);
    analyze(`${pair} OUT-OF-SAMPLE`, outOfSample, true);
  }
  console.log('\nMETALS COMBINED:');
  const metalsInStats = analyze('IN-SAMPLE (months 1-4)', metalsInSample, true);
  const metalsOutStats = analyze('OUT-OF-SAMPLE (months 5-6)', metalsOutOfSample, true);

  console.log('\n\n========================= SUMMARY TABLE =========================');
  console.log('STRATEGY                | PERIOD          | Closed | WinRate | AvgR   | MaxDD(R)');
  console.log('-------------------------------------------------------------------------------');
  const row = (name: string, period: string, s: { closed: number; winRate: number; avgR: number; maxDD: number }) =>
    console.log(`${name.padEnd(24)}| ${period.padEnd(16)}| ${String(s.closed).padStart(6)} | ${s.winRate.toFixed(1).padStart(6)}% | ${s.avgR.toFixed(3).padStart(6)} | ${s.maxDD.toFixed(2).padStart(7)}`);
  row('Forex mean-reversion', 'In-sample (1-4m)', forexInStats);
  row('Forex mean-reversion', 'Out-of-sample (5-6m)', forexOutStats);
  row('Metals trend-breakout', 'In-sample (1-4m)', metalsInStats);
  row('Metals trend-breakout', 'Out-of-sample (5-6m)', metalsOutStats);

  fs.default.writeFileSync('backtest-walkforward-results.json', JSON.stringify({
    forexCutoff, metalsCutoff,
    forexInStats, forexOutStats, metalsInStats, metalsOutStats,
    forexTradesFull, metalsTradesFull,
  }, null, 0));
  console.log('\nSaved to backtest-walkforward-results.json');
  console.log('\nNOTE: forex and metals engine files were not modified - this is a new,');
  console.log('isolated backtest-only script (server/backtest-walkforward.ts).');
}

main().catch(e => { console.error(e); process.exit(1); });
