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

// ===== STRATEGY: JPY CROSS MOMENTUM WITH TRAILING STOP =====
// Only trade JPY crosses (most volatile), use trailing stop to capture big moves
function testJPYMomentumTrailing(pair: string, candles: Candle[], brokerCost: number): Trade[] {
  if (!pair.includes('JPY')) return []; // Only JPY crosses
  if (candles.length < 250) return [];

  const closes = candles.map(c => c.close);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);
  const atrValues = atr(candles, 14);

  const trades: Trade[] = [];
  const pipMult = getPipMultiplier(pair);
  let lastSignalIdx = -80;

  for (let i = 200; i < candles.length; i++) {
    if (i - lastSignalIdx < 80) continue;

    const current = candles[i];
    const ema20Val = ema20[i];
    const ema50Val = ema50[i];
    const ema200Val = ema200[i];
    const atrVal = atrValues[i];

    // ===== LONG: Strong uptrend, pullback to EMA20, bounce =====
    const strongUptrend = 
      current.close > ema200Val &&
      ema20Val > ema50Val &&
      ema50Val > ema200Val &&
      ema200[i] > ema200[Math.max(0, i - 15)]; // EMA200 rising

    if (strongUptrend) {
      // Pullback: price touched EMA20 zone (tighter pullback)
      const nearEMA20 = current.low <= ema20Val * 1.002 && current.close > ema20Val;
      const bounce = current.close > current.open && (current.close - current.open) > atrVal * 0.3;

      if (nearEMA20 && bounce) {
        const entry = current.close;
        const sl = entry - atrVal * 1.5; // 1.5x ATR stop
        const slPips = Math.abs(entry - sl) / pipMult;

        if (slPips < 10 || slPips > 40) continue;

        // Use trailing stop: move SL up as price moves in our favor
        let exitPrice = entry;
        let exitReason = 'OPEN';
        let currentSL = sl;
        let maxProfit = 0;

        for (let j = i + 1; j < Math.min(i + 400, candles.length); j++) {
          const candle = candles[j];
          const profitPips = (candle.high - entry) / pipMult;
          
          // Update max profit
          if (profitPips > maxProfit) {
            maxProfit = profitPips;
            
            // Trail stop: move SL up by 1x ATR for every 10 pips of profit
            if (maxProfit > 10) {
              const trailAmount = Math.floor(maxProfit / 10) * atrVal;
              const newSL = entry + trailAmount - atrVal * 0.5;
              if (newSL > currentSL) {
                currentSL = newSL;
              }
            }
          }

          // Check if SL hit
          if (candle.low <= currentSL) {
            exitPrice = currentSL;
            exitReason = maxProfit > 10 ? 'TRAILING_STOP' : 'SL';
            break;
          }

          // Exit if trend reverses
          if (candle.close < ema50[j]) {
            exitPrice = candle.close;
            exitReason = 'TREND_REVERSAL';
            break;
          }
        }

        const grossPips = (exitPrice - entry) / pipMult;
        const netPips = grossPips - brokerCost;
        const rMultiple = netPips / slPips;

        trades.push({
          pair,
          direction: 'LONG',
          entry,
          sl,
          tp: 0, // No fixed TP
          exitPrice,
          exitReason,
          pipsWon: netPips,
          rMultiple,
        });

        lastSignalIdx = i;
      }
    }

    // ===== SHORT: Strong downtrend, pullback to EMA20, bounce down =====
    const strongDowntrend =
      current.close < ema200Val &&
      ema20Val < ema50Val &&
      ema50Val < ema200Val &&
      ema200[i] < ema200[Math.max(0, i - 15)]; // EMA200 falling

    if (strongDowntrend) {
      const nearEMA20 = current.high >= ema20Val * 0.998 && current.close < ema20Val;
      const bounce = current.close < current.open && (current.open - current.close) > atrVal * 0.3;

      if (nearEMA20 && bounce) {
        const entry = current.close;
        const sl = entry + atrVal * 1.5;
        const slPips = Math.abs(entry - sl) / pipMult;

        if (slPips < 10 || slPips > 40) continue;

        let exitPrice = entry;
        let exitReason = 'OPEN';
        let currentSL = sl;
        let maxProfit = 0;

        for (let j = i + 1; j < Math.min(i + 400, candles.length); j++) {
          const candle = candles[j];
          const profitPips = (entry - candle.low) / pipMult;
          
          if (profitPips > maxProfit) {
            maxProfit = profitPips;
            
            if (maxProfit > 10) {
              const trailAmount = Math.floor(maxProfit / 10) * atrVal;
              const newSL = entry - trailAmount + atrVal * 0.5;
              if (newSL < currentSL) {
                currentSL = newSL;
              }
            }
          }

          if (candle.high >= currentSL) {
            exitPrice = currentSL;
            exitReason = maxProfit > 10 ? 'TRAILING_STOP' : 'SL';
            break;
          }

          if (candle.close > ema50[j]) {
            exitPrice = candle.close;
            exitReason = 'TREND_REVERSAL';
            break;
          }
        }

        const grossPips = (entry - exitPrice) / pipMult;
        const netPips = grossPips - brokerCost;
        const rMultiple = netPips / slPips;

        trades.push({
          pair,
          direction: 'SHORT',
          entry,
          sl,
          tp: 0,
          exitPrice,
          exitReason,
          pipsWon: netPips,
          rMultiple,
        });

        lastSignalIdx = i;
      }
    }
  }

  return trades;
}

