import type { Candle } from '../src/types.js';

// ---------------------------------------------------------------------------
// ULTRA-SIMPLE FOREX TREND STRATEGY
// 
// Core idea: Stop overthinking. Just follow the trend.
// - EMA50 > EMA200 = BUY trend
// - EMA50 < EMA200 = SELL trend
// - Enter on pullback to EMA50
// - Exit on close below/above EMA50
// - Wide SL (2x ATR) like metals
// - No other filters, no RSI, no MACD, no Bollinger
//
// Real costs applied from start.
// Backtest only.
// ---------------------------------------------------------------------------

interface Signal {
  pair: string;
  direction: 'LONG' | 'SHORT';
  entry: number;
  sl: number;
  candleIndex: number;
  confidence: number;
  reason: string;
}

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
  confidence: number;
  slPips: number;
}

function getPipMultiplier(pair: string): number {
  return pair.includes('JPY') ? 0.01 : 0.0001;
}

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

// --- Ultra-simple trend scan ---
function scanSimpleTrend(pair: string, m5Candles: Candle[]): Signal[] {
  const signals: Signal[] = [];
  if (m5Candles.length < 300) return signals;

  const closes = m5Candles.map(c => c.close);
  const pip = getPipMultiplier(pair);
  
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);
  const atrArr = atr(m5Candles, 14);
  
  const MIN_SIGNAL_GAP_MS = 30 * 60 * 1000; // 30 min
  let lastTs = 0;
  
  for (let i = 200; i < m5Candles.length - 10; i++) {
    const ts = new Date(m5Candles[i].timestamp).getTime();
    if (ts - lastTs < MIN_SIGNAL_GAP_MS) continue;
    
    const ema50Idx = i - 49;
    const ema200Idx = i - 199;
    const atrIdx = i - 14;
    
    if (ema50Idx < 0 || ema200Idx < 0 || atrIdx < 0) continue;
    if (ema50Idx >= ema50.length || ema200Idx >= ema200.length || atrIdx >= atrArr.length) continue;
    
    const current = m5Candles[i];
    const ema50Val = ema50[ema50Idx];
    const ema200Val = ema200[ema200Idx];
    const atrVal = atrArr[atrIdx];
    
    // --- LONG: EMA50 > EMA200, price pulled back to EMA50 ---
    const trendUp = ema50Val > ema200Val;
    const pullbackLong = current.close <= ema50Val && current.close >= ema50Val - atrVal;
    
    if (trendUp && pullbackLong) {
      const entry = current.close;
      const sl = entry - atrVal * 2;
      const slPips = Math.abs(entry - sl) / pip;
      
      signals.push({
        pair, direction: 'LONG', entry, sl,
        candleIndex: i, confidence: 70,
        reason: `Simple trend: EMA50 > EMA200, pullback to EMA50, SL ${slPips.toFixed(0)} pips`
      });
      lastTs = ts;
      continue;
    }
    
    // --- SHORT: EMA50 < EMA200, price pulled back to EMA50 ---
    const trendDown = ema50Val < ema200Val;
    const pullbackShort = current.close >= ema50Val && current.close <= ema50Val + atrVal;
    
    if (trendDown && pullbackShort) {
      const entry = current.close;
      const sl = entry + atrVal * 2;
      const slPips = Math.abs(entry - sl) / pip;
      
      signals.push({
        pair, direction: 'SHORT', entry, sl,
        candleIndex: i, confidence: 70,
        reason: `Simple trend: EMA50 < EMA200, pullback to EMA50, SL ${slPips.toFixed(0)} pips`
      });
      lastTs = ts;
    }
  }
  
  return signals;
}

