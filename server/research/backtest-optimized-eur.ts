import type { Candle } from '../../src/types.js';
import { scanOptimizedSignals } from './engine-optimized-eur.js';

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

function simulateFixedTpTrade(
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
  slPips: number
): Trade {
  const isLong = direction === 'LONG';
  const pip = getPipMultiplier(pair);
  const initialRiskPips = Math.abs(entry - sl) / pip;
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

  const avgWinner = wins.length ? wins.reduce((sum, t) => sum + (t.r || 0), 0) / wins.length : 0;
  const losers = closed.filter(t => t.result === 'LOSS');
  const avgLoser = losers.length ? losers.reduce((sum, t) => sum + (t.r || 0), 0) / losers.length : 0;

  const recoveryFactor = maxDD > 0 ? totalR / maxDD : totalR > 0 ? Infinity : 0;

  console.log(`  ${label.padEnd(28)} signals:${String(trades.length).padStart(4)} closed:${String(closed.length).padStart(4)} WR:${winRate.toFixed(1).padStart(6)}%  avgR:${avgR.toFixed(3).padStart(7)}  PF:${profitFactor.toFixed(2).padStart(6)}  maxDD(R):${maxDD.toFixed(2).padStart(6)}  avgSL(pips):${avgSlPips.toFixed(1).padStart(6)}`);

  return { label, signals: trades.length, closed: closed.length, winRate, avgR, profitFactor, maxDD, avgSlPips, avgWinner, avgLoser, recoveryFactor, totalR };
}

async function main() {
  const EUR_PAIRS = ['EURUSD', 'EURGBP', 'EURJPY', 'EURAUD', 'EURNZD', 'EURCAD', 'EURCHF'];

  console.log('\n===================================================================');
  console.log('RESEARCH: Optimized EUR Strategy - Target 60% WR, 8 pip min SL');
  console.log('Indicators: EMA50 + RSI + ATR + Bollinger Bands + Price Action');
  console.log('===================================================================');

  const allTrades: Trade[] = [];
  const perPair: Record<string, ReturnType<typeof analyze>> = {};

  console.log('\nPer-pair results:');
  for (const pair of EUR_PAIRS) {
    const m5 = loadCache(pair);
    if (!m5 || m5.length < 300) {
      console.warn(`SKIP ${pair}: no/short cache`);
      continue;
    }

    const signals = scanOptimizedSignals(pair, m5);

    const trades = signals.map(sig => {
      const m5Index = sig.candleIndex * 3;
      return simulateFixedTpTrade(
        pair,
        sig.direction,
        sig.entry,
        sig.sl,
        sig.tp1,
        sig.tp2,
        sig.tp3,
        m5[m5Index]?.timestamp || new Date().toISOString(),
        m5,
        m5Index,
        sig.confidence,
        sig.slPips
      );
    });

    allTrades.push(...trades);
    perPair[pair] = analyze(pair, trades);
  }

  console.log('\nCOMBINED (all EUR pairs):');
  const combined = analyze('COMBINED', allTrades);

  // Check targets
  console.log('\n=== TARGET CHECK ===');
  console.log(`Target: 60%+ WR | Current: ${combined.winRate.toFixed(1)}%`);
  console.log(`Target: 8 pip min SL | Current avg: ${combined.avgSlPips.toFixed(1)} pips`);
  console.log(`Target: 4+ signals/day | Current: ${combined.signals} signals over 6 months`);
  
  const daysInData = 180; // 6 months
  const signalsPerDay = combined.signals / daysInData;
  console.log(`Signals per day: ${signalsPerDay.toFixed(2)}`);

  fs.default.writeFileSync('backtest-optimized-eur-results.json', JSON.stringify({ perPair, combined, allTrades }, null, 0));
  console.log('\nSaved to backtest-optimized-eur-results.json');
}

main().catch(e => { console.error(e); process.exit(1); });
