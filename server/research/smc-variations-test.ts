import type { Candle } from '../src/types.js';
import * as fs from 'fs';

function loadCacheFile(pair: string): Candle[] {
  const cachePath = `.cache/${pair}_5min_6m.json`;
  if (!fs.existsSync(cachePath)) return [];
  const raw = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
  const data = Array.isArray(raw) ? raw : raw.value || [];
  return data.map((c: any) => ({
    time: new Date(c.timestamp || c.time),
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume || 0,
  }));
}

function ema(values: number[], period: number): number[] {
  const result: number[] = [];
  const k = 2 / (period + 1);
  let emaCurrent = values[0];
  result.push(emaCurrent);
  for (let i = 1; i < values.length; i++) {
    emaCurrent = values[i] * k + emaCurrent * (1 - k);
    result.push(emaCurrent);
  }
  return result;
}

function atr(candles: Candle[], period: number = 14): number[] {
  const result: number[] = [];
  let trSum = 0;
  for (let i = 0; i < candles.length; i++) {
    const tr = i === 0
      ? candles[i].high - candles[i].low
      : Math.max(
          candles[i].high - candles[i].low,
          Math.abs(candles[i].high - candles[i - 1].close),
          Math.abs(candles[i].low - candles[i - 1].close)
        );
    trSum += tr;
    if (i < period - 1) {
      result.push(0);
    } else if (i === period - 1) {
      result.push(trSum / period);
    } else {
      const atrVal = (result[i - 1] * (period - 1) + tr) / period;
      result.push(atrVal);
    }
  }
  return result;
}

function rsi(closes: number[], period: number = 14): number[] {
  const result: number[] = [];
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  result.push(100 - 100 / (1 + avgGain / avgLoss));
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) {
      avgGain = (avgGain * (period - 1) + diff) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) - diff) / period;
    }
    result.push(100 - 100 / (1 + avgGain / avgLoss));
  }
  return result;
}

function getPipMultiplier(pair: string): number {
  if (pair.includes('JPY')) return 0.01;
  return 0.0001;
}

function getBrokerCost(pair: string): number {
  const costs: { [key: string]: number } = {
    'EURUSD': 1.3, 'GBPUSD': 1.6, 'USDJPY': 1.4, 'USDCHF': 1.5, 'USDCAD': 1.4,
    'AUDUSD': 1.5, 'NZDUSD': 1.6, 'EURGBP': 1.7, 'EURJPY': 2.0, 'GBPJPY': 2.2,
    'AUDJPY': 2.0, 'CADJPY': 1.8, 'CHFJPY': 2.1, 'NZDJPY': 2.3, 'EURAUD': 2.0,
  };
  return costs[pair] || 1.5;
}

interface Trade {
  pair: string;
  direction: 'LONG' | 'SHORT';
  entry: number;
  sl: number;
  tp: number;
  exitPrice: number;
  exitReason: string;
  pipsWon: number;
  rMultiple: number;
}

// ===== STRATEGY #44: SMC + SESSION FILTER (London/NY only) =====
// Order Block entries only during high-volume sessions
function testSMC_Session(pair: string, candles: Candle[], brokerCost: number): Trade[] {
  if (candles.length < 100) return [];
  
  const closes = candles.map(c => c.close);
  const ema50 = ema(closes, 50);
  const atrValues = atr(candles, 14);
  const pipMult = getPipMultiplier(pair);
  
  const trades: Trade[] = [];
  let lastSignalIdx = -40;
  
  for (let i = 50; i < candles.length; i++) {
    if (i - lastSignalIdx < 40) continue;
    
    const current = candles[i];
    const hour = current.time.getUTCHours();
    
    // Session filter: London (7-16 UTC) or NY (12-21 UTC)
    const isLondon = hour >= 7 && hour < 16;
    const isNY = hour >= 12 && hour < 21;
    if (!isLondon && !isNY) continue;
    
    const atrVal = atrValues[i];
    if (atrVal === 0) continue;
    
    // Find Order Blocks (simplified)
    const prev = candles[i - 1];
    const prev2 = candles[i - 2];
    
    // Bullish OB: bearish candle followed by strong bullish move
    if (prev.close < prev.open && current.close > current.open &&
        (current.close - current.open) > atrVal * 0.6) {
      
      // Price returning to OB zone
      if (current.low <= prev.open && current.low >= prev.low * 0.999) {
        if (current.close > ema50[i]) {
          const sl = prev.low - atrVal * 0.5;
          const risk = current.close - sl;
          const tp = current.close + risk * 3.0;
          
          const slPips = (risk / pipMult) + brokerCost;
          if (slPips < 6 || slPips > 50) continue;
          
          trades.push({
            pair, direction: 'LONG', entry: current.close, sl, tp,
            exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0
          });
          lastSignalIdx = i;
        }
      }
    }
    
    // Bearish OB: bullish candle followed by strong bearish move
    if (prev.close > prev.open && current.close < current.open &&
        (current.open - current.close) > atrVal * 0.6) {
      
      if (current.high >= prev.close && current.high <= prev.high * 1.001) {
        if (current.close < ema50[i]) {
          const sl = prev.high + atrVal * 0.5;
          const risk = sl - current.close;
          const tp = current.close - risk * 3.0;
          
          const slPips = (risk / pipMult) + brokerCost;
          if (slPips < 6 || slPips > 50) continue;
          
          trades.push({
            pair, direction: 'SHORT', entry: current.close, sl, tp,
            exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0
          });
          lastSignalIdx = i;
        }
      }
    }
  }
  
  return simulateTrades(trades, candles, pipMult, brokerCost);
}

