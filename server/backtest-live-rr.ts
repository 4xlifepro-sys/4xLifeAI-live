// ---------------------------------------------------------------------------
// Backtest using the ACTUAL LIVE engine (engine2.ts / detectTrendMomentumScannerV5)
// with the ACTUAL LIVE TP structure (1.5R / 3R / 5R) and the ACTUAL LIVE
// breakeven-lock exit logic used by scanner.ts's outcome tracker:
//   - TP1 hit -> SL moves to entry (breakeven)
//   - TP2 hit -> SL moves to TP1
//   - Hit detection uses candle CLOSE price (matches scanner.ts, not wick high/low)
//   - SL is checked before TP on the same candle (matches scanner.ts safety order)
// This is a NEW, isolated backtest-only script. No live/deployed files touched.
// ---------------------------------------------------------------------------
import { detectTrendMomentumScannerV5, getPipMultiplier } from './engine2.js';
import { readFileSync, existsSync } from 'fs';

interface Candle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

interface Trade {
  pair: string;
  direction: string;
  entry: number;
  sl: number;
  tp1: number;
  tp2: number;
  tp3: number;
  entryTime: string;
  exitTime: string;
  exitPrice: number;
  result: string; // WIN_TP1 | WIN_TP2 | WIN_TP3 | LOSS | BREAKEVEN | OPEN
  r: number;
  confidence: number;
  tier: string;
}

const FOREX_PAIRS = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'USDCAD', 'AUDUSD', 'NZDUSD',
  'EURGBP', 'EURJPY', 'AUDJPY', 'CADJPY', 'CHFJPY', 'NZDJPY', 'EURAUD', 'AUDNZD'];
const METALS_PAIRS = ['XAUUSD', 'XAGUSD'];
const CRYPTO_PAIRS = ['BTCUSD', 'ETHUSD', 'LTCUSD', 'XRPUSD', 'ADAUSD', 'SOLUSD', 'DOGEUSD', 'BNBUSD'];
const ALL_PAIRS = [...FOREX_PAIRS, ...METALS_PAIRS, ...CRYPTO_PAIRS];

function loadCandles(path: string): Candle[] | null {
  if (!existsSync(path)) return null;
  const raw = JSON.parse(readFileSync(path, 'utf-8')) as Candle[];
  return [...raw].reverse(); // cache is newest-first, need ascending
}

function runBacktest(pair: string, h4: Candle[], m5: Candle[]): Trade[] {
  const trades: Trade[] = [];
  let lastSignalTs = 0;
  const cooldownMs = 60 * 60 * 1000; // 1 hour cooldown, matches typical live scan gap
  const pipMult = getPipMultiplier(pair);

  for (let i = 100; i < m5.length - 5; i++) {
    if (i % 12 !== 0) continue; // sample hourly (12 x M5 = 1h) for speed, same as prior scripts

    const ts = new Date(m5[i].timestamp).getTime();
    if (ts - lastSignalTs < cooldownMs) continue;

    const m5Slice = m5.slice(0, i + 1);
    const h4Slice = h4.filter(h => new Date(h.timestamp).getTime() <= ts);
    if (h4Slice.length < 30) continue;

    let result;
    try {
      result = detectTrendMomentumScannerV5(pair, h4Slice, m5Slice, m5Slice);
    } catch {
      continue;
    }
    const signal = result?.signal;
    if (!signal || signal.status !== 'ACTIVE' || signal.tier === 'Reject') continue;
    if (!signal.entry || !signal.sl) continue;

    const isLong = signal.direction === 'LONG';
    const entry = signal.entry;
    const originalSl = signal.sl;
    const tp1 = signal.tp1;
    const tp2 = signal.tp2;
    const tp3 = signal.tp3;
    const riskUnits = Math.abs(entry - originalSl) / pipMult;
    if (riskUnits <= 0) continue;

    // Simulate forward using CLOSE price only, same rule order as scanner.ts:
    // effectiveSL starts at originalSl; after TP1 -> entry; after TP2 -> tp1.
    let status: 'LIVE' | 'TP1_HIT' | 'TP2_HIT' = 'LIVE';
    let effectiveSl = originalSl;
    let finalResult = 'OPEN';
    let exitPrice = entry;
    let exitTime = m5[i].timestamp;

    const maxLook = Math.min(i + 481, m5.length); // ~40h lookahead on M5
    for (let j = i + 1; j < maxLook; j++) {
      const c = m5[j];
      const close = c.close;

      if (isLong) {
        if (close <= effectiveSl) {
          exitPrice = effectiveSl;
          exitTime = c.timestamp;
          finalResult = status === 'LIVE' ? 'LOSS' : (status === 'TP1_HIT' ? 'BREAKEVEN' : 'WIN_TP1_LOCKED');
          break;
        }
        if (close >= tp3 && status !== 'TP2_HIT') {
          exitPrice = tp3; exitTime = c.timestamp; finalResult = 'WIN_TP3'; break;
        }
        if (close >= tp2 && status !== 'TP2_HIT') {
          status = 'TP2_HIT'; effectiveSl = tp1;
          continue;
        }
        if (close >= tp1 && status === 'LIVE') {
          status = 'TP1_HIT'; effectiveSl = entry;
          continue;
        }
      } else {
        if (close >= effectiveSl) {
          exitPrice = effectiveSl;
          exitTime = c.timestamp;
          finalResult = status === 'LIVE' ? 'LOSS' : (status === 'TP1_HIT' ? 'BREAKEVEN' : 'WIN_TP1_LOCKED');
          break;
        }
        if (close <= tp3 && status !== 'TP2_HIT') {
          exitPrice = tp3; exitTime = c.timestamp; finalResult = 'WIN_TP3'; break;
        }
        if (close <= tp2 && status !== 'TP2_HIT') {
          status = 'TP2_HIT'; effectiveSl = tp1;
          continue;
        }
        if (close <= tp1 && status === 'LIVE') {
          status = 'TP1_HIT'; effectiveSl = entry;
          continue;
        }
      }
    }

    if (finalResult === 'OPEN') continue; // drop unresolved trades (still running at end of data)

    const pips = isLong ? (exitPrice - entry) / pipMult : (entry - exitPrice) / pipMult;
    const r = pips / riskUnits;

    trades.push({
      pair, direction: signal.direction, entry, sl: originalSl, tp1, tp2, tp3,
      entryTime: m5[i].timestamp, exitTime, exitPrice,
      result: finalResult, r,
      confidence: signal.aiConfidence, tier: signal.tier,
    });

    lastSignalTs = ts;
  }

  return trades;
}

