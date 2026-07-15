import type { Candle } from '../src/types.js';
import { detectSignalV2 } from './engine2.js';
import { detectLiquiditySweepSignal } from './engine-liquidity-sweep.js';
import { detectAMDSignal } from './engine-amd.js';
import { scanCCISignals } from './engine-cci.js';
import { scanEMAMomentumSignals } from './engine-ema-momentum.js';
import { scanM5Trend200Signals } from './engine-m5trend200.js';
import { scanMeanReversionSignals } from './engine-mean-reversion.js';

const PAIRS = [
  'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'USDCAD',
  'AUDUSD', 'NZDUSD', 'EURGBP', 'EURJPY', 'GBPJPY',
  'AUDJPY', 'CADJPY', 'CHFJPY', 'NZDJPY', 'EURAUD',
  'XAUUSD', 'XAGUSD', 'BTCUSD',
  'ETHUSD', 'SOLUSD', 'XRPUSD', 'BNBUSD', 'ADAUSD',
  'LTCUSD', 'DOGEUSD'
];

const MONTHS = 6;

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
  exitReason?: 'TP1' | 'TP2' | 'TP3' | 'SL' | 'OPEN';
  pips?: number;
  result?: 'WIN_TP1' | 'WIN_TP2' | 'WIN_TP3' | 'LOSS' | 'OPEN';
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

// TwelveData cache timestamps are space-separated with no timezone marker
// (e.g. "2026-07-03 23:00:00"). Node's Date parser treats that as LOCAL
// time, not UTC, causing session/hour filters to shift by the machine's
// timezone offset. Normalize to explicit UTC ISO format on load.
function normalizeTimestamp(ts: string): string {
  if (ts.includes('T') || ts.endsWith('Z')) return ts;
  return ts.replace(' ', 'T') + 'Z';
}

function loadCache(pair: string, interval: string, months: number): Candle[] | null {
  const f = cacheKey(pair, interval, months);
  if (fs.default.existsSync(f)) {
    const raw: Candle[] = JSON.parse(fs.default.readFileSync(f, 'utf-8'));
    const normalized = raw.map(c => ({ ...c, timestamp: normalizeTimestamp(c.timestamp) }));
    // TwelveData returns candles newest-first (descending). All backtest logic
    // below assumes oldest-first (ascending) order — e.g. m5Candles[len-1] is
    // treated as "current" and m5.slice(i+1, i+101) as "future" candles for
    // TP/SL simulation. Sort ascending so that assumption actually holds.
    normalized.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    return normalized;
  }
  return null;
}

