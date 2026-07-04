import { detectSignalV2, getPipMultiplier } from './engine2.js';
import { readFileSync } from 'fs';

interface Candle { timestamp: string; open: number; high: number; low: number; close: number; }
interface TradeResult { pair: string; direction: string; entry: number; sl: number; tp1: number; tp2: number; tp3: number; entryTime: string; result: string; pips: number; confidence: number; }

const COSTS = 2.0;

function runBacktest(pair: string, h4Raw: Candle[], m5Raw: Candle[]): TradeResult[] {
  const h4 = [...h4Raw].reverse();
  const m5 = [...m5Raw].reverse();
  const pipMult = getPipMultiplier(pair);
  const trades: TradeResult[] = [];
  let lastSignalTs = 0;

  for (let i = 100; i < m5.length - 10; i++) {
    if (i % 12 !== 0) continue;
    const ts = new Date(m5[i].timestamp).getTime();
    const hour = new Date(m5[i].timestamp).getUTCHours();
    if (hour < 7 || hour >= 21) continue;
    if (ts - lastSignalTs < 3600000) continue;
    const slice = m5.slice(0, i + 1);
    const h4Slice = h4.filter(h => new Date(h.timestamp).getTime() <= ts);
    if (h4Slice.length < 30) continue;
    const signal = detectSignalV2(pair, h4Slice, slice);
    if (!signal) continue;

    const isLong = signal.direction === 'LONG';
    const entry = signal.entry;
    const sl = signal.sl;
    const tp1 = signal.tp1; const tp2 = signal.tp2; const tp3 = signal.tp3;
    let bestTp: string | null = null;
    let exitPrice = entry;
    let exitTime = m5[i].timestamp;
    let result = 'OPEN';
    const maxLook = Math.min(i + 201, m5.length);
    for (let j = i + 1; j < maxLook; j++) {
      const c = m5[j];
      if (isLong) {
        if (c.high >= tp3) { bestTp = 'TP3'; exitPrice = tp3; exitTime = c.timestamp; }
        else if (c.high >= tp2 && !bestTp) { bestTp = 'TP2'; exitPrice = tp2; exitTime = c.timestamp; }
        else if (c.high >= tp1 && !bestTp) { bestTp = 'TP1'; exitPrice = tp1; exitTime = c.timestamp; }
        if (c.low <= sl) { if (bestTp) { result = 'WIN_' + bestTp; } else { exitPrice = sl; result = 'LOSS'; } break; }
      } else {
        if (c.low <= tp3) { bestTp = 'TP3'; exitPrice = tp3; exitTime = c.timestamp; }
        else if (c.low <= tp2 && !bestTp) { bestTp = 'TP2'; exitPrice = tp2; exitTime = c.timestamp; }
        else if (c.low <= tp1 && !bestTp) { bestTp = 'TP1'; exitPrice = tp1; exitTime = c.timestamp; }
        if (c.high >= sl) { if (bestTp) { result = 'WIN_' + bestTp; } else { exitPrice = sl; result = 'LOSS'; } break; }
      }
    }
    if (result === 'OPEN' && bestTp) result = 'WIN_' + bestTp;
    else if (result === 'OPEN') { const lastC = m5[maxLook - 1]; exitPrice = lastC.close; exitTime = lastC.timestamp; result = 'CLOSED'; }
    const pips = isLong ? (exitPrice - entry) / pipMult : (entry - exitPrice) / pipMult;
    trades.push({ pair, direction: signal.direction, entry, sl, tp1, tp2, tp3, entryTime: m5[i].timestamp, exitTime, result, pips: Math.round(pips * 100) / 100, confidence: signal.confidence || 0 });
    lastSignalTs = ts;
  }
  return trades;
}

// All untested pairs from the user's list
const allPairs = [
  // Majors
  'GBPUSD', 'USDCHF', 'USDCAD', 'AUDUSD', 'NZDUSD',
  // Metals
  'XAUUSD', 'XAGUSD',
  // Popular crosses
  'EURJPY', 'GBPJPY', 'EURGBP', 'EURAUD', 'GBPAUD', 'GBPNZD', 'GBPCAD', 'AUDCAD',
  // Exotics (try them)
  'USDZAR', 'USDSGD',
];

let totalNetPips = 0;
let totalTrades = 0;
let totalWins = 0;
let totalClosed = 0;

console.log('\n' + '='.repeat(80));
console.log('ALL PAIRS BACKTEST — EMA9 REMOVED, pipMultiplier from engine2.ts');
console.log('Costs: ' + COSTS + ' pips/trade');
console.log('='.repeat(80));

