import type { Candle } from '../src/types.js';
import { scanMeanReversionSignals } from './engine-mean-reversion.js';

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

// ---------------------------------------------------------------------------
// CRYPTO-ONLY variant (backtest script change, not touching metals/forex).
//
// BUG FIX: the shared runMeanReversionVariant() above only simulates 100
// candles ahead (sig.candleIndex + 101). On M5 candles that's under 8.5
// hours - too short a horizon for crypto's noisier moves to resolve, so
// ~47% of crypto signals were getting stuck "OPEN" and biasing the sample
// (metals continues to use the original 100-candle horizon above, unchanged,
// since that path is out of scope here). This crypto-only copy extends the
// lookahead to CRYPTO_LOOKAHEAD_CANDLES candles (~2.6 days on M5) so trades
// actually resolve before being reported as OPEN.
// ---------------------------------------------------------------------------
const CRYPTO_LOOKAHEAD_CANDLES = 750; // ~2.6 days on M5 candles

function runMeanReversionVariantCrypto(pair: string, m5: Candle[]): Trade[] {
  const trades: Trade[] = [];
  const signals = scanMeanReversionSignals(pair, m5);

  for (const sig of signals) {
    const future = m5.slice(sig.candleIndex + 1, Math.min(sig.candleIndex + 1 + CRYPTO_LOOKAHEAD_CANDLES, m5.length));
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

function riskUnits(t: Trade): number {
  const pip = getPipMultiplier(t.pair);
  const risk = Math.abs(t.entry - t.sl) / pip;
  return risk;
}

function analyze(label: string, trades: Trade[]) {
  const closed = trades.filter(t => t.result !== 'OPEN');
  const wins = closed.filter(t => t.result?.startsWith('WIN'));
  const winRate = closed.length ? (wins.length / closed.length) * 100 : 0;
  const totalPips = closed.reduce((s, t) => s + (t.pips || 0), 0);

  let totalR = 0;
  let peak = 0, trough = 0, running = 0, maxDD = 0;
  for (const t of closed) {
    const risk = riskUnits(t);
    const r = risk > 0 ? (t.pips || 0) / risk : 0;
    totalR += r;
    running += (t.pips || 0);
    if (running > peak) peak = running;
    const dd = peak - running;
    if (dd > maxDD) maxDD = dd;
  }
  const avgR = closed.length ? totalR / closed.length : 0;

  console.log(`\n=== ${label} ===`);
  console.log(`Total signals: ${trades.length} | Closed: ${closed.length} | Open: ${trades.length - closed.length}`);
  console.log(`Win rate (closed): ${winRate.toFixed(1)}%`);
  console.log(`Avg R/trade: ${avgR.toFixed(3)}`);
  console.log(`Max drawdown (informational, raw units): ${maxDD.toFixed(1)}`);
  console.log(`Total pips (informational only, units not comparable across pairs): ${totalPips.toFixed(1)}`);

  return { label, closed: closed.length, winRate, avgR, maxDD, totalPips };
}

async function main() {
  const CRYPTO_PAIRS = ['BTCUSD', 'ETHUSD', 'SOLUSD', 'XRPUSD', 'BNBUSD', 'ADAUSD', 'LTCUSD', 'DOGEUSD'];
  const METALS_PAIRS = ['XAUUSD', 'XAGUSD'];

  console.log('\n=========================================================');
  console.log('CRYPTO + METALS ISOLATED BACKTEST (post-fix engine)');
  console.log('=========================================================');

  const cryptoTrades: Trade[] = [];
  const perSymbolCrypto: Record<string, ReturnType<typeof analyze>> = {};
  for (const pair of CRYPTO_PAIRS) {
    const m5 = loadCache(pair, '5min', 6);
    if (!m5 || m5.length < 60) { console.warn(`SKIP ${pair}: no/short cache`); continue; }
    const trades = runMeanReversionVariantCrypto(pair, m5); // crypto-only: uses extended lookahead horizon
    cryptoTrades.push(...trades);
    console.log(`${pair}: candles=${m5.length} signals=${trades.length}`);
    perSymbolCrypto[pair] = analyze(`CRYPTO ${pair}`, trades);
  }

  const metalsTrades: Trade[] = [];
  for (const pair of METALS_PAIRS) {
    const m5 = loadCache(pair, '5min', 6);
    if (!m5 || m5.length < 60) { console.warn(`SKIP ${pair}: no/short cache`); continue; }
    const trades = runMeanReversionVariant(pair, m5);
    metalsTrades.push(...trades);
    console.log(`${pair}: candles=${m5.length} signals=${trades.length}`);
  }

  const cryptoStats = analyze('CRYPTO (after fix)', cryptoTrades);
  const metalsStats = analyze('METALS (after fix)', metalsTrades);

  fs.default.writeFileSync('backtest-crypto-metals-after.json', JSON.stringify({ cryptoStats, metalsStats, cryptoTrades, metalsTrades }, null, 0));
  console.log('\nSaved to backtest-crypto-metals-after.json');
}

main().catch(e => { console.error(e); process.exit(1); });