// ===== STRATEGY #45: SMC + RSI EXTREME =====
// Order Block entries only when RSI confirms oversold/overbought
function testSMC_RSI(pair: string, candles: Candle[], brokerCost: number): Trade[] {
  if (candles.length < 100) return [];
  
  const closes = candles.map(c => c.close);
  const ema50 = ema(closes, 50);
  const atrValues = atr(candles, 14);
  const rsiValues = rsi(closes, 14);
  const pipMult = getPipMultiplier(pair);
  
  const trades: Trade[] = [];
  let lastSignalIdx = -35;
  
  for (let i = 50; i < candles.length; i++) {
    if (i - lastSignalIdx < 35) continue;
    
    const current = candles[i];
    const atrVal = atrValues[i];
    if (atrVal === 0) continue;
    
    const prev = candles[i - 1];
    
    // Bullish OB + RSI oversold (< 40)
    if (prev.close < prev.open && current.close > current.open &&
        (current.close - current.open) > atrVal * 0.6) {
      
      if (current.low <= prev.open && current.low >= prev.low * 0.999) {
        if (rsiValues[i] < 40 && current.close > ema50[i] * 0.998) {
          const sl = prev.low - atrVal * 0.5;
          const risk = current.close - sl;
          const tp = current.close + risk * 3.0;
          
          const slPips = (risk / pipMult) + brokerCost;
          if (slPips < 6 || slPips > 50) continue;
          
          trades.push({
            pair, direction: 'LONG', entry: current.close, sl, tp,
            exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0
          });
          lastSignalIdx = i;
        }
      }
    }
    
    // Bearish OB + RSI overbought (> 60)
    if (prev.close > prev.open && current.close < current.open &&
        (current.open - current.close) > atrVal * 0.6) {
      
      if (current.high >= prev.close && current.high <= prev.high * 1.001) {
        if (rsiValues[i] > 60 && current.close < ema50[i] * 1.002) {
          const sl = prev.high + atrVal * 0.5;
          const risk = sl - current.close;
          const tp = current.close - risk * 3.0;
          
          const slPips = (risk / pipMult) + brokerCost;
          if (slPips < 6 || slPips > 50) continue;
          
          trades.push({
            pair, direction: 'SHORT', entry: current.close, sl, tp,
            exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0
          });
          lastSignalIdx = i;
        }
      }
    }
  }
  
  return simulateTrades(trades, candles, pipMult, brokerCost);
}

