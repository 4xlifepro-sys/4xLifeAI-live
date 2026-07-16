import type { Candle } from '../src/types.js';

// ---------------------------------------------------------------------------
// FOREX: H1 TREND + M5 PULLBACK WITH WIDER SL
// 
// Key insight from metals: metals work because SL is WIDE (160 pips).
// Forex fails because SL is TIGHT (22 pips). 
// 
// New approach:
// - H1 EMA200 for trend direction (higher timeframe = more reliable)
// - M5 pullback to EMA50 (entry on pullback, not breakout)
// - SL: 40-50 pips (MUCH wider, give it room like metals)
// - TP: trailing EMA20 (same as metals)
// - Session filter: London/NY overlap only (12:00-16:00 UTC, highest vol)
//
// Real costs applied from start.
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

// Realistic broker spreads (Pepperstone RAW)
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

// --- Indicator math ---
function sma(values: number[], period: number): number[] {
  const result: number[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) result.push(sum / period);
  }
  return result;
}

function rsi(closes: number[], period: number = 14): number[] {
  const result: number[] = [];
  if (closes.length < period + 1) return result;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;
  for (let i = period; i < closes.length; i++) {
    if (i > period) {
      const change = closes[i] - closes[i - 1];
      const gain = change > 0 ? change : 0;
      const loss = change < 0 ? Math.abs(change) : 0;
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
    }
    if (avgLoss === 0) result.push(100);
    else {
      const rs = avgGain / avgLoss;
      result.push(100 - (100 / (1 + rs)));
    }
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

// Aggregate M5 candles to H1
function aggregateToH1(m5Candles: Candle[]): Candle[] {
  const h1Candles: Candle[] = [];
  let current: Candle | null = null;
  
  for (const m5 of m5Candles) {
    const m5Hour = new Date(m5.timestamp).getUTCHours();
    const m5Min = new Date(m5.timestamp).getUTCMinutes();
    
    // New H1 candle every hour at :00
    if (m5Min === 0 || current === null) {
      if (current !== null) h1Candles.push(current);
      current = { ...m5 };
    } else {
      current.high = Math.max(current.high, m5.high);
      current.low = Math.min(current.low, m5.low);
      current.close = m5.close;
    }
  }
  if (current !== null) h1Candles.push(current);
  
  return h1Candles;
}

// --- Scan for forex signals: H1 trend + M5 pullback ---
function scanForexH1TrendM5Pullback(pair: string, m5Candles: Candle[]): Signal[] {
  const signals: Signal[] = [];
  if (m5Candles.length < 300) return signals;

  const pipMultiplier = getPipMultiplier(pair);
  
  // Aggregate M5 to H1
  const h1Candles = aggregateToH1(m5Candles);
  if (h1Candles.length < 250) return signals;
  
  // H1 indicators
  const h1Closes = h1Candles.map(c => c.close);
  const h1Ema200 = ema(h1Closes, 200);
  
  // M5 indicators
  const m5Closes = m5Candles.map(c => c.close);
  const m5Ema50 = ema(m5Closes, 50);
  const m5Ema20 = ema(m5Closes, 20);
  const m5Rsi = rsi(m5Closes, 14);
  const m5Atr = atr(m5Candles, 14);
  
  const MIN_SIGNAL_GAP_MS = 60 * 60 * 1000; // 1 hour gap (wider than before)
  let lastTs = 0;
  
  // Start from index 250 (need H1 EMA200 warmed up)
  // H1 index = M5 index / 12 (approximately)
  const startIdx = 250 * 12; // 3000 M5 candles = 250 H1 candles
  
  for (let i = startIdx; i < m5Candles.length; i++) {
    const ts = new Date(m5Candles[i].timestamp).getTime();
    if (ts - lastTs < MIN_SIGNAL_GAP_MS) continue;
    
    // Session filter: London/NY overlap only (12:00-16:00 UTC)
    const hour = new Date(m5Candles[i].timestamp).getUTCHours();
    if (hour < 12 || hour >= 16) continue;
    
    // H1 trend direction
    const h1Idx = Math.floor(i / 12);
    if (h1Idx >= h1Ema200.length) continue;
    const h1Ema = h1Ema200[h1Idx];
    const m5Close = m5Candles[i].close;
    
    // M5 indicators
    const m5Idx50 = i - 49;
    const m5Idx20 = i - 19;
    const m5IdxRsi = i - 14;
    const m5IdxAtr = i - 14;
    
    if (m5Idx50 < 0 || m5Idx20 < 0 || m5IdxRsi < 0 || m5IdxAtr < 0) continue;
    if (m5Idx50 >= m5Ema50.length || m5Idx20 >= m5Ema20.length || 
        m5IdxRsi >= m5Rsi.length || m5IdxAtr >= m5Atr.length) continue;
    
    const ema50 = m5Ema50[m5Idx50];
    const ema20 = m5Ema20[m5Idx20];
    const rsiVal = m5Rsi[m5IdxRsi];
    const atrVal = m5Atr[m5IdxAtr];
    
    // --- LONG setup ---
    // H1 trend up: price above H1 EMA200
    const h1TrendUp = m5Close > h1Ema;
    // M5 pullback: price near EMA50 (within 1 ATR)
    const pullbackLong = m5Close <= ema50 + atrVal && m5Close >= ema50 - atrVal * 0.5;
    // RSI not overbought
    const rsiLongOk = rsiVal < 70 && rsiVal > 40;
    // Price above EMA20 (short-term momentum still up)
    const momentumLong = m5Close > ema20;
    
    if (h1TrendUp && pullbackLong && rsiLongOk && momentumLong) {
      const entry = m5Close;
      // WIDER SL: 45 pips (like metals, give it room)
      const slPips = 45;
      const sl = entry - slPips * pipMultiplier;
      
      let confidence = 65;
      if (rsiVal >= 45 && rsiVal <= 60) confidence += 10; // RSI in sweet spot
      if (Math.abs(m5Close - ema50) < atrVal * 0.3) confidence += 5; // Very close to EMA50
      
      signals.push({
        pair, direction: 'LONG', entry, sl,
        candleIndex: i, confidence: Math.min(confidence, 85),
        reason: `H1 trend up, M5 pullback to EMA50, RSI ${rsiVal.toFixed(1)}, SL ${slPips} pips`
      });
      lastTs = ts;
      continue;
    }
    
    // --- SHORT setup ---
    const h1TrendDown = m5Close < h1Ema;
    const pullbackShort = m5Close >= ema50 - atrVal && m5Close <= ema50 + atrVal * 0.5;
    const rsiShortOk = rsiVal > 30 && rsiVal < 60;
    const momentumShort = m5Close < ema20;
    
    if (h1TrendDown && pullbackShort && rsiShortOk && momentumShort) {
      const entry = m5Close;
      const slPips = 45;
      const sl = entry + slPips * pipMultiplier;
      
      let confidence = 65;
      if (rsiVal >= 40 && rsiVal <= 55) confidence += 10;
      if (Math.abs(m5Close - ema50) < atrVal * 0.3) confidence += 5;
      
      signals.push({
        pair, direction: 'SHORT', entry, sl,
        candleIndex: i, confidence: Math.min(confidence, 85),
        reason: `H1 trend down, M5 pullback to EMA50, RSI ${rsiVal.toFixed(1)}, SL ${slPips} pips`
      });
      lastTs = ts;
    }
  }
  
  return signals;
}

// --- Simulate trade with trailing EMA20 exit + real costs ---
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

  // Build trailing EMA20
  const trailEmaPeriod = 20;
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
        r.exitPrice = c.close; r.exitTime = c.timestamp; r.exitReason = 'TRAIL_EMA';
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
  console.log('FOREX: H1 TREND + M5 PULLBACK WITH WIDER SL (45 pips)');
  console.log('Key change: WIDER SL like metals, H1 trend filter, London/NY overlap');
  console.log('Real costs applied from start (Pepperstone RAW spreads + commission)');
  console.log('===================================================================\n');

  // Load all forex data and generate signals
  const allSignals: Record<string, Signal[]> = {};
  const allCandles: Record<string, Candle[]> = {};
  for (const pair of FOREX_PAIRS) {
    const m5 = loadCache(pair);
    if (!m5 || m5.length < 3000) {
      console.warn(`SKIP ${pair}: no/short cache`);
      continue;
    }
    allCandles[pair] = m5;
    allSignals[pair] = scanForexH1TrendM5Pullback(pair, m5);
    console.log(`  ${pair}: ${allSignals[pair].length} signals`);
  }

  const totalSignals = Object.values(allSignals).reduce((s, a) => s + a.length, 0);
  console.log(`\nTotal signals across ${FOREX_PAIRS.length} pairs: ${totalSignals}\n`);

  if (totalSignals === 0) {
    console.log('ZERO signals generated. Strategy too restrictive.');
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
  const fullStats = analyze('H1 trend + M5 pullback (full period)', fullPeriodTrades);

  // Per-pair breakdown
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
  const inStats = analyze('H1 trend + M5 pullback (in-sample)', inSample);
  const outStats = analyze('H1 trend + M5 pullback (out-of-sample)', outSample);

  // Exit reason breakdown
  console.log('\n--- Exit reason breakdown (full period) ---\n');
  const trailExits = fullPeriodTrades.filter(t => t.exitReason === 'TRAIL_EMA');
  const slHits = fullPeriodTrades.filter(t => t.exitReason === 'SL');
  const openTrades = fullPeriodTrades.filter(t => t.exitReason === 'OPEN');
  console.log(`  Trailing EMA exit: ${trailExits.length} (${(trailExits.length / fullPeriodTrades.length * 100).toFixed(1)}%)`);
  console.log(`  Stop loss hit: ${slHits.length} (${(slHits.length / fullPeriodTrades.length * 100).toFixed(1)}%)`);
  console.log(`  Still open: ${openTrades.length} (${(openTrades.length / fullPeriodTrades.length * 100).toFixed(1)}%)`);

  // Comparison
  console.log('\n===================================================================');
  console.log('COMPARISON: H1 Trend + M5 Pullback vs Previous Forex Tests');
  console.log('===================================================================\n');
  console.log('                    | H1+M5 (45 pip SL) | Best Previous (TP1 min 8)');
  console.log('  ------------------+--------------------+--------------------------');
  console.log(`  Full period WR    | ${fullStats.winRate.toFixed(1).padStart(5)}%         | 77.0%`);
  console.log(`  Full period avgR  | ${fullStats.avgR.toFixed(3).padStart(7)}         | -0.004`);
  console.log(`  Full period PF    | ${fullStats.profitFactor.toFixed(2).padStart(6)}           | 0.98`);
  console.log(`  In-sample WR      | ${inStats.winRate.toFixed(1).padStart(5)}%         | 76.6%`);
  console.log(`  In-sample avgR    | ${inStats.avgR.toFixed(3).padStart(7)}         | -0.046`);
  console.log(`  Out-of-sample WR  | ${outStats.winRate.toFixed(1).padStart(5)}%         | 65.5%`);
  console.log(`  Out-of-sample avgR| ${outStats.avgR.toFixed(3).padStart(7)}         | +0.004`);

  // Verdict
  console.log('\n=== VERDICT ===\n');
  const passes = outStats.avgR > 0 && outStats.winRate > 35 && outStats.profitFactor > 1.0;

  if (passes) {
    console.log('✅ H1 trend + M5 pullback PASSES walk-forward validation!');
    console.log(`   Out-of-sample avgR: ${outStats.avgR.toFixed(3)}, WR: ${outStats.winRate.toFixed(1)}%, PF: ${outStats.profitFactor.toFixed(2)}`);
    console.log('   The wider SL (45 pips) + H1 trend filter works for forex!');
    console.log('   Recommendation: WORTH TESTING FOR DEPLOYMENT.');
  } else {
    console.log('❌ H1 trend + M5 pullback FAILS walk-forward validation.');
    console.log(`   Out-of-sample avgR: ${outStats.avgR.toFixed(3)}, WR: ${outStats.winRate.toFixed(1)}%, PF: ${outStats.profitFactor.toFixed(2)}`);
    console.log('   Even with wider SL and H1 trend filter, forex is not profitable.');
  }

  fs.default.writeFileSync('h1-trend-m5-pullback-results.json', JSON.stringify({
    splitTime: new Date(splitTime).toISOString(),
    totalSignals,
    fullPeriod: fullStats,
    inSample: inStats,
    outOfSample: outStats,
    exitBreakdown: {
      trailExits: trailExits.length,
      slHits: slHits.length,
      openTrades: openTrades.length,
    }
  }, null, 0));
  console.log('\nSaved to h1-trend-m5-pullback-results.json');
}

main().catch(e => { console.error(e); process.exit(1); });
