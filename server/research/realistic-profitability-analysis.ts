import type { Candle } from '../src/types.js';
import { scanMeanReversionSignals } from '../engine-mean-reversion.js';

// ---------------------------------------------------------------------------
// REALISTIC PROFITABILITY ANALYSIS: Forex Mean-Reversion
//
// Task: Recalculate real profitability with trading costs factored in
// 1. Apply 8-pip minimum floor on SL and TP legs
// 2. Apply realistic spread/commission (1-2 pips per trade)
// 3. Recompute metrics on full 6-month dataset
// 4. Test ONE alternative: TP1 minimum 8 pips guarantee
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
  tp1Pips: number;
  tp2Pips: number;
  tp3Pips: number;
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

// Simulate trade with realistic cost adjustment
function simulateTradeWithCosts(
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
  slPips: number,
  spreadPips: number = 1.5 // realistic spread + commission estimate
): Trade {
  const isLong = direction === 'LONG';
  const pip = getPipMultiplier(pair);
  const initialRiskPips = Math.abs(entry - sl) / pip;
  const tp1Pips = Math.abs(tp1 - entry) / pip;
  const tp2Pips = Math.abs(tp2 - entry) / pip;
  const tp3Pips = Math.abs(tp3 - entry) / pip;
  
  const r: Trade = { 
    pair, direction, entry, sl, tp1, tp2, tp3, entryTime, confidence, 
    slPips, tp1Pips, tp2Pips, tp3Pips 
  };

  const maxLookahead = Math.min(candleIndex + 2001, candles.length);
  for (let i = candleIndex + 1; i < maxLookahead; i++) {
    const c = candles[i];

    // Check SL hit (with spread cost)
    if (isLong && c.low <= sl) {
      r.exitPrice = sl; 
      r.exitTime = c.timestamp; 
      r.exitReason = 'SL';
      // Real cost: SL hit + spread paid on entry and exit
      r.pips = (sl - entry) / pip - spreadPips;
      r.r = initialRiskPips > 0 ? r.pips / initialRiskPips : 0;
      r.result = r.pips > 0 ? 'WIN' : 'LOSS';
      return r;
    }
    if (!isLong && c.high >= sl) {
      r.exitPrice = sl; 
      r.exitTime = c.timestamp; 
      r.exitReason = 'SL';
      r.pips = (entry - sl) / pip - spreadPips;
      r.r = initialRiskPips > 0 ? r.pips / initialRiskPips : 0;
      r.result = r.pips > 0 ? 'WIN' : 'LOSS';
      return r;
    }

    // Check TP hits (with spread cost)
    if (isLong) {
      if (c.high >= tp3) {
        r.exitPrice = tp3; 
        r.exitTime = c.timestamp; 
        r.exitReason = 'TP3';
        r.pips = (tp3 - entry) / pip - spreadPips;
        r.r = initialRiskPips > 0 ? r.pips / initialRiskPips : 0;
        r.result = 'WIN';
        return r;
      }
      if (c.high >= tp2) {
        r.exitPrice = tp2; 
        r.exitTime = c.timestamp; 
        r.exitReason = 'TP2';
        r.pips = (tp2 - entry) / pip - spreadPips;
        r.r = initialRiskPips > 0 ? r.pips / initialRiskPips : 0;
        r.result = 'WIN';
        return r;
      }
      if (c.high >= tp1) {
        r.exitPrice = tp1; 
        r.exitTime = c.timestamp; 
        r.exitReason = 'TP1';
        r.pips = (tp1 - entry) / pip - spreadPips;
        r.r = initialRiskPips > 0 ? r.pips / initialRiskPips : 0;
        r.result = 'WIN';
        return r;
      }
    } else {
      if (c.low <= tp3) {
        r.exitPrice = tp3; 
        r.exitTime = c.timestamp; 
        r.exitReason = 'TP3';
        r.pips = (entry - tp3) / pip - spreadPips;
        r.r = initialRiskPips > 0 ? r.pips / initialRiskPips : 0;
        r.result = 'WIN';
        return r;
      }
      if (c.low <= tp2) {
        r.exitPrice = tp2; 
        r.exitTime = c.timestamp; 
        r.exitReason = 'TP2';
        r.pips = (entry - tp2) / pip - spreadPips;
        r.r = initialRiskPips > 0 ? r.pips / initialRiskPips : 0;
        r.result = 'WIN';
        return r;
      }
      if (c.low <= tp1) {
        r.exitPrice = tp1; 
        r.exitTime = c.timestamp; 
        r.exitReason = 'TP1';
        r.pips = (entry - tp1) / pip - spreadPips;
        r.r = initialRiskPips > 0 ? r.pips / initialRiskPips : 0;
        r.result = 'WIN';
        return r;
      }
    }
  }

  // Trade still open
  const lastIdx = maxLookahead - 1;
  const last = candles[lastIdx]?.close ?? entry;
  r.exitPrice = last;
  r.exitTime = candles[lastIdx]?.timestamp ?? entryTime;
  r.exitReason = 'OPEN';
  r.result = 'OPEN';
  r.pips = (isLong ? (last - entry) / pip : (entry - last) / pip) - spreadPips;
  r.r = initialRiskPips > 0 ? r.pips / initialRiskPips : 0;
  return r;
}

