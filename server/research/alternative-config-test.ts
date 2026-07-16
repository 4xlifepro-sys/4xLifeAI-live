import type { Candle } from '../src/types.js';
import { scanMeanReversionSignals } from '../engine-mean-reversion.js';

// ---------------------------------------------------------------------------
// ALTERNATIVE CONFIGURATION TEST: Forex Mean-Reversion
//
// Testing 3 variations WITHOUT iterative tuning:
// 1. TP1 at 0.45R (instead of 0.35R)
// 2. SL with +20% wider buffer
// 3. Per-pair breakdown (JPY/CHF vs majors)
//
// One clean test per variation, reported honestly.
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

// Simulate trade with modified TP1 ratio
function simulateTradeWithTp1Ratio(
  pair: string,
  direction: 'LONG' | 'SHORT',
  entry: number,
  sl: number,
  tp1Ratio: number, // 0.35 or 0.45
  entryTime: string,
  candles: Candle[],
  candleIndex: number,
  confidence: number,
  slPips: number
): Trade {
  const isLong = direction === 'LONG';
  const pip = getPipMultiplier(pair);
  const initialRiskPips = Math.abs(entry - sl) / pip;
  const risk = initialRiskPips * pip;
  
  const tp1 = isLong ? entry + risk * tp1Ratio : entry - risk * tp1Ratio;
  const tp2 = isLong ? entry + risk * 0.9 : entry - risk * 0.9;
  const tp3 = isLong ? entry + risk * 1.8 : entry - risk * 1.8;
  
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

// Simulate trade with wider SL buffer (+20%)
function simulateTradeWithWiderSL(
  pair: string,
  direction: 'LONG' | 'SHORT',
  entry: number,
  sl: number,
  entryTime: string,
  candles: Candle[],
  candleIndex: number,
  confidence: number,
  slPips: number
): Trade {
  const isLong = direction === 'LONG';
  const pip = getPipMultiplier(pair);
  const initialRiskPips = Math.abs(entry - sl) / pip;
  
  // Widen SL by 20%
  const widerSlPips = initialRiskPips * 1.2;
  const widerSl = isLong ? entry - widerSlPips * pip : entry + widerSlPips * pip;
  
  const tp1 = isLong ? entry + initialRiskPips * pip * 0.35 : entry - initialRiskPips * pip * 0.35;
  const tp2 = isLong ? entry + initialRiskPips * pip * 0.9 : entry - initialRiskPips * pip * 0.9;
  const tp3 = isLong ? entry + initialRiskPips * pip * 1.8 : entry - initialRiskPips * pip * 1.8;
  
  const r: Trade = { pair, direction, entry, sl: widerSl, tp1, tp2, tp3, entryTime, confidence, slPips: widerSlPips };

  const maxLookahead = Math.min(candleIndex + 2001, candles.length);
  for (let i = candleIndex + 1; i < maxLookahead; i++) {
    const c = candles[i];

    if (isLong && c.low <= widerSl) {
      r.exitPrice = widerSl; r.exitTime = c.timestamp; r.exitReason = 'SL';
      r.pips = (widerSl - entry) / pip;
      r.r = widerSlPips > 0 ? r.pips / widerSlPips : 0;
      r.result = r.pips > 0 ? 'WIN' : 'LOSS';
      return r;
    }
    if (!isLong && c.high >= widerSl) {
      r.exitPrice = widerSl; r.exitTime = c.timestamp; r.exitReason = 'SL';
      r.pips = (entry - widerSl) / pip;
      r.r = widerSlPips > 0 ? r.pips / widerSlPips : 0;
      r.result = r.pips > 0 ? 'WIN' : 'LOSS';
      return r;
    }

    if (isLong) {
      if (c.high >= tp3) {
        r.exitPrice = tp3; r.exitTime = c.timestamp; r.exitReason = 'TP3';
        r.pips = (tp3 - entry) / pip;
        r.r = widerSlPips > 0 ? r.pips / widerSlPips : 0;
        r.result = 'WIN';
        return r;
      }
      if (c.high >= tp2) {
        r.exitPrice = tp2; r.exitTime = c.timestamp; r.exitReason = 'TP2';
        r.pips = (tp2 - entry) / pip;
        r.r = widerSlPips > 0 ? r.pips / widerSlPips : 0;
        r.result = 'WIN';
        return r;
      }
      if (c.high >= tp1) {
        r.exitPrice = tp1; r.exitTime = c.timestamp; r.exitReason = 'TP1';
        r.pips = (tp1 - entry) / pip;
        r.r = widerSlPips > 0 ? r.pips / widerSlPips : 0;
        r.result = 'WIN';
        return r;
      }
    } else {
      if (c.low <= tp3) {
        r.exitPrice = tp3; r.exitTime = c.timestamp; r.exitReason = 'TP3';
        r.pips = (entry - tp3) / pip;
        r.r = widerSlPips > 0 ? r.pips / widerSlPips : 0;
        r.result = 'WIN';
        return r;
      }
      if (c.low <= tp2) {
        r.exitPrice = tp2; r.exitTime = c.timestamp; r.exitReason = 'TP2';
        r.pips = (entry - tp2) / pip;
        r.r = widerSlPips > 0 ? r.pips / widerSlPips : 0;
        r.result = 'WIN';
        return r;
      }
      if (c.low <= tp1) {
        r.exitPrice = tp1; r.exitTime = c.timestamp; r.exitReason = 'TP1';
        r.pips = (entry - tp1) / pip;
        r.r = widerSlPips > 0 ? r.pips / widerSlPips : 0;
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
  r.r = widerSlPips > 0 ? r.pips / widerSlPips : 0;
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

  console.log(`  ${label.padEnd(35)} signals:${String(trades.length).padStart(4)} closed:${String(closed.length).padStart(4)} WR:${winRate.toFixed(1).padStart(6)}%  avgR:${avgR.toFixed(3).padStart(7)}  PF:${profitFactor.toFixed(2).padStart(6)}  maxDD(R):${maxDD.toFixed(2).padStart(6)}  avgSL(pips):${avgSlPips.toFixed(1).padStart(6)}`);

  return { label, signals: trades.length, closed: closed.length, winRate, avgR, profitFactor, maxDD, avgSlPips };
}

async function main() {
  const FOREX_PAIRS = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'USDCAD', 'AUDUSD', 'NZDUSD', 'EURGBP', 'EURJPY', 'GBPJPY', 'AUDJPY', 'CADJPY', 'CHFJPY', 'NZDJPY', 'EURAUD'];

  console.log('\n===================================================================');
  console.log('ALTERNATIVE CONFIGURATION TEST: Forex Mean-Reversion');
  console.log('Testing 3 variations WITHOUT iterative tuning');
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

  // Test 1: TP1 at 0.45R (instead of 0.35R)
  console.log('=== TEST 1: TP1 at 0.45R (instead of 0.35R) ===\n');
  const tradesTp1_045: Trade[] = [];
  for (const [pair, signals] of Object.entries(allSignals)) {
    const m5 = loadCache(pair)!;
    for (const sig of signals) {
      const trade = simulateTradeWithTp1Ratio(
        pair, sig.direction, sig.entry, sig.sl, 0.45,
        m5[sig.candleIndex].timestamp, m5, sig.candleIndex,
        sig.confidence, Math.abs(sig.entry - sig.sl) / getPipMultiplier(pair)
      );
      tradesTp1_045.push(trade);
    }
  }
  const statsTp1_045 = analyze('TP1=0.45R (full 6-month)', tradesTp1_045);

  // Test 2: SL with +20% wider buffer
  console.log('\n=== TEST 2: SL with +20% wider buffer ===\n');
  const tradesWiderSL: Trade[] = [];
  for (const [pair, signals] of Object.entries(allSignals)) {
    const m5 = loadCache(pair)!;
    for (const sig of signals) {
      const trade = simulateTradeWithWiderSL(
        pair, sig.direction, sig.entry, sig.sl,
        m5[sig.candleIndex].timestamp, m5, sig.candleIndex,
        sig.confidence, Math.abs(sig.entry - sig.sl) / getPipMultiplier(pair)
      );
      tradesWiderSL.push(trade);
    }
  }
  const statsWiderSL = analyze('SL+20% (full 6-month)', tradesWiderSL);

  // Test 3: Per-pair breakdown (current config)
  console.log('\n=== TEST 3: Per-pair breakdown (current config 0.35R TP1) ===\n');
  const perPairStats: Record<string, ReturnType<typeof analyze>> = {};
  const majors: Trade[] = [];
  const jpyCrosses: Trade[] = [];
  const chfCrosses: Trade[] = [];

  for (const [pair, signals] of Object.entries(allSignals)) {
    const m5 = loadCache(pair)!;
    const trades: Trade[] = [];
    for (const sig of signals) {
      const trade = simulateTradeWithTp1Ratio(
        pair, sig.direction, sig.entry, sig.sl, 0.35,
        m5[sig.candleIndex].timestamp, m5, sig.candleIndex,
        sig.confidence, Math.abs(sig.entry - sig.sl) / getPipMultiplier(pair)
      );
      trades.push(trade);
    }
    perPairStats[pair] = analyze(pair, trades);

    // Categorize
    if (pair.includes('JPY') && !pair.startsWith('USD')) {
      jpyCrosses.push(...trades);
    } else if (pair.includes('CHF') && !pair.startsWith('USD')) {
      chfCrosses.push(...trades);
    } else if (['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'USDCAD', 'AUDUSD', 'NZDUSD'].includes(pair)) {
      majors.push(...trades);
    }
  }

  console.log('\n=== ASSET CLASS BREAKDOWN ===\n');
  analyze('Majors (7 pairs)', majors);
  analyze('JPY Crosses (7 pairs)', jpyCrosses);
  analyze('CHF Crosses (1 pair)', chfCrosses);

  // Summary comparison
  console.log('\n=== SUMMARY COMPARISON ===\n');
  console.log('Current live config (TP1=0.35R):');
  console.log('  Full period: 67.2% WR, +0.031 avgR (from walk-forward validation)');
  console.log('  In-sample: 65.6% WR, -0.010 avgR');
  console.log('  Out-of-sample: 71.1% WR, +0.134 avgR\n');

  console.log('Test 1 - TP1=0.45R:');
  console.log(`  Full period: ${statsTp1_045.winRate.toFixed(1)}% WR, ${statsTp1_045.avgR.toFixed(3)} avgR, PF=${statsTp1_045.profitFactor.toFixed(2)}\n`);

  console.log('Test 2 - SL+20%:');
  console.log(`  Full period: ${statsWiderSL.winRate.toFixed(1)}% WR, ${statsWiderSL.avgR.toFixed(3)} avgR, PF=${statsWiderSL.profitFactor.toFixed(2)}\n`);

  console.log('Test 3 - Per-pair:');
  console.log('  Majors: see above');
  console.log('  JPY Crosses: see above');
  console.log('  CHF Crosses: see above\n');

  // Recommendation
  console.log('=== RECOMMENDATION ===\n');
  const tp1Improvement = statsTp1_045.avgR > 0.031 && statsTp1_045.winRate > 60;
  const slImprovement = statsWiderSL.avgR > 0.031 && statsWiderSL.winRate > 60;

  if (tp1Improvement) {
    console.log('TP1=0.45R shows genuine improvement in avgR without collapsing win rate.');
    console.log('Recommendation: Worth a proper walk-forward test before considering deployment.');
  } else if (statsTp1_045.avgR < 0.031) {
    console.log('TP1=0.45R did NOT improve avgR. Keep current 0.35R TP1.');
  }

  if (slImprovement) {
    console.log('SL+20% shows genuine improvement in avgR without collapsing win rate.');
    console.log('Recommendation: Worth a proper walk-forward test before considering deployment.');
  } else if (statsWiderSL.avgR < 0.031) {
    console.log('SL+20% did NOT improve avgR. Keep current SL sizing.');
  }

  if (!tp1Improvement && !slImprovement) {
    console.log('Neither alternative improved performance. Keep the current live config as-is.');
    console.log('The current strategy (TP1=0.35R, current SL) remains the best validated configuration.');
  }

  fs.default.writeFileSync('alternative-config-test-results.json', JSON.stringify({
    statsTp1_045,
    statsWiderSL,
    perPairStats,
  }, null, 0));
  console.log('\nSaved to alternative-config-test-results.json');
}

main().catch(e => { console.error(e); process.exit(1); });
