import { detectSignalV2 } from './engine2.js';
import { readFileSync } from 'fs';

interface Candle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface TradeResult {
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
  result: string;
  pips: number;
  confidence: number;
}

function getPipMultiplier(pair: string): number {
  if (pair.includes('JPY')) return 0.01;
  if (pair.includes('XAU')) return 0.1;
  if (pair.includes('XAG')) return 0.01;
  if (['BTC', 'ETH', 'LTC', 'XRP', 'ADA', 'SOL', 'DOGE', 'BNB'].some(c => pair.includes(c))) return 1;
  return 0.0001;
}

const TOTAL_COST_PIPS = 2.0; // spread + slippage + commission

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
    const tp1 = signal.tp1;
    const tp2 = signal.tp2;
    const tp3 = signal.tp3;

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
        if (c.low <= sl) {
          if (bestTp) { result = 'WIN_' + bestTp; }
          else { exitPrice = sl; result = 'LOSS'; }
          break;
        }
      } else {
        if (c.low <= tp3) { bestTp = 'TP3'; exitPrice = tp3; exitTime = c.timestamp; }
        else if (c.low <= tp2 && !bestTp) { bestTp = 'TP2'; exitPrice = tp2; exitTime = c.timestamp; }
        else if (c.low <= tp1 && !bestTp) { bestTp = 'TP1'; exitPrice = tp1; exitTime = c.timestamp; }
        if (c.high >= sl) {
          if (bestTp) { result = 'WIN_' + bestTp; }
          else { exitPrice = sl; result = 'LOSS'; }
          break;
        }
      }
    }

    if (result === 'OPEN' && bestTp) result = 'WIN_' + bestTp;
    else if (result === 'OPEN') {
      const lastC = m5[maxLook - 1];
      exitPrice = lastC.close;
      exitTime = lastC.timestamp;
      result = 'CLOSED';
    }

    const pips = isLong ? (exitPrice - entry) / pipMult : (entry - exitPrice) / pipMult;
    trades.push({
      pair, direction: signal.direction,
      entry, sl, tp1, tp2, tp3,
      entryTime: m5[i].timestamp,
      exitTime, exitPrice, result,
      pips: Math.round(pips * 100) / 100,
      confidence: signal.confidence || 0,
    });
    lastSignalTs = ts;
  }
  return trades;
}

const pairs = ['EURUSD', 'USDJPY', 'AUDNZD'];
const COSTS = 2.0;

for (const pair of pairs) {
  const h4 = JSON.parse(readFileSync('.cache/' + pair + '_4h_6m.json', 'utf-8')) as Candle[];
  const m5 = JSON.parse(readFileSync('.cache/' + pair + '_5min_6m.json', 'utf-8')) as Candle[];
  const trades = runBacktest(pair, h4, m5);

  const closed = trades.filter(t => !t.result.includes('OPEN') && t.result !== 'CLOSED');
  const wins = closed.filter(t => t.result.startsWith('WIN'));
  const losses = closed.filter(t => t.result === 'LOSS');
  const wr = closed.length > 0 ? (wins.length / closed.length * 100).toFixed(1) : '0.0';
  const avgW = wins.length > 0 ? (wins.reduce((s, t) => s + t.pips, 0) / wins.length).toFixed(2) : '0.00';
  const avgL = losses.length > 0 ? (Math.abs(losses.reduce((s, t) => s + t.pips, 0)) / losses.length).toFixed(2) : '0.00';
  const gross = trades.reduce((s, t) => s + t.pips, 0).toFixed(1);
  const net = (Number(gross) - closed.length * COSTS).toFixed(1);

  let maxDD = 0, peak = 0, run = 0;
  for (const t of closed) { run += t.pips - COSTS; if (run > peak) peak = run; const dd = peak - run; if (dd > maxDD) maxDD = dd; }

  const days = trades.length > 1 ? ((new Date(trades[trades.length - 1].entryTime).getTime() - new Date(trades[0].entryTime).getTime()) / 86400000).toFixed(0) : '0';
  const perWeek = Number(days) > 0 ? (trades.length / (Number(days) / 7)).toFixed(1) : '0.0';

  const rr = Number(avgL) > 0 ? (Number(avgW) / Number(avgL)).toFixed(2) : '0.00';
  const netRR = Number(avgL) > 0 ? ((Number(avgW) - COSTS) / (Number(avgL) + COSTS)).toFixed(2) : '0.00';
  const breakevenWR = Number(netRR) > 0 ? (1 / (1 + Number(netRR)) * 100).toFixed(1) : '50.0';
  const edge = (Number(wr) - Number(breakevenWR)).toFixed(1);

  console.log('\n' + '='.repeat(60));
  console.log(pair + ' — EMA9 FILTER REMOVED');
  console.log('='.repeat(60));
  console.log('Trades: ' + trades.length + ' (closed: ' + closed.length + ')');
  console.log('Win rate: ' + wr + '%');
  console.log('Avg win: ' + avgW + ' | Avg loss: ' + avgL);
  console.log('Gross R:R: ' + rr + ' | Net R:R: ' + netRR);
  console.log('Gross pips: ' + gross);
  console.log('Net pips: ' + net + ' (after ' + COSTS + ' pips/trade)');
  console.log('Max drawdown: ' + maxDD.toFixed(2) + ' pips');
  console.log('Days: ' + days + ' | Signals/week: ' + perWeek);
  console.log('Break-even WR: ' + breakevenWR + '% | Edge: ' + edge + ' pp');

  if (Number(net) > 0) {
    console.log('*** PROFITABLE ***');
  } else {
    console.log('*** LOSING ***');
  }
}
