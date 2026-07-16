import type { Candle } from '../src/types.js';
import {
  buildContext,
  evaluateBreakout,
  METALS_ATR_SL_BUFFER,
  MIN_SIGNAL_GAP_MS,
  TRAIL_EMA_PERIOD,
} from './engine-trend-breakout.js';

// ---------------------------------------------------------------------------
// FINAL "ALL PAIRS" BACKTEST
// Uses the PROVEN metals trend-breakout entry (evaluateBreakout) + the REAL
// trailing-EMA20 exit (a close back through EMA20 against the trade closes it)
// + a hard ATR SL as safety. Real per-pair costs applied to every trade.
// Runs on every pair that has real 6-month M5 data. One honest ranked list.
// ---------------------------------------------------------------------------

const fs = await import('fs');
const path = await import('path');
const CACHE = path.default.join(process.cwd(), '.cache');

function pipMult(pair: string): number {
  if (pair === 'XAUUSD') return 0.1;
  if (pair === 'XAGUSD') return 0.01;
  if (pair.includes('JPY')) return 0.01;
  if (['BTCUSD','ETHUSD','SOLUSD','BNBUSD','LTCUSD','ADAUSD','XRPUSD','DOGEUSD'].includes(pair)) return 1;
  return 0.0001;
}

// Realistic round-trip cost in PIPS (Pepperstone RAW spreads + commission).
// Crypto is handled as a % of price (see costPrice) since pip=1 there.
function costPips(pair: string): number {
  const map: Record<string, number> = {
    EURUSD: 1.0, GBPUSD: 1.2, USDJPY: 1.0, USDCHF: 1.5, USDCAD: 1.5,
    AUDUSD: 1.2, NZDUSD: 1.6, EURGBP: 1.5, EURJPY: 1.5, GBPJPY: 2.0,
    AUDJPY: 1.8, CADJPY: 2.0, CHFJPY: 2.3, NZDJPY: 2.3, EURAUD: 2.0,
    AUDNZD: 2.3, EURNZD: 2.3, GBPAUD: 2.3, GBPNZD: 2.3,
    XAUUSD: 25.7, XAGUSD: 3.7,
  };
  return map[pair] ?? 2.0;
}

function costPrice(pair: string, entry: number): number {
  if (['BTCUSD','ETHUSD','SOLUSD','BNBUSD','LTCUSD','ADAUSD','XRPUSD','DOGEUSD'].includes(pair)) {
    return entry * 0.0006; // ~0.06% round-trip for crypto
  }
  return costPips(pair) * pipMult(pair);
}

function normalizeTimestamp(ts: string): string {
  if (ts.includes('T') || ts.endsWith('Z')) return ts;
  return ts.replace(' ', 'T') + 'Z';
}

function loadM5(pair: string): Candle[] | null {
  const f = path.default.join(CACHE, `${pair}_5min_6m.json`);
  if (!fs.default.existsSync(f)) return null;
  const raw: Candle[] = JSON.parse(fs.default.readFileSync(f, 'utf-8'));
  if (!Array.isArray(raw) || raw.length < 60) return null;
  const norm = raw.map(c => ({ ...c, timestamp: normalizeTimestamp(c.timestamp) }));
  const seen = new Set<string>();
  const dedup = norm.filter(c => { if (seen.has(c.timestamp)) return false; seen.add(c.timestamp); return true; });
  dedup.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  return dedup;
}

interface Trade { pair: string; dir: 'LONG'|'SHORT'; entry: number; sl: number; entryIdx: number; exitIdx?: number; r: number; result: 'WIN'|'LOSS'; }

const LOOKAHEAD = 2000; // M5 candles (~7 days) - plenty for trailing exit to resolve

// Scan every pair with the metals breakout entry (works for any asset class).
function scanAll(pair: string, m5: Candle[]) {
  const ctx = buildContext(m5);
  const pm = pipMult(pair);
  const sigs: ReturnType<typeof evaluateBreakout>[] = [];
  let lastTs = 0;
  for (let i = 250; i < m5.length; i++) {
    const ts = new Date(m5[i].timestamp).getTime();
    if (ts - lastTs < MIN_SIGNAL_GAP_MS) continue;
    const s = evaluateBreakout(pair, m5, ctx, i, pm, METALS_ATR_SL_BUFFER, 'ALL');
    if (s) { sigs.push(s); lastTs = ts; }
  }
  return { ctx, sigs };
}

