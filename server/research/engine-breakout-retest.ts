import type { Candle } from '../../src/types.js';

// ---------------------------------------------------------------------------
// RESEARCH ENGINE: Trend Continuation (Breakout + Retest)
//
// Core Idea: Trade the retest after a breakout, not the initial breakout
//
// Timeframes:
// - H4: Overall trend direction (EMA100)
// - M15: Signal generation (breakout + retest + rejection candle)
//
// Fully isolated - does not import or modify any production engine.
// ---------------------------------------------------------------------------

export interface BreakoutRetestSignal {
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
// Aggregate 5min candles
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
// Donchian channel (for consolidation range detection)
// ---------------------------------------------------------------------------

function donchian(candles: Candle[], period: number): { highs: (number | undefined)[]; lows: (number | undefined)[] } {
  const highs: (number | undefined)[] = new Array(candles.length).fill(undefined);
  const lows: (number | undefined)[] = new Array(candles.length).fill(undefined);
  for (let i = period; i < candles.length; i++) {
    let hi = -Infinity, lo = Infinity;
    for (let j = i - period; j < i; j++) {
      if (candles[j].high > hi) hi = candles[j].high;
      if (candles[j].low < lo) lo = candles[j].low;
    }
    highs[i] = hi;
    lows[i] = lo;
  }
  return { highs, lows };
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
// Session filter
// ---------------------------------------------------------------------------

function isGoodSession(timestamp: string): boolean {
  const hour = new Date(timestamp).getUTCHours();
  return hour >= 7 && hour <= 21;
}

// ---------------------------------------------------------------------------
// Main signal detection
// ---------------------------------------------------------------------------

export function scanBreakoutRetestSignals(pair: string, m5Candles: Candle[]): BreakoutRetestSignal[] {
  const signals: BreakoutRetestSignal[] = [];
  if (m5Candles.length < 500) return signals;

  // Aggregate to M15
  const m15Candles = aggregateCandles(m5Candles, 3);
  const h4Candles = aggregateCandles(m5Candles, 48);

  if (m15Candles.length < 200 || h4Candles.length < 150) return signals;

  // Compute H4 trend filter
  const h4Closes = h4Candles.map(c => c.close);
  const h4Ema100 = ema(h4Closes, 100);
  const h4Ema100At = (i: number) => {
    const j = i - 99;
    return (j >= 0 && j < h4Ema100.length) ? h4Ema100[j] : undefined;
  };

  // Compute M15 indicators
  const m15Closes = m15Candles.map(c => c.close);
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

  // Donchian channel for consolidation range (20 bars)
  const { highs: donHigh, lows: donLow } = donchian(m15Candles, 20);

  const pipMultiplier = pair.includes('JPY') ? 0.01 : 0.0001;
  const MIN_SIGNAL_GAP_MS = 45 * 60 * 1000; // 45 min gap (breakouts need time)

  let lastTs = 0;
  let lastBreakoutIdx = -100; // track last breakout to detect retest

  // Scan M15 candles
  for (let i = 100; i < m15Candles.length; i++) {
    const m15Candle = m15Candles[i];
    if (!isGoodSession(m15Candle.timestamp)) continue;

    const ts = new Date(m15Candle.timestamp).getTime();
    if (ts - lastTs < MIN_SIGNAL_GAP_MS) continue;

    // Map to H4 index
    const h4Idx = Math.floor(i / 16);
    if (h4Idx < 100) continue;

    // Step 1: H4 Trend Filter
    const h4Ema100 = h4Ema100At(h4Idx);
    const h4Close = h4Candles[h4Idx].close;
    if (h4Ema100 === undefined) continue;

    const h4Bullish = h4Close > h4Ema100;
    const h4Bearish = h4Close < h4Ema100;

    // Step 2: Detect breakout (close beyond Donchian channel)
    const donHi = donHigh[i];
    const donLo = donLow[i];
    if (donHi === undefined || donLo === undefined) continue;

    const range = m15Candle.high - m15Candle.low;
    if (range <= 0) continue;

    // Strong breakout candle: close in top/bottom 25% of range
    const strongCloseLong = m15Candle.close >= m15Candle.low + 0.75 * range;
    const strongCloseShort = m15Candle.close <= m15Candle.high - 0.75 * range;

    const brokeOutLong = m15Candle.close > donHi && strongCloseLong;
    const brokeOutShort = m15Candle.close < donLo && strongCloseShort;

    // Track breakout
    if (brokeOutLong || brokeOutShort) {
      lastBreakoutIdx = i;
      continue; // wait for retest, don't enter on breakout
    }

    // Step 3: Detect retest (price returns to breakout level within 10 bars)
    const barsSinceBreakout = i - lastBreakoutIdx;
    if (barsSinceBreakout < 2 || barsSinceBreakout > 10) continue;

    const breakoutLevel = lastBreakoutIdx > 0 ? 
      (brokeOutLong ? donHigh[lastBreakoutIdx] : donLow[lastBreakoutIdx]) : undefined;
    if (breakoutLevel === undefined) continue;

    // Retest: price touches breakout level (within 0.2x ATR)
    const atrVal = m15AtrAt(i);
    if (atrVal === undefined) continue;

    const retestLong = m15Candle.low <= breakoutLevel + atrVal * 0.2 && m15Candle.low >= breakoutLevel - atrVal * 0.2;
    const retestShort = m15Candle.high >= breakoutLevel - atrVal * 0.2 && m15Candle.high <= breakoutLevel + atrVal * 0.2;

    // Step 4: Entry confirmation (rejection candle at retest)
    const bullishEngulfing = isBullishEngulfing(m15Candles, i);
    const bearishEngulfing = isBearishEngulfing(m15Candles, i);
    const bullishPinBar = isBullishPinBar(m15Candles, i);
    const bearishPinBar = isBearishPinBar(m15Candles, i);

    const confirmationBull = bullishEngulfing || bullishPinBar;
    const confirmationBear = bearishEngulfing || bearishPinBar;

    // Step 5: RSI filter (momentum confirmation, not extreme)
    const rsiVal = m15RsiAt(i);
    if (rsiVal === undefined) continue;

    const rsiLongOk = rsiVal >= 55 && rsiVal <= 70;
    const rsiShortOk = rsiVal >= 30 && rsiVal <= 45;

    // Step 6: ATR filter (volatility expansion)
    const atrAvg = m15AtrAvgAt(i);
    if (atrAvg === undefined) continue;

    if (atrVal <= atrAvg) continue;

    // Check all conditions
    const longSetup = h4Bullish && retestLong && confirmationBull && rsiLongOk;
    const shortSetup = h4Bearish && retestShort && confirmationBear && rsiShortOk;

    if (!longSetup && !shortSetup) continue;

    // Generate signal
    const direction = longSetup ? 'LONG' : 'SHORT';
    const entry = m15Candle.close;

    // Risk Management: SL beyond consolidation range opposite side
    const rangeHeight = donHi - donLo;
    let sl: number;
    if (direction === 'LONG') {
      sl = donLo - atrVal; // below range low + ATR buffer
    } else {
      sl = donHi + atrVal; // above range high + ATR buffer
    }

    const risk = Math.abs(entry - sl);
    const tp1 = direction === 'LONG' ? entry + risk : entry - risk; // 1R = range height
    const tp2 = direction === 'LONG' ? entry + risk * 2 : entry - risk * 2;
    const tp3 = direction === 'LONG' ? entry + risk * 3 : entry - risk * 3;

    // Confidence Score
    let confidence = 55;
    if (h4Bullish || h4Bearish) confidence += 15; // H4 trend alignment
    if (barsSinceBreakout >= 3 && barsSinceBreakout <= 7) confidence += 10; // clean retest timing
    if (bullishEngulfing || bearishEngulfing) confidence += 10; // strong reversal candle
    if (atrVal > atrAvg * 1.3) confidence += 5; // ATR expansion
    if (rsiVal >= 58 && rsiVal <= 67) confidence += 5; // RSI in momentum zone

    confidence = Math.min(confidence, 100);

    if (confidence < 70) continue;

    const slPips = risk / pipMultiplier;

    const reason = `H4 trend ${direction}, breakout + retest of ${barsSinceBreakout}-bar Donchian channel, ${bullishEngulfing ? 'bullish engulfing' : bearishEngulfing ? 'bearish engulfing' : bullishPinBar ? 'bullish pin bar' : 'bearish pin bar'} at retest, RSI ${rsiVal.toFixed(1)}, ATR expanding`;

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
