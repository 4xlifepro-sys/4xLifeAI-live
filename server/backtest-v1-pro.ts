import type { Candle } from '../src/types.js';
import { scanV1Signals } from './engine-v1-pro.js';

// ---------------------------------------------------------------------------
// BACKTEST RUNNER - 4xLifeAI V1 Professional Multi-Timeframe Strategy
//
// Timeframes: H4 (direction), H1 (confirmation), M15 (signals)
// Fully isolated backtest - does not modify any live files.
// ---------------------------------------------------------------------------

interface Trade {
  pair: string;
  direction: 'LONG' | 'SHORT';
  entry: number;
  sl: number;
  tp1: number;
  tp2: number;
  tp3: number;
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

// Aggregate 5min to M15 (3 bars per candle)
function aggregateToM15(candles: Candle[]): Candle[] {
  const result: Candle[] = [];
  for (let i = 0; i < candles.length; i += 3) {
    const chunk = candles.slice(i, i + 3);
    if (chunk.length < 3) break;
    const open = chunk[0].open;
    const close = chunk[chunk.length - 1].close;
    const high = Math.max(...chunk.map(c => c.high));
    const low = Math.min(...chunk.map(c => c.low));
    const volume = chunk.reduce((sum, c) => sum + (c.volume || 0), 0);
    const timestamp = chunk[chunk.length - 1].timestamp;
    result.push({ open, high, low, close, volume, timestamp });
  }
  return result;
}

// Simulate trade with fixed TP levels (TP1/TP2/TP3) and SL
function simulateFixedTpTrade(
  pair: string,
  direction: 'LONG' | 'SHORT',
  entry: number,
  sl: number,
  tp1: number,
  tp2: number,
  tp3: number,
  entryTime: string,
  candles: Candle[],
  candleIndex: number,
  confidence: number,
  slPips: number
): Trade {
  const isLong = direction === 'LONG';
  const pip = getPipMultiplier(pair);
  const initialRiskPips = Math.abs(entry - sl) / pip;
  const r: Trade = { pair, direction, entry, sl, tp1, tp2, tp3, entryTime, confidence, slPips };

  const maxLookahead = Math.min(candleIndex + 2001, candles.length);
  for (let i = candleIndex + 1; i < maxLookahead; i++) {
    const c = candles[i];

    // Check SL hit first
    if (isLong && c.low <= sl) {
      r.exitPrice = sl; r.exitTime = c.timestamp; r.exitReason = 'SL';
      r.pips = (sl - entry) / pip;
      r.r = initialRiskPips > 0 ? r.pips / initialRiskPips : 0;
      r.result = r.pips > 0 ? 'WIN' : 'LOSS';
      return r;
    }
    if (!isLong && c.high >= sl) {
      r.exitPrice = sl; r.exitTime = c.timestamp; r.exitReason = 'SL';
      r.pips = (entry - sl) / pip;
      r.r = initialRiskPips > 0 ? r.pips / initialRiskPips : 0;
      r.result = r.pips > 0 ? 'WIN' : 'LOSS';
      return r;
    }

    // Check TP hits in order (TP1 -> TP2 -> TP3)
    if (isLong) {
      if (c.high >= tp3) {
        r.exitPrice = tp3; r.exitTime = c.timestamp; r.exitReason = 'TP3';
        r.pips = (tp3 - entry) / pip;
        r.r = initialRiskPips > 0 ? r.pips / initialRiskPips : 0;
        r.result = 'WIN';
        return r;
      }
      if (c.high >= tp2) {
        r.exitPrice = tp2; r.exitTime = c.timestamp; r.exitReason = 'TP2';
        r.pips = (tp2 - entry) / pip;
        r.r = initialRiskPips > 0 ? r.pips / initialRiskPips : 0;
        r.result = 'WIN';
        return r;
      }
      if (c.high >= tp1) {
        r.exitPrice = tp1; r.exitTime = c.timestamp; r.exitReason = 'TP1';
        r.pips = (tp1 - entry) / pip;
        r.r = initialRiskPips > 0 ? r.pips / initialRiskPips : 0;
        r.result = 'WIN';
        return r;
      }
    } else {
      if (c.low <= tp3) {
        r.exitPrice = tp3; r.exitTime = c.timestamp; r.exitReason = 'TP3';
        r.pips = (entry - tp3) / pip;
        r.r = initialRiskPips > 0 ? r.pips / initialRiskPips : 0;
        r.result = 'WIN';
        return r;
      }
      if (c.low <= tp2) {
        r.exitPrice = tp2; r.exitTime = c.timestamp; r.exitReason = 'TP2';
        r.pips = (entry - tp2) / pip;
        r.r = initialRiskPips > 0 ? r.pips / initialRiskPips : 0;
        r.result = 'WIN';
        return r;
      }
      if (c.low <= tp1) {
        r.exitPrice = tp1; r.exitTime = c.timestamp; r.exitReason = 'TP1';
        r.pips = (entry - tp1) / pip;
        r.r = initialRiskPips > 0 ? r.pips / initialRiskPips : 0;
        r.result = 'WIN';
        return r;
      }
    }
  }

  // Trade still open at end of data
  const lastIdx = maxLookahead - 1;
  const last = candles[lastIdx]?.close ?? entry;
  r.exitPrice = last;
  r.exitTime = candles[lastIdx]?.timestamp ?? entryTime;
  r.exitReason = 'OPEN';
  r.result = 'OPEN';
  r.pips = isLong ? (last - entry) / pip : (entry - last) / pip;
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

  console.log(`  ${label.padEnd(28)} signals:${String(trades.length).padStart(4)} closed:${String(closed.length).padStart(4)} WR:${winRate.toFixed(1).padStart(6)}%  avgR:${avgR.toFixed(3).padStart(7)}  maxDD(R):${maxDD.toFixed(2).padStart(6)}  avgSL(pips):${avgSlPips.toFixed(1).padStart(6)}`);

  return { label, signals: trades.length, closed: closed.length, winRate, avgR, maxDD, avgSlPips };
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

async function main() {
  const FOREX_PAIRS = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'USDCAD', 'AUDUSD', 'NZDUSD', 'EURGBP', 'EURJPY', 'GBPJPY', 'AUDJPY', 'CADJPY', 'CHFJPY', 'NZDJPY', 'EURAUD'];

  console.log('\n===================================================================');
  console.log('4xLifeAI V1 PROFESSIONAL - MULTI-TIMEFRAME STRATEGY BACKTEST');
  console.log('Timeframes: H4 (direction), H1 (confirmation), M15 (signals)');
  console.log('Forex pairs only, isolated backtest - no live files modified');
  console.log('===================================================================');

  const allTrades: Trade[] = [];
  const perPair: Record<string, ReturnType<typeof analyze>> = {};

  console.log('\nPer-pair results:');
  for (const pair of FOREX_PAIRS) {
    const m5 = loadCache(pair);
    if (!m5 || m5.length < 500) {
      console.warn(`SKIP ${pair}: no/short cache`);
      continue;
    }

    // Aggregate to M15 for signal detection
    const m15 = aggregateToM15(m5);
    const signals = scanV1Signals(pair, m5);

    // Simulate each signal as a trade
    const trades = signals.map(sig => {
      // Map M15 candleIndex back to M5 index (multiply by 3)
      const m5Index = sig.candleIndex * 3;
      return simulateFixedTpTrade(
        pair,
        sig.direction,
        sig.entry,
        sig.sl,
        sig.tp1,
        sig.tp2,
        sig.tp3,
        m15[sig.candleIndex].timestamp,
        m5,
        m5Index,
        sig.confidence,
        sig.slPips
      );
    });

    allTrades.push(...trades);
    perPair[pair] = analyze(pair, trades);
  }

  console.log('\nCOMBINED (all forex pairs):');
  const combined = analyze('COMBINED', allTrades);

  // Walk-forward validation
  console.log('\n=== WALK-FORWARD VALIDATION ===');
  const cutoff = new Date(new Date(allTrades[0]?.entryTime || Date.now()).getTime() + (new Date(allTrades[allTrades.length - 1]?.entryTime || Date.now()).getTime() - new Date(allTrades[0]?.entryTime || Date.now()).getTime()) * (4 / 6)).toISOString();
  console.log(`Cutoff: ${cutoff}`);

  const { inSample, outOfSample } = splitByTime(allTrades, cutoff);
  const inStats = analyze('IN-SAMPLE (months 1-4)', inSample);
  const outStats = analyze('OUT-OF-SAMPLE (months 5-6)', outOfSample);

  const passFail = (outStats.closed > 0 && outStats.avgR > 0 && outStats.avgR > inStats.avgR * 0.3)
    ? 'WEAK PASS (avgR positive out-of-sample)'
    : (outStats.closed === 0 ? 'INCONCLUSIVE (no closed out-of-sample trades)' : 'FAIL (avgR collapsed or negative out-of-sample)');
  console.log(`\nPass/Fail: ${passFail}`);

  // Summary table
  console.log('\n========================= SUMMARY TABLE =========================');
  console.log('STRATEGY              | PERIOD               | Closed | WinRate | AvgR   | MaxDD(R) | AvgSL(pips)');
  console.log('---------------------------------------------------------------------------------------------------');
  const row = (name: string, period: string, s: { closed: number; winRate: number; avgR: number; maxDD: number; avgSlPips: number }) =>
    console.log(`${name.padEnd(23)}| ${period.padEnd(21)}| ${String(s.closed).padStart(6)} | ${s.winRate.toFixed(1).padStart(6)}% | ${s.avgR.toFixed(3).padStart(6)} | ${s.maxDD.toFixed(2).padStart(8)} | ${s.avgSlPips.toFixed(1).padStart(11)}`);
  row('V1 Pro Multi-TF', 'In-sample (1-4m)', inStats);
  row('V1 Pro Multi-TF', 'Out-of-sample (5-6m)', outStats);

  fs.default.writeFileSync('backtest-v1-pro-results.json', JSON.stringify({ perPair, combined, inStats, outStats, passFail, allTrades }, null, 0));
  console.log('\nSaved to backtest-v1-pro-results.json');
  console.log('NOTE: isolated backtest-only script (server/backtest-v1-pro.ts).');
  console.log('engine-v1-pro.ts is not imported by scanner.ts - nothing deployed.');
}

main().catch(e => { console.error(e); process.exit(1); });
