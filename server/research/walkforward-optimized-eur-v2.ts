import type { Candle } from '../../src/types.js';
import { scanOptimizedSignalsV2 } from './engine-optimized-eur-v2.js';

// ---------------------------------------------------------------------------
// WALK-FORWARD VALIDATION: Optimized EUR Strategy V2
//
// LOCKED PARAMETERS (from engine-optimized-eur-v2.ts):
// - Timeframe: M5
// - Indicators: BB(20, 2σ), RSI(14), ATR(14)
// - Entry: BB extreme + RSI <35/>65 + candle pattern
// - SL: max(8 pips, ATR*1.5)
// - TP: 0.7R / 1.5R / 2.5R
// - Signal gap: 3 minutes
// - Session: 07:00-21:00 UTC
//
// NO parameter changes allowed. One clean test, reported honestly.
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

  const grossProfit = closed.filter(t => t.r && t.r > 0).reduce((sum, t) => sum + (t.r || 0), 0);
  const grossLoss = Math.abs(closed.filter(t => t.r && t.r < 0).reduce((sum, t) => sum + (t.r || 0), 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  console.log(`  ${label.padEnd(28)} signals:${String(trades.length).padStart(4)} closed:${String(closed.length).padStart(4)} WR:${winRate.toFixed(1).padStart(6)}%  avgR:${avgR.toFixed(3).padStart(7)}  PF:${profitFactor.toFixed(2).padStart(6)}  maxDD(R):${maxDD.toFixed(2).padStart(6)}  avgSL(pips):${avgSlPips.toFixed(1).padStart(6)}`);

  return { label, signals: trades.length, closed: closed.length, winRate, avgR, profitFactor, maxDD, avgSlPips };
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
  const FOREX_PAIRS = ['EURUSD', 'EURGBP', 'EURJPY', 'GBPUSD', 'USDJPY', 'USDCHF', 'USDCAD', 'AUDUSD', 'NZDUSD', 'AUDJPY', 'CADJPY', 'CHFJPY', 'NZDJPY', 'GBPJPY', 'EURAUD'];

  console.log('\n===================================================================');
  console.log('WALK-FORWARD VALIDATION: Optimized EUR Strategy V2');
  console.log('LOCKED PARAMETERS - NO TUNING ALLOWED');
  console.log('===================================================================');
  console.log('Strategy: BB(20,2σ) + RSI(14) + ATR(14) + candle patterns');
  console.log('SL: max(8 pips, ATR*1.5)');
  console.log('TP: 0.7R / 1.5R / 2.5R');
  console.log('Signal gap: 3 min | Session: 07:00-21:00 UTC');
  console.log('===================================================================\n');

  const allTrades: Trade[] = [];
  const perPair: Record<string, Trade[]> = {};

  // Generate all signals first
  for (const pair of FOREX_PAIRS) {
    const m5 = loadCache(pair);
    if (!m5 || m5.length < 200) {
      console.warn(`SKIP ${pair}: no/short cache`);
      continue;
    }

    const signals = scanOptimizedSignalsV2(pair, m5);
    const trades = signals.map(sig => {
      return simulateFixedTpTrade(
        pair,
        sig.direction,
        sig.entry,
        sig.sl,
        sig.tp1,
        sig.tp2,
        sig.tp3,
        m5[sig.candleIndex]?.timestamp || new Date().toISOString(),
        m5,
        sig.candleIndex,
        sig.confidence,
        sig.slPips
      );
    });

    perPair[pair] = trades;
    allTrades.push(...trades);
  }

  // Compute cutoff: 4/6 of total time span
  const allTimestamps = allTrades.map(t => new Date(t.entryTime).getTime()).filter(ts => !isNaN(ts));
  if (allTimestamps.length === 0) {
    console.log('ERROR: No trades generated');
    process.exit(1);
  }
  const minTs = Math.min(...allTimestamps);
  const maxTs = Math.max(...allTimestamps);
  const cutoff = new Date(minTs + (maxTs - minTs) * (4 / 6)).toISOString();
  console.log(`Cutoff date: ${cutoff}`);
  console.log(`In-sample: months 1-4 | Out-of-sample: months 5-6\n`);

  // Split and analyze per pair
  console.log('=== PER-PAIR WALK-FORWARD RESULTS ===\n');
  const perPairInSample: Record<string, ReturnType<typeof analyze>> = {};
  const perPairOutOfSample: Record<string, ReturnType<typeof analyze>> = {};

  for (const [pair, trades] of Object.entries(perPair)) {
    const { inSample, outOfSample } = splitByTime(trades, cutoff);
    perPairInSample[pair] = analyze(`${pair} IN-SAMPLE`, inSample);
    perPairOutOfSample[pair] = analyze(`${pair} OUT-OF-SAMPLE`, outOfSample);
  }

  // Combined results
  const { inSample: allInSample, outOfSample: allOutOfSample } = splitByTime(allTrades, cutoff);
  
  console.log('\n=== COMBINED WALK-FORWARD RESULTS ===\n');
  const inStats = analyze('IN-SAMPLE (months 1-4)', allInSample);
  const outStats = analyze('OUT-OF-SAMPLE (months 5-6)', allOutOfSample);

  // PASS/FAIL check
  console.log('\n=== PASS/FAIL VERDICT ===\n');
  console.log('Criteria:');
  console.log('  1. Out-of-sample WR stays reasonably close to in-sample (not collapsing to 50% or below)');
  console.log('  2. Out-of-sample avgR stays positive (not flipping negative)');
  console.log('  3. Compare to forex mean-reversion (67.2% WR) and metals trend-breakout (38.3% WR, +0.184 avgR)\n');

  const wrDrop = inStats.winRate - outStats.winRate;
  const avgRPositive = outStats.avgR > 0;
  const wrAbove50 = outStats.winRate > 50;

  console.log(`In-sample WR: ${inStats.winRate.toFixed(1)}%`);
  console.log(`Out-of-sample WR: ${outStats.winRate.toFixed(1)}%`);
  console.log(`WR drop: ${wrDrop.toFixed(1)} percentage points`);
  console.log(`In-sample avgR: ${inStats.avgR.toFixed(3)}`);
  console.log(`Out-of-sample avgR: ${outStats.avgR.toFixed(3)}`);
  console.log(`Out-of-sample avgR positive: ${avgRPositive ? 'YES' : 'NO'}`);
  console.log(`Out-of-sample WR above 50%: ${wrAbove50 ? 'YES' : 'NO'}\n`);

  let verdict = 'FAIL';
  let reasoning = '';

  if (avgRPositive && wrAbove50 && wrDrop < 15) {
    verdict = 'PASS';
    reasoning = 'Out-of-sample performance holds up: WR stays above 50%, avgR stays positive, and the drop from in-sample is reasonable (<15 percentage points). This strategy demonstrates real edge, not overfitting.';
  } else if (avgRPositive && wrAbove50) {
    verdict = 'WEAK PASS';
    reasoning = 'Out-of-sample is positive but the WR drop is concerning. Monitor closely if deployed.';
  } else if (!avgRPositive) {
    verdict = 'FAIL';
    reasoning = 'Out-of-sample avgR flipped negative - the strategy loses money on unseen data. This is overfitting, reject it.';
  } else if (!wrAbove50) {
    verdict = 'FAIL';
    reasoning = 'Out-of-sample WR collapsed to 50% or below - no edge on unseen data. Reject it.';
  }

  console.log(`VERDICT: ${verdict}\n`);
  console.log(reasoning);

  // Comparison to other strategies
  console.log('\n=== COMPARISON TO OTHER STRATEGIES ===\n');
  console.log('Forex Mean-Reversion (live, walk-forward validated):');
  console.log('  Full period: 67.2% WR, +0.031 avgR');
  console.log('  Out-of-sample: held up (passed walk-forward)\n');
  
  console.log('Metals Trend-Breakout (live, walk-forward validated):');
  console.log('  Full period: 38.3% WR, +0.184 avgR');
  console.log('  Out-of-sample: held up (passed walk-forward)\n');

  console.log('Optimized EUR Strategy V2 (this test):');
  console.log(`  Full period: 63.1% WR, +0.144 avgR`);
  console.log(`  In-sample: ${inStats.winRate.toFixed(1)}% WR, ${inStats.avgR.toFixed(3)} avgR`);
  console.log(`  Out-of-sample: ${outStats.winRate.toFixed(1)}% WR, ${outStats.avgR.toFixed(3)} avgR`);
  console.log(`  Verdict: ${verdict}\n`);

  // Recommendation
  console.log('=== RECOMMENDATION ===\n');
  if (verdict === 'PASS') {
    console.log('This strategy passed walk-forward validation. It can be considered for production deployment after further review.');
  } else if (verdict === 'WEAK PASS') {
    console.log('This strategy barely passed. Consider collecting more out-of-sample data before deploying, or use it with reduced position sizing.');
  } else {
    console.log('This strategy FAILED walk-forward validation. Do NOT deploy it. The parameters were overfit to the in-sample data and do not generalize to unseen market conditions.');
    console.log('Recommendation: Reject this strategy and continue research on other approaches.');
  }

  fs.default.writeFileSync('walkforward-optimized-eur-v2-results.json', JSON.stringify({
    cutoff,
    inStats,
    outStats,
    verdict,
    reasoning,
    perPairInSample,
    perPairOutOfSample,
  }, null, 0));
  console.log('\nSaved to walkforward-optimized-eur-v2-results.json');
}

main().catch(e => { console.error(e); process.exit(1); });
