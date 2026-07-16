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

// ===== STRATEGY #35: MARKET STRUCTURE BREAK (MSB) =====
// Trade when price breaks recent swing high/low (change of character)
function testMarketStructureBreak(pair: string, candles: Candle[], brokerCost: number): Trade[] {
  if (candles.length < 100) return [];

  const closes = candles.map(c => c.close);
  const ema50 = ema(closes, 50);
  const atrValues = atr(candles, 14);

  const trades: Trade[] = [];
  const pipMult = getPipMultiplier(pair);
  let lastSignalIdx = -40;

  for (let i = 50; i < candles.length; i++) {
    if (i - lastSignalIdx < 40) continue;

    const current = candles[i];
    const atrVal = atrValues[i];

    // Find recent swing points (last 20 candles)
    let swingHigh = -Infinity;
    let swingLow = Infinity;
    for (let j = Math.max(0, i - 20); j < i; j++) {
      swingHigh = Math.max(swingHigh, candles[j].high);
      swingLow = Math.min(swingLow, candles[j].low);
    }

    // LONG: Price breaks above swing high + trend filter
    const breaksHigh = current.close > swingHigh;
    const trendUp = current.close > ema50[i];
    const momentum = current.close > current.open;

    if (breaksHigh && trendUp && momentum) {
      const entry = current.close;
      const sl = entry - atrVal * 1.5;
      const slPips = Math.abs(entry - sl) / pipMult;

      if (slPips < 5 || slPips > 40) continue;

      const tp = entry + slPips * 2 * pipMult;

      let exitPrice = entry;
      let exitReason = 'OPEN';

      for (let j = i + 1; j < Math.min(i + 100, candles.length); j++) {
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

    // SHORT: Price breaks below swing low + trend filter
    const breaksLow = current.close < swingLow;
    const trendDown = current.close < ema50[i];
    const momentumDown = current.close < current.open;

    if (breaksLow && trendDown && momentumDown) {
      const entry = current.close;
      const sl = entry + atrVal * 1.5;
      const slPips = Math.abs(entry - sl) / pipMult;

      if (slPips < 5 || slPips > 40) continue;

      const tp = entry - slPips * 2 * pipMult;

      let exitPrice = entry;
      let exitReason = 'OPEN';

      for (let j = i + 1; j < Math.min(i + 100, candles.length); j++) {
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

// ===== STRATEGY #36: LIQUIDITY SWEEP / STOP HUNT =====
// Trade when price sweeps recent high/low then reverses
function testLiquiditySweep(pair: string, candles: Candle[], brokerCost: number): Trade[] {
  if (candles.length < 100) return [];

  const closes = candles.map(c => c.close);
  const ema50 = ema(closes, 50);
  const atrValues = atr(candles, 14);

  const trades: Trade[] = [];
  const pipMult = getPipMultiplier(pair);
  let lastSignalIdx = -40;

  for (let i = 50; i < candles.length; i++) {
    if (i - lastSignalIdx < 40) continue;

    const current = candles[i];
    const prev = candles[i - 1];
    const atrVal = atrValues[i];

    // Find recent swing points (last 15 candles)
    let swingHigh = -Infinity;
    let swingLow = Infinity;
    for (let j = Math.max(0, i - 15); j < i; j++) {
      swingHigh = Math.max(swingHigh, candles[j].high);
      swingLow = Math.min(swingLow, candles[j].low);
    }

    // LONG: Price sweeps below swing low then closes back above (stop hunt)
    const sweepsLow = prev.low < swingLow && current.close > swingLow;
    const trendUp = current.close > ema50[i];
    const reversal = current.close > current.open;

    if (sweepsLow && trendUp && reversal) {
      const entry = current.close;
      const sl = entry - atrVal * 1.5;
      const slPips = Math.abs(entry - sl) / pipMult;

      if (slPips < 5 || slPips > 40) continue;

      const tp = entry + slPips * 2.5 * pipMult;

      let exitPrice = entry;
      let exitReason = 'OPEN';

      for (let j = i + 1; j < Math.min(i + 100, candles.length); j++) {
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

    // SHORT: Price sweeps above swing high then closes back below (stop hunt)
    const sweepsHigh = prev.high > swingHigh && current.close < swingHigh;
    const trendDown = current.close < ema50[i];
    const reversalDown = current.close < current.open;

    if (sweepsHigh && trendDown && reversalDown) {
      const entry = current.close;
      const sl = entry + atrVal * 1.5;
      const slPips = Math.abs(entry - sl) / pipMult;

      if (slPips < 5 || slPips > 40) continue;

      const tp = entry - slPips * 2.5 * pipMult;

      let exitPrice = entry;
      let exitReason = 'OPEN';

      for (let j = i + 1; j < Math.min(i + 100, candles.length); j++) {
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

// ===== STRATEGY #37: TIME-BASED MOMENTUM =====
// Trade only during specific high-probability hours
function testTimeBasedMomentum(pair: string, candles: Candle[], brokerCost: number): Trade[] {
  if (candles.length < 100) return [];

  const closes = candles.map(c => c.close);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const atrValues = atr(candles, 14);
  const rsiValues = rsi(closes, 14);

  const trades: Trade[] = [];
  const pipMult = getPipMultiplier(pair);
  let lastSignalIdx = -40;

  for (let i = 50; i < candles.length; i++) {
    if (i - lastSignalIdx < 40) continue;

    const current = candles[i];
    const hour = current.time.getUTCHours();
    const atrVal = atrValues[i];
    const rsiVal = rsiValues[i];

    // Only trade during London open (07:00-09:00) or NY open (13:00-15:00)
    const isLondonOpen = hour >= 7 && hour < 9;
    const isNYOpen = hour >= 13 && hour < 15;

    if (!isLondonOpen && !isNYOpen) continue;

    // LONG: Strong momentum + RSI not overbought
    const trendUp = current.close > ema20[i] && ema20[i] > ema50[i];
    const momentum = current.close > current.open && (current.close - current.open) > atrVal * 0.5;
    const rsiOk = rsiVal > 50 && rsiVal < 70;

    if (trendUp && momentum && rsiOk) {
      const entry = current.close;
      const sl = entry - atrVal * 1.5;
      const slPips = Math.abs(entry - sl) / pipMult;

      if (slPips < 5 || slPips > 40) continue;

      const tp = entry + slPips * 2 * pipMult;

      let exitPrice = entry;
      let exitReason = 'OPEN';

      for (let j = i + 1; j < Math.min(i + 80, candles.length); j++) {
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

    // SHORT: Strong momentum + RSI not oversold
    const trendDown = current.close < ema20[i] && ema20[i] < ema50[i];
    const momentumDown = current.close < current.open && (current.open - current.close) > atrVal * 0.5;
    const rsiOkDown = rsiVal < 50 && rsiVal > 30;

    if (trendDown && momentumDown && rsiOkDown) {
      const entry = current.close;
      const sl = entry + atrVal * 1.5;
      const slPips = Math.abs(entry - sl) / pipMult;

      if (slPips < 5 || slPips > 40) continue;

      const tp = entry - slPips * 2 * pipMult;

      let exitPrice = entry;
      let exitReason = 'OPEN';

      for (let j = i + 1; j < Math.min(i + 80, candles.length); j++) {
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

// ===== STRATEGY #38: VOLATILITY CONTRACTION BREAKOUT =====
// Trade when price breaks out of tight consolidation
function testVolatilityContraction(pair: string, candles: Candle[], brokerCost: number): Trade[] {
  if (candles.length < 100) return [];

  const closes = candles.map(c => c.close);
  const ema50 = ema(closes, 50);
  const atrValues = atr(candles, 14);

  const trades: Trade[] = [];
  const pipMult = getPipMultiplier(pair);
  let lastSignalIdx = -60;

  for (let i = 50; i < candles.length; i++) {
    if (i - lastSignalIdx < 60) continue;

    const current = candles[i];
    const atrVal = atrValues[i];

    // Calculate ATR over last 20 candles
    const atrHistory = atrValues.slice(Math.max(0, i - 20), i).filter(v => v > 0);
    if (atrHistory.length < 10) continue;

    const avgAtr = atrHistory.reduce((a, b) => a + b, 0) / atrHistory.length;
    const minAtr = Math.min(...atrHistory);

    // Check for volatility contraction (current ATR < 70% of average)
    const isContracted = atrVal < avgAtr * 0.7;

    if (!isContracted) continue;

    // Find range of last 10 candles
    let rangeHigh = -Infinity;
    let rangeLow = Infinity;
    for (let j = Math.max(0, i - 10); j < i; j++) {
      rangeHigh = Math.max(rangeHigh, candles[j].high);
      rangeLow = Math.min(rangeLow, candles[j].low);
    }

    const rangeSize = rangeHigh - rangeLow;
    const rangeSizePips = rangeSize / pipMult;

    if (rangeSizePips < 5 || rangeSizePips > 30) continue;

    // LONG: Breakout above range + trend filter
    const breaksHigh = current.close > rangeHigh;
    const trendUp = current.close > ema50[i];
    const momentum = current.close > current.open;

    if (breaksHigh && trendUp && momentum) {
      const entry = current.close;
      const sl = rangeLow;
      const slPips = Math.abs(entry - sl) / pipMult;

      if (slPips < 5 || slPips > 40) continue;

      const tp = entry + slPips * 2.5 * pipMult;

      let exitPrice = entry;
      let exitReason = 'OPEN';

      for (let j = i + 1; j < Math.min(i + 120, candles.length); j++) {
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

    // SHORT: Breakout below range + trend filter
    const breaksLow = current.close < rangeLow;
    const trendDown = current.close < ema50[i];
    const momentumDown = current.close < current.open;

    if (breaksLow && trendDown && momentumDown) {
      const entry = current.close;
      const sl = rangeHigh;
      const slPips = Math.abs(entry - sl) / pipMult;

      if (slPips < 5 || slPips > 40) continue;

      const tp = entry - slPips * 2.5 * pipMult;

      let exitPrice = entry;
      let exitReason = 'OPEN';

      for (let j = i + 1; j < Math.min(i + 120, candles.length); j++) {
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
console.log('TESTING 4 MORE STRATEGIES');
console.log('#35: Market Structure Break (MSB)');
console.log('#36: Liquidity Sweep / Stop Hunt');
console.log('#37: Time-Based Momentum (London/NY open only)');
console.log('#38: Volatility Contraction Breakout');
console.log('===================================================================\n');

for (const stratName of ['MSB', 'Liquidity Sweep', 'Time-Based', 'Vol Contraction']) {
  console.log(`\n--- Strategy: ${stratName} ---\n`);
  
  const allTrades: Trade[] = [];
  const pairResults: { [key: string]: Trade[] } = {};

  for (const pair of pairs) {
    const candles = loadCacheFile(pair);
    if (candles.length < 200) continue;

    const cost = getBrokerCost(pair);
    let trades: Trade[] = [];

    if (stratName === 'MSB') trades = testMarketStructureBreak(pair, candles, cost);
    else if (stratName === 'Liquidity Sweep') trades = testLiquiditySweep(pair, candles, cost);
    else if (stratName === 'Time-Based') trades = testTimeBasedMomentum(pair, candles, cost);
    else if (stratName === 'Vol Contraction') trades = testVolatilityContraction(pair, candles, cost);

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
console.log('COMPLETE SUMMARY: All 38 Strategies Tested');
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
console.log('29 | Fibonacci Retracement       | -0.613  | ❌');
console.log('30 | Volatility Regime           |  0.000  | ❌');
console.log('31 | Multi-Timeframe Alignment   | -0.659  | ❌');
console.log('32 | First Hour Breakout         | -0.869  | ❌');
console.log('33 | Micro Scalping              | -61.659 | ❌');
console.log('34 | Momentum Burst              | -0.591  | ❌');
console.log('35 | Market Structure Break      | ???     | ???');
console.log('36 | Liquidity Sweep             | ???     | ???');
console.log('37 | Time-Based Momentum         | ???     | ???');
console.log('38 | Volatility Contraction      | ???     | ???');
console.log('\n===================================================================\n');