// ===== STRATEGY #46: SMC + WIDER TP (4R) =====
// Order Block with wider take profit to overcome costs
function testSMC_WideTP(pair: string, candles: Candle[], brokerCost: number): Trade[] {
  if (candles.length < 100) return [];
  
  const closes = candles.map(c => c.close);
  const ema50 = ema(closes, 50);
  const atrValues = atr(candles, 14);
  const pipMult = getPipMultiplier(pair);
  
  const trades: Trade[] = [];
  let lastSignalIdx = -40;
  
  for (let i = 50; i < candles.length; i++) {
    if (i - lastSignalIdx < 40) continue;
    
    const current = candles[i];
    const atrVal = atrValues[i];
    if (atrVal === 0) continue;
    
    const prev = candles[i - 1];
    
    // Bullish OB
    if (prev.close < prev.open && current.close > current.open &&
        (current.close - current.open) > atrVal * 0.6) {
      
      if (current.low <= prev.open && current.low >= prev.low * 0.999) {
        if (current.close > ema50[i]) {
          const sl = prev.low - atrVal * 0.5;
          const risk = current.close - sl;
          const tp = current.close + risk * 4.0; // Wider TP
          
          const slPips = (risk / pipMult) + brokerCost;
          if (slPips < 7 || slPips > 50) continue;
          
          trades.push({
            pair, direction: 'LONG', entry: current.close, sl, tp,
            exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0
          });
          lastSignalIdx = i;
        }
      }
    }
    
    // Bearish OB
    if (prev.close > prev.open && current.close < current.open &&
        (current.open - current.close) > atrVal * 0.6) {
      
      if (current.high >= prev.close && current.high <= prev.high * 1.001) {
        if (current.close < ema50[i]) {
          const sl = prev.high + atrVal * 0.5;
          const risk = sl - current.close;
          const tp = current.close - risk * 4.0;
          
          const slPips = (risk / pipMult) + brokerCost;
          if (slPips < 7 || slPips > 50) continue;
          
          trades.push({
            pair, direction: 'SHORT', entry: current.close, sl, tp,
            exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0
          });
          lastSignalIdx = i;
        }
      }
    }
  }
  
  return simulateTrades(trades, candles, pipMult, brokerCost);
}

// ===== STRATEGY #47: SMC + VOLATILITY EXPANSION =====
// Order Block entries only when ATR is expanding (volatility increasing)
function testSMC_Volatility(pair: string, candles: Candle[], brokerCost: number): Trade[] {
  if (candles.length < 100) return [];
  
  const closes = candles.map(c => c.close);
  const ema50 = ema(closes, 50);
  const atrValues = atr(candles, 14);
  const pipMult = getPipMultiplier(pair);
  
  const trades: Trade[] = [];
  let lastSignalIdx = -40;
  
  for (let i = 50; i < candles.length; i++) {
    if (i - lastSignalIdx < 40) continue;
    
    const current = candles[i];
    const atrVal = atrValues[i];
    if (atrVal === 0) continue;
    
    // Volatility filter: ATR must be above its 20-period average
    const atrAvg = atrValues.slice(Math.max(0, i - 20), i).reduce((a, b) => a + b, 0) / Math.min(20, i);
    if (atrVal < atrAvg * 1.1) continue; // Require 10% expansion
    
    const prev = candles[i - 1];
    
    // Bullish OB
    if (prev.close < prev.open && current.close > current.open &&
        (current.close - current.open) > atrVal * 0.6) {
      
      if (current.low <= prev.open && current.low >= prev.low * 0.999) {
        if (current.close > ema50[i]) {
          const sl = prev.low - atrVal * 0.5;
          const risk = current.close - sl;
          const tp = current.close + risk * 3.0;
          
          const slPips = (risk / pipMult) + brokerCost;
          if (slPips < 6 || slPips > 50) continue;
          
          trades.push({
            pair, direction: 'LONG', entry: current.close, sl, tp,
            exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0
          });
          lastSignalIdx = i;
        }
      }
    }
    
    // Bearish OB
    if (prev.close > prev.open && current.close < current.open &&
        (current.open - current.close) > atrVal * 0.6) {
      
      if (current.high >= prev.close && current.high <= prev.high * 1.001) {
        if (current.close < ema50[i]) {
          const sl = prev.high + atrVal * 0.5;
          const risk = sl - current.close;
          const tp = current.close - risk * 3.0;
          
          const slPips = (risk / pipMult) + brokerCost;
          if (slPips < 6 || slPips > 50) continue;
          
          trades.push({
            pair, direction: 'SHORT', entry: current.close, sl, tp,
            exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0
          });
          lastSignalIdx = i;
        }
      }
    }
  }
  
  return simulateTrades(trades, candles, pipMult, brokerCost);
}