function analyze(label: string, trades: Trade[]) {
  const closed = trades; // OPEN already dropped
  const wins = closed.filter(t => t.r > 0);
  const winRate = closed.length ? (wins.length / closed.length) * 100 : 0;
  const totalR = closed.reduce((s, t) => s + t.r, 0);
  const avgR = closed.length ? totalR / closed.length : 0;

  let peak = 0, running = 0, maxDD = 0;
  for (const t of closed) {
    running += t.r;
    if (running > peak) peak = running;
    const dd = peak - running;
    if (dd > maxDD) maxDD = dd;
  }

  const tp1Locked = closed.filter(t => t.result === 'WIN_TP1_LOCKED').length;
  const tp3 = closed.filter(t => t.result === 'WIN_TP3').length;
  const breakeven = closed.filter(t => t.result === 'BREAKEVEN').length;
  const loss = closed.filter(t => t.result === 'LOSS').length;

  console.log(`${label.padEnd(24)}| closed:${String(closed.length).padStart(5)} | WR:${winRate.toFixed(1).padStart(6)}% | avgR:${avgR.toFixed(3).padStart(7)} | maxDD(R):${maxDD.toFixed(2).padStart(6)} | TP3:${tp3} TP1-locked:${tp1Locked} BE:${breakeven} LOSS:${loss}`);

  return { label, closed: closed.length, winRate, avgR, maxDD, tp3, tp1Locked, breakeven, loss };
}

async function main() {
  console.log('===== LIVE ENGINE (engine2.ts) BACKTEST — REAL 1.5R/3R/5R + BREAKEVEN LOCK =====\n');
  console.log('Matches exact live logic: TP ratios 1:1.5/1:3/1:5, SL->entry after TP1, SL->TP1 after TP2, close-price hit detection.\n');

  const allTrades: Trade[] = [];
  const perPairResults: any[] = [];

  for (const pair of ALL_PAIRS) {
    const h4Path = `.cache/${pair}_4h_6m.json`;
    const m5Path = `.cache/${pair}_5min_6m.json`;
    const h4 = loadCandles(h4Path);
    const m5 = loadCandles(m5Path);
    if (!h4 || !m5) {
      console.log(`SKIP ${pair} - no cached data`);
      continue;
    }
    const trades = runBacktest(pair, h4, m5);
    if (trades.length === 0) {
      console.log(`${pair.padEnd(10)}| no closed trades in window`);
      continue;
    }
    allTrades.push(...trades);
    perPairResults.push(analyze(pair, trades));
  }

  console.log('\n===== ASSET CLASS TOTALS =====');
  const forexTrades = allTrades.filter(t => FOREX_PAIRS.includes(t.pair));
  const metalsTrades = allTrades.filter(t => METALS_PAIRS.includes(t.pair));
  const cryptoTrades = allTrades.filter(t => CRYPTO_PAIRS.includes(t.pair));
  analyze('FOREX (all)', forexTrades);
  analyze('METALS (all)', metalsTrades);
  analyze('CRYPTO (all)', cryptoTrades);

  console.log('\n===== GRAND TOTAL (all 25 pairs, live TP/SL logic) =====');
  analyze('ALL PAIRS', allTrades);
}

main().catch(err => {
  console.error('Error:', err.message);
  console.error(err.stack);
});
