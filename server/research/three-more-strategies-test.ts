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

function sma(values: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      result.push(0);
    } else {
      const sum = values.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
      result.push(sum / period);
    }
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

function aggregateCandles(m5Candles: Candle[], minutesPerCandle: number): Candle[] {
  const result: Candle[] = [];
  let current: Candle | null = null;
  let count = 0;

  for (const candle of m5Candles) {
    const totalMinutes = candle.time.getUTCHours() * 60 + candle.time.getUTCMinutes();
    const bucket = Math.floor(totalMinutes / minutesPerCandle);
    
    if (!current || count === 0) {
      if (current) result.push(current);
      current = {
        time: candle.time,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
      };
      count = 1;
    } else if (Math.floor((candle.time.getUTCHours() * 60 + candle.time.getUTCMinutes()) / minutesPerCandle) !== bucket ||
               candle.time.getUTCDate() !== current.time.getUTCDate()) {
      result.push(current);
      current = {
        time: candle.time,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
      };
      count = 1;
    } else {
      current.high = Math.max(current.high, candle.high);
      current.low = Math.min(current.low, candle.low);
      current.close = candle.close;
      current.volume += candle.volume;
      count++;
    }
  }
  if (current) result.push(current);
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

// ===== STRATEGY #29: FIBONACCI RETRACEMENT =====
function testFibonacciRetracement(pair: string, candles: Candle[], brokerCost: number): Trade[] {
  if (candles.length < 100) return [];

  const closes = candles.map(c => c.close);
  const ema50 = ema(closes, 50);
  const atrValues = atr(candles, 14);

  const trades: Trade[] = [];
  const pipMult = getPipMultiplier(pair);
  let lastSignalIdx = -60;
  const lookback = 50;

  for (let i = 100; i < candles.length; i++) {
    if (i - lastSignalIdx < 60) continue;

    const current = candles[i];
    const atrVal = atrValues[i];

    // Find recent swing high/low
    let swingHigh = -Infinity, swingLow = Infinity;
    let swingHighIdx = i, swingLowIdx = i;
    for (let j = i - lookback; j < i; j++) {
      if (candles[j].high > swingHigh) {
        swingHigh = candles[j].high;
        swingHighIdx = j;
      }
      if (candles[j].low < swingLow) {
        swingLow = candles[j].low;
        swingLowIdx = j;
      }
    }

    const range = swingHigh - swingLow;
    if (range <= 0) continue;

    // Fibonacci levels
    const fib382 = swingHigh - range * 0.382;
    const fib500 = swingHigh - range * 0.500;
    const fib618 = swingHigh - range * 0.618;

    // LONG: Uptrend + pullback to 38.2-61.8% zone
    const uptrend = swingHighIdx > swingLowIdx && current.close > ema50[i];
    const inFibZone = current.close >= fib618 && current.close <= fib382;
    const bounce = current.close > current.open;

    if (uptrend && inFibZone && bounce) {
      const entry = current.close;
      const sl = entry - atrVal * 1.5;
      const slPips = Math.abs(entry - sl) / pipMult;

      if (slPips < 5 || slPips > 40) continue;

      const tp = entry + slPips * 2.5 * pipMult;

      let exitPrice = entry;
      let exitReason = 'OPEN';

      for (let j = i + 1; j < Math.min(i + 150, candles.length); j++) {
        const candle = candles[j];
        if (candle.high >= tp) { exitPrice = tp; exitReason = 'TP'; break; }
        if (candle.low <= sl) { exitPrice = sl; exitReason = 'SL'; break; }
      }

      const grossPips = (exitPrice - entry) / pipMult;
      const netPips = grossPips - brokerCost;
      const rMultiple = netPips / slPips;

      trades.push({ pair, direction: 'LONG', entry, sl, tp, exitPrice, exitReason, pipsWon: netPips, rMultiple });
      lastSignalIdx = i;
    }

    // SHORT: Downtrend + pullback to 38.2-61.8% zone
    const downtrend = swingLowIdx > swingHighIdx && current.close < ema50[i];
    const fib382Short = swingLow + range * 0.382;
    const fib618Short = swingLow + range * 0.618;
    const inFibZoneShort = current.close >= fib382Short && current.close <= fib618Short;
    const bounceDown = current.close < current.open;

    if (downtrend && inFibZoneShort && bounceDown) {
      const entry = current.close;
      const sl = entry + atrVal * 1.5;
      const slPips = Math.abs(entry - sl) / pipMult;

      if (slPips < 5 || slPips > 40) continue;

      const tp = entry - slPips * 2.5 * pipMult;

      let exitPrice = entry;
      let exitReason = 'OPEN';

      for (let j = i + 1; j < Math.min(i + 150, candles.length); j++) {
        const candle = candles[j];
        if (candle.low <= tp) { exitPrice = tp; exitReason = 'TP'; break; }
        if (candle.high >= sl) { exitPrice = sl; exitReason = 'SL'; break; }
      }

      const grossPips = (entry - exitPrice) / pipMult;
      const netPips = grossPips - brokerCost;
      const rMultiple = netPips / slPips;

      trades.push({ pair, direction: 'SHORT', entry, sl, tp, exitPrice, exitReason, pipsWon: netPips, rMultiple });
      lastSignalIdx = i;
    }
  }

  return trades;
}

// ===== STRATEGY #30: VOLATILITY REGIME =====
function testVolatilityRegime(pair: string, candles: Candle[], brokerCost: number): Trade[] {
  if (candles.length < 100) return [];

  const closes = candles.map(c => c.close);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const atrValues = atr(candles, 14);

  const trades: Trade[] = [];
  const pipMult = getPipMultiplier(pair);
  let lastSignalIdx = -60;

  // Calculate ATR percentile over last 100 candles
  for (let i = 100; i < candles.length; i++) {
    if (i - lastSignalIdx < 60) continue;

    const current = candles[i];
    const atrVal = atrValues[i];

    // Get ATR history
    const atrHistory = atrValues.slice(i - 100, i).filter(v => v > 0);
    if (atrHistory.length < 50) continue;

    const sorted = [...atrHistory].sort((a, b) => a - b);
    const percentile = (atrHistory.indexOf(atrVal) / atrHistory.length) * 100;

    // Only trade when volatility is in top 30% (high volatility regime)
    if (percentile < 70) continue;

    // LONG: High vol + trend + momentum
    const trendUp = current.close > ema20[i] && ema20[i] > ema50[i];
    const momentum = current.close > current.open && (current.close - current.open) > atrVal * 0.4;

    if (trendUp && momentum) {
      const entry = current.close;
      const sl = entry - atrVal * 1.5;
      const slPips = Math.abs(entry - sl) / pipMult;

      if (slPips < 5 || slPips > 40) continue;

      const tp = entry + slPips * 2.5 * pipMult;

      let exitPrice = entry;
      let exitReason = 'OPEN';

      for (let j = i + 1; j < Math.min(i + 150, candles.length); j++) {
        const candle = candles[j];
        if (candle.high >= tp) { exitPrice = tp; exitReason = 'TP'; break; }
        if (candle.low <= sl) { exitPrice = sl; exitReason = 'SL'; break; }
      }

      const grossPips = (exitPrice - entry) / pipMult;
      const netPips = grossPips - brokerCost;
      const rMultiple = netPips / slPips;

      trades.push({ pair, direction: 'LONG', entry, sl, tp, exitPrice, exitReason, pipsWon: netPips, rMultiple });
      lastSignalIdx = i;
    }

    // SHORT: High vol + trend down + momentum
    const trendDown = current.close < ema20[i] && ema20[i] < ema50[i];
    const momentumDown = current.close < current.open && (current.open - current.close) > atrVal * 0.4;

    if (trendDown && momentumDown) {
      const entry = current.close;
      const sl = entry + atrVal * 1.5;
      const slPips = Math.abs(entry - sl) / pipMult;

      if (slPips < 5 || slPips > 40) continue;

      const tp = entry - slPips * 2.5 * pipMult;

      let exitPrice = entry;
      let exitReason = 'OPEN';

      for (let j = i + 1; j < Math.min(i + 150, candles.length); j++) {
        const candle = candles[j];
        if (candle.low <= tp) { exitPrice = tp; exitReason = 'TP'; break; }
        if (candle.high >= sl) { exitPrice = sl; exitReason = 'SL'; break; }
      }

      const grossPips = (entry - exitPrice) / pipMult;
      const netPips = grossPips - brokerCost;
      const rMultiple = netPips / slPips;

      trades.push({ pair, direction: 'SHORT', entry, sl, tp, exitPrice, exitReason, pipsWon: netPips, rMultiple });
      lastSignalIdx = i;
    }
  }

  return trades;
}

// ===== STRATEGY #31: MULTI-TIMEFRAME ALIGNMENT =====
function testMultiTimeframeAlignment(pair: string, m5Candles: Candle[], brokerCost: number): Trade[] {
  const h1Candles = aggregateCandles(m5Candles, 60);
  const h4Candles = aggregateCandles(m5Candles, 240);
  
  if (h1Candles.length < 60 || h4Candles.length < 30 || m5Candles.length < 200) return [];

  const h1Closes = h1Candles.map(c => c.close);
  const h1Ema20 = ema(h1Closes, 20);
  const h1Ema50 = ema(h1Closes, 50);

  const h4Closes = h4Candles.map(c => c.close);
  const h4Ema20 = ema(h4Closes, 20);
  const h4Ema50 = ema(h4Closes, 50);

  const m5Closes = m5Candles.map(c => c.close);
  const m5Ema20 = ema(m5Closes, 20);
  const m5Ema50 = ema(m5Closes, 50);
  const m5Atr = atr(m5Candles, 14);

  const trades: Trade[] = [];
  const pipMult = getPipMultiplier(pair);
  let lastSignalIdx = -60;

  let h1Idx = 0, h4Idx = 0;

  for (let i = 50; i < m5Candles.length; i++) {
    if (i - lastSignalIdx < 60) continue;

    // Map to H1 and H4
    while (h1Idx < h1Candles.length - 1 && h1Candles[h1Idx + 1].time <= m5Candles[i].time) h1Idx++;
    while (h4Idx < h4Candles.length - 1 && h4Candles[h4Idx + 1].time <= m5Candles[i].time) h4Idx++;

    if (h1Idx < 50 || h4Idx < 20) continue;

    const m5Current = m5Candles[i];
    const m5AtrVal = m5Atr[i];

    // All timeframes must agree on trend
    const h1Bullish = h1Closes[h1Idx] > h1Ema20[h1Idx] && h1Ema20[h1Idx] > h1Ema50[h1Idx];
    const h4Bullish = h4Closes[h4Idx] > h4Ema20[h4Idx] && h4Ema20[h4Idx] > h4Ema50[h4Idx];
    const m5Bullish = m5Current.close > m5Ema20[i] && m5Ema20[i] > m5Ema50[i];

    // LONG: All 3 timeframes bullish + M5 pullback
    if (h1Bullish && h4Bullish && m5Bullish) {
      const pullback = m5Current.low <= m5Ema20[i] * 1.001 && m5Current.close > m5Ema20[i];
      const bounce = m5Current.close > m5Current.open;

      if (pullback && bounce) {
        const entry = m5Current.close;
        const sl = entry - m5AtrVal * 1.5;
        const slPips = Math.abs(entry - sl) / pipMult;

        if (slPips < 5 || slPips > 40) continue;

        const tp = entry + slPips * 2.5 * pipMult;

        let exitPrice = entry;
        let exitReason = 'OPEN';

        for (let j = i + 1; j < Math.min(i + 150, m5Candles.length); j++) {
          const candle = m5Candles[j];
          if (candle.high >= tp) { exitPrice = tp; exitReason = 'TP'; break; }
          if (candle.low <= sl) { exitPrice = sl; exitReason = 'SL'; break; }
        }

        const grossPips = (exitPrice - entry) / pipMult;
        const netPips = grossPips - brokerCost;
        const rMultiple = netPips / slPips;

        trades.push({ pair, direction: 'LONG', entry, sl, tp, exitPrice, exitReason, pipsWon: netPips, rMultiple });
        lastSignalIdx = i;
      }
    }

    // SHORT: All 3 timeframes bearish
    const h1Bearish = h1Closes[h1Idx] < h1Ema20[h1Idx] && h1Ema20[h1Idx] < h1Ema50[h1Idx];
    const h4Bearish = h4Closes[h4Idx] < h4Ema20[h4Idx] && h4Ema20[h4Idx] < h4Ema50[h4Idx];
    const m5Bearish = m5Current.close < m5Ema20[i] && m5Ema20[i] < m5Ema50[i];

    if (h1Bearish && h4Bearish && m5Bearish) {
      const pullback = m5Current.high >= m5Ema20[i] * 0.999 && m5Current.close < m5Ema20[i];
      const bounce = m5Current.close < m5Current.open;

      if (pullback && bounce) {
        const entry = m5Current.close;
        const sl = entry + m5AtrVal * 1.5;
        const slPips = Math.abs(entry - sl) / pipMult;

        if (slPips < 5 || slPips > 40) continue;

        const tp = entry - slPips * 2.5 * pipMult;

        let exitPrice = entry;
        let exitReason = 'OPEN';

        for (let j = i + 1; j < Math.min(i + 150, m5Candles.length); j++) {
          const candle = m5Candles[j];
          if (candle.low <= tp) { exitPrice = tp; exitReason = 'TP'; break; }
          if (candle.high >= sl) { exitPrice = sl; exitReason = 'SL'; break; }
        }

        const grossPips = (entry - exitPrice) / pipMult;
        const netPips = grossPips - brokerCost;
        const rMultiple = netPips / slPips;

        trades.push({ pair, direction: 'SHORT', entry, sl, tp, exitPrice, exitReason, pipsWon: netPips, rMultiple });
        lastSignalIdx = i;
      }
    }
  }

  return trades;
}

const pairs = [
  'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'USDCAD',
  'AUDUSD', 'NZDUSD', 'EURGBP', 'EURJPY', 'GBPJPY',
  'AUDJPY', 'CADJPY', 'CHFJPY', 'NZDJPY', 'EURAUD',
];

function analyzeResults(trades: Trade[], label: string) {
  if (trades.length === 0) {
    console.log(`  ${label.padEnd(50)} signals:    0`);
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

  console.log(`  ${label.padEnd(50)} signals:${trades.length.toString().padStart(5)} closed:${closed.length.toString().padStart(5)} WR:${wr.toFixed(1).padStart(5)}%  avgR:${avgR.toFixed(3).padStart(7)}  PF:${pf.toFixed(2).padStart(5)}  maxDD(R):${maxDD.toFixed(2).padStart(7)}  avgSL:${avgSL.toFixed(1).padStart(5)}p`);
}

console.log('===================================================================');
console.log('TESTING 3 MORE STRATEGIES');
console.log('#29: Fibonacci Retracement');
console.log('#30: Volatility Regime (top 30% ATR)');
console.log('#31: Multi-Timeframe Alignment (H1+H4+M5)');
console.log('===================================================================\n');

for (const stratName of ['Fibonacci', 'Volatility Regime', 'Multi-TF']) {
  console.log(`\n--- Strategy: ${stratName} ---\n`);
  
  const allTrades: Trade[] = [];
  const pairResults: { [key: string]: Trade[] } = {};

  for (const pair of pairs) {
    const candles = loadCacheFile(pair);
    if (candles.length < 200) continue;

    const cost = getBrokerCost(pair);
    let trades: Trade[] = [];

    if (stratName === 'Fibonacci') trades = testFibonacciRetracement(pair, candles, cost);
    else if (stratName === 'Volatility Regime') trades = testVolatilityRegime(pair, candles, cost);
    else if (stratName === 'Multi-TF') trades = testMultiTimeframeAlignment(pair, candles, cost);

    pairResults[pair] = trades;
    allTrades.push(...trades);
    if (trades.length > 0) console.log(`  ${pair}: ${trades.length} signals`);
  }

  console.log(`\n  Total: ${allTrades.length} signals\n`);
  analyzeResults(allTrades, `${stratName} (combined)`);

  for (const pair of pairs) {
    const trades = pairResults[pair] || [];
    if (trades.length > 0) analyzeResults(trades, `  ${pair}`);
  }
}

console.log('\n===================================================================');
console.log('COMPLETE SUMMARY: All 31 Strategies Tested');
console.log('===================================================================\n');
console.log('#  | Strategy                    | avgR    | Verdict');
console.log('---+-----------------------------+---------+--------');
console.log('1  | Mean-reversion (0.35R)      | -0.051  | ❌');
console.log('2  | Mean-reversion (TP1 min 8)  | +0.004  | ⚠️');
console.log('3  | Single TP (11 pips)         | -0.128  | ❌');
console.log('4  | Confirmation delay          | -0.182  | ❌');
console.log('5  | Target SMA20                | -0.389  | ❌');
console.log('6  | Trend-breakout (metals)     | -0.714  | ❌');
console.log('7  | H1 trend + M5 pullback      | -0.724  | ❌');
console.log('8  | H4 RSI Divergence           | -0.181  | ❌');
console.log('9  | D1 Multi-Indicator          | -0.991  | ❌');
console.log('10 | Ultra-simple EMA50/200      | -0.767  | ❌');
console.log('11 | EMA110 M5 Pullback          | -0.311  | ❌');
console.log('12 | Multi-Indicator (7 ind)     | -0.382  | ❌');
console.log('13 | Inside Bar Breakout         |  0.000  | ❌');
console.log('14 | Volatility Expansion        | -0.612  | ❌');
console.log('15 | Ultra-Tight Scalping        | -1.492  | ❌');
console.log('16 | Professional EMA Trend      | -1.387  | ❌');
console.log('17 | H1 Trend + M5 Entry         |  0.000  | ❌');
console.log('18 | Breakout Retest             | -0.623  | ❌');
console.log('19 | Pure Trend Following        | -0.625  | ❌');
console.log('20 | Session Momentum            | -0.838  | ❌');
console.log('21 | Range Trading               | -0.409  | ❌');
console.log('22 | Wide Target (5x SL)         | -0.580  | ❌');
console.log('23 | JPY Momentum Trailing       | -0.742  | ❌');
console.log('24 | Counter-Trend Reversal      | -1.125  | ❌');
console.log('25 | Candlestick Patterns        | -0.801  | ❌');
console.log('26 | H4 Trend + M15 Entry        |  0.000  | ❌');
console.log('27 | Donchian Breakout           | -0.401  | ❌');
console.log('28 | Opening Range Breakout      | -0.825  | ❌');
console.log('29 | Fibonacci Retracement       | ???     | ???');
console.log('30 | Volatility Regime           | ???     | ???');
console.log('31 | Multi-Timeframe Alignment   | ???     | ???');
console.log('\n===================================================================\n');