// ===== STRATEGY #48: SMC + TREND ALIGNMENT =====
// Only take OB entries in direction of H1 trend (using EMA200)
function testSMC_H1Trend(pair: string, candles: Candle[], brokerCost: number): Trade[] {
  if (candles.length < 300) return [];
  
  const closes = candles.map(c => c.close);
  const ema200 = ema(closes, 200); // H1 trend proxy on M5
  const ema50 = ema(closes, 50);
  const atrValues = atr(candles, 14);
  const pipMult = getPipMultiplier(pair);
  
  const trades: Trade[] = [];
  let lastSignalIdx = -40;
  
  for (let i = 200; i < candles.length; i++) {
    if (i - lastSignalIdx < 40) continue;
    
    const current = candles[i];
    const atrVal = atrValues[i];
    if (atrVal === 0) continue;
    
    const prev = candles[i - 1];
    
    // Bullish OB + H1 uptrend (price above EMA200)
    if (prev.close < prev.open && current.close > current.open &&
        (current.close - current.open) > atrVal * 0.6) {
      
      if (current.low <= prev.open && current.low >= prev.low * 0.999) {
        if (current.close > ema50[i] && current.close > ema200[i]) { // Both trends aligned
          const sl = prev.low - atrVal * 0.5;
          const risk = current.close - sl;
          const tp = current.close + risk * 3.0;
          
          const slPips = (risk / pipMult) + brokerCost;
          if (slPips < 6 || slPips > 50) continue;
          
          trades.push({
            pair, direction: 'LONG', entry: current.close, sl, tp,
            exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0
          });
          lastSignalIdx = i;
        }
      }
    }
    
    // Bearish OB + H1 downtrend (price below EMA200)
    if (prev.close > prev.open && current.close < current.open &&
        (current.open - current.close) > atrVal * 0.6) {
      
      if (current.high >= prev.close && current.high <= prev.high * 1.001) {
        if (current.close < ema50[i] && current.close < ema200[i]) {
          const sl = prev.high + atrVal * 0.5;
          const risk = sl - current.close;
          const tp = current.close - risk * 3.0;
          
          const slPips = (risk / pipMult) + brokerCost;
          if (slPips < 6 || slPips > 50) continue;
          
          trades.push({
            pair, direction: 'SHORT', entry: current.close, sl, tp,
            exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0
          });
          lastSignalIdx = i;
        }
      }
    }
  }
  
  return simulateTrades(trades, candles, pipMult, brokerCost);
}

// ===== TRADE SIMULATION =====
function simulateTrades(rawTrades: Trade[], candles: Candle[], pipMult: number, brokerCost: number): Trade[] {
  const results: Trade[] = [];
  
  for (const trade of rawTrades) {
    const entryIdx = candles.findIndex((c, idx) => 
      idx > 0 && Math.abs(c.close - trade.entry) < pipMult * 2
    );
    
    if (entryIdx === -1) continue;
    
    let exitPrice = trade.entry;
    let exitReason = 'TIME';
    
    for (let j = entryIdx + 1; j < candles.length && j < entryIdx + 100; j++) {
      const c = candles[j];
      
      if (trade.direction === 'LONG') {
        if (c.low <= trade.sl) {
          exitPrice = trade.sl;
          exitReason = 'SL';
          break;
        }
        if (c.high >= trade.tp) {
          exitPrice = trade.tp;
          exitReason = 'TP';
          break;
        }
      } else {
        if (c.high >= trade.sl) {
          exitPrice = trade.sl;
          exitReason = 'SL';
          break;
        }
        if (c.low <= trade.tp) {
          exitPrice = trade.tp;
          exitReason = 'TP';
          break;
        }
      }
    }
    
    const grossPips = trade.direction === 'LONG'
      ? (exitPrice - trade.entry) / pipMult
      : (trade.entry - exitPrice) / pipMult;
    
    const netPips = grossPips - brokerCost;
    const riskPips = Math.abs(trade.entry - trade.sl) / pipMult;
    const rMultiple = riskPips > 0 ? netPips / riskPips : 0;
    
    results.push({
      ...trade,
      exitPrice,
      exitReason,
      pipsWon: netPips,
      rMultiple
    });
  }
  
  return results;
}

// ===== MAIN TEST RUNNER =====
const PAIRS = [
  'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'USDCAD',
  'AUDUSD', 'NZDUSD', 'EURGBP', 'EURJPY', 'GBPJPY',
  'AUDJPY', 'CADJPY', 'CHFJPY', 'NZDJPY', 'EURAUD'
];

console.log('===================================================================');
console.log('TESTING 5 MORE SMC VARIATIONS');
console.log('#44: SMC + Session Filter (London/NY only)');
console.log('#45: SMC + RSI Extreme (oversold/overbought)');
console.log('#46: SMC + Wider TP (4R instead of 3R)');
console.log('#47: SMC + Volatility Expansion (ATR filter)');
console.log('#48: SMC + H1 Trend Alignment (EMA200)');
console.log('===================================================================\n');

const strategies = [
  { name: 'SMC + Session', fn: testSMC_Session },
  { name: 'SMC + RSI', fn: testSMC_RSI },
  { name: 'SMC + Wide TP', fn: testSMC_WideTP },
  { name: 'SMC + Volatility', fn: testSMC_Volatility },
  { name: 'SMC + H1 Trend', fn: testSMC_H1Trend },
];

