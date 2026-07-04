import { detectSignalV2 } from './engine2.js';
import { readFileSync } from 'fs';

interface Candle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface Trade {
  pair: string;
  direction: 'LONG' | 'SHORT';
  entry: number;
  sl: number;
  tp1: number;
  tp2: number;
  tp3: number;
  entryTime: string;
  exitTime: string;
  exitPrice: number;
  result: 'WIN_TP1' | 'WIN_TP2' | 'WIN_TP3' | 'LOSS' | 'OPEN';
  pips: number;
  confidence: number;
  date: string;
}

function getPipMultiplier(pair: string): number {
  if (pair.includes('JPY')) return 0.01;
  if (pair.startsWith('X') && !pair.includes('XRP')) return 0.1;
  if (pair.includes('BTC') || pair.includes('ETH')) return 1;
  return 0.0001;
}

function simulateTrade(pair: string, trade: any, futureCandles: Candle[]): Trade {
  const pipMult = getPipMultiplier(pair);
  const isLong = trade.direction === 'LONG';
  
  let hitTP1 = false, hitTP2 = false, hitTP3 = false;
  let exitPrice = trade.entry;
  let exitTime = trade.entryTime;
  let result: Trade['result'] = 'OPEN';
  
  for (const c of futureCandles) {
    if (isLong) {
      // Check TPs first (highest to lowest)
      if (c.high >= trade.tp3 && !hitTP3) { 
        hitTP3 = true; 
        exitPrice = trade.tp3; 
        exitTime = c.timestamp; 
      }
      if (c.high >= trade.tp2 && !hitTP2) { 
        hitTP2 = true; 
        if (!hitTP3) {
          exitPrice = trade.tp2; 
          exitTime = c.timestamp; 
        }
      }
      if (c.high >= trade.tp1 && !hitTP1) { 
        hitTP1 = true; 
        if (!hitTP2 && !hitTP3) {
          exitPrice = trade.tp1; 
          exitTime = c.timestamp; 
        }
      }
      // Then check SL
      if (c.low <= trade.sl) {
        // If any TP was hit, it's a WIN at the highest TP
        if (hitTP3 || hitTP2 || hitTP1) {
          result = hitTP3 ? 'WIN_TP3' : hitTP2 ? 'WIN_TP2' : 'WIN_TP1';
        } else {
          exitPrice = trade.sl;
          exitTime = c.timestamp;
          result = 'LOSS';
        }
        break;
      }
    } else {
      // SHORT direction
      if (c.low <= trade.tp3 && !hitTP3) { 
        hitTP3 = true; 
        exitPrice = trade.tp3; 
        exitTime = c.timestamp; 
      }
      if (c.low <= trade.tp2 && !hitTP2) { 
        hitTP2 = true; 
        if (!hitTP3) {
          exitPrice = trade.tp2; 
          exitTime = c.timestamp; 
        }
      }
      if (c.low <= trade.tp1 && !hitTP1) { 
        hitTP1 = true; 
        if (!hitTP2 && !hitTP3) {
          exitPrice = trade.tp1; 
          exitTime = c.timestamp; 
        }
      }
      // Then check SL
      if (c.high >= trade.sl) {
        if (hitTP3 || hitTP2 || hitTP1) {
          result = hitTP3 ? 'WIN_TP3' : hitTP2 ? 'WIN_TP2' : 'WIN_TP1';
        } else {
          exitPrice = trade.sl;
          exitTime = c.timestamp;
          result = 'LOSS';
        }
        break;
      }
    }
  }
  
  // If we didn't hit SL and didn't break, check if any TP was hit
  if (result === 'OPEN') {
    if (hitTP3) result = 'WIN_TP3';
    else if (hitTP2) result = 'WIN_TP2';
    else if (hitTP1) result = 'WIN_TP1';
  }
  
  const pips = isLong 
    ? (exitPrice - trade.entry) / pipMult
    : (trade.entry - exitPrice) / pipMult;
  
  return {
    pair,
    direction: trade.direction,
    entry: trade.entry,
    sl: trade.sl,
    tp1: trade.tp1,
    tp2: trade.tp2,
    tp3: trade.tp3,
    entryTime: trade.entryTime,
    exitTime,
    exitPrice,
    result,
    pips: Math.round(pips * 100) / 100,
    confidence: trade.confidence,
    date: trade.entryTime.split(' ')[0]
  };
}

// Realistic costs
const SPREAD_PIPS = 1.2;
const SLIPPAGE_PIPS = 0.5;
const COMMISSION_PIPS = 0.3;
const TOTAL_COST_PIPS = SPREAD_PIPS + SLIPPAGE_PIPS + COMMISSION_PIPS;

