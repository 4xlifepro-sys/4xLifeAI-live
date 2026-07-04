import { detectSignalV2, getPipMultiplier } from './engine2.js';
import { readFileSync } from 'fs';

interface Candle { timestamp: string; open: number; high: number; low: number; close: number; }
interface TradeResult { pair: string; direction: string; entryTime: string; result: string; pips: number; confidence: number; tpHit: string; }

const COSTS = 2.0;

function runBacktest(pair: string, h4Raw: Candle[], m5Raw: Candle[], 
  opts: { slMult?: number; tp1Mult?: number; tp2Mult?: number; tp3Mult?: number; rsiMin?: number; rsiMax?: number; sessionStart?: number; sessionEnd?: number } = {}
): TradeResult[] {
  const h4 = [...h4Raw].reverse();
  const m5 = [...m5Raw].reverse();
  const pipMult = getPipMultiplier(pair);
  const slMult = opts.slMult || 1.0;
  const tp1Mult = opts.tp1Mult || 1.5;
  const tp2Mult = opts.tp2Mult || 3.0;
  const tp3Mult = opts.tp3Mult || 5.0;
  const rsiMin = opts.rsiMin ?? -1;
  const rsiMax = opts.rsiMax ?? 999;
  const sessStart = opts.sessionStart ?? 7;
  const sessEnd = opts.sessionEnd ?? 21;

  const trades: TradeResult[] = [];
  let lastSignalTs = 0;

  for (let i = 100; i < m5.length - 10; i++) {
    if (i % 12 !== 0) continue;
    const ts = new Date(m5[i].timestamp).getTime();
    const hour = new Date(m5[i].timestamp).getUTCHours();
    if (hour < sessStart || hour >= sessEnd) continue;
    if (ts - lastSignalTs < 3600000) continue;
    const slice = m5.slice(0, i + 1);
    const h4Slice = h4.filter(h => new Date(h.timestamp).getTime() <= ts);
    if (h4Slice.length < 30) continue;
    const signal = detectSignalV2(pair, h4Slice, slice);
    if (!signal) continue;

    const isLong = signal.direction === 'LONG';
    const entry = signal.entry;
    const sl = isLong ? entry - (entry - signal.sl) * slMult : entry + (signal.sl - entry) * slMult;
    const risk = Math.abs(entry - sl);
    const tp1 = isLong ? entry + risk * tp1Mult : entry - risk * tp1Mult;
    const tp2 = isLong ? entry + risk * tp2Mult : entry - risk * tp2Mult;
    const tp3 = isLong ? entry + risk * tp3Mult : entry - risk * tp3Mult;

    // Extra RSI filter
    const m5Closes = slice.slice(-200).map(c => c.close);
    const m5RsiVals: number[] = [];
    if (m5Closes.length >= 15) {
      let avgGain = 0, avgLoss = 0;
      for (let k = 1; k <= 14; k++) {
        const ch = m5Closes[k] - m5Closes[k - 1];
        if (ch > 0) avgGain += ch; else avgLoss += Math.abs(ch);
      }
      avgGain /= 14; avgLoss /= 14;
      for (let k = 14; k < m5Closes.length; k++) {
        if (k > 14) {
          const ch = m5Closes[k] - m5Closes[k - 1];
          const g = ch > 0 ? ch : 0;
          const l = ch < 0 ? Math.abs(ch) : 0;
          avgGain = (avgGain * 13 + g) / 14;
          avgLoss = (avgLoss * 13 + l) / 14;
        }
        m5RsiVals.push(avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss)));
      }
    }
    const currentRsi = m5RsiVals.length > 0 ? m5RsiVals[m5RsiVals.length - 1] : 50;
    if (currentRsi < rsiMin || currentRsi > rsiMax) continue;

    let bestTp: string | null = null;
    let exitPrice = entry;
    let result = 'OPEN';
    const maxLook = Math.min(i + 201, m5.length);
    for (let j = i + 1; j < maxLook; j++) {
      const c = m5[j];
      if (isLong) {
        if (c.high >= tp3 && !bestTp) { bestTp = 'TP3'; exitPrice = tp3; }
        else if (c.high >= tp2 && !bestTp) { bestTp = 'TP2'; exitPrice = tp2; }
        else if (c.high >= tp1 && !bestTp) { bestTp = 'TP1'; exitPrice = tp1; }
        if (c.low <= sl) { if (bestTp) { result = 'WIN_' + bestTp; } else { exitPrice = sl; result = 'LOSS'; } break; }
      } else {
        if (c.low <= tp3 && !bestTp) { bestTp = 'TP3'; exitPrice = tp3; }
        else if (c.low <= tp2 && !bestTp) { bestTp = 'TP2'; exitPrice = tp2; }
        else if (c.low <= tp1 && !bestTp) { bestTp = 'TP1'; exitPrice = tp1; }
        if (c.high >= sl) { if (bestTp) { result = 'WIN_' + bestTp; } else { exitPrice = sl; result = 'LOSS'; } break; }
      }
    }
    if (result === 'OPEN' && bestTp) result = 'WIN_' + bestTp;
    else if (result === 'OPEN') { const lastC = m5[maxLook - 1]; exitPrice = lastC.close; result = 'CLOSED'; }
    const pips = isLong ? (exitPrice - entry) / pipMult : (entry - exitPrice) / pipMult;
    trades.push({ pair, direction: signal.direction, entryTime: m5[i].timestamp, result, pips: Math.round(pips * 100) / 100, confidence: signal.confidence || 0, tpHit: bestTp || 'NONE' });
    lastSignalTs = ts;
  }
  return trades;
}

