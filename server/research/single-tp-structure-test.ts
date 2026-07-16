import type { Candle } from '../src/types.js';
import { scanMeanReversionSignals } from '../engine-mean-reversion.js';

// ---------------------------------------------------------------------------
// ALTERNATIVE TP STRUCTURE TEST: Single 10-12 Pip Target
//
// Instead of tiered TPs (0.35R/0.9R/1.8R), use a single fixed target at 10-12 pips.
// This avoids the "small TP1 gets eaten by costs" problem.
// Apply real per-pair costs from the start, then walk-forward validate.
// ---------------------------------------------------------------------------

interface Trade {
  pair: string;
  direction: 'LONG' | 'SHORT';
  entry: number;
  sl: number;
  tp: number;
  entryTime: string;
  exitTime?: string;
  exitPrice?: number;
  exitReason?: string;
  pips?: number;
  r?: number;
  result?: string;
  confidence: number;
  slPips: number;
  tpPips: number;
}

function getPipMultiplier(pair: string): number {
  if (pair.includes('JPY')) return 0.01;
  if (pair.includes('XAU')) return 0.1;
  if (pair.includes('XAG')) return 0.01;
  return 0.0001;
}

// Realistic broker spreads (Pepperstone-style ECN/RAW)
const BROKER_SPREADS: Record<string, number> = {
  'EURUSD': 0.6, 'GBPUSD': 0.9, 'USDJPY': 0.7, 'USDCHF': 0.8,
  'USDCAD': 0.9, 'AUDUSD': 0.7, 'NZDUSD': 0.9,
  'EURGBP': 1.0, 'EURJPY': 1.2, 'GBPJPY': 1.5, 'AUDJPY': 1.3,
  'CADJPY': 1.4, 'CHFJPY': 1.6, 'NZDJPY': 1.5, 'EURAUD': 1.4,
};
const COMMISSION_PIPS = 0.7;