function runBacktest(pair: string, h4Raw: Candle[], m5Raw: Candle[], startDate?: string) {
  const h4 = [...h4Raw].reverse();
  let m5 = [...m5Raw].reverse();
  if (startDate) {
    const startTs = new Date(startDate).getTime();
    m5 = m5.filter(c => new Date(c.timestamp).getTime() >= startTs);
  }
  
  const trades: Trade[] = [];
  let lastSignalTime = 0;
  
  for (let i = 200; i < m5.length; i += 12) {
    const currentCandle = m5[i];
    const currentTime = new Date(currentCandle.timestamp).getTime();
    
    if (currentTime - lastSignalTime < 3600000) continue;
    
    const hour = new Date(currentCandle.timestamp).getUTCHours();
    if (hour < 7 || hour >= 21) continue;
    
    const h4Slice = h4.filter(h => new Date(h.timestamp).getTime() <= currentTime);
    if (h4Slice.length < 30) continue;
    
    const m5Slice = m5.slice(0, i + 1);
    const signal = detectSignalV2(pair, h4Slice, m5Slice);
    
    if (signal) {
      const futureCandles = m5.slice(i + 1, Math.min(i + 201, m5.length));
      const tradeSignal = {
        ...signal,
        entryTime: m5Slice[signal.candleIndex]?.timestamp || currentCandle.timestamp
      };
      const trade = simulateTrade(pair, tradeSignal, futureCandles);
      trades.push(trade);
      lastSignalTime = currentTime;
    }
  }
  
  return trades;
}

function printStats(label: string, trades: Trade[]) {
  const closed = trades.filter(t => t.result !== 'OPEN');
  const wins = closed.filter(t => t.result.startsWith('WIN'));
  const losses = closed.filter(t => t.result === 'LOSS');
  
  if (closed.length === 0) {
    console.log(`\n${label}: No closed trades`);
    return;
  }
  
  const winRate = (wins.length / closed.length * 100);
  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pips, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + t.pips, 0)) / losses.length : 0;
  const totalPips = closed.reduce((s, t) => s + t.pips, 0);
  
  // Equity curve
  let equity = 0;
  let peak = 0;
  let maxDD = 0;
  for (const t of closed) {
    equity += t.pips;
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDD) maxDD = dd;
  }
  
  const startDate = trades[0].date;
  const endDate = trades[trades.length - 1].date;
  const days = (new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000;
  const signalsPerWeek = trades.length / (days / 7);
  
  console.log(`\n${'='.repeat(70)}`);
  console.log(`${label}`);
  console.log(`${'='.repeat(70)}`);
  console.log(`Period: ${startDate} to ${endDate} (${days.toFixed(0)} days)`);
  console.log(`Total trades: ${trades.length} (${signalsPerWeek.toFixed(1)}/week)`);
  console.log(`\nBefore costs:`);
  console.log(`  Win rate: ${winRate.toFixed(1)}% (${wins.length}/${closed.length})`);
  console.log(`  Avg win: ${avgWin.toFixed(2)} pips`);
  console.log(`  Avg loss: ${avgLoss.toFixed(2)} pips`);
  console.log(`  R:R: ${(avgWin / avgLoss).toFixed(2)}`);
  console.log(`  Total: ${totalPips.toFixed(1)} pips`);
  console.log(`  Max drawdown: ${maxDD.toFixed(2)} pips`);
  
  const netPips = totalPips - (closed.length * TOTAL_COST_PIPS);
  const netAvgWin = avgWin - TOTAL_COST_PIPS;
  const netAvgLoss = avgLoss + TOTAL_COST_PIPS;
  const netRR = netAvgLoss > 0 ? netAvgWin / netAvgLoss : 0;
  
  console.log(`\nAfter costs (${TOTAL_COST_PIPS} pips/trade):`);
  console.log(`  Avg net win: ${netAvgWin.toFixed(2)} pips`);
  console.log(`  Avg net loss: ${netAvgLoss.toFixed(2)} pips`);
  console.log(`  Net R:R: ${netRR.toFixed(2)}`);
  console.log(`  Net total: ${netPips.toFixed(1)} pips`);
  
  const breakevenWR = netRR > 0 ? (1 / (1 + netRR)) * 100 : 50;
  console.log(`\nStatistical checks:`);
  console.log(`  Break-even WR needed: ${breakevenWR.toFixed(1)}%`);
  console.log(`  Actual WR: ${winRate.toFixed(1)}%`);
  console.log(`  Edge: ${(winRate - breakevenWR).toFixed(1)} pp`);
  
  const se = Math.sqrt((winRate / 100) * (1 - winRate / 100) / closed.length) * 100;
  const ci = 1.96 * se;
  console.log(`  95% CI: ${Math.max(0, winRate - ci).toFixed(1)}% - ${Math.min(100, winRate + ci).toFixed(1)}%`);
  console.log(`  CI width: ${(ci * 2).toFixed(1)} pp`);
  
  if (netPips < 0) {
    console.log(`\n*** RESULT: LOSING after costs ***`);
  } else if (winRate - breakevenWR < 3) {
    console.log(`\n*** WARNING: Thin edge (<3 pp) ***`);
  } else {
    console.log(`\n*** RESULT: PROFITABLE after costs ***`);
  }
  
  return { winRate, totalPips, netPips, maxDD, signalsPerWeek };
}

