import type { Candle } from '../src/types.js';
import { scanTrendBreakoutSignals, buildContext } from './engine-trend-breakout.js';

// ---------------------------------------------------------------------------
// WALK-FORWARD ROBUSTNESS CHECK - CRYPTO TREND-BREAKOUT ONLY
// Same methodology as backtest-walkforward.ts (forex/metals), applied to the
// 5 curated live crypto coins (ETH/SOL/ADA/LTC/DOGE). New isolated script -
// does not touch engine-trend-breakout.ts or any live/deployed file.
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

function getPipMultiplier(pair: string): number {
  if (['BTCUSD', 'ETHUSD', 'SOLUSD', 'BNBUSD', 'LTCUSD', 'ADAUSD', 'XRPUSD', 'DOGEUSD'].includes(pair)) return 1;
  return 0.0001;
}

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

function runTrendBreakoutCryptoFull(pair: string, m5: Candle[]): Trade[] {
  const trades: Trade[] = [];
  const signals = scanTrendBreakoutSignals(pair, m5);
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
  const wins = closed.filter(t => t.result?.startsWith('WIN'));
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

  console.log(`  ${label.padEnd(28)} signals:${String(trades.length).padStart(4)} closed:${String(closed.length).padStart(4)} WR:${winRate.toFixed(1).padStart(6)}%  avgR:${avgR.toFixed(3).padStart(7)}  maxDD(R):${maxDD.toFixed(2).padStart(6)}`);

  return { label, signals: trades.length, closed: closed.length, winRate, avgR, maxDD };
}

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

async function main() {
  const CRYPTO_PAIRS = ['ETHUSD', 'SOLUSD', 'ADAUSD', 'LTCUSD', 'DOGEUSD'];

  console.log('\n=========================================================');
  console.log('WALK-FORWARD ROBUSTNESS CHECK - CRYPTO TREND-BREAKOUT');
  console.log('(curated 5: ETH/SOL/ADA/LTC/DOGE - same methodology as forex/metals)');
  console.log('=========================================================');

  const series: Candle[][] = [];
  const tradesFull: Record<string, Trade[]> = {};
  for (const pair of CRYPTO_PAIRS) {
    const m5 = loadCache(pair, '5min', 6);
    if (!m5 || m5.length < 250) { console.warn(`SKIP ${pair}: no/short cache`); continue; }
    series.push(m5);
    tradesFull[pair] = runTrendBreakoutCryptoFull(pair, m5);
  }
  const cutoff = computeCutoff(series);
  console.log(`Cutoff (in-sample vs out-of-sample): ${cutoff}`);

  const inSampleAll: Trade[] = [];
  const outOfSampleAll: Trade[] = [];
  const perCoin: Record<string, any> = {};
  console.log('\nPer-coin (in-sample | out-of-sample):');
  for (const [pair, trades] of Object.entries(tradesFull)) {
    const { inSample, outOfSample } = splitByTime(trades, cutoff);
    inSampleAll.push(...inSample);
    outOfSampleAll.push(...outOfSample);
    const inStats = analyze(`${pair} IN-SAMPLE`, inSample);
    const outStats = analyze(`${pair} OUT-OF-SAMPLE`, outOfSample);
    perCoin[pair] = { inStats, outStats };
  }

  console.log('\nCRYPTO COMBINED (5 curated coins):');
  const inStats = analyze('IN-SAMPLE (months 1-4)', inSampleAll);
  const outStats = analyze('OUT-OF-SAMPLE (months 5-6)', outOfSampleAll);

  console.log('\n\n========================= PASS/FAIL CHECK =========================');
  const passed = outStats.avgR > 0 && outStats.closed >= 10;
  console.log(`Out-of-sample avgR: ${outStats.avgR.toFixed(3)} | In-sample avgR: ${inStats.avgR.toFixed(3)}`);
  console.log(`Result: ${passed ? 'PASS - edge holds out-of-sample (positive, not collapsing)' : 'FAIL - edge collapses or flips negative out-of-sample'}`);

  fs.default.writeFileSync('backtest-walkforward-crypto-results.json', JSON.stringify({
    cutoff, inStats, outStats, perCoin, tradesFull, passed,
  }, null, 0));
  console.log('\nSaved to backtest-walkforward-crypto-results.json');
  console.log('\nNOTE: engine-trend-breakout.ts was not modified - new, isolated backtest-only script.');
}

main().catch(e => { console.error(e); process.exit(1); });
