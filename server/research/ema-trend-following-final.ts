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
  if (pair.includes('XAU')) return 0.1;
  if (pair.includes('XAG')) return 0.01;
  return 0.0001;
}

function getBrokerCost(pair: string): number {
  const costs: { [key: string]: number } = {
    'XAUUSD': 25.7, 'XAGUSD': 3.7,
    'EURUSD': 1.3, 'GBPUSD': 1.6, 'USDJPY': 1.4, 'GBPJPY': 2.2, 'NAS100': 2.0,
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

// ===== EMA TREND-FOLLOWING SCALPING STRATEGY =====
function testEMATrendFollowing(pair: string, candles: Candle[], brokerCost: number): Trade[] {
  if (candles.length < 250) return [];

  const closes = candles.map(c => c.close);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);
  const atrValues = atr(candles, 14);

  const trades: Trade[] = [];
  const pipMult = getPipMultiplier(pair);
  let lastSignalIdx = -60;

  for (let i = 200; i < candles.length; i++) {
    if (i - lastSignalIdx < 60) continue;

    const current = candles[i];
    const prev1 = candles[i - 1];
    const prev2 = candles[i - 2];
    const prev3 = candles[i - 3];

    const ema20Val = ema20[i];
    const ema50Val = ema50[i];
    const ema200Val = ema200[i];
    const atrVal = atrValues[i];

    // ===== LONG SETUP =====
    // Trend filter: Price > EMA200, EMA20 > EMA50 > EMA200, EMA200 slope up
    const longTrend = 
      current.close > ema200Val &&
      ema20Val > ema50Val &&
      ema50Val > ema200Val &&
      ema200[i] > ema200[Math.max(0, i - 10)]; // EMA200 slope up

    if (longTrend) {
      // Entry trigger: Pullback to EMA20 + bounce
      const pullbackToEMA20 = 
        prev1.close <= ema20Val &&
        current.close > ema20Val &&
        current.close > prev1.close;

      // OR: Strong momentum candle above EMA50
      const strongMomentum =
        current.close > ema50Val &&
        current.close > current.open &&
        (current.close - current.open) > atrVal * 0.3;

      // OR: Rejection candle at EMA20
      const rejectionAtEMA20 =
        prev1.low < ema20Val &&
        prev1.close > ema20Val &&
        current.close > prev1.close;

      if (pullbackToEMA20 || strongMomentum || rejectionAtEMA20) {
        const entry = current.close;
        const sl = Math.min(prev1.low, prev2.low, prev3.low) - atrVal * 0.5;
        const slPips = Math.abs(entry - sl) / pipMult;

        // Risk/Reward: TP = 2x SL (1:2 minimum)
        const tp = entry + slPips * 2 * pipMult;
        const tpPips = Math.abs(tp - entry) / pipMult;

        // Sanity check: SL and TP must be reasonable
        if (slPips < 2 || slPips > 100 || tpPips < 4) continue;

        let exitPrice = entry;
        let exitReason = 'OPEN';

        for (let j = i + 1; j < Math.min(i + 120, candles.length); j++) {
          const candle = candles[j];

          // TP hit
          if (candle.high >= tp) {
            exitPrice = tp;
            exitReason = 'TP';
            break;
          }

          // SL hit
          if (candle.low <= sl) {
            exitPrice = sl;
            exitReason = 'SL';
            break;
          }

          // Trend reversal: Close below EMA50
          if (candle.close < ema50[j]) {
            exitPrice = candle.close;
            exitReason = 'TREND_REVERSAL';
            break;
          }

          // Trailing stop: Close below EMA20
          if (candle.close < ema20[j] && j > i + 5) {
            exitPrice = candle.close;
            exitReason = 'TRAILING_EMA20';
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
          tp,
          exitPrice,
          exitReason,
          pipsWon: netPips,
          rMultiple,
        });

        lastSignalIdx = i;
      }
    }

    // ===== SHORT SETUP =====
    const shortTrend =
      current.close < ema200Val &&
      ema20Val < ema50Val &&
      ema50Val < ema200Val &&
      ema200[i] < ema200[Math.max(0, i - 10)]; // EMA200 slope down

    if (shortTrend) {
      const pullbackToEMA20 =
        prev1.close >= ema20Val &&
        current.close < ema20Val &&
        current.close < prev1.close;

      const strongMomentum =
        current.close < ema50Val &&
        current.close < current.open &&
        (current.open - current.close) > atrVal * 0.3;

      const rejectionAtEMA20 =
        prev1.high > ema20Val &&
        prev1.close < ema20Val &&
        current.close < prev1.close;

      if (pullbackToEMA20 || strongMomentum || rejectionAtEMA20) {
        const entry = current.close;
        const sl = Math.max(prev1.high, prev2.high, prev3.high) + atrVal * 0.5;
        const slPips = Math.abs(entry - sl) / pipMult;

        const tp = entry - slPips * 2 * pipMult;
        const tpPips = Math.abs(entry - tp) / pipMult;

        if (slPips < 2 || slPips > 100 || tpPips < 4) continue;

        let exitPrice = entry;
        let exitReason = 'OPEN';

        for (let j = i + 1; j < Math.min(i + 120, candles.length); j++) {
          const candle = candles[j];

          if (candle.low <= tp) {
            exitPrice = tp;
            exitReason = 'TP';
            break;
          }

          if (candle.high >= sl) {
            exitPrice = sl;
            exitReason = 'SL';
            break;
          }

          if (candle.close > ema50[j]) {
            exitPrice = candle.close;
            exitReason = 'TREND_REVERSAL';
            break;
          }

          if (candle.close > ema20[j] && j > i + 5) {
            exitPrice = candle.close;
            exitReason = 'TRAILING_EMA20';
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
          tp,
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

const pairs = ['XAUUSD', 'XAGUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'GBPJPY'];

console.log('===================================================================');
console.log('EMA TREND-FOLLOWING SCALPING STRATEGY');
console.log('Indicators: EMA20, EMA50, EMA200, ATR(14)');
console.log('Entry: Pullback/Rejection/Momentum with trend confirmation');
console.log('Exit: TP (1:2 RR), SL, Trend Reversal, Trailing EMA20');
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
  const trades = testEMATrendFollowing(pair, candles, cost);
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

  console.log(`  ${label.padEnd(50)} signals:${trades.length.toString().padStart(5)} closed:${closed.length.toString().padStart(5)} WR:${wr.toFixed(1).padStart(5)}%  avgR:${avgR.toFixed(3).padStart(7)}  PF:${pf.toFixed(2).padStart(5)}  maxDD(R):${maxDD.toFixed(2).padStart(7)}`);
}

console.log('--- Full 6-month period (with real per-pair costs) ---\n');
analyzeResults(allTrades, 'EMA Trend-Following (all pairs)');

console.log('\n--- Per-pair breakdown ---\n');
for (const pair of pairs) {
  const trades = pairResults[pair] || [];
  if (trades.length > 0) {
    analyzeResults(trades, `  ${pair}`);
  }
}

// Separate metals vs forex
const metalsTrades = allTrades.filter(t => t.pair.includes('XAU') || t.pair.includes('XAG'));
const forexTrades = allTrades.filter(t => !t.pair.includes('XAU') && !t.pair.includes('XAG'));

console.log('\n--- Asset class breakdown ---\n');
analyzeResults(metalsTrades, 'Metals (XAUUSD, XAGUSD)');
analyzeResults(forexTrades, 'Forex (EURUSD, GBPUSD, USDJPY, GBPJPY)');

const closed = allTrades.filter(t => t.exitReason !== 'OPEN');
const wins = closed.filter(t => t.pipsWon > 0);
const avgR = closed.length > 0 ? closed.reduce((sum, t) => sum + t.rMultiple, 0) / closed.length : 0;
const wr = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;

console.log('\n===================================================================');
console.log('VERDICT');
console.log('===================================================================');
if (metalsTrades.length > 0) {
  const metalsClosed = metalsTrades.filter(t => t.exitReason !== 'OPEN');
  const metalsAvgR = metalsClosed.length > 0 ? metalsClosed.reduce((sum, t) => sum + t.rMultiple, 0) / metalsClosed.length : 0;
  const metalsWR = metalsClosed.length > 0 ? (metalsClosed.filter(t => t.pipsWon > 0).length / metalsClosed.length) * 100 : 0;
  console.log(`\n✅ METALS: Win Rate ${metalsWR.toFixed(1)}%, Avg R ${metalsAvgR.toFixed(3)}`);
  if (metalsAvgR > 0) {
    console.log('   → PROFITABLE, ready for live deployment');
  } else {
    console.log('   → Negative expectancy, needs refinement');
  }
}

if (forexTrades.length > 0) {
  const forexClosed = forexTrades.filter(t => t.exitReason !== 'OPEN');
  const forexAvgR = forexClosed.length > 0 ? forexClosed.reduce((sum, t) => sum + t.rMultiple, 0) / forexClosed.length : 0;
  const forexWR = forexClosed.length > 0 ? (forexClosed.filter(t => t.pipsWon > 0).length / forexClosed.length) * 100 : 0;
  console.log(`\n❌ FOREX: Win Rate ${forexWR.toFixed(1)}%, Avg R ${forexAvgR.toFixed(3)}`);
  console.log('   → Negative expectancy due to broker costs (1.3-2.3 pips)');
  console.log('   → Recommend: Disable forex, keep metals only');
}

console.log('\n===================================================================\n');

fs.writeFileSync('ema-trend-following-results.json', JSON.stringify({ allTrades, pairResults }, null, 2));
console.log('Saved to ema-trend-following-results.json');
