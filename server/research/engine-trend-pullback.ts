import type { Candle } from '../../src/types.js';

// ---------------------------------------------------------------------------
// RESEARCH ENGINE: Trend Pullback (EMA Cascade)
//
// Core Idea: Enter on pullbacks within established multi-timeframe trends
//
// Timeframes:
// - H4: Overall trend direction (EMA100)
// - H1: Trend confirmation (EMA20 > EMA50 > EMA100 cascade)
// - M15: Signal generation (pullback to EMA20/50 + reversal candle)
//
// Fully isolated - does not import or modify any production engine.
// ---------------------------------------------------------------------------

export interface TrendPullbackSignal {
  pair: string;
  direction: 'LONG' | 'SHORT';
  entry: number;
  sl: number;
  tp1: number;
  tp2: number;
  tp3: number;
  confidence: number;
  reason: string;
  candleIndex: number;
  slPips: number;
}

// ---------------------------------------------------------------------------
// Indicator math (self-contained, no external dependencies)
// ---------------------------------------------------------------------------

function ema(values: number[], period: number): number[] {
  const result: number[] = [];
  if (values.length < period) return result;
  const k = 2 / (period + 1);
  let prev = 0;
  for (let i = 0; i < period; i++) prev += values[i];
  prev /= period;
  result.push(prev);
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    result.push(prev);
  }
  return result;
}

function rsi(closes: number[], period = 14): number[] {
  const result: number[] = [];
  if (closes.length < period + 1) return result;
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) avgGain += change; else avgLoss += Math.abs(change);
  }
  avgGain /= period; avgLoss /= period;
  for (let i = period; i < closes.length; i++) {
    if (i > period) {
      const change = closes[i] - closes[i - 1];
      const gain = change > 0 ? change : 0;
      const loss = change < 0 ? Math.abs(change) : 0;
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
    }
    if (avgLoss === 0) result.push(100);
    else { const rs = avgGain / avgLoss; result.push(100 - (100 / (1 + rs))); }
  }
  return result;
}

function atr(candles: Candle[], period = 14): number[] {
  const result: number[] = [];
  if (candles.length < period) return result;
  const trueRanges: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    );
    trueRanges.push(tr);
  }
  let avg = 0;
  for (let i = 0; i < period; i++) avg += trueRanges[i];
  avg /= period;
  result.push(avg);
  for (let i = period; i < trueRanges.length; i++) {
    avg = (avg * (period - 1) + trueRanges[i]) / period;
    result.push(avg);
  }
  return result;
}