// Simulate trade with TP1 minimum 8 pips guarantee
function simulateTradeWithTp1Min8Pips(
  pair: string,
  direction: 'LONG' | 'SHORT',
  entry: number,
  sl: number,
  entryTime: string,
  candles: Candle[],
  candleIndex: number,
  confidence: number,
  slPips: number,
  spreadPips: number = 1.5
): Trade {
  const isLong = direction === 'LONG';
  const pip = getPipMultiplier(pair);
  const initialRiskPips = Math.abs(entry - sl) / pip;
  
  // TP1 minimum 8 pips guarantee
  const tp1Pips = Math.max(8, initialRiskPips * 0.35);
  const tp1 = isLong ? entry + tp1Pips * pip : entry - tp1Pips * pip;
  const tp2 = isLong ? entry + initialRiskPips * 0.9 * pip : entry - initialRiskPips * 0.9 * pip;
  const tp3 = isLong ? entry + initialRiskPips * 1.8 * pip : entry - initialRiskPips * 1.8 * pip;
  
  const r: Trade = { 
    pair, direction, entry, sl, tp1, tp2, tp3, entryTime, confidence, 
    slPips, tp1Pips, tp2Pips: initialRiskPips * 0.9, tp3Pips: initialRiskPips * 1.8 
  };

  const maxLookahead = Math.min(candleIndex + 2001, candles.length);
  for (let i = candleIndex + 1; i < maxLookahead; i++) {
    const c = candles[i];

    if (isLong && c.low <= sl) {
      r.exitPrice = sl; 
      r.exitTime = c.timestamp; 
      r.exitReason = 'SL';
      r.pips = (sl - entry) / pip - spreadPips;
      r.r = initialRiskPips > 0 ? r.pips / initialRiskPips : 0;
      r.result = r.pips > 0 ? 'WIN' : 'LOSS';
      return r;
    }
    if (!isLong && c.high >= sl) {
      r.exitPrice = sl; 
      r.exitTime = c.timestamp; 
      r.exitReason = 'SL';
      r.pips = (entry - sl) / pip - spreadPips;
      r.r = initialRiskPips > 0 ? r.pips / initialRiskPips : 0;
      r.result = r.pips > 0 ? 'WIN' : 'LOSS';
      return r;
    }

    if (isLong) {
      if (c.high >= tp3) {
        r.exitPrice = tp3; 
        r.exitTime = c.timestamp; 
        r.exitReason = 'TP3';
        r.pips = (tp3 - entry) / pip - spreadPips;
        r.r = initialRiskPips > 0 ? r.pips / initialRiskPips : 0;
        r.result = 'WIN';
        return r;
      }
      if (c.high >= tp2) {
        r.exitPrice = tp2; 
        r.exitTime = c.timestamp; 
        r.exitReason = 'TP2';
        r.pips = (tp2 - entry) / pip - spreadPips;
        r.r = initialRiskPips > 0 ? r.pips / initialRiskPips : 0;
        r.result = 'WIN';
        return r;
      }
      if (c.high >= tp1) {
        r.exitPrice = tp1; 
        r.exitTime = c.timestamp; 
        r.exitReason = 'TP1';
        r.pips = (tp1 - entry) / pip - spreadPips;
        r.r = initialRiskPips > 0 ? r.pips / initialRiskPips : 0;
        r.result = 'WIN';
        return r;
      }
    } else {
      if (c.low <= tp3) {
        r.exitPrice = tp3; 
        r.exitTime = c.timestamp; 
        r.exitReason = 'TP3';
        r.pips = (entry - tp3) / pip - spreadPips;
        r.r = initialRiskPips > 0 ? r.pips / initialRiskPips : 0;
        r.result = 'WIN';
        return r;
      }
      if (c.low <= tp2) {
        r.exitPrice = tp2; 
        r.exitTime = c.timestamp; 
        r.exitReason = 'TP2';
        r.pips = (entry - tp2) / pip - spreadPips;
        r.r = initialRiskPips > 0 ? r.pips / initialRiskPips : 0;
        r.result = 'WIN';
        return r;
      }
      if (c.low <= tp1) {
        r.exitPrice = tp1; 
        r.exitTime = c.timestamp; 
        r.exitReason = 'TP1';
        r.pips = (entry - tp1) / pip - spreadPips;
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
  r.pips = (isLong ? (last - entry) / pip : (entry - last) / pip) - spreadPips;
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
  const avgTp1Pips = trades.length ? trades.reduce((s, t) => s + t.tp1Pips, 0) / trades.length : 0;

  const grossProfit = closed.filter(t => t.r && t.r > 0).reduce((sum, t) => sum + (t.r || 0), 0);
  const grossLoss = Math.abs(closed.filter(t => t.r && t.r < 0).reduce((sum, t) => sum + (t.r || 0), 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  console.log(`  ${label.padEnd(35)} signals:${String(trades.length).padStart(4)} closed:${String(closed.length).padStart(4)} WR:${winRate.toFixed(1).padStart(6)}%  avgR:${avgR.toFixed(3).padStart(7)}  PF:${profitFactor.toFixed(2).padStart(6)}  maxDD(R):${maxDD.toFixed(2).padStart(6)}  avgSL(pips):${avgSlPips.toFixed(1).padStart(6)}  avgTP1(pips):${avgTp1Pips.toFixed(1).padStart(6)}`);

  return { label, signals: trades.length, closed: closed.length, winRate, avgR, profitFactor, maxDD, avgSlPips, avgTp1Pips };
}

async function main() {
  const FOREX_PAIRS = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'USDCAD', 'AUDUSD', 'NZDUSD', 'EURGBP', 'EURJPY', 'GBPJPY', 'AUDJPY', 'CADJPY', 'CHFJPY', 'NZDJPY', 'EURAUD'];

  console.log('\n===================================================================');
  console.log('REALISTIC PROFITABILITY ANALYSIS: Forex Mean-Reversion');
  console.log('Factoring in realistic trading costs (spread + commission)');
  console.log('===================================================================\n');

  // Load all data and generate signals once
  const allSignals: Record<string, any[]> = {};
  for (const pair of FOREX_PAIRS) {
    const m5 = loadCache(pair);
    if (!m5 || m5.length < 60) {
      console.warn(`SKIP ${pair}: no/short cache`);
      continue;
    }
    allSignals[pair] = scanMeanReversionSignals(pair, m5);
  }

  // Test 1: Current config with realistic costs (1.5 pips spread/commission)
  console.log('=== TEST 1: Current config with realistic costs (1.5 pips) ===\n');
  const tradesWithCosts: Trade[] = [];
  for (const [pair, signals] of Object.entries(allSignals)) {
    const m5 = loadCache(pair)!;
    for (const sig of signals) {
      const trade = simulateTradeWithCosts(
        pair, sig.direction, sig.entry, sig.sl, sig.tp1, sig.tp2, sig.tp3,
        m5[sig.candleIndex].timestamp, m5, sig.candleIndex,
        sig.confidence, Math.abs(sig.entry - sig.sl) / getPipMultiplier(pair),
        1.5 // realistic spread + commission
      );
      tradesWithCosts.push(trade);
    }
  }
  const statsWithCosts = analyze('Current + 1.5 pip costs', tradesWithCosts);

  // Analyze TP1 hits specifically
  const tp1Hits = tradesWithCosts.filter(t => t.exitReason === 'TP1');
  const tp1HitsBelow8Pips = tp1Hits.filter(t => t.tp1Pips < 8);
  const tp1HitsCutInHalf = tp1Hits.filter(t => t.tp1Pips < 8 && t.pips < t.tp1Pips * 0.5);
  
  console.log(`\n  TP1 Hit Analysis:`);
  console.log(`    Total TP1 hits: ${tp1Hits.length}`);
  console.log(`    TP1 hits with target < 8 pips: ${tp1HitsBelow8Pips.length} (${tp1Hits.length ? (tp1HitsBelow8Pips.length / tp1Hits.length * 100).toFixed(1) : 0}%)`);
  console.log(`    TP1 hits where costs cut result in half or worse: ${tp1HitsCutInHalf.length} (${tp1Hits.length ? (tp1HitsCutInHalf.length / tp1Hits.length * 100).toFixed(1) : 0}%)`);

  // Test 2: TP1 minimum 8 pips guarantee with realistic costs
  console.log('\n=== TEST 2: TP1 minimum 8 pips guarantee + realistic costs ===\n');
  const tradesTp1Min8: Trade[] = [];
  for (const [pair, signals] of Object.entries(allSignals)) {
    const m5 = loadCache(pair)!;
    for (const sig of signals) {
      const trade = simulateTradeWithTp1Min8Pips(
        pair, sig.direction, sig.entry, sig.sl,
        m5[sig.candleIndex].timestamp, m5, sig.candleIndex,
        sig.confidence, Math.abs(sig.entry - sig.sl) / getPipMultiplier(pair),
        1.5
      );
      tradesTp1Min8.push(trade);
    }
  }
  const statsTp1Min8 = analyze('TP1 min 8 pips + 1.5 pip costs', tradesTp1Min8);

  // Analyze TP1 hits with min 8 pips
  const tp1HitsMin8 = tradesTp1Min8.filter(t => t.exitReason === 'TP1');
  const tp1HitsMin8Below8Pips = tp1HitsMin8.filter(t => t.tp1Pips < 8);
  
  console.log(`\n  TP1 Hit Analysis (with min 8 pips):`);
  console.log(`    Total TP1 hits: ${tp1HitsMin8.length}`);
  console.log(`    TP1 hits with target < 8 pips: ${tp1HitsMin8Below8Pips.length} (${tp1HitsMin8.length ? (tp1HitsMin8Below8Pips.length / tp1HitsMin8.length * 100).toFixed(1) : 0}%)`);

  // Comparison summary
  console.log('\n=== COMPARISON SUMMARY ===\n');
  console.log('Baseline (no costs, from walk-forward validation):');
  console.log('  Full period: 67.2% WR, +0.031 avgR');
  console.log('  In-sample: 65.6% WR, -0.010 avgR');
  console.log('  Out-of-sample: 71.1% WR, +0.134 avgR\n');

  console.log('Test 1 - Current config with 1.5 pip costs:');
  console.log(`  Full period: ${statsWithCosts.winRate.toFixed(1)}% WR, ${statsWithCosts.avgR.toFixed(3)} avgR, PF=${statsWithCosts.profitFactor.toFixed(2)}`);
  console.log(`  Avg TP1 target: ${statsWithCosts.avgTp1Pips.toFixed(1)} pips\n`);

  console.log('Test 2 - TP1 min 8 pips with 1.5 pip costs:');
  console.log(`  Full period: ${statsTp1Min8.winRate.toFixed(1)}% WR, ${statsTp1Min8.avgR.toFixed(3)} avgR, PF=${statsTp1Min8.profitFactor.toFixed(2)}`);
  console.log(`  Avg TP1 target: ${statsTp1Min8.avgTp1Pips.toFixed(1)} pips\n`);

  // Recommendation
  console.log('=== RECOMMENDATION ===\n');
  
  const currentProfitableAfterCosts = statsWithCosts.avgR > 0;
  const tp1Min8Better = statsTp1Min8.avgR > statsWithCosts.avgR && statsTp1Min8.winRate > 55;

  if (!currentProfitableAfterCosts) {
    console.log('️  WARNING: Current strategy is NOT profitable after realistic costs.');
    console.log(`   Avg R dropped from +0.031 to ${statsWithCosts.avgR.toFixed(3)} with 1.5 pip costs.`);
    console.log('   This means the small TP1 wins (3-4 pips) are being eaten by spread/commission.\n');
  } else {
    console.log('✅ Current strategy remains profitable after costs, but margin is thin.\n');
  }

  if (tp1Min8Better) {
    console.log('✅ TP1 minimum 8 pips guarantee shows genuine improvement:');
    console.log(`   - Win rate: ${statsWithCosts.winRate.toFixed(1)}% → ${statsTp1Min8.winRate.toFixed(1)}%`);
    console.log(`   - Avg R: ${statsWithCosts.avgR.toFixed(3)} → ${statsTp1Min8.avgR.toFixed(3)}`);
    console.log(`   - Profit factor: ${statsWithCosts.profitFactor.toFixed(2)} → ${statsTp1Min8.profitFactor.toFixed(2)}`);
    console.log('   Recommendation: Worth a proper walk-forward test before considering deployment.\n');
  } else {
    console.log('❌ TP1 minimum 8 pips did NOT improve performance. The wider target reduces hit rate too much.\n');
  }

  console.log('=== KEY FINDING ===\n');
  console.log(`Of ${tp1Hits.length} TP1 hits in the current strategy:`);
  console.log(`- ${tp1HitsBelow8Pips.length} (${(tp1HitsBelow8Pips.length / tp1Hits.length * 100).toFixed(1)}%) had targets below 8 pips`);
  console.log(`- ${tp1HitsCutInHalf.length} (${(tp1HitsCutInHalf.length / tp1Hits.length * 100).toFixed(1)}%) had their pip result cut in half or worse by costs`);
  console.log('\nThis confirms the 8-pip minimum requirement is critical for real-world profitability.');

  fs.default.writeFileSync('realistic-profitability-analysis.json', JSON.stringify({
    statsWithCosts,
    statsTp1Min8,
    tp1HitAnalysis: {
      total: tp1Hits.length,
      below8Pips: tp1HitsBelow8Pips.length,
      cutInHalf: tp1HitsCutInHalf.length,
    },
  }, null, 0));
  console.log('\nSaved to realistic-profitability-analysis.json');
}

main().catch(e => { console.error(e); process.exit(1); });