function simulate(trade: Trade, future: Candle[], pair: string): Trade {
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
        r.result = bestTp ? ('WIN_' + bestTp as any) : 'LOSS';
        const exitAt = bestTp ? trade[bestTp === 'TP1' ? 'tp1' : bestTp === 'TP2' ? 'tp2' : 'tp3'] : trade.sl;
        r.pips = (exitAt - trade.entry) / pip;
        return r;
      }
      if (c.high >= trade.tp3) bestTp = 'TP3';
      else if (c.high >= trade.tp2) bestTp = 'TP2';
      else if (c.high >= trade.tp1) bestTp = 'TP1';
    } else {
      if (c.high >= trade.sl) {
        r.exitPrice = trade.sl;
        r.exitTime = c.timestamp;
        r.exitReason = 'SL';
        r.result = bestTp ? ('WIN_' + bestTp as any) : 'LOSS';
        const exitAt = bestTp ? trade[bestTp === 'TP1' ? 'tp1' : bestTp === 'TP2' ? 'tp2' : 'tp3'] : trade.sl;
        r.pips = (trade.entry - exitAt) / pip;
        return r;
      }
      if (c.low <= trade.tp3) bestTp = 'TP3';
      else if (c.low <= trade.tp2) bestTp = 'TP2';
      else if (c.low <= trade.tp1) bestTp = 'TP1';
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

function runVariant(
  pair: string,
  h4: Candle[],
  m5: Candle[],
  requireConfirmation: boolean,
  slBoost: number = 1.0,
  requireTrendStrength: boolean = false
): Trade[] {
  const trades: Trade[] = [];
  let lastTs = 0;

  for (let i = 50; i < m5.length - 50; i++) {
    if (i % 3 !== 0) continue;
    const ts = new Date(m5[i].timestamp).getTime();
    if (ts - lastTs < 4 * 3600000) continue;

    const sig = detectSignalV2(pair, h4, m5.slice(0, i + 1), requireConfirmation, slBoost, requireTrendStrength);
    if (!sig) continue;

    const future = m5.slice(i + 1, Math.min(i + 101, m5.length));
    if (future.length === 0) continue;

    const completed = simulate({
      pair, direction: sig.direction,
      entry: sig.entry, sl: sig.sl,
      tp1: sig.tp1, tp2: sig.tp2, tp3: sig.tp3,
      entryTime: m5[i].timestamp,
      confidence: sig.confidence
    }, future, pair);

    trades.push(completed);
    lastTs = ts;
  }

  return trades;
}

function summarize(label: string, trades: Trade[]) {
  const closed = trades.filter(t => t.exitReason !== 'OPEN');
  const wins = closed.filter(t => t.result !== 'LOSS' && t.result !== 'OPEN');
  const losses = closed.filter(t => t.result === 'LOSS');
  const tp1w = closed.filter(t => t.result === 'WIN_TP1');
  const tp2w = closed.filter(t => t.result === 'WIN_TP2');
  const tp3w = closed.filter(t => t.result === 'WIN_TP3');

  const wr = closed.length > 0 ? wins.length / closed.length * 100 : 0;
  const winPips = wins.reduce((s, t) => s + (t.pips || 0), 0);
  const lossPips = Math.abs(losses.reduce((s, t) => s + (t.pips || 0), 0));
  const avgW = wins.length > 0 ? winPips / wins.length : 0;
  const avgL = losses.length > 0 ? lossPips / losses.length : 0;
  const totalPips = trades.reduce((s, t) => s + (t.pips || 0), 0);

  let maxDD = 0, peak = 0, run = 0;
  for (const t of closed) {
    run += t.pips || 0;
    if (run > peak) peak = run;
    const dd = peak - run;
    if (dd > maxDD) maxDD = dd;
  }

  console.log(`\n--- ${label} ---`);
  console.log(`Total signals: ${trades.length}`);
  console.log(`Closed trades: ${closed.length}`);
  console.log(`Win rate: ${wr.toFixed(1)}%`);
  console.log(`  TP1: ${tp1w.length} (${closed.length > 0 ? (tp1w.length / closed.length * 100).toFixed(1) : 0}%)`);
  console.log(`  TP2: ${tp2w.length} (${closed.length > 0 ? (tp2w.length / closed.length * 100).toFixed(1) : 0}%)`);
  console.log(`  TP3: ${tp3w.length} (${closed.length > 0 ? (tp3w.length / closed.length * 100).toFixed(1) : 0}%)`);
  console.log(`Losses: ${losses.length}`);
  console.log(`Avg win: ${avgW.toFixed(2)} pips`);
  console.log(`Avg loss: ${avgL.toFixed(2)} pips`);
  console.log(`Total pips: ${totalPips.toFixed(2)}`);
  console.log(`Max drawdown: ${maxDD.toFixed(2)} pips`);

  return {
    totalSignals: trades.length,
    closedTrades: closed.length,
    winRate: wr.toFixed(1) + '%',
    tp1: tp1w.length,
    tp2: tp2w.length,
    tp3: tp3w.length,
    losses: losses.length,
    avgWin: avgW.toFixed(2),
    avgLoss: avgL.toFixed(2),
    totalPips: totalPips.toFixed(2),
    maxDD: maxDD.toFixed(2)
  };
}

function runLiquiditySweepVariant(pair: string, h4: Candle[], m5: Candle[]): Trade[] {
  const trades: Trade[] = [];
  let lastTs = 0;

  for (let i = 210; i < m5.length - 50; i++) {
    const ts = new Date(m5[i].timestamp).getTime();
    if (ts - lastTs < 3600000) continue; // min 1hr gap between sweep signals

    const sig = detectLiquiditySweepSignal(pair, h4, m5.slice(0, i + 1));
    if (!sig) continue;

    const future = m5.slice(i + 1, Math.min(i + 101, m5.length));
    if (future.length === 0) continue;

    const completed = simulate({
      pair, direction: sig.direction,
      entry: sig.entry, sl: sig.sl,
      tp1: sig.tp1, tp2: sig.tp2, tp3: sig.tp3,
      entryTime: m5[i].timestamp,
      confidence: sig.confidence
    }, future, pair);

    trades.push(completed);
    lastTs = ts;
  }

  return trades;
}

function runAMDVariant(pair: string, h4: Candle[], m5: Candle[]): Trade[] {
  const trades: Trade[] = [];
  let lastTs = 0;

  for (let i = 210; i < m5.length - 50; i++) {
    const ts = new Date(m5[i].timestamp).getTime();
    if (ts - lastTs < 3600000) continue; // min 1hr gap between AMD signals

    const sig = detectAMDSignal(pair, h4, m5.slice(0, i + 1));
    if (!sig) continue;

    const future = m5.slice(i + 1, Math.min(i + 101, m5.length));
    if (future.length === 0) continue;

    const completed = simulate({
      pair, direction: sig.direction,
      entry: sig.entry, sl: sig.sl,
      tp1: sig.tp1, tp2: sig.tp2, tp3: sig.tp3,
      entryTime: m5[i].timestamp,
      confidence: sig.confidence
    }, future, pair);

    trades.push(completed);
    lastTs = ts;
  }

  return trades;
}

function runCCIVariant(pair: string, m5: Candle[]): Trade[] {
  const trades: Trade[] = [];
  const signals = scanCCISignals(pair, m5);

  for (const sig of signals) {
    const future = m5.slice(sig.candleIndex + 1, Math.min(sig.candleIndex + 101, m5.length));
    if (future.length === 0) continue;

    const completed = simulate({
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

function runEMAMomentumVariant(pair: string, m5: Candle[]): Trade[] {
  const trades: Trade[] = [];
  const signals = scanEMAMomentumSignals(pair, m5);

  for (const sig of signals) {
    const future = m5.slice(sig.candleIndex + 1, Math.min(sig.candleIndex + 101, m5.length));
    if (future.length === 0) continue;

    const completed = simulate({
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

function runM5Trend200Variant(pair: string, m5: Candle[]): Trade[] {
  const trades: Trade[] = [];
  const signals = scanM5Trend200Signals(pair, m5);

  for (const sig of signals) {
    const future = m5.slice(sig.candleIndex + 1, Math.min(sig.candleIndex + 101, m5.length));
    if (future.length === 0) continue;

    const completed = simulate({
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

function runMeanReversionVariant(pair: string, m5: Candle[]): Trade[] {
  const trades: Trade[] = [];
  const signals = scanMeanReversionSignals(pair, m5);

  for (const sig of signals) {
    const future = m5.slice(sig.candleIndex + 1, Math.min(sig.candleIndex + 101, m5.length));
    if (future.length === 0) continue;

    const completed = simulate({
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

async function main() {
  console.log('\n====================================');
  console.log('[BACKTEST] Strategy Variant Comparison');
  console.log('Data: cached TwelveData 6 months M5+H4');
  console.log('====================================\n');

  const t0 = Date.now();
  const variants: Record<string, Trade[]> = {
    baseline: [],
    confirmed: [],
    widerSL: [],
    trendStrength: [],
    combined: [],
    liquiditySweep: [],
    amd: [],
    cci: [],
    emaMomentum: [],
    m5trend200: [],
    meanReversion: []
  };
  let pairsUsed = 0;

  for (const pair of PAIRS) {
    const h4 = loadCache(pair, '4h', MONTHS);
    const m5 = loadCache(pair, '5min', MONTHS);

    if (!h4 || !m5) { console.warn(`--- ${pair}: SKIP (no cache) ---`); continue; }
    if (h4.length < 30 || m5.length < 50) { console.warn(`--- ${pair}: SKIP (too few) ---`); continue; }

    pairsUsed++;
    const baseline = runVariant(pair, h4, m5, false, 1.0, false);
    const confirmed = runVariant(pair, h4, m5, true, 1.0, false);
    const widerSL = runVariant(pair, h4, m5, false, 1.5, false);
    const trendStrength = runVariant(pair, h4, m5, false, 1.0, true);
    const combined = runVariant(pair, h4, m5, false, 1.5, true);
    const liquiditySweep = h4.length >= 210 ? runLiquiditySweepVariant(pair, h4, m5) : [];
    const amd = h4.length >= 210 ? runAMDVariant(pair, h4, m5) : [];
    const cci = m5.length >= 320 ? runCCIVariant(pair, m5) : [];
    const emaMomentum = m5.length >= 260 ? runEMAMomentumVariant(pair, m5) : [];
    const m5trend200 = m5.length >= 220 ? runM5Trend200Variant(pair, m5) : [];
    const meanReversion = m5.length >= 60 ? runMeanReversionVariant(pair, m5) : [];

    variants.baseline.push(...baseline);
    variants.confirmed.push(...confirmed);
    variants.widerSL.push(...widerSL);
    variants.trendStrength.push(...trendStrength);
    variants.combined.push(...combined);
    variants.liquiditySweep.push(...liquiditySweep);
    variants.amd.push(...amd);
    variants.cci.push(...cci);
    variants.emaMomentum.push(...emaMomentum);
    variants.m5trend200.push(...m5trend200);
    variants.meanReversion.push(...meanReversion);

    console.log(`--- ${pair} --- base:${baseline.length} conf:${confirmed.length} wideSL:${widerSL.length} trend:${trendStrength.length} combo:${combined.length} sweep:${liquiditySweep.length} amd:${amd.length} cci:${cci.length} emaMom:${emaMomentum.length} m5t200:${m5trend200.length} meanRev:${meanReversion.length}`);
  }

  console.log(`\nPairs used: ${pairsUsed}/${PAIRS.length}`);

  console.log('\n====================================');
  console.log('COMPARISON SUMMARY');
  console.log('====================================');

  const summaries: Record<string, any> = {};
  summaries.baseline = summarize('BASELINE (current live strategy)', variants.baseline);
  summaries.confirmed = summarize('CONFIRMED (wait for rejection candle)', variants.confirmed);
  summaries.widerSL = summarize('WIDER SL (1.5x ATR boost)', variants.widerSL);
  summaries.trendStrength = summarize('TREND STRENGTH FILTER (H4 slope > 0.3 ATR)', variants.trendStrength);
  summaries.combined = summarize('COMBINED (wider SL + trend strength)', variants.combined);
  summaries.liquiditySweep = summarize('LIQUIDITY SWEEP (new strategy: sweep + trend continuation)', variants.liquiditySweep);
  summaries.amd = summarize('AMD (Asian range accumulation + London/NY sweep + distribution)', variants.amd);
  summaries.cci = summarize('CCI (M5-only: 200-EMA + CCI14/25/50 trend align + EMA110 retracement entry)', variants.cci);
  summaries.emaMomentum = summarize('EMA200+EMA110 Momentum (M5, RSI confirm, volume check skipped - no real data)', variants.emaMomentum);
  summaries.m5trend200 = summarize('M5 TREND200 (M5-only: EMA200 trend + EMA110 pullback + RSI 75/25 filter)', variants.m5trend200);
  summaries.meanReversion = summarize('MEAN REVERSION SCALP (Bollinger 20/2std extreme + RSI 70/30 + rejection candle, tight 1R target)', variants.meanReversion);

  console.log('\n====================================');
  console.log(`Complete in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  console.log('====================================\n');

  fs.default.writeFileSync('backtest-confirm-compare-results.json', JSON.stringify({
    summaries,
    variants
  }, null, 2));

  console.log('Saved: backtest-confirm-compare-results.json');
}

main().catch(e => { console.error(e); process.exit(1); });