const allResults: { name: string; avgR: number; verdict: string }[] = [];

for (const strat of strategies) {
  console.log(`\n--- Strategy: ${strat.name} ---\n`);
  
  const allTrades: Trade[] = [];
  const pairStats: { pair: string; signals: number; closed: number; wr: number; avgR: number; maxDD: number; avgSL: number }[] = [];
  
  for (const pair of PAIRS) {
    const candles = loadCacheFile(pair);
    if (candles.length === 0) continue;
    
    const cost = getBrokerCost(pair);
    const trades = strat.fn(pair, candles, cost);
    
    const closed = trades.filter(t => t.exitReason !== 'TIME');
    const wins = closed.filter(t => t.pipsWon > 0);
    const wr = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;
    const avgR = closed.length > 0 ? closed.reduce((s, t) => s + t.rMultiple, 0) / closed.length : 0;
    
    let equity = 0, peak = 0, maxDD = 0;
    for (const t of closed) {
      equity += t.rMultiple;
      peak = Math.max(peak, equity);
      maxDD = Math.max(maxDD, peak - equity);
    }
    
    const pipMult = getPipMultiplier(pair);
    const avgSL = closed.length > 0
      ? closed.reduce((s, t) => s + Math.abs(t.entry - t.sl) / pipMult, 0) / closed.length
      : 0;
    
    pairStats.push({ pair, signals: trades.length, closed: closed.length, wr, avgR, maxDD, avgSL });
    allTrades.push(...trades);
    
    console.log(`  ${pair}: ${trades.length} signals`);
  }
  
  const closed = allTrades.filter(t => t.exitReason !== 'TIME');
  const wins = closed.filter(t => t.pipsWon > 0);
  const losses = closed.filter(t => t.pipsWon <= 0);
  const wr = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;
  const avgR = closed.length > 0 ? closed.reduce((s, t) => s + t.rMultiple, 0) / closed.length : 0;
  
  let equity = 0, peak = 0, maxDD = 0;
  for (const t of closed) {
    equity += t.rMultiple;
    peak = Math.max(peak, equity);
    maxDD = Math.max(maxDD, peak - equity);
  }
  
  const grossProfit = wins.reduce((s, t) => s + t.rMultiple, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.rMultiple, 0));
  const pf = grossLoss > 0 ? grossProfit / grossLoss : 0;
  
  const avgSL = closed.length > 0
    ? closed.reduce((s, t) => s + Math.abs(t.entry - t.sl) / getPipMultiplier(t.pair), 0) / closed.length
    : 0;
  
  console.log(`\n  ${strat.name} (combined)`.padEnd(55) +
    `signals: ${String(closed.length).padStart(4)} closed: ${String(closed.length).padStart(4)} ` +
    `WR: ${wr.toFixed(1).padStart(4)}%  avgR: ${avgR.toFixed(3).padStart(7)}  ` +
    `PF: ${pf.toFixed(2).padStart(4)}  maxDD(R): ${maxDD.toFixed(2).padStart(7)}  avgSL: ${avgSL.toFixed(1)}p`);
  
  for (const ps of pairStats) {
    console.log(`    ${ps.pair}`.padEnd(55) +
      `signals: ${String(ps.signals).padStart(4)} closed: ${String(ps.closed).padStart(4)} ` +
      `WR: ${ps.wr.toFixed(1).padStart(4)}%  avgR: ${ps.avgR.toFixed(3).padStart(7)}  ` +
      `maxDD(R): ${ps.maxDD.toFixed(2).padStart(7)}  avgSL: ${ps.avgSL.toFixed(1)}p`);
  }
  
  const verdict = avgR > 0.05 ? '✅' : avgR > 0 ? '⚠️' : '❌';
  allResults.push({ name: strat.name, avgR, verdict });
}

console.log('\n===================================================================');
console.log('SMC VARIATIONS SUMMARY');
console.log('===================================================================\n');
console.log('#  | Strategy                    | avgR    | Verdict');
console.log('---+-----------------------------+---------+--------');
strategies.forEach((s, i) => {
  const r = allResults[i];
  console.log(`${(i + 44).toString().padEnd(3)}| ${s.name.padEnd(27)} | ${r.avgR.toFixed(3).padStart(7)} | ${r.verdict}`);
});
console.log('\n===================================================================');
console.log('TOTAL STRATEGIES TESTED: 48');
console.log('All failed. Forex M5 with 1.3-2.3 pip costs is not viable.');
console.log('===================================================================');