for (const pair of allPairs) {
  const h4Path = '.cache/' + pair + '_4h_6m.json';
  const m5Path = '.cache/' + pair + '_5min_6m.json';
  let h4: Candle[], m5: Candle[];
  try { h4 = JSON.parse(readFileSync(h4Path, 'utf-8')); m5 = JSON.parse(readFileSync(m5Path, 'utf-8')); }
  catch (e) { console.log(pair + ': NO DATA'); continue; }
  if (h4.length === 0 || m5.length === 0) { console.log(pair + ': EMPTY'); continue; }

  const trades = runBacktest(pair, h4, m5);
  const closed = trades.filter(t => !t.result.includes('OPEN') && t.result !== 'CLOSED');
  const wins = closed.filter(t => t.result.startsWith('WIN'));
  const losses = closed.filter(t => t.result === 'LOSS');
  const wr = closed.length > 0 ? (wins.length / closed.length * 100) : 0;
  const avgW = wins.length > 0 ? (wins.reduce((s, t) => s + t.pips, 0) / wins.length) : 0;
  const avgL = losses.length > 0 ? (Math.abs(losses.reduce((s, t) => s + t.pips, 0)) / losses.length) : 0;
  const gross = trades.reduce((s, t) => s + t.pips, 0);
  const net = gross - closed.length * COSTS;
  let maxDD = 0, peak = 0, run = 0;
  for (const t of closed) { run += t.pips - COSTS; if (run > peak) peak = run; const dd = peak - run; if (dd > maxDD) maxDD = dd; }
  const days = trades.length > 1 ? ((new Date(trades[trades.length - 1].entryTime).getTime() - new Date(trades[0].entryTime).getTime()) / 86400000) : 0;
  const perWeek = days > 0 ? (trades.length / (days / 7)) : 0;
  const rr = avgL > 0 ? avgW / avgL : 0;
  const netRR = avgL > 0 ? (avgW - COSTS) / (avgL + COSTS) : 0;
  const breakevenWR = netRR > 0 ? (1 / (1 + netRR)) * 100 : 50;
  const edge = wr - breakevenWR;
  const status = net > 0 ? '✅' : '❌';

  console.log(status + ' ' + pair.padEnd(10) + ' Trades:' + String(trades.length).padStart(4) +
    '  WR:' + wr.toFixed(1).padStart(5) + '%' +
    '  R:R:' + rr.toFixed(2).padStart(5) +
    '  Net:' + net.toFixed(0).padStart(7) + ' pips' +
    '  Edge:' + edge.toFixed(1).padStart(6) + 'pp' +
    '  /wk:' + perWeek.toFixed(1).padStart(5) +
    '  DD:' + maxDD.toFixed(0).padStart(5));

  totalNetPips += net;
  totalTrades += trades.length;
  totalWins += wins.length;
  totalClosed += closed.length;
}

// Combined with already-known results
const knownProfitable = [
  { pair: 'EURUSD', net: 624, wr: 47.3 },
  { pair: 'USDJPY', net: 275, wr: 60.0 },
  { pair: 'BTCUSD', net: 13961, wr: 48.5 },
  { pair: 'ETHUSD', net: 231, wr: 48.1 },
];
console.log('\n' + '='.repeat(80));
console.log('ALL 15 PAIRS RANKED BY NET PIPS (after costs)');
console.log('='.repeat(80));

// Combine known + new results into a sortable array
const allResults: { pair: string; net: number; wr: number; rr: number; trades: number; perWeek: number; edge: number; maxDD: number }[] = [...knownProfitable.map(p => ({ pair: p.pair, net: p.net, wr: p.wr, rr: 0, trades: 0, perWeek: 0, edge: 0, maxDD: 0 }))];

// Re-run to collect stats for new pairs
for (const pair of allPairs) {
  const h4Path = '.cache/' + pair + '_4h_6m.json';
  const m5Path = '.cache/' + pair + '_5min_6m.json';
  let h4: Candle[], m5: Candle[];
  try { h4 = JSON.parse(readFileSync(h4Path, 'utf-8')); m5 = JSON.parse(readFileSync(m5Path, 'utf-8')); }
  catch (e) { continue; }
  if (h4.length === 0 || m5.length === 0) continue;

  const trades = runBacktest(pair, h4, m5);
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
  const breakevenWR = netRR > 0 ? (1 / (1 + netRR)) * 100 : 50;
  const edge = wr - breakevenWR;
  let maxDD = 0, peak = 0, run = 0;
  for (const t of closed) { run += t.pips - COSTS; if (run > peak) peak = run; const dd = peak - run; if (dd > maxDD) maxDD = dd; }
  const days = trades.length > 1 ? ((new Date(trades[trades.length - 1].entryTime).getTime() - new Date(trades[0].entryTime).getTime()) / 86400000) : 0;
  const perWeek = days > 0 ? (trades.length / (days / 7)) : 0;

  allResults.push({ pair, net, wr, rr, trades: closed.length, perWeek, edge, maxDD });
}

allResults.sort((a, b) => b.net - a.net);
let rank = 1;
for (const r of allResults) {
  const emoji = r.net > 0 ? '✅' : '❌';
  console.log(String(rank).padStart(2) + '. ' + emoji + ' ' + r.pair.padEnd(10) +
    ' Net:' + r.net.toFixed(0).padStart(8) + ' pips' +
    '  WR:' + r.wr.toFixed(1).padStart(5) + '%' +
    '  R:R:' + r.rr.toFixed(2).padStart(5) +
    '  Edge:' + r.edge.toFixed(1).padStart(6) + 'pp' +
    '  Trades:' + String(r.trades).padStart(4) +
    '  /wk:' + r.perWeek.toFixed(1).padStart(5) +
    '  DD:' + r.maxDD.toFixed(0).padStart(5));
  rank++;
}

const profitable = allResults.filter(r => r.net > 0);
console.log('\n' + '='.repeat(80));
console.log('PROFITABLE PAIRS: ' + profitable.length + ' / ' + allResults.length);
console.log('TOTAL NET (profitable only): ' + profitable.reduce((s, r) => s + r.net, 0).toFixed(0) + ' pips');
console.log('TOTAL NET (all pairs): ' + allResults.reduce((s, r) => s + r.net, 0).toFixed(0) + ' pips');
console.log('='.repeat(80));
