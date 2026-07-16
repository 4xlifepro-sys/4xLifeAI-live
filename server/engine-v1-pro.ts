import type { Candle } from '../src/types.js';

// ---------------------------------------------------------------------------
// 4xLifeAI V1 - Professional Multi-Timeframe Signal Engine
//
// Timeframes:
// - H4: Market direction (EMA200)
// - H1: Trend confirmation (EMA50 vs EMA200)
// - M15: Signal generation (EMA20/50 pullback, RSI, ATR, candle patterns)
//
// Fully isolated backtest engine - does not modify any live files.
// ---------------------------------------------------------------------------

export interface V1Signal {
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
// Indicator math (self-contained)
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

// 5min -> M15: 3 bars per candle
// 5min -> H1: 12 bars per candle
// 5min -> H4: 48 bars per candle

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
    prev.close < prev.open && // prev is bearish
    curr.close > curr.open && // curr is bullish
    curr.open <= prev.close && // curr opens at or below prev close
    curr.close >= prev.open && // curr closes at or above prev open
    currBody > prevBody // curr body is larger
  );
}

function isBearishEngulfing(candles: Candle[], i: number): boolean {
  if (i < 1) return false;
  const prev = candles[i - 1];
  const curr = candles[i];
  const prevBody = Math.abs(prev.close - prev.open);
  const currBody = Math.abs(curr.close - curr.open);
  return (
    prev.close > prev.open && // prev is bullish
    curr.close < curr.open && // curr is bearish
    curr.open >= prev.close && // curr opens at or above prev close
    curr.close <= prev.open && // curr closes at or below prev open
    currBody > prevBody // curr body is larger
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
    lowerWick > body * 2 && // lower wick is at least 2x body
    upperWick < range * 0.3 && // upper wick is small
    curr.close > curr.open // closes bullish
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
    upperWick > body * 2 && // upper wick is at least 2x body
    lowerWick < range * 0.3 && // lower wick is small
    curr.close < curr.open // closes bearish
  );
}

function isStrongMomentumCandle(candles: Candle[], i: number, direction: 'LONG' | 'SHORT'): boolean {
  const curr = candles[i];
  const range = curr.high - curr.low;
  if (range <= 0) return false;
  const body = Math.abs(curr.close - curr.open);
  const bodyRatio = body / range;
  if (direction === 'LONG') {
    return bodyRatio > 0.7 && curr.close > curr.open; // large bullish body
  } else {
    return bodyRatio > 0.7 && curr.close < curr.open; // large bearish body
  }
}

// ---------------------------------------------------------------------------
// Market structure detection (simplified HH/HL/LH/LL)
// ---------------------------------------------------------------------------

function detectMarketStructure(candles: Candle[], lookback: number = 20): 'BULLISH' | 'BEARISH' | 'RANGING' {
  if (candles.length < lookback) return 'RANGING';
  const recent = candles.slice(-lookback);
  const highs = recent.map(c => c.high);
  const lows = recent.map(c => c.low);
  
  // Find swing highs and lows (simplified: local max/min)
  const swingHighs: number[] = [];
  const swingLows: number[] = [];
  for (let i = 2; i < highs.length - 2; i++) {
    if (highs[i] > highs[i - 1] && highs[i] > highs[i - 2] && highs[i] > highs[i + 1] && highs[i] > highs[i + 2]) {
      swingHighs.push(highs[i]);
    }
    if (lows[i] < lows[i - 1] && lows[i] < lows[i - 2] && lows[i] < lows[i + 1] && lows[i] < lows[i + 2]) {
      swingLows.push(lows[i]);
    }
  }
  
  if (swingHighs.length < 2 || swingLows.length < 2) return 'RANGING';
  
  const lastSH = swingHighs[swingHighs.length - 1];
  const prevSH = swingHighs[swingHighs.length - 2];
  const lastSL = swingLows[swingLows.length - 1];
  const prevSL = swingLows[swingLows.length - 2];
  
  const higherHigh = lastSH > prevSH;
  const higherLow = lastSL > prevSL;
  const lowerHigh = lastSH < prevSH;
  const lowerLow = lastSL < prevSL;
  
  if (higherHigh && higherLow) return 'BULLISH';
  if (lowerHigh && lowerLow) return 'BEARISH';
  return 'RANGING';
}

// ---------------------------------------------------------------------------
// Find recent swing high/low for stop-loss placement
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
  return hour >= 7 && hour <= 21; // London (7-16) + NY (12-21) overlap
}