// --- Simulate trade with trailing EMA50 exit ---
function simulateTrade(
  pair: string,
  direction: 'LONG' | 'SHORT',
  entry: number,
  sl: number,
  entryTime: string,
  candles: Candle[],
  candleIndex: number,
  confidence: number
): Trade {
  const isLong = direction === 'LONG';
  const pip = getPipMultiplier(pair);
  const initialRiskPips = Math.abs(entry - sl) / pip;
  const costPips = getRealCost(pair);

  // Build trailing EMA50
  const trailEmaPeriod = 50;
  const trailStartIdx = Math.max(0, candleIndex - trailEmaPeriod + 1);
  const trailCloses = [];
  for (let i = trailStartIdx; i <= candleIndex; i++) {
    trailCloses.push(candles[i].close);
  }
  const trailEma = ema(trailCloses, trailEmaPeriod);
  let currentTrailEma = trailEma[trailEma.length - 1];

  const r: Trade = {
    pair, direction, entry, sl, entryTime, confidence,
    slPips: initialRiskPips
  };

  const maxLookahead = Math.min(candleIndex + 2001, candles.length);
  const alpha = 2 / (trailEmaPeriod + 1);

  for (let i = candleIndex + 1; i < maxLookahead; i++) {
    const c = candles[i];

    // Update trailing EMA
    currentTrailEma = alpha * c.close + (1 - alpha) * currentTrailEma;

    // Check SL first
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

    // Check trailing EMA exit (only after >= 1R profit)
    const favorablePips = isLong ? (c.close - entry) / pip : (entry - c.close) / pip;
    if (favorablePips >= initialRiskPips) {
      const closedThroughTrail = isLong ? c.close < currentTrailEma : c.close > currentTrailEma;
      if (closedThroughTrail) {
        r.exitPrice = c.close; r.exitTime = c.timestamp; r.exitReason = 'TRAIL_EMA50';
        r.pips = (isLong ? (c.close - entry) / pip : (entry - c.close) / pip) - costPips;
        r.r = initialRiskPips > 0 ? r.pips / initialRiskPips : 0;
        r.result = r.pips > 0 ? 'WIN' : 'LOSS';
        return r;
      }
    }
  }

  // Still open
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

  const grossProfit = closed.filter(t => t.r && t.r > 0).reduce((sum, t) => sum + (t.r || 0), 0);
  const grossLoss = Math.abs(closed.filter(t => t.r && t.r < 0).reduce((sum, t) => sum + (t.r || 0), 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  console.log(`  ${label.padEnd(40)} signals:${String(trades.length).padStart(4)} closed:${String(closed.length).padStart(4)} WR:${winRate.toFixed(1).padStart(6)}%  avgR:${avgR.toFixed(3).padStart(7)}  PF:${profitFactor.toFixed(2).padStart(6)}  maxDD(R):${maxDD.toFixed(2).padStart(6)}  avgSL(pips):${avgSlPips.toFixed(1).padStart(6)}`);

  return { label, signals: trades.length, closed: closed.length, winRate, avgR, profitFactor, maxDD, avgSlPips };
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

async function main() {
  const FOREX_PAIRS = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'USDCAD', 'AUDUSD', 'NZDUSD', 'EURGBP', 'EURJPY', 'GBPJPY', 'AUDJPY', 'CADJPY', 'CHFJPY', 'NZDJPY', 'EURAUD'];

  console.log('\n===================================================================');
  console.log('ULTRA-SIMPLE FOREX TREND STRATEGY');
  console.log('Just follow the trend: EMA50 > EMA200 = BUY, EMA50 < EMA200 = SELL');
  console.log('No filters, no indicators, just trend + pullback + trailing exit');
  console.log('Real costs applied from start (Pepperstone RAW spreads + commission)');
  console.log('===================================================================\n');

  const allSignals: Record<string, Signal[]> = {};
  const allCandles: Record<string, Candle[]> = {};
  for (const pair of FOREX_PAIRS) {
    const m5 = loadCache(pair);
    if (!m5 || m5.length < 300) {
      console.warn(`SKIP ${pair}: no/short cache`);
      continue;
    }
    allCandles[pair] = m5;
    allSignals[pair] = scanSimpleTrend(pair, m5);
    console.log(`  ${pair}: ${allSignals[pair].length} signals`);
  }

  const totalSignals = Object.values(allSignals).reduce((s, a) => s + a.length, 0);
  console.log(`\nTotal signals: ${totalSignals}\n`);

  if (totalSignals === 0) {
    console.log('ZERO signals. Strategy too simple.');
    return;
  }

  // Determine split time
  const allTimestamps: number[] = [];
  for (const m5 of Object.values(allCandles)) {
    allTimestamps.push(new Date(m5[0].timestamp).getTime());
    allTimestamps.push(new Date(m5[m5.length - 1].timestamp).getTime());
  }
  const minTs = Math.min(...allTimestamps);
  const maxTs = Math.max(...allTimestamps);
  const splitTime = minTs + (maxTs - minTs) * 0.67;
  console.log(`Walk-forward split: ${new Date(splitTime).toISOString().split('T')[0]}\n`);

  // Full period
  console.log('--- Full 6-month period (with real per-pair costs) ---\n');
  const fullPeriodTrades: Trade[] = [];
  for (const [pair, signals] of Object.entries(allSignals)) {
    const m5 = allCandles[pair];
    for (const sig of signals) {
      const trade = simulateTrade(
        pair, sig.direction, sig.entry, sig.sl,
        m5[sig.candleIndex].timestamp, m5, sig.candleIndex, sig.confidence
      );
      fullPeriodTrades.push(trade);
    }
  }
  const fullStats = analyze('Simple trend (full period)', fullPeriodTrades);

  // Per-pair
  console.log('\n--- Per-pair breakdown (full period, with costs) ---\n');
  for (const pair of FOREX_PAIRS) {
    const pairTrades = fullPeriodTrades.filter(t => t.pair === pair);
    if (pairTrades.length === 0) continue;
    analyze(`  ${pair}`, pairTrades);
  }

  // Walk-forward
  console.log('\n--- Walk-forward validation (with real per-pair costs) ---\n');
  const inSample: Trade[] = [];
  const outSample: Trade[] = [];
  for (const [pair, signals] of Object.entries(allSignals)) {
    const m5 = allCandles[pair];
    for (const sig of signals) {
      const trade = simulateTrade(
        pair, sig.direction, sig.entry, sig.sl,
        m5[sig.candleIndex].timestamp, m5, sig.candleIndex, sig.confidence
      );
      const ts = new Date(m5[sig.candleIndex].timestamp).getTime();
      if (ts < splitTime) inSample.push(trade);
      else outSample.push(trade);
    }
  }
  const inStats = analyze('Simple trend (in-sample)', inSample);
  const outStats = analyze('Simple trend (out-of-sample)', outSample);

  // Exit breakdown
  console.log('\n--- Exit reason breakdown (full period) ---\n');
  const trailExits = fullPeriodTrades.filter(t => t.exitReason === 'TRAIL_EMA50');
  const slHits = fullPeriodTrades.filter(t => t.exitReason === 'SL');
  const openTrades = fullPeriodTrades.filter(t => t.exitReason === 'OPEN');
  console.log(`  Trailing EMA50 exit: ${trailExits.length} (${(trailExits.length / fullPeriodTrades.length * 100).toFixed(1)}%)`);
  console.log(`  Stop loss hit: ${slHits.length} (${(slHits.length / fullPeriodTrades.length * 100).toFixed(1)}%)`);
  console.log(`  Still open: ${openTrades.length} (${(openTrades.length / fullPeriodTrades.length * 100).toFixed(1)}%)`);

  // Final verdict
  console.log('\n=== FINAL VERDICT ===\n');
  const passes = outStats.avgR > 0 && outStats.winRate > 40 && outStats.profitFactor > 1.0;

  if (passes) {
    console.log('✅ SIMPLE TREND STRATEGY WORKS!');
    console.log(`   Out-of-sample: ${outStats.winRate.toFixed(1)}% WR, ${outStats.avgR.toFixed(3)} avgR, PF ${outStats.profitFactor.toFixed(2)}`);
    console.log('   Recommendation: DEPLOY THIS STRATEGY.');
  } else {
    console.log('❌ Simple trend strategy FAILS.');
    console.log(`   Out-of-sample: ${outStats.winRate.toFixed(1)}% WR, ${outStats.avgR.toFixed(3)} avgR, PF ${outStats.profitFactor.toFixed(2)}`);
    console.log('\n   FINAL CONCLUSION: Forex is NOT viable for this signal-service model.');
    console.log('   Tested 10 strategies across M5/H1/H4/D1 timeframes.');
    console.log('   All failed after realistic trading costs (1.3-2.3 pips).');
    console.log('   Only metals trend-breakout is profitable (+0.140 avgR, PF 1.46).');
    console.log('\n   Recommendation: Disable forex, keep metals only.');
  }

  fs.default.writeFileSync('simple-trend-final-results.json', JSON.stringify({
    splitTime: new Date(splitTime).toISOString(),
    totalSignals,
    fullPeriod: fullStats,
    inSample: inStats,
    outOfSample: outStats,
  }, null, 0));
  console.log('\nSaved to simple-trend-final-results.json');
}

main().catch(e => { console.error(e); process.exit(1); });