// Only test JPY crosses
const pairs = ['EURJPY', 'GBPJPY', 'AUDJPY', 'CADJPY', 'CHFJPY', 'NZDJPY', 'USDJPY'];

console.log('===================================================================');
console.log('STRATEGY #23: JPY CROSS MOMENTUM WITH TRAILING STOP');
console.log('Only trade JPY crosses (most volatile pairs)');
console.log('Entry: Strong trend, pullback to EMA20, momentum bounce');
console.log('Exit: Trailing stop (move SL up as price moves in favor)');
console.log('Key insight: Let winners run, cut losers quickly');
console.log('Real costs: 1.8-2.3 pips per pair');
console.log('===================================================================\n');

const allTrades: Trade[] = [];
const pairResults: { [key: string]: Trade[] } = {};

for (const pair of pairs) {
  const candles = loadCacheFile(pair);
  if (candles.length < 250) {
    console.log(`  ${pair}: SKIP (insufficient cache)`);
    continue;
  }

  const cost = getBrokerCost(pair);
  const trades = testJPYMomentumTrailing(pair, candles, cost);
  pairResults[pair] = trades;
  allTrades.push(...trades);
  console.log(`  ${pair}: ${trades.length} signals`);
}

console.log(`\nTotal signals: ${allTrades.length}\n`);

function analyzeResults(trades: Trade[], label: string) {
  if (trades.length === 0) {
    console.log(`  ${label.padEnd(50)} signals:    0 closed:    0 WR:   N/A  avgR:   N/A  PF:  N/A`);
    return;
  }

  const closed = trades.filter(t => t.exitReason !== 'OPEN');
  const wins = closed.filter(t => t.pipsWon > 0);
  const losses = closed.filter(t => t.pipsWon <= 0);

  const wr = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;
  const avgR = closed.length > 0 ? closed.reduce((sum, t) => sum + t.rMultiple, 0) / closed.length : 0;
  const avgWin = wins.length > 0 ? wins.reduce((sum, t) => sum + t.pipsWon, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((sum, t) => sum + t.pipsWon, 0) / losses.length : 0;
  const pf = avgLoss !== 0 ? Math.abs((wins.length * avgWin) / (losses.length * avgLoss)) : 0;

  let cumR = 0, maxDD = 0;
  for (const trade of closed) {
    cumR += trade.rMultiple;
    if (cumR < maxDD) maxDD = cumR;
  }
  maxDD = Math.abs(maxDD);

  const avgSL = closed.length > 0 ? closed.reduce((sum, t) => sum + Math.abs(t.entry - t.sl) / getPipMultiplier(t.pair), 0) / closed.length : 0;
  const avgExit = closed.length > 0 ? closed.reduce((sum, t) => sum + Math.abs(t.exitPrice - t.entry) / getPipMultiplier(t.pair), 0) / closed.length : 0;

  console.log(`  ${label.padEnd(50)} signals:${trades.length.toString().padStart(5)} closed:${closed.length.toString().padStart(5)} WR:${wr.toFixed(1).padStart(5)}%  avgR:${avgR.toFixed(3).padStart(7)}  PF:${pf.toFixed(2).padStart(5)}  maxDD(R):${maxDD.toFixed(2).padStart(7)}  avgSL:${avgSL.toFixed(1).padStart(5)}p  avgExit:${avgExit.toFixed(1).padStart(5)}p`);
}

console.log('--- Full 6-month period (with real per-pair costs) ---\n');
analyzeResults(allTrades, 'JPY Momentum Trailing');

console.log('\n--- Per-pair breakdown ---\n');
for (const pair of pairs) {
  const trades = pairResults[pair] || [];
  if (trades.length > 0) {
    analyzeResults(trades, `  ${pair}`);
  }
}

// Exit reason breakdown
const exitReasons: { [key: string]: number } = {};
for (const t of allTrades) {
  exitReasons[t.exitReason] = (exitReasons[t.exitReason] || 0) + 1;
}
console.log('\n--- Exit reason breakdown ---\n');
for (const [reason, count] of Object.entries(exitReasons)) {
  const pct = ((count / allTrades.length) * 100).toFixed(1);
  console.log(`  ${reason}: ${count} (${pct}%)`);
}

const closed = allTrades.filter(t => t.exitReason !== 'OPEN');
const wins = closed.filter(t => t.pipsWon > 0);
const avgR = closed.length > 0 ? closed.reduce((sum, t) => sum + t.rMultiple, 0) / closed.length : 0;
const wr = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;

console.log('\n===================================================================');
if (avgR > 0 && wr > 50) {
  console.log('✅ JPY MOMENTUM TRAILING PASSES');
  console.log(`   Win Rate: ${wr.toFixed(1)}%, Avg R: ${avgR.toFixed(3)}`);
} else if (avgR > 0) {
  console.log('⚠️  MARGINAL — Positive avgR but low win rate');
  console.log(`   Win Rate: ${wr.toFixed(1)}%, Avg R: ${avgR.toFixed(3)}`);
} else {
  console.log('❌ JPY MOMENTUM TRAILING FAILS');
  console.log(`   Win Rate: ${wr.toFixed(1)}%, Avg R: ${avgR.toFixed(3)}`);
}
console.log('===================================================================\n');

fs.writeFileSync('jpy-momentum-trailing-results.json', JSON.stringify({ allTrades, pairResults }, null, 2));
console.log('Saved to jpy-momentum-trailing-results.json');