function simTrailing(pair: string, m5: Candle[], ctx: ReturnType<typeof buildContext>, sig: any): Trade | null {
  const isLong = sig.direction === 'LONG';
  const riskPrice = Math.abs(sig.entry - sig.sl);
  if (riskPrice <= 0) return null;
  const cost = costPrice(pair, sig.entry);
  const end = Math.min(sig.candleIndex + 1 + LOOKAHEAD, m5.length);

  for (let i = sig.candleIndex + 1; i < end; i++) {
    const c = m5[i];
    // hard SL first
    if (isLong && c.low <= sig.sl) {
      const gross = sig.sl - sig.entry;
      return { pair, dir: sig.direction, entry: sig.entry, sl: sig.sl, entryIdx: sig.candleIndex, exitIdx: i, r: (gross - cost) / riskPrice, result: 'LOSS' };
    }
    if (!isLong && c.high >= sig.sl) {
      const gross = sig.entry - sig.sl;
      return { pair, dir: sig.direction, entry: sig.entry, sl: sig.sl, entryIdx: sig.candleIndex, exitIdx: i, r: (gross - cost) / riskPrice, result: 'LOSS' };
    }
    // trailing exit: close back through EMA20 against the trade
    const tema = ctx.trailEmaAt(i);
    if (tema !== undefined) {
      if (isLong && c.close < tema) {
        const gross = c.close - sig.entry;
        return { pair, dir: sig.direction, entry: sig.entry, sl: sig.sl, entryIdx: sig.candleIndex, exitIdx: i, r: (gross - cost) / riskPrice, result: (gross - cost) > 0 ? 'WIN' : 'LOSS' };
      }
      if (!isLong && c.close > tema) {
        const gross = sig.entry - c.close;
        return { pair, dir: sig.direction, entry: sig.entry, sl: sig.sl, entryIdx: sig.candleIndex, exitIdx: i, r: (gross - cost) / riskPrice, result: (gross - cost) > 0 ? 'WIN' : 'LOSS' };
      }
    }
  }
  // still open at horizon end -> close at last close
  const last = m5[end - 1];
  const gross = isLong ? last.close - sig.entry : sig.entry - last.close;
  return { pair, dir: sig.direction, entry: sig.entry, sl: sig.sl, entryIdx: sig.candleIndex, exitIdx: end - 1, r: (gross - cost) / riskPrice, result: (gross - cost) > 0 ? 'WIN' : 'LOSS' };
}

function stats(trades: Trade[]) {
  const n = trades.length;
  const wins = trades.filter(t => t.result === 'WIN');
  const wr = n ? wins.length / n * 100 : 0;
  const totalR = trades.reduce((s, t) => s + t.r, 0);
  const avgR = n ? totalR / n : 0;
  const grossWin = trades.filter(t => t.r > 0).reduce((s, t) => s + t.r, 0);
  const grossLoss = Math.abs(trades.filter(t => t.r < 0).reduce((s, t) => s + t.r, 0));
  const pf = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : 0);
  // max drawdown in R (equity curve)
  let peak = 0, eq = 0, maxDD = 0;
  for (const t of trades) { eq += t.r; if (eq > peak) peak = eq; const dd = peak - eq; if (dd > maxDD) maxDD = dd; }
  return { n, wr, avgR, pf, maxDD, totalR };
}

// Walk-forward split by trade index (chronological)
function splitInOut(trades: Trade[]) {
  const sorted = [...trades].sort((a, b) => a.entryIdx - b.entryIdx);
  const cut = Math.floor(sorted.length * (4 / 6)); // months 1-4 vs 5-6
  return { inS: sorted.slice(0, cut), outS: sorted.slice(cut) };
}

const ALL_PAIRS = [
  // metals
  'XAUUSD','XAGUSD',
  // crypto
  'BTCUSD','ETHUSD','SOLUSD','BNBUSD','LTCUSD','ADAUSD','XRPUSD','DOGEUSD',
  // forex majors/crosses (with data)
  'EURUSD','GBPUSD','USDJPY','USDCHF','USDCAD','AUDUSD','NZDUSD',
  'EURGBP','EURJPY','GBPJPY','AUDJPY','CADJPY','CHFJPY','NZDJPY','AUDNZD',
];

