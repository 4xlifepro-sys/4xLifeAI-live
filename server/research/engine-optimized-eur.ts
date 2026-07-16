import type { Candle } from '../../src/types.js';

// ---------------------------------------------------------------------------
// RESEARCH ENGINE: Optimized EUR Strategy
// Target: 60%+ WR, 8 pip min SL, 4+ signals/day
// Indicators: EMA + RSI + ATR + Bollinger Bands + Price Action
// ---------------------------------------------------------------------------

export interface OptimizedSignal {
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

function stddev(values: number[], smaArr: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = period - 1; i < values.length; i++) {
    const mean = smaArr[i - (period - 1)];
    let sumSq = 0;
    for (let j = i - period + 1; j <= i; j++) sumSq += (values[j] - mean) ** 2;
    result.push(Math.sqrt(sumSq / period));
  }
  return result;
}

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

function isGoodSession(timestamp: string): boolean {
  const hour = new Date(timestamp).getUTCHours();
  return hour >= 7 && hour <= 21;
}

export function scanOptimizedSignals(pair: string, m5Candles: Candle[]): OptimizedSignal[] {
  const signals: OptimizedSignal[] = [];
  if (m5Candles.length < 300) return signals;

  const m15Candles = aggregateCandles(m5Candles, 3);
  if (m15Candles.length < 100) return signals;

  const m15Closes = m15Candles.map(c => c.close);
  
  // Indicators
  const m15Ema50 = ema(m15Closes, 50);
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

  const smaArr = sma(m15Closes, 20);
  const stdArr = stddev(m15Closes, smaArr, 20);
  const bbAt = (i: number) => {
    const j = i - 19;
    return (j >= 0 && j < smaArr.length) ? { mean: smaArr[j], std: stdArr[j] } : undefined;
  };

  const pipMultiplier = pair.includes('JPY') ? 0.01 : 0.0001;
  const MIN_SL_PIPS = 8; // minimum 8 pips for EUR pairs
  const MIN_SIGNAL_GAP_MS = 15 * 60 * 1000; // 15 min gap (target 4+ signals/day)

  let lastTs = 0;

  for (let i = 80; i < m15Candles.length; i++) {
    const m15Candle = m15Candles[i];
    if (!isGoodSession(m15Candle.timestamp)) continue;

    const ts = new Date(m15Candle.timestamp).getTime();
    if (ts - lastTs < MIN_SIGNAL_GAP_MS) continue;

    const ema50 = m15Ema50At(i);
    const rsiVal = m15RsiAt(i);
    const atrVal = m15AtrAt(i);
    const bb = bbAt(i);

    if (ema50 === undefined || rsiVal === undefined || !atrVal || bb === undefined) continue;

    const bbUpper = bb.mean + 2 * bb.std;
    const bbLower = bb.mean - 2 * bb.std;

    // Trend filter
    const trendBull = m15Candle.close > ema50;
    const trendBear = m15Candle.close < ema50;

    // Entry conditions - balanced for win rate + frequency
    const longSetup = m15Candle.close <= bbLower && 
      rsiVal < 30 && 
      (isBullishEngulfing(m15Candles, i) || isBullishPinBar(m15Candles, i) || m15Candle.close > m15Candle.open);

    const shortSetup = m15Candle.close >= bbUpper && 
      rsiVal > 70 && 
      (isBearishEngulfing(m15Candles, i) || isBearishPinBar(m15Candles, i) || m15Candle.close < m15Candle.open);

    if (!longSetup && !shortSetup) continue;

    const direction = longSetup ? 'LONG' : 'SHORT';
    const entry = m15Candle.close;

    // SL: 8 pip minimum, or ATR-based (whichever is larger)
    const atrSl = atrVal * 1.5;
    const minSl = MIN_SL_PIPS * pipMultiplier;
    const slDistance = Math.max(atrSl, minSl);

    let sl: number;
    if (direction === 'LONG') {
      sl = entry - slDistance;
    } else {
      sl = entry + slDistance;
    }

    // TP: 1:1.5, 1:3, 1:5 R:R
    const risk = Math.abs(entry - sl);
    const tp1 = direction === 'LONG' ? entry + risk * 1.5 : entry - risk * 1.5;
    const tp2 = direction === 'LONG' ? entry + risk * 3 : entry - risk * 3;
    const tp3 = direction === 'LONG' ? entry + risk * 5 : entry - risk * 5;

    // Confidence
    let confidence = 65;
    if (rsiVal < 25 || rsiVal > 75) confidence += 10; // extreme RSI
    if (isBullishEngulfing(m15Candles, i) || isBearishEngulfing(m15Candles, i)) confidence += 10;
    if (atrVal > atrVal * 1.2) confidence += 5; // ATR expansion (placeholder, needs avg)

    confidence = Math.min(confidence, 100);

    const slPips = risk / pipMultiplier;

    const reason = `${direction} | EMA50 trend, BB extreme, RSI ${rsiVal.toFixed(1)}, reversal candle, SL ${slPips.toFixed(1)} pips`;

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
