import type { Candle } from './src/types.js';
import { scanTrendBreakoutSignals, buildContext } from './server/engine-trend-breakout.js';

interface Trade {
  pair: string;
  direction: 'LONG' | 'SHORT';
  entry: number;
  sl: number;
  entryTime: string;
  exitTime?: string;
  exitPrice?: number;
  exitReason?: 'TRAIL_EMA' | 'SL' | 'OPEN';
  pips?: number;
  r?: number;
  result?: 'WIN' | 'LOSS' | 'OPEN';
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

/**
 * Trend-following exit simulation: unlike the mean-reversion engine's fixed
 * TP1/TP2/TP3 ladder, this engine lets winners run and exits when price
 * closes back through the trailing EMA against the trade direction, or when
 * the initial hard SL is hit - whichever comes first. R-multiple = realized
 * pips / initial risk (entry-to-SL distance in pips).
 */
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

  const maxLookahead = Math.min(candleIndex + 2001, candles.length); // cap horizon so a stuck trend doesn't run forever
  for (let i = candleIndex + 1; i < maxLookahead; i++) {
    const c = candles[i];

    // Hard SL first (intrabar)
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

    // Trailing EMA exit - only allowed once price has moved at least 1R in
    // favor, so the trade isn't stopped out by the trail before it has even
    // confirmed the breakout (gives the trend room to establish itself).
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

function runTrendBreakoutVariant(pair: string, m5: Candle[], metalsSessionFilter?: boolean): Trade[] {
  const trades: Trade[] = [];
  const signals = scanTrendBreakoutSignals(pair, m5, { metalsSessionFilter });
  if (signals.length === 0) return trades;

  const ctx = buildContext(m5); // built once, reused for every signal's trailing-exit lookup

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

function analyze(label: string, trades: Trade[]) {
  const closed = trades.filter(t => t.result !== 'OPEN');
  const wins = closed.filter(t => t.result === 'WIN');
  const winRate = closed.length ? (wins.length / closed.length) * 100 : 0;
  const totalR = closed.reduce((s, t) => s + (t.r || 0), 0);
  const avgR = closed.length ? totalR / closed.length : 0;

  let running = 0, peak = 0, maxDD = 0;
  for (const t of closed) {
    running += (t.r || 0);
    if (running > peak) peak = running;
    const dd = peak - running;
    if (dd > maxDD) maxDD = dd;
  }
  const totalPips = closed.reduce((s, t) => s + (t.pips || 0), 0);

  console.log(`\n--- ${label} ---`);
  console.log(`Signals: ${trades.length} | Closed: ${closed.length} | Open: ${trades.length - closed.length}`);
  console.log(`Win rate: ${winRate.toFixed(1)}%  |  Avg R/trade: ${avgR.toFixed(3)}  |  Max DD (R): ${maxDD.toFixed(2)}`);
  console.log(`Total pips (informational only, not comparable across pairs): ${totalPips.toFixed(1)}`);

  return { label, signals: trades.length, closed: closed.length, winRate, avgR, maxDD, totalPips };
}

async function main() {
  const CRYPTO_PAIRS = ['BTCUSD', 'ETHUSD', 'SOLUSD', 'XRPUSD', 'BNBUSD', 'ADAUSD', 'LTCUSD', 'DOGEUSD'];
  const METALS_PAIRS = ['XAUUSD', 'XAGUSD'];

  console.log('\n=========================================================');
  console.log('TREND-FOLLOWING / BREAKOUT ENGINE - ISOLATED BACKTEST');
  console.log('(server/engine-trend-breakout.ts - separate from mean-reversion)');
  console.log('=========================================================');

  const perSymbol: Record<string, ReturnType<typeof analyze>> = {};
  const allCryptoTrades: Trade[] = [];
  const allMetalsTradesWithSession: Trade[] = [];
  const allMetalsTradesNoSession: Trade[] = [];

  console.log('\n### CRYPTO (no session filter, 24/7) ###');
  for (const pair of CRYPTO_PAIRS) {
    const m5 = loadCache(pair, '5min', 6);
    if (!m5 || m5.length < 250) { console.warn(`SKIP ${pair}: no/short cache (need >=250 bars for EMA200)`); continue; }
    const trades = runTrendBreakoutVariant(pair, m5);
    allCryptoTrades.push(...trades);
    perSymbol[pair] = analyze(pair, trades);
  }

  console.log('\n### METALS - WITH session filter (07:00-21:00 UTC) ###');
  const perSymbolMetalsSession: Record<string, ReturnType<typeof analyze>> = {};
  for (const pair of METALS_PAIRS) {
    const m5 = loadCache(pair, '5min', 6);
    if (!m5 || m5.length < 250) { console.warn(`SKIP ${pair}: no/short cache`); continue; }
    const trades = runTrendBreakoutVariant(pair, m5, true);
    allMetalsTradesWithSession.push(...trades);
    perSymbolMetalsSession[pair] = analyze(`${pair} (session filter ON)`, trades);
  }

  console.log('\n### METALS - WITHOUT session filter (24h) ###');
  const perSymbolMetalsNoSession: Record<string, ReturnType<typeof analyze>> = {};
  for (const pair of METALS_PAIRS) {
    const m5 = loadCache(pair, '5min', 6);
    if (!m5 || m5.length < 250) { console.warn(`SKIP ${pair}: no/short cache`); continue; }
    const trades = runTrendBreakoutVariant(pair, m5, false);
    allMetalsTradesNoSession.push(...trades);
    perSymbolMetalsNoSession[pair] = analyze(`${pair} (session filter OFF)`, trades);
  }

  console.log('\n\n========================= SUMMARY =========================');
  const cryptoTotal = analyze('CRYPTO - ALL 8 PAIRS COMBINED', allCryptoTrades);
  const metalsSessionTotal = analyze('METALS - ALL PAIRS COMBINED (session filter ON)', allMetalsTradesWithSession);
  const metalsNoSessionTotal = analyze('METALS - ALL PAIRS COMBINED (session filter OFF)', allMetalsTradesNoSession);

  // Step-3 diagnostic (crypto-only backtest-script change, does not affect
  // the engine or any other pair's trades): re-combine excluding the
  // confirmed worst per-coin performers (BTCUSD 0%WR/-1.000R, BNBUSD
  // 25-33%WR/-0.3R, XRPUSD 0%WR/-0.125R) to show, transparently, what the
  // combined crypto trend-breakout stats look like without them dragging
  // the average down.
  const EXCLUDED_WORST_PAIRS = new Set(['BTCUSD', 'BNBUSD', 'XRPUSD']);
  const curatedCryptoTrades = allCryptoTrades.filter(t => !EXCLUDED_WORST_PAIRS.has(t.pair));
  const cryptoCuratedTotal = analyze('CRYPTO - CURATED (excl. BTCUSD/BNBUSD/XRPUSD)', curatedCryptoTrades);

  fs.default.writeFileSync('backtest-trend-breakout-results.json', JSON.stringify({
    perSymbolCrypto: perSymbol,
    perSymbolMetalsSession,
    perSymbolMetalsNoSession,
    cryptoTotal,
    cryptoCuratedTotal,
    metalsSessionTotal,
    metalsNoSessionTotal,
    cryptoTrades: allCryptoTrades,
    metalsTradesWithSession: allMetalsTradesWithSession,
    metalsTradesNoSession: allMetalsTradesNoSession,
  }, null, 0));
  console.log('\nSaved to backtest-trend-breakout-results.json');
}

main().catch(e => { console.error(e); process.exit(1); });