function cls(pair: string): string {
  if (['XAUUSD','XAGUSD'].includes(pair)) return 'METALS';
  if (['BTCUSD','ETHUSD','SOLUSD','BNBUSD','LTCUSD','ADAUSD','XRPUSD','DOGEUSD'].includes(pair)) return 'CRYPTO';
  return 'FOREX';
}

async function main() {
  console.log('\n==================================================================');
  console.log(' FINAL ALL-PAIRS BACKTEST  (Trend-Breakout entry + EMA20 trail exit)');
  console.log(' Real costs applied to every trade. 6-month M5 data.');
  console.log('==================================================================\n');

  const rows: any[] = [];
  for (const pair of ALL_PAIRS) {
    const m5 = loadM5(pair);
    if (!m5) { console.log(`SKIP ${pair.padEnd(7)} - no data`); continue; }
    if (m5.length < 4000) { console.log(`SKIP ${pair.padEnd(7)} - short data (${m5.length} candles)`); continue; }

    const { ctx, sigs } = scanAll(pair, m5);
    const trades: Trade[] = [];
    for (const s of sigs) { if (!s) continue; const t = simTrailing(pair, m5, ctx, s); if (t) trades.push(t); }
    if (trades.length === 0) { console.log(`${pair.padEnd(7)} [${cls(pair)}] - 0 trades`); continue; }

    const full = stats(trades);
    const { inS, outS } = splitInOut(trades);
    const si = stats(inS), so = stats(outS);
    // pass: out-of-sample avgR stays positive and WR doesn't collapse (>= 30%)
    const pass = outS.length >= 10 && so.avgR > 0 && so.wr >= 30;
    rows.push({ pair, class: cls(pair), ...full, inN: si.n, inAvgR: si.avgR, outN: so.n, outAvgR: so.avgR, outWR: so.wr, pass });

    console.log(
      `${pair.padEnd(7)} [${cls(pair).padEnd(6)}] ` +
      `n=${String(full.n).padStart(4)}  WR=${full.wr.toFixed(1).padStart(5)}%  avgR=${full.avgR.toFixed(3).padStart(7)}  ` +
      `PF=${(full.pf === Infinity ? '∞' : full.pf.toFixed(2)).padStart(5)}  maxDD=${full.maxDD.toFixed(1).padStart(6)}R  ` +
      `| OUT n=${String(so.n).padStart(3)} avgR=${so.avgR.toFixed(3).padStart(7)} WR=${so.wr.toFixed(0)}%  ${pass ? '✅ PASS' : '❌ fail'}`
    );
  }

  // Rankings
  rows.sort((a, b) => b.avgR - a.avgR);
  console.log('\n================= RANKED BY avgR (full period, after costs) =================');
  rows.forEach((r, idx) => {
    console.log(`${String(idx + 1).padStart(2)}. ${r.pair.padEnd(7)} [${r.class.padEnd(6)}] avgR=${r.avgR.toFixed(3).padStart(7)}  PF=${(r.pf === Infinity ? '∞' : r.pf.toFixed(2)).padStart(5)}  WR=${r.wr.toFixed(1)}%  ${r.pass ? '✅ PASS walk-forward' : '❌'}`);
  });

  const passers = rows.filter(r => r.pass);
  console.log('\n================= FINAL VERDICT: PAIRS THAT PASS =================');
  if (passers.length === 0) console.log('None passed strict walk-forward.');
  else passers.forEach(r => console.log(`  ✅ ${r.pair} [${r.class}] - full avgR ${r.avgR.toFixed(3)}, out-of-sample avgR ${r.outAvgR.toFixed(3)}, PF ${r.pf === Infinity ? '∞' : r.pf.toFixed(2)}`));

  fs.default.writeFileSync('backtest-all-pairs-final-results.json', JSON.stringify({ rows }, null, 0));
  console.log('\nSaved -> backtest-all-pairs-final-results.json');
}

main().catch(e => { console.error(e); process.exit(1); });
