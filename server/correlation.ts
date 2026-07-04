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
      if (c.high >= trade.tp3 && !hitTP3) { hitTP3 = true; exitPrice = trade.tp3; exitTime = c.timestamp; }
      if (c.high >= trade.tp2 && !hitTP2) { hitTP2 = true; if (!hitTP3) { exitPrice = trade.tp2; exitTime = c.timestamp; } }
      if (c.high >= trade.tp1 && !hitTP1) { hitTP1 = true; if (!hitTP2 && !hitTP3) { exitPrice = trade.tp1; exitTime = c.timestamp; } }
      if (c.low <= trade.sl) {
        if (hitTP3 || hitTP2 || hitTP1) { result = hitTP3 ? 'WIN_TP3' : hitTP2 ? 'WIN_TP2' : 'WIN_TP1'; }
        else { exitPrice = trade.sl; exitTime = c.timestamp; result = 'LOSS'; }
        break;
      }
    } else {
      if (c.low <= trade.tp3 && !hitTP3) { hitTP3 = true; exitPrice = trade.tp3; exitTime = c.timestamp; }
      if (c.low <= trade.tp2 && !hitTP2) { hitTP2 = true; if (!hitTP3) { exitPrice = trade.tp2; exitTime = c.timestamp; } }
      if (c.low <= trade.tp1 && !hitTP1) { hitTP1 = true; if (!hitTP2 && !hitTP3) { exitPrice = trade.tp1; exitTime = c.timestamp; } }
      if (c.high >= trade.sl) {
        if (hitTP3 || hitTP2 || hitTP1) { result = hitTP3 ? 'WIN_TP3' : hitTP2 ? 'WIN_TP2' : 'WIN_TP1'; }
        else { exitPrice = trade.sl; exitTime = c.timestamp; result = 'LOSS'; }
        break;
      }
    }
  }
  
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

const SPREAD_PIPS = 1.2;
const SLIPPAGE_PIPS = 0.5;
const COMMISSION_PIPS = 0.3;
const TOTAL_COST_PIPS = SPREAD_PIPS + SLIPPAGE_PIPS + COMMISSION_PIPS;

function runBacktest(pair: string, h4Raw: Candle[], m5Raw: Candle[], startDate?: string): Trade[] {
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

function getStats(trades: Trade[]) {
  const closed = trades.filter(t => t.result !== 'OPEN');
  const wins = closed.filter(t => t.result.startsWith('WIN'));
  const losses = closed.filter(t => t.result === 'LOSS');
  
  const winRate = closed.length > 0 ? (wins.length / closed.length * 100) : 0;
  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pips, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + t.pips, 0)) / losses.length : 0;
  const rr = avgLoss > 0 ? avgWin / avgLoss : 0;
  const grossPips = closed.reduce((s, t) => s + t.pips, 0);
  const netPips = grossPips - (closed.length * TOTAL_COST_PIPS);
  
  return { trades: trades.length, closed: closed.length, wins: wins.length, losses: losses.length, winRate, avgWin, avgLoss, rr, grossPips, netPips };
}

function getDailyReturns(trades: Trade[]): Map<string, number> {
  const daily: Map<string, number> = new Map();
  const closed = trades.filter(t => t.result !== 'OPEN');
  for (const t of closed) {
    daily.set(t.date, (daily.get(t.date) || 0) + t.pips);
  }
  return daily;
}

function calcCorrelation(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  const meanA = a.reduce((s, v) => s + v, 0) / a.length;
  const meanB = b.reduce((s, v) => s + v, 0) / b.length;
  
  let num = 0, denA = 0, denB = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - meanA) * (b[i] - meanB);
    denA += (a[i] - meanA) ** 2;
    denB += (b[i] - meanB) ** 2;
  }
  
  const denom = Math.sqrt(denA * denB);
  return denom === 0 ? 0 : num / denom;
}

console.log('Cross-Pair Correlation Analysis');
console.log('================================\n');

const pairs = ['EURUSD', 'USDJPY', 'AUDNZD'];
const allTrades: Map<string, Trade[]> = new Map();
const allReturns: Map<string, Map<string, number>> = new Map();

for (const pair of pairs) {
  console.log(`Loading ${pair}...`);
  const h4 = JSON.parse(readFileSync(`.cache/${pair}_4h_6m.json`, 'utf-8')) as Candle[];
  const m5 = JSON.parse(readFileSync(`.cache/${pair}_5min_6m.json`, 'utf-8')) as Candle[];
  
  const trades = runBacktest(pair, h4, m5);
  const stats = getStats(trades);
  const dailyReturns = getDailyReturns(trades);
  
  allTrades.set(pair, trades);
  allReturns.set(pair, dailyReturns);
  
  console.log(`  ${pair}: ${stats.trades} trades, WR ${stats.winRate.toFixed(1)}%, Gross ${stats.grossPips.toFixed(1)} pips, Net ${stats.netPips.toFixed(1)} pips\n`);
}

console.log('Correlation Matrix (Daily Returns)');
console.log('----------------------------------');

const allDates = new Set<string>();
for (const returns of allReturns.values()) {
  for (const date of returns.keys()) {
    allDates.add(date);
  }
}
const sortedDates = Array.from(allDates).sort();

console.log(`Found ${sortedDates.length} unique trading days\n`);

for (let i = 0; i < pairs.length; i++) {
  for (let j = 0; j < pairs.length; j++) {
    if (i === j) {
      console.log(`${pairs[i]} vs ${pairs[j]}: 1.000 (self)`);
      continue;
    }
    
    const returnsA = allReturns.get(pairs[i])!;
    const returnsB = allReturns.get(pairs[j])!;
    
    const vecA: number[] = [];
    const vecB: number[] = [];
    
    for (const date of sortedDates) {
      vecA.push(returnsA.get(date) || 0);
      vecB.push(returnsB.get(date) || 0);
    }
    
    const corr = calcCorrelation(vecA, vecB);
    console.log(`${pairs[i]} vs ${pairs[j]}: ${corr.toFixed(3)}`);
  }
}

console.log('\nInterpretation:');
console.log('- Correlation > 0.7: High (signals are correlated, less diversification)');
console.log('- Correlation 0.3-0.7: Moderate');
console.log('- Correlation < 0.3: Low (good diversification)');
console.log('- Correlation < 0: Negative (hedge effect)');