function printResult(pair: string, trades: TradeResult[], label: string) {
  const closed = trades.filter(t => !t.result.includes('OPEN') && t.result !== 'CLOSED');
  const wins = closed.filter(t => t.result.startsWith('WIN'));
  const losses = closed.filter(t => t.result === 'LOSS');
  const wr = closed.length > 0 ? (wins.length / closed.length * 100) : 0;
  const avgW = wins.length > 0 ? (wins.reduce((s, t) => s + t.pips, 0) / wins.length) : 0;
  const avgL = losses.length > 0 ? (Math.abs(losses.reduce((s, t) => s + t.pips, 0)) / losses.length) : 0;
  const gross = trades.reduce((s, t) => s + t.pips, 0);
  const net = gross - closed.length * COSTS;
  const rr = avgL > 0 ? avgW / avgL : 0;
  const netRR = avgL > 0 ? (avgW - COSTS) / (avgL + COSTS) : 0;
  const beWR = netRR > 0 ? (1 / (1 + netRR)) * 100 : 50;
  const edge = wr - beWR;
  const emoji = net > 0 ? '✅' : '❌';
  console.log(label.padEnd(35) + emoji + ' ' + pair + '  Trades:' + String(closed.length).padStart(4) +
    '  WR:' + wr.toFixed(1).padStart(5) + '%  R:R:' + rr.toFixed(2).padStart(5) +
    '  Net:' + net.toFixed(0).padStart(7) + '  Edge:' + edge.toFixed(1).padStart(6) + 'pp');
  return { net, wr, edge, closed: closed.length };
}

const pairs = ['AUDUSD', 'GBPUSD'];

for (const pair of pairs) {
  const h4 = JSON.parse(readFileSync('.cache/' + pair + '_4h_6m.json', 'utf-8')) as Candle[];
  const m5 = JSON.parse(readFileSync('.cache/' + pair + '_5min_6m.json', 'utf-8')) as Candle[];

  console.log('\n' + '='.repeat(80));
  console.log(pair + ' — PARAMETER OPTIMIZATION');
  console.log('='.repeat(80));

  // Baseline
  printResult(pair, runBacktest(pair, h4, m5), 'Baseline (1.5R/3R/5R, SL=1ATR):');

  // Test wider TPs
  printResult(pair, runBacktest(pair, h4, m5, { tp1Mult: 2, tp2Mult: 4, tp3Mult: 6 }), 'Wider TPs (2R/4R/6R):');

  // Test tighter SL
  printResult(pair, runBacktest(pair, h4, m5, { slMult: 0.7 }), 'Tighter SL (0.7 ATR):');

  // Test tighter SL + wider TPs
  printResult(pair, runBacktest(pair, h4, m5, { slMult: 0.7, tp1Mult: 2, tp2Mult: 4, tp3Mult: 6 }), 'Tight SL + Wide TPs:');

  // Test narrower session (London+NY overlap only: 12-17 UTC)
  printResult(pair, runBacktest(pair, h4, m5, { sessionStart: 12, sessionEnd: 17 }), 'Overlap only (12-17 UTC):');

  // Test RSI sweet spot (40-60 for buys, 40-60 for sells)
  printResult(pair, runBacktest(pair, h4, m5, { rsiMin: 30, rsiMax: 70 }), 'RSI 30-70 filter:');

  // Best combo: tight SL + wide TPs + overlap
  printResult(pair, runBacktest(pair, h4, m5, { slMult: 0.7, tp1Mult: 2, tp2Mult: 4, tp3Mult: 6, sessionStart: 12, sessionEnd: 17 }), 'Combo: Tight SL + Wide TP + Overlap:');
}
