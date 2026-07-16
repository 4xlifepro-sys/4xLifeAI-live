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

// Aggregate M5 candles into larger timeframes
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

// ===== STRATEGY #26: H4 TREND + M15 ENTRY =====
function testH4TrendM15Entry(pair: string, m5Candles: Candle[], brokerCost: number): Trade[] {
  const h4Candles = aggregateCandles(m5Candles, 240); // 4 hours = 240 minutes
  const m15Candles = aggregateCandles(m5Candles, 15);
  
  if (h4Candles.length < 60 || m15Candles.length < 200) return [];

  const h4Closes = h4Candles.map(c => c.close);
  const h4Ema50 = ema(h4Closes, 50);
  const h4Atr = atr(h4Candles, 14);

  const m15Closes = m15Candles.map(c => c.close);
  const m15Ema20 = ema(m15Closes, 20);
  const m15Ema50 = ema(m15Closes, 50);
  const m15Atr = atr(m15Candles, 14);
  const m15Rsi = rsi(m15Closes, 14);

  const trades: Trade[] = [];
  const pipMult = getPipMultiplier(pair);
  let lastSignalIdx = -30;

  // Map H4 index to M15 index
  let h4Idx = 0;

  for (let i = 50; i < m15Candles.length; i++) {
    if (i - lastSignalIdx < 30) continue;

    // Find corresponding H4 candle
    while (h4Idx < h4Candles.length - 1 && h4Candles[h4Idx + 1].time <= m15Candles[i].time) {
      h4Idx++;
    }
    if (h4Idx < 50) continue;

    const m15Current = m15Candles[i];
    const h4Ema50Val = h4Ema50[h4Idx];
    const h4AtrVal = h4Atr[h4Idx];
    const m15Ema20Val = m15Ema20[i];
    const m15Ema50Val = m15Ema50[i];
    const m15AtrVal = m15Atr[i];
    const m15RsiVal = m15Rsi[i];

    // ===== LONG: H4 uptrend + M15 pullback to EMA20 =====
    const h4Bullish = m15Current.close > h4Ema50Val && h4Ema50Val > h4Ema50[Math.max(0, h4Idx - 5)];
    
    if (h4Bullish) {
      const pullback = m15Current.low <= m15Ema20Val * 1.001 && m15Current.close > m15Ema20Val;
      const bounce = m15Current.close > m15Current.open;
      const rsiOk = m15RsiVal >= 40 && m15RsiVal <= 65;

      if (pullback && bounce && rsiOk) {
        const entry = m15Current.close;
        const sl = entry - m15AtrVal * 2;
        const slPips = Math.abs(entry - sl) / pipMult;

        if (slPips < 5 || slPips > 50) continue;

        // TP: 3x SL
        const tp = entry + slPips * 3 * pipMult;

        let exitPrice = entry;
        let exitReason = 'OPEN';

        for (let j = i + 1; j < Math.min(i + 200, m15Candles.length); j++) {
          const candle = m15Candles[j];
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

    // ===== SHORT: H4 downtrend + M15 pullback to EMA20 =====
    const h4Bearish = m15Current.close < h4Ema50Val && h4Ema50Val < h4Ema50[Math.max(0, h4Idx - 5)];

    if (h4Bearish) {
      const pullback = m15Current.high >= m15Ema20Val * 0.999 && m15Current.close < m15Ema20Val;
      const bounce = m15Current.close < m15Current.open;
      const rsiOk = m15RsiVal >= 35 && m15RsiVal <= 60;

      if (pullback && bounce && rsiOk) {
        const entry = m15Current.close;
        const sl = entry + m15AtrVal * 2;
        const slPips = Math.abs(entry - sl) / pipMult;

        if (slPips < 5 || slPips > 50) continue;

        const tp = entry - slPips * 3 * pipMult;

        let exitPrice = entry;
        let exitReason = 'OPEN';

        for (let j = i + 1; j < Math.min(i + 200, m15Candles.length); j++) {
          const candle = m15Candles[j];
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

// ===== STRATEGY #27: DONCHIAN CHANNEL BREAKOUT =====
function testDonchianBreakout(pair: string, candles: Candle[], brokerCost: number): Trade[] {
  if (candles.length < 100) return [];

  const closes = candles.map(c => c.close);
  const ema50 = ema(closes, 50);
  const atrValues = atr(candles, 14);

  const trades: Trade[] = [];
  const pipMult = getPipMultiplier(pair);
  let lastSignalIdx = -60;
  const lookback = 20; // 20-period Donchian

  for (let i = 100; i < candles.length; i++) {
    if (i - lastSignalIdx < 60) continue;

    const current = candles[i];
    const atrVal = atrValues[i];

    // Calculate Donchian channel
    let highest = -Infinity, lowest = Infinity;
    for (let j = i - lookback; j < i; j++) {
      highest = Math.max(highest, candles[j].high);
      lowest = Math.min(lowest, candles[j].low);
    }

    // LONG: Breakout above Donchian high + trend filter
    if (current.close > highest && current.close > ema50[i]) {
      const entry = current.close;
      const sl = lowest; // SL at Donchian low
      const slPips = Math.abs(entry - sl) / pipMult;

      if (slPips < 8 || slPips > 60) continue;

      const tp = entry + slPips * 2 * pipMult;

      let exitPrice = entry;
      let exitReason = 'OPEN';

      for (let j = i + 1; j < Math.min(i + 200, candles.length); j++) {
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

    // SHORT: Breakout below Donchian low + trend filter
    if (current.close < lowest && current.close < ema50[i]) {
      const entry = current.close;
      const sl = highest;
      const slPips = Math.abs(entry - sl) / pipMult;

      if (slPips < 8 || slPips > 60) continue;

      const tp = entry - slPips * 2 * pipMult;

      let exitPrice = entry;
      let exitReason = 'OPEN';

      for (let j = i + 1; j < Math.min(i + 200, candles.length); j++) {
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

// ===== STRATEGY #28: OPENING RANGE BREAKOUT =====
function testOpeningRangeBreakout(pair: string, candles: Candle[], brokerCost: number): Trade[] {
  if (candles.length < 100) return [];

  const closes = candles.map(c => c.close);
  const ema50 = ema(closes, 50);
  const atrValues = atr(candles, 14);

  const trades: Trade[] = [];
  const pipMult = getPipMultiplier(pair);
  let lastSignalIdx = -60;

  // Group candles by day
  const days: Map<string, Candle[]> = new Map();
  for (const candle of candles) {
    const dayKey = candle.time.toISOString().split('T')[0];
    if (!days.has(dayKey)) days.set(dayKey, []);
    days.get(dayKey)!.push(candle);
  }

  for (const [dayKey, dayCandles] of days) {
    if (dayCandles.length < 20) continue;

    // Opening range: first 6 candles (30 minutes) of London session
    const londonStart = dayCandles.filter(c => {
      const h = c.time.getUTCHours();
      return h >= 7 && h < 8; // First hour of London
    });

    if (londonStart.length < 6) continue;

    const openingRange = londonStart.slice(0, 6);
    const rangeHigh = Math.max(...openingRange.map(c => c.high));
    const rangeLow = Math.min(...openingRange.map(c => c.low));
    const rangeSize = rangeHigh - rangeLow;
    const rangeSizePips = rangeSize / pipMult;

    if (rangeSizePips < 5 || rangeSizePips > 30) continue;

    // Trade breakout after opening range
    const afterRange = dayCandles.filter(c => c.time > openingRange[openingRange.length - 1].time);

    for (let i = 0; i < afterRange.length; i++) {
      const candle = afterRange[i];
      const globalIdx = candles.indexOf(candle);
      if (globalIdx - lastSignalIdx < 60) continue;

      const atrVal = atrValues[globalIdx] || rangeSize;

      // LONG: Breakout above range high + trend filter
      if (candle.close > rangeHigh && candle.close > ema50[globalIdx]) {
        const entry = candle.close;
        const sl = rangeLow;
        const slPips = Math.abs(entry - sl) / pipMult;

        if (slPips < 5 || slPips > 40) continue;

        const tp = entry + slPips * 2 * pipMult;

        let exitPrice = entry;
        let exitReason = 'OPEN';

        for (let j = i + 1; j < afterRange.length; j++) {
          const c = afterRange[j];
          if (c.high >= tp) { exitPrice = tp; exitReason = 'TP'; break; }
          if (c.low <= sl) { exitPrice = sl; exitReason = 'SL'; break; }
        }

        const grossPips = (exitPrice - entry) / pipMult;
        const netPips = grossPips - brokerCost;
        const rMultiple = netPips / slPips;

        trades.push({ pair, direction: 'LONG', entry, sl, tp, exitPrice, exitReason, pipsWon: netPips, rMultiple });
        lastSignalIdx = globalIdx;
        break; // One trade per day
      }

      // SHORT: Breakout below range low + trend filter
      if (candle.close < rangeLow && candle.close < ema50[globalIdx]) {
        const entry = candle.close;
        const sl = rangeHigh;
        const slPips = Math.abs(entry - sl) / pipMult;

        if (slPips < 5 || slPips > 40) continue;

        const tp = entry - slPips * 2 * pipMult;

        let exitPrice = entry;
        let exitReason = 'OPEN';

        for (let j = i + 1; j < afterRange.length; j++) {
          const c = afterRange[j];
          if (c.low <= tp) { exitPrice = tp; exitReason = 'TP'; break; }
          if (c.high >= sl) { exitPrice = sl; exitReason = 'SL'; break; }
        }

        const grossPips = (entry - exitPrice) / pipMult;
        const netPips = grossPips - brokerCost;
        const rMultiple = netPips / slPips;

        trades.push({ pair, direction: 'SHORT', entry, sl, tp, exitPrice, exitReason, pipsWon: netPips, rMultiple });
        lastSignalIdx = globalIdx;
        break; // One trade per day
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

// Test all 3 strategies
console.log('===================================================================');
console.log('TESTING 3 NEW STRATEGIES SIMULTANEOUSLY');
console.log('#26: H4 Trend + M15 Entry');
console.log('#27: Donchian Channel Breakout');
console.log('#28: Opening Range Breakout');
console.log('===================================================================\n');

for (const stratName of ['H4+M15', 'Donchian', 'Opening Range']) {
  console.log(`\n--- Strategy: ${stratName} ---\n`);
  
  const allTrades: Trade[] = [];
  const pairResults: { [key: string]: Trade[] } = {};

  for (const pair of pairs) {
    const candles = loadCacheFile(pair);
    if (candles.length < 200) continue;

    const cost = getBrokerCost(pair);
    let trades: Trade[] = [];

    if (stratName === 'H4+M15') trades = testH4TrendM15Entry(pair, candles, cost);
    else if (stratName === 'Donchian') trades = testDonchianBreakout(pair, candles, cost);
    else if (stratName === 'Opening Range') trades = testOpeningRangeBreakout(pair, candles, cost);

    pairResults[pair] = trades;
    allTrades.push(...trades);
    if (trades.length > 0) console.log(`  ${pair}: ${trades.length} signals`);
  }

  console.log(`\n  Total: ${allTrades.length} signals\n`);
  analyzeResults(allTrades, `${stratName} (combined)`);

  // Per-pair
  for (const pair of pairs) {
    const trades = pairResults[pair] || [];
    if (trades.length > 0) analyzeResults(trades, `  ${pair}`);
  }
}

console.log('\n===================================================================');
console.log('COMPLETE SUMMARY: All 28 Strategies Tested');
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
console.log('26 | H4 Trend + M15 Entry        | ???     | ???');
console.log('27 | Donchian Breakout           | ???     | ???');
console.log('28 | Opening Range Breakout      | ???     | ???');
console.log('\n===================================================================\n');