function getRealCost(pair: string): number {
  const spread = BROKER_SPREADS[pair] ?? 1.5;
  return spread + COMMISSION_PIPS;
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

// Simulate trade with single TP target (10-12 pips)
function simulateTradeWithSingleTP(
  pair: string,
  direction: 'LONG' | 'SHORT',
  entry: number,
  sl: number,
  entryTime: string,
  candles: Candle[],
  candleIndex: number,
  confidence: number,
  slPips: number,
  singleTpPips: number = 11 // middle of 10-12 range
): Trade {
  const isLong = direction === 'LONG';
  const pip = getPipMultiplier(pair);
  const initialRiskPips = Math.abs(entry - sl) / pip;
  const costPips = getRealCost(pair);
  
  // Single TP at fixed pip distance
  const tpPrice = isLong ? entry + singleTpPips * pip : entry - singleTpPips * pip;
  
  const r: Trade = { 
    pair, direction, entry, sl, tp: tpPrice, entryTime, confidence, 
    slPips, tpPips: singleTpPips 
  };

  const maxLookahead = Math.min(candleIndex + 2001, candles.length);
  for (let i = candleIndex + 1; i < maxLookahead; i++) {
    const c = candles[i];

    // Check SL
    if (isLong && c.low <= sl) {
      r.exitPrice = sl; r.exitTime = c.timestamp; r.exitReason = 'SL';
      r.pips = (sl - entry) / pip - costPips;
      r.r = initialRiskPips > 0 ? r.pips / initialRiskPips : 0;
      r.result = r.pips > 0 ? 'WIN' : 'LOSS';
      return r;
    }
    if (!isLong && c.high >= sl) {
      r.exitPrice = sl; r.exitTime = c.timestamp; r.exitReason = 'SL';
      r.pips = (entry - sl) / pip - costPips;
      r.r = initialRiskPips > 0 ? r.pips / initialRiskPips : 0;
      r.result = r.pips > 0 ? 'WIN' : 'LOSS';
      return r;
    }

    // Check single TP
    if (isLong && c.high >= tpPrice) {
      r.exitPrice = tpPrice; r.exitTime = c.timestamp; r.exitReason = 'TP';
      r.pips = (tpPrice - entry) / pip - costPips;
      r.r = initialRiskPips > 0 ? r.pips / initialRiskPips : 0;
      r.result = 'WIN';
      return r;
    }
    if (!isLong && c.low <= tpPrice) {
      r.exitPrice = tpPrice; r.exitTime = c.timestamp; r.exitReason = 'TP';
      r.pips = (entry - tpPrice) / pip - costPips;
      r.r = initialRiskPips > 0 ? r.pips / initialRiskPips : 0;
      r.result = 'WIN';
      return r;
    }
  }

  // Trade still open
  const lastIdx = maxLookahead - 1;
  const last = candles[lastIdx]?.close ?? entry;
  r.exitPrice = last; r.exitTime = candles[lastIdx]?.timestamp ?? entryTime;
  r.exitReason = 'OPEN'; r.result = 'OPEN';
  r.pips = (isLong ? (last - entry) / pip : (entry - last) / pip) - costPips;
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
  const avgTpPips = trades.length ? trades.reduce((s, t) => s + t.tpPips, 0) / trades.length : 0;

  const grossProfit = closed.filter(t => t.r && t.r > 0).reduce((sum, t) => sum + (t.r || 0), 0);
  const grossLoss = Math.abs(closed.filter(t => t.r && t.r < 0).reduce((sum, t) => sum + (t.r || 0), 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  console.log(`  ${label.padEnd(40)} signals:${String(trades.length).padStart(4)} closed:${String(closed.length).padStart(4)} WR:${winRate.toFixed(1).padStart(6)}%  avgR:${avgR.toFixed(3).padStart(7)}  PF:${profitFactor.toFixed(2).padStart(6)}  maxDD(R):${maxDD.toFixed(2).padStart(6)}  avgSL(pips):${avgSlPips.toFixed(1).padStart(6)}  avgTP(pips):${avgTpPips.toFixed(1).padStart(6)}`);

  return { label, signals: trades.length, closed: closed.length, winRate, avgR, profitFactor, maxDD, avgSlPips, avgTpPips };
}

async function main() {
  const FOREX_PAIRS = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'USDCAD', 'AUDUSD', 'NZDUSD', 'EURGBP', 'EURJPY', 'GBPJPY', 'AUDJPY', 'CADJPY', 'CHFJPY', 'NZDJPY', 'EURAUD'];

  console.log('\n===================================================================');
  console.log('ALTERNATIVE TP STRUCTURE: Single 10-12 Pip Target');
  console.log('Real per-pair costs applied from start, walk-forward validation');
  console.log('===================================================================\n');

  // Load all forex data and generate signals once
  const allSignals: Record<string, any[]> = {};
  const allCandles: Record<string, Candle[]> = {};
  for (const pair of FOREX_PAIRS) {
    const m5 = loadCache(pair);
    if (!m5 || m5.length < 60) {
      console.warn(`SKIP ${pair}: no/short cache`);
      continue;
    }
    allCandles[pair] = m5;
    allSignals[pair] = scanMeanReversionSignals(pair, m5);
  }

  // Determine split time (4 months in = 67% of 6 months)
  const allTimestamps: number[] = [];
  for (const m5 of Object.values(allCandles)) {
    allTimestamps.push(new Date(m5[0].timestamp).getTime());
    allTimestamps.push(new Date(m5[m5.length - 1].timestamp).getTime());
  }
  const minTs = Math.min(...allTimestamps);
  const maxTs = Math.max(...allTimestamps);
  const splitTime = minTs + (maxTs - minTs) * 0.67;
  console.log(`Walk-forward split: ${new Date(splitTime).toISOString().split('T')[0]} (4 months in-sample, 2 months out-of-sample)\n`);

  // Test single TP at 11 pips (middle of 10-12 range)
  console.log('--- Single TP at 11 pips (with real per-pair costs) ---\n');
  const inSample: Trade[] = [];
  const outSample: Trade[] = [];
  for (const [pair, signals] of Object.entries(allSignals)) {
    const m5 = allCandles[pair];
    for (const sig of signals) {
      const trade = simulateTradeWithSingleTP(
        pair, sig.direction, sig.entry, sig.sl,
        m5[sig.candleIndex].timestamp, m5, sig.candleIndex,
        sig.confidence, Math.abs(sig.entry - sig.sl) / getPipMultiplier(pair),
        11 // single TP at 11 pips
      );
      const ts = new Date(m5[sig.candleIndex].timestamp).getTime();
      if (ts < splitTime) inSample.push(trade);
      else outSample.push(trade);
    }
  }
  const inStats = analyze('Single TP 11 pips (in-sample)', inSample);
  const outStats = analyze('Single TP 11 pips (out-of-sample)', outSample);

  // Comparison
  console.log('\n===================================================================');
  console.log('COMPARISON: Single TP 11 pips vs Current Tiered (0.35R/0.9R/1.8R)');
  console.log('===================================================================\n');
  console.log('                    | Single TP 11 pips | Current Tiered (from previous test)');
  console.log('  ------------------+-------------------+------------------------------------');
  console.log(`  In-sample WR      | ${inStats.winRate.toFixed(1).padStart(5)}%            | 76.6% (0.35R TP1)`);
  console.log(`  In-sample avgR    | ${inStats.avgR.toFixed(3).padStart(7)}            | -0.046 (0.35R TP1)`);
  console.log(`  In-sample PF      | ${inStats.profitFactor.toFixed(2).padStart(6)}              | 0.84 (0.35R TP1)`);
  console.log(`  In-sample maxDD   | ${inStats.maxDD.toFixed(2).padStart(6)}R             | 23.30R (0.35R TP1)`);
  console.log(`  Out-of-sample WR  | ${outStats.winRate.toFixed(1).padStart(5)}%            | 79.0% (0.35R TP1)`);
  console.log(`  Out-of-sample avgR| ${outStats.avgR.toFixed(3).padStart(7)}            | -0.051 (0.35R TP1)`);
  console.log(`  Out-of-sample PF  | ${outStats.profitFactor.toFixed(2).padStart(6)}              | 0.80 (0.35R TP1)`);
  console.log(`  Out-of-sample maxDD| ${outStats.maxDD.toFixed(2).padStart(6)}R             | 9.84R (0.35R TP1)`);

  // Verdict
  console.log('\n=== VERDICT ===\n');
  const passes = outStats.avgR > 0 && outStats.winRate > 55;
  
  if (passes) {
    console.log('✅ Single TP 11 pips PASSES walk-forward validation.');
    console.log(`   Out-of-sample avgR: ${outStats.avgR.toFixed(3)}, WR: ${outStats.winRate.toFixed(1)}%`);
    console.log('   Recommendation: This TP structure survives realistic costs.');
    console.log('   Worth considering for deployment after further testing.');
  } else {
    console.log('❌ Single TP 11 pips FAILS walk-forward validation.');
    console.log(`   Out-of-sample avgR: ${outStats.avgR.toFixed(3)}, WR: ${outStats.winRate.toFixed(1)}%`);
    console.log('   Recommendation: This TP structure does not improve profitability.');
    console.log('   The mean-reversion entry logic itself may not be viable for forex after costs.');
  }

  fs.default.writeFileSync('single-tp-test-results.json', JSON.stringify({
    splitTime: new Date(splitTime).toISOString(),
    singleTp11: { inSample: inStats, outOfSample: outStats },
  }, null, 0));
  console.log('\nSaved to single-tp-test-results.json');
}

main().catch(e => { console.error(e); process.exit(1); });