// Correlation
function calcCorrelation(a: number[], b: number[]) {
  const n = Math.min(a.length, b.length);
  const aSlice = a.slice(0, n);
  const bSlice = b.slice(0, n);
  
  const meanA = aSlice.reduce((s, v) => s + v, 0) / n;
  const meanB = bSlice.reduce((s, v) => s + v, 0) / n;
  
  let num = 0, denA = 0, denB = 0;
  for (let i = 0; i < n; i++) {
    const da = aSlice[i] - meanA;
    const db = bSlice[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  
  return denA > 0 && denB > 0 ? num / Math.sqrt(denA * denB) : 0;
}

function getDailyReturns(trades: Trade[]) {
  const dailyPips: Record<string, number> = {};
  for (const t of trades) {
    if (!dailyPips[t.date]) dailyPips[t.date] = 0;
    dailyPips[t.date] += t.pips;
  }
  return Object.values(dailyPips);
}

try {
  const h4 = JSON.parse(readFileSync('.cache/EURUSD_4h_6m.json', 'utf-8')) as Candle[];
  const m5 = JSON.parse(readFileSync('.cache/EURUSD_5min_6m.json', 'utf-8')) as Candle[];
  
  console.log(`EURUSD 6-Month Audit with Realistic Costs`);
  console.log(`Data: ${h4.length} H4 candles, ${m5.length} M5 candles`);
  
  // Full period
  const all = runBacktest('EURUSD', h4, m5);
  printStats('FULL PERIOD (Jan-Jul 2026)', all);
  
  // Out-of-sample
  const trainEnd = '2026-05-01';
  const train = all.filter(t => t.date < trainEnd);
  const test = all.filter(t => t.date >= trainEnd);
  printStats('TRAIN SET (Jan-Apr 2026)', train);
  printStats('TEST SET (May-Jun 2026) - OUT OF SAMPLE', test);
  
  // Walk-forward
  console.log(`\n${'='.repeat(70)}`);
  console.log(`WALK-FORWARD VALIDATION`);
  console.log(`${'='.repeat(70)}`);
  
  const windows = [
    { train: null, test: '2026-02-01', label: 'Feb (train: Jan)' },
    { train: null, test: '2026-03-01', label: 'Mar (train: Jan-Feb)' },
    { train: null, test: '2026-04-01', label: 'Apr (train: Feb-Mar)' },
    { train: null, test: '2026-05-01', label: 'May (train: Mar-Apr)' },
    { train: null, test: '2026-06-01', label: 'Jun (train: Apr-May)' },
    { train: null, test: '2026-07-01', label: 'Jul (train: May-Jun)' },
  ];
  
  for (const w of windows) {
    const trainData = runBacktest('EURUSD', h4, m5, w.train || undefined);
    const testData = trainData.filter(t => t.date >= w.test);
    printStats(w.label, testData);
  }
  
  // Equity curve
  console.log(`\n${'='.repeat(70)}`);
  console.log(`EQUITY CURVE`);
  console.log(`${'='.repeat(70)}`);
  
  const closed = all.filter(t => t.result !== 'OPEN');
  let equity = 0;
  const curve: { date: string; equity: number }[] = [];
  for (const t of closed) {
    equity += t.pips;
    curve.push({ date: t.date, equity });
  }
  
  const step = Math.max(1, Math.floor(curve.length / 20));
  const maxEq = Math.max(...curve.map(c => c.equity));
  const minEq = Math.min(...curve.map(c => c.equity));
  const range = maxEq - minEq || 1;
  
  for (let i = 0; i < curve.length; i += step) {
    const c = curve[i];
    const barLen = Math.round(((c.equity - minEq) / range) * 40);
    const bar = '█'.repeat(barLen);
    console.log(`${c.date} ${c.equity >= 0 ? '+' : ''}${c.equity.toFixed(1).padStart(7)} |${bar}`);
  }
  
} catch (err: any) {
  console.error('Error:', err.message);
  console.error(err.stack);
}