function sma(values: number[], period: number): number[] {
  const result: number[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) result.push(sum / period);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Aggregate 5min candles into higher timeframes
// ---------------------------------------------------------------------------

function aggregateCandles(candles: Candle[], barsPerNewCandle: number): Candle[] {
  const result: Candle[] = [];
  for (let i = 0; i < candles.length; i += barsPerNewCandle) {
    const chunk = candles.slice(i, i + barsPerNewCandle);
    if (chunk.length < barsPerNewCandle) break;
    const open = chunk[0].open;
    const close = chunk[chunk.length - 1].close;
    const high = Math.max(...chunk.map(c => c.high));
    const low = Math.min(...chunk.map(c => c.low));
    const volume = chunk.reduce((sum, c) => sum + (c.volume || 0), 0);
    const timestamp = chunk[chunk.length - 1].timestamp;
    result.push({ open, high, low, close, volume, timestamp });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Candle pattern detection
// ---------------------------------------------------------------------------

function isBullishEngulfing(candles: Candle[], i: number): boolean {
  if (i < 1) return false;
  const prev = candles[i - 1];
  const curr = candles[i];
  const prevBody = Math.abs(prev.close - prev.open);
  const currBody = Math.abs(curr.close - curr.open);
  return (
    prev.close < prev.open &&
    curr.close > curr.open &&
    curr.open <= prev.close &&
    curr.close >= prev.open &&
    currBody > prevBody
  );
}

function isBearishEngulfing(candles: Candle[], i: number): boolean {
  if (i < 1) return false;
  const prev = candles[i - 1];
  const curr = candles[i];
  const prevBody = Math.abs(prev.close - prev.open);
  const currBody = Math.abs(curr.close - curr.open);
  return (
    prev.close > prev.open &&
    curr.close < curr.open &&
    curr.open >= prev.close &&
    curr.close <= prev.open &&
    currBody > prevBody
  );
}

function isBullishPinBar(candles: Candle[], i: number): boolean {
  if (i < 1) return false;
  const curr = candles[i];
  const range = curr.high - curr.low;
  if (range <= 0) return false;
  const body = Math.abs(curr.close - curr.open);
  const lowerWick = Math.min(curr.open, curr.close) - curr.low;
  const upperWick = curr.high - Math.max(curr.open, curr.close);
  return (
    lowerWick > body * 2 &&
    upperWick < range * 0.3 &&
    curr.close > curr.open
  );
}

function isBearishPinBar(candles: Candle[], i: number): boolean {
  if (i < 1) return false;
  const curr = candles[i];
  const range = curr.high - curr.low;
  if (range <= 0) return false;
  const body = Math.abs(curr.close - curr.open);
  const lowerWick = Math.min(curr.open, curr.close) - curr.low;
  const upperWick = curr.high - Math.max(curr.open, curr.close);
  return (
    upperWick > body * 2 &&
    lowerWick < range * 0.3 &&
    curr.close < curr.open
  );
}

// ---------------------------------------------------------------------------
// Find recent swing high/low
// ---------------------------------------------------------------------------

function findRecentSwingLow(candles: Candle[], lookback: number = 20): number {
  const recent = candles.slice(-lookback);
  return Math.min(...recent.map(c => c.low));
}

function findRecentSwingHigh(candles: Candle[], lookback: number = 20): number {
  const recent = candles.slice(-lookback);
  return Math.max(...recent.map(c => c.high));
}

// ---------------------------------------------------------------------------
// Session filter (London/NY only)
// ---------------------------------------------------------------------------

function isGoodSession(timestamp: string): boolean {
  const hour = new Date(timestamp).getUTCHours();
  return hour >= 7 && hour <= 21;
}

// ---------------------------------------------------------------------------
// Main signal detection
// ---------------------------------------------------------------------------

export function scanTrendPullbackSignals(pair: string, m5Candles: Candle[]): TrendPullbackSignal[] {
  const signals: TrendPullbackSignal[] = [];
  if (m5Candles.length < 600) return signals; // need enough data for all timeframes

  // Aggregate to higher timeframes
  const m15Candles = aggregateCandles(m5Candles, 3);
  const h1Candles = aggregateCandles(m5Candles, 12);
  const h4Candles = aggregateCandles(m5Candles, 48);

  // Need minimum bars for indicators
  if (m15Candles.length < 150 || h1Candles.length < 150 || h4Candles.length < 150) return signals;

  // Compute H4 indicators
  const h4Closes = h4Candles.map(c => c.close);
  const h4Ema100 = ema(h4Closes, 100);
  const h4Ema100At = (i: number) => {
    const j = i - 99;
    return (j >= 0 && j < h4Ema100.length) ? h4Ema100[j] : undefined;
  };

  // Compute H1 indicators (EMA cascade: 20 > 50 > 100)
  const h1Closes = h1Candles.map(c => c.close);
  const h1Ema20 = ema(h1Closes, 20);
  const h1Ema50 = ema(h1Closes, 50);
  const h1Ema100 = ema(h1Closes, 100);
  const h1Ema20At = (i: number) => {
    const j = i - 19;
    return (j >= 0 && j < h1Ema20.length) ? h1Ema20[j] : undefined;
  };
  const h1Ema50At = (i: number) => {
    const j = i - 49;
    return (j >= 0 && j < h1Ema50.length) ? h1Ema50[j] : undefined;
  };
  const h1Ema100At = (i: number) => {
    const j = i - 99;
    return (j >= 0 && j < h1Ema100.length) ? h1Ema100[j] : undefined;
  };

  // Compute M15 indicators
  const m15Closes = m15Candles.map(c => c.close);
  const m15Ema20 = ema(m15Closes, 20);
  const m15Ema50 = ema(m15Closes, 50);
  const m15Ema20At = (i: number) => {
    const j = i - 19;
    return (j >= 0 && j < m15Ema20.length) ? m15Ema20[j] : undefined;
  };
  const m15Ema50At = (i: number) => {
    const j = i - 49;
    return (j >= 0 && j < m15Ema50.length) ? m15Ema50[j] : undefined;
  };

  const m15Rsi = rsi(m15Closes, 14);
  const m15RsiAt = (i: number) => {
    const j = i - 14;
    return (j >= 0 && j < m15Rsi.length) ? m15Rsi[j] : undefined;
  };

  const m15Atr = atr(m15Candles, 14);
  const m15AtrAt = (i: number) => {
    const j = i - 14;
    return (j >= 0 && j < m15Atr.length) ? m15Atr[j] : undefined;
  };
  const m15AtrAvg = sma(m15Atr, 20);
  const m15AtrAvgAt = (i: number) => {
    const j = i - 14 - 19;
    return (j >= 0 && j < m15AtrAvg.length) ? m15AtrAvg[j] : undefined;
  };

  const pipMultiplier = pair.includes('JPY') ? 0.01 : 0.0001;
  const MIN_SIGNAL_GAP_MS = 30 * 60 * 1000; // 30 min gap between signals

  let lastTs = 0;

  // Scan M15 candles for signals
  for (let i = 150; i < m15Candles.length; i++) {
    const m15Candle = m15Candles[i];
    if (!isGoodSession(m15Candle.timestamp)) continue;

    const ts = new Date(m15Candle.timestamp).getTime();
    if (ts - lastTs < MIN_SIGNAL_GAP_MS) continue;

    // Map M15 index to H1 and H4 indices
    const h1Idx = Math.floor(i / 4);
    const h4Idx = Math.floor(i / 16);

    if (h1Idx < 100 || h4Idx < 100) continue;

    // Step 1: H4 Trend Filter
    const h4Ema100 = h4Ema100At(h4Idx);
    const h1Close = h1Candles[h1Idx].close;
    if (h4Ema100 === undefined) continue;

    const h4Bullish = h1Close > h4Ema100;
    const h4Bearish = h1Close < h4Ema100;

    // Step 2: H1 EMA Cascade
    const h1Ema20 = h1Ema20At(h1Idx);
    const h1Ema50 = h1Ema50At(h1Idx);
    const h1Ema100 = h1Ema100At(h1Idx);
    if (h1Ema20 === undefined || h1Ema50 === undefined || h1Ema100 === undefined) continue;

    const h1BullishCascade = h1Ema20 > h1Ema50 && h1Ema50 > h1Ema100;
    const h1BearishCascade = h1Ema20 < h1Ema50 && h1Ema50 < h1Ema100;

    const trendAlignedBull = h4Bullish && h1BullishCascade;
    const trendAlignedBear = h4Bearish && h1BearishCascade;

    if (!trendAlignedBull && !trendAlignedBear) continue;

    // Step 3: M15 Pullback to EMA20 or EMA50
    const m15Ema20 = m15Ema20At(i);
    const m15Ema50 = m15Ema50At(i);
    const m15Close = m15Candle.close;
    if (m15Ema20 === undefined || m15Ema50 === undefined) continue;

    // Pullback: price touches or comes within 0.3% of EMA
    const pullbackToEma20Bull = m15Close <= m15Ema20 * 1.003 && m15Close >= m15Ema20 * 0.997;
    const pullbackToEma50Bull = m15Close <= m15Ema50 * 1.003 && m15Close >= m15Ema50 * 0.997;
    const pullbackToEma20Bear = m15Close >= m15Ema20 * 0.997 && m15Close <= m15Ema20 * 1.003;
    const pullbackToEma50Bear = m15Close >= m15Ema50 * 0.997 && m15Close <= m15Ema50 * 1.003;

    const pullbackBull = pullbackToEma20Bull || pullbackToEma50Bull;
    const pullbackBear = pullbackToEma20Bear || pullbackToEma50Bear;

    if (trendAlignedBull && !pullbackBull) continue;
    if (trendAlignedBear && !pullbackBear) continue;

    // Step 4: Entry Confirmation (reversal candle)
    const bullishEngulfing = isBullishEngulfing(m15Candles, i);
    const bearishEngulfing = isBearishEngulfing(m15Candles, i);
    const bullishPinBar = isBullishPinBar(m15Candles, i);
    const bearishPinBar = isBearishPinBar(m15Candles, i);

    const confirmationBull = bullishEngulfing || bullishPinBar;
    const confirmationBear = bearishEngulfing || bearishPinBar;

    if (trendAlignedBull && !confirmationBull) continue;
    if (trendAlignedBear && !confirmationBear) continue;

    // Step 5: RSI Filter (40-60 during pullback)
    const rsiVal = m15RsiAt(i);
    if (rsiVal === undefined) continue;

    const rsiOk = rsiVal >= 40 && rsiVal <= 60;
    if (!rsiOk) continue;

    // Step 6: ATR Filter (expanding volatility)
    const atrVal = m15AtrAt(i);
    const atrAvg = m15AtrAvgAt(i);
    if (atrVal === undefined || atrAvg === undefined) continue;

    if (atrVal <= atrAvg) continue; // ATR must be above average

    // All filters passed - generate signal
    const direction = trendAlignedBull ? 'LONG' : 'SHORT';
    const entry = m15Close;

    // Risk Management
    const swingLow = findRecentSwingLow(m15Candles.slice(0, i + 1), 20);
    const swingHigh = findRecentSwingHigh(m15Candles.slice(0, i + 1), 20);

    let sl: number;
    if (direction === 'LONG') {
      sl = swingLow - atrVal * 1.5; // beyond swing low + 1.5x ATR buffer
    } else {
      sl = swingHigh + atrVal * 1.5; // beyond swing high + 1.5x ATR buffer
    }

    const risk = Math.abs(entry - sl);
    const tp1 = direction === 'LONG' ? entry + risk * 1.5 : entry - risk * 1.5;
    const tp2 = direction === 'LONG' ? entry + risk * 2.5 : entry - risk * 2.5;
    const tp3 = direction === 'LONG' ? entry + risk * 4 : entry - risk * 4;

    // Confidence Score
    let confidence = 55;
    if (trendAlignedBull || trendAlignedBear) confidence += 15; // H4/H1 trend alignment
    if (pullbackToEma20Bull || pullbackToEma20Bear) confidence += 10; // clean pullback to EMA20
    if (bullishEngulfing || bearishEngulfing) confidence += 10; // strong reversal candle
    if (rsiVal >= 45 && rsiVal <= 55) confidence += 5; // RSI near neutral
    if (atrVal > atrAvg * 1.2) confidence += 5; // ATR expanding
    if (isGoodSession(m15Candle.timestamp)) confidence += 5; // good session

    confidence = Math.min(confidence, 100);

    // Only publish if confidence >= 70
    if (confidence < 70) continue;

    const slPips = risk / pipMultiplier;

    const reason = `H4/H1 trend aligned (${direction}), EMA cascade confirmed, pullback to EMA${pullbackToEma20Bull || pullbackToEma20Bear ? '20' : '50'}, ${bullishEngulfing ? 'bullish engulfing' : bearishEngulfing ? 'bearish engulfing' : bullishPinBar ? 'bullish pin bar' : 'bearish pin bar'} candle, RSI ${rsiVal.toFixed(1)}, ATR above average`;

    signals.push({
      pair,
      direction,
      entry,
      sl,
      tp1,
      tp2,
      tp3,
      confidence,
      reason,
      candleIndex: i,
      slPips,
    });

    lastTs = ts;
  }

  return signals;
}