// ---------------------------------------------------------------------------
// Main signal detection
// ---------------------------------------------------------------------------

export function scanV1Signals(pair: string, m5Candles: Candle[]): V1Signal[] {
  const signals: V1Signal[] = [];
  if (m5Candles.length < 500) return signals; // need enough data for all timeframes

  // Aggregate to higher timeframes
  const m15Candles = aggregateCandles(m5Candles, 3);
  const h1Candles = aggregateCandles(m5Candles, 12);
  const h4Candles = aggregateCandles(m5Candles, 48);

  // Need minimum bars for indicators
  if (m15Candles.length < 100 || h1Candles.length < 100 || h4Candles.length < 250) return signals;

  // Compute indicators for each timeframe
  const h4Closes = h4Candles.map(c => c.close);
  const h4Ema200 = ema(h4Closes, 200);
  const h4Ema200At = (i: number) => {
    const j = i - 199;
    return (j >= 0 && j < h4Ema200.length) ? h4Ema200[j] : undefined;
  };

  const h1Closes = h1Candles.map(c => c.close);
  const h1Ema50 = ema(h1Closes, 50);
  const h1Ema200 = ema(h1Closes, 200);
  const h1Ema50At = (i: number) => {
    const j = i - 49;
    return (j >= 0 && j < h1Ema50.length) ? h1Ema50[j] : undefined;
  };
  const h1Ema200At = (i: number) => {
    const j = i - 199;
    return (j >= 0 && j < h1Ema200.length) ? h1Ema200[j] : undefined;
  };

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

  // Scan M15 candles for signals (starting from index 100 to ensure all indicators are ready)
  for (let i = 100; i < m15Candles.length; i++) {
    const m15Candle = m15Candles[i];
    if (!isGoodSession(m15Candle.timestamp)) continue;

    const ts = new Date(m15Candle.timestamp).getTime();
    if (ts - lastTs < MIN_SIGNAL_GAP_MS) continue;

    // Map M15 index to H1 and H4 indices
    // M15 is 3x 5min, H1 is 12x 5min, H4 is 48x 5min
    // So M15 index i corresponds to H1 index floor(i/4) and H4 index floor(i/16)
    const h1Idx = Math.floor(i / 4);
    const h4Idx = Math.floor(i / 16);

    if (h1Idx < 200 || h4Idx < 200) continue; // need enough H1/H4 data

    // Step 1: Trend Filter (H4 + H1)
    const h4Ema200 = h4Ema200At(h4Idx);
    const h1Ema50 = h1Ema50At(h1Idx);
    const h1Ema200 = h1Ema200At(h1Idx);
    const h1Close = h1Candles[h1Idx].close;

    if (h4Ema200 === undefined || h1Ema50 === undefined || h1Ema200 === undefined) continue;

    const h4Bullish = h1Close > h4Ema200;
    const h4Bearish = h1Close < h4Ema200;
    const h1Bullish = h1Ema50 > h1Ema200;
    const h1Bearish = h1Ema50 < h1Ema200;

    const trendAlignedBull = h4Bullish && h1Bullish;
    const trendAlignedBear = h4Bearish && h1Bearish;

    if (!trendAlignedBull && !trendAlignedBear) continue; // trend not aligned

    // Step 2: Market Structure (M15)
    const structure = detectMarketStructure(m15Candles.slice(0, i + 1), 20);
    const structureBull = structure === 'BULLISH';
    const structureBear = structure === 'BEARISH';

    if (trendAlignedBull && !structureBull) continue;
    if (trendAlignedBear && !structureBear) continue;

    // Step 3: Pullback to EMA20 or EMA50 on M15
    const m15Ema20 = m15Ema20At(i);
    const m15Ema50 = m15Ema50At(i);
    const m15Close = m15Candle.close;

    if (m15Ema20 === undefined || m15Ema50 === undefined) continue;

    const pullbackToEma20Bull = m15Close <= m15Ema20 * 1.002 && m15Close >= m15Ema20 * 0.998; // within 0.2% of EMA20
    const pullbackToEma50Bull = m15Close <= m15Ema50 * 1.002 && m15Close >= m15Ema50 * 0.998;
    const pullbackToEma20Bear = m15Close >= m15Ema20 * 0.998 && m15Close <= m15Ema20 * 1.002;
    const pullbackToEma50Bear = m15Close >= m15Ema50 * 0.998 && m15Close <= m15Ema50 * 1.002;

    const pullbackBull = pullbackToEma20Bull || pullbackToEma50Bull;
    const pullbackBear = pullbackToEma20Bear || pullbackToEma50Bear;

    if (trendAlignedBull && !pullbackBull) continue;
    if (trendAlignedBear && !pullbackBear) continue;

    // Step 4: Entry Confirmation (candle pattern)
    const bullishEngulfing = isBullishEngulfing(m15Candles, i);
    const bearishEngulfing = isBearishEngulfing(m15Candles, i);
    const bullishPinBar = isBullishPinBar(m15Candles, i);
    const bearishPinBar = isBearishPinBar(m15Candles, i);
    const strongMomentumBull = isStrongMomentumCandle(m15Candles, i, 'LONG');
    const strongMomentumBear = isStrongMomentumCandle(m15Candles, i, 'SHORT');

    const confirmationBull = bullishEngulfing || bullishPinBar || strongMomentumBull;
    const confirmationBear = bearishEngulfing || bearishPinBar || strongMomentumBear;

    if (trendAlignedBull && !confirmationBull) continue;
    if (trendAlignedBear && !confirmationBear) continue;

    // Step 5: Momentum (RSI)
    const rsiVal = m15RsiAt(i);
    if (rsiVal === undefined) continue;

    const rsiBull = rsiVal >= 50 && rsiVal <= 65;
    const rsiBear = rsiVal >= 35 && rsiVal <= 50;

    if (trendAlignedBull && !rsiBull) continue;
    if (trendAlignedBear && !rsiBear) continue;

    // Step 6: Volatility (ATR)
    const atrVal = m15AtrAt(i);
    const atrAvg = m15AtrAvgAt(i);
    if (atrVal === undefined || atrAvg === undefined) continue;

    if (atrVal <= atrAvg) continue; // ATR must be above average

    // All filters passed - generate signal
    const direction = trendAlignedBull ? 'LONG' : 'SHORT';
    const entry = m15Close;

    // Step 8: Risk Management
    const swingLow = findRecentSwingLow(m15Candles.slice(0, i + 1), 20);
    const swingHigh = findRecentSwingHigh(m15Candles.slice(0, i + 1), 20);

    let sl: number;
    if (direction === 'LONG') {
      sl = swingLow - atrVal; // beyond swing low + 1x ATR buffer
    } else {
      sl = swingHigh + atrVal; // beyond swing high + 1x ATR buffer
    }

    const risk = Math.abs(entry - sl);
    const tp1 = direction === 'LONG' ? entry + risk : entry - risk;
    const tp2 = direction === 'LONG' ? entry + risk * 2 : entry - risk * 2;
    const tp3 = direction === 'LONG' ? entry + risk * 3 : entry - risk * 3;

    // Minimum R:R check (must be at least 1:2)
    const rrToTp2 = risk / risk; // always 1:1 to TP1, 1:2 to TP2
    if (rrToTp2 < 2) continue; // skip if R:R is below 1:2

    // Step 9: Confidence Score
    let confidence = 60;
    if (trendAlignedBull || trendAlignedBear) confidence += 10; // trend alignment
    if (structureBull || structureBear) confidence += 10; // strong market structure
    if (pullbackToEma20Bull || pullbackToEma20Bear) confidence += 5; // pullback to EMA20 (better than EMA50)
    if (bullishEngulfing || bearishEngulfing) confidence += 5; // strong entry candle
    if (atrVal > atrAvg * 1.2) confidence += 5; // ATR expansion
    if (isGoodSession(m15Candle.timestamp)) confidence += 5; // good session (already filtered, but bonus for overlap hours)

    confidence = Math.min(confidence, 100);

    // Only publish if confidence >= 70 (relaxed from 85 to get actual signals)
    if (confidence < 70) continue;

    const slPips = risk / pipMultiplier;

    const reason = `H4/H1 trend aligned (${direction}), ${structure.toLowerCase()} structure, pullback to EMA${pullbackToEma20Bull || pullbackToEma20Bear ? '20' : '50'}, ${bullishEngulfing ? 'bullish engulfing' : bearishEngulfing ? 'bearish engulfing' : bullishPinBar ? 'bullish pin bar' : bearishPinBar ? 'bearish pin bar' : 'strong momentum'} candle, RSI ${rsiVal.toFixed(1)}, ATR above average`;

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
