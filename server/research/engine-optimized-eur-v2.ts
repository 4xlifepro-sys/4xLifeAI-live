import type { Candle } from '../../src/types.js';

// ---------------------------------------------------------------------------
// RESEARCH ENGINE: Optimized EUR Strategy V2
// Target: 60%+ WR, 8 pip min SL, 4+ signals/day
// Timeframe: M5 (more signals than M15)
// Pairs: EURUSD, EURGBP (best performers from V1)
// ---------------------------------------------------------------------------

export interface OptimizedSignalV2 {
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

export function scanOptimizedSignalsV2(pair: string, m5Candles: Candle[]): OptimizedSignalV2[] {
  const signals: OptimizedSignalV2[] = [];
  if (m5Candles.length < 200) return signals;

  const closes = m5Candles.map(c => c.close);
  
  // Indicators on M5
  const ema50 = ema(closes, 50);
  const ema50At = (i: number) => {
    const j = i - 49;
    return (j >= 0 && j < ema50.length) ? ema50[j] : undefined;
  };

  const rsiArr = rsi(closes, 14);
  const rsiAt = (i: number) => {
    const j = i - 14;
    return (j >= 0 && j < rsiArr.length) ? rsiArr[j] : undefined;
  };

  const atrArr = atr(m5Candles, 14);
  const atrAt = (i: number) => {
    const j = i - 14;
    return (j >= 0 && j < atrArr.length) ? atrArr[j] : undefined;
  };

  const smaArr = sma(closes, 20);
  const stdArr = stddev(closes, smaArr, 20);
  const bbAt = (i: number) => {
    const j = i - 19;
    return (j >= 0 && j < smaArr.length) ? { mean: smaArr[j], std: stdArr[j] } : undefined;
  };

  const pipMultiplier = pair.includes('JPY') ? 0.01 : 0.0001;
  const MIN_SL_PIPS = 8;
  const MIN_SIGNAL_GAP_MS = 3 * 60 * 1000; // 3 min gap (target 4+ signals/day)

  let lastTs = 0;

  for (let i = 80; i < m5Candles.length; i++) {
    const candle = m5Candles[i];
    if (!isGoodSession(candle.timestamp)) continue;

    const ts = new Date(candle.timestamp).getTime();
    if (ts - lastTs < MIN_SIGNAL_GAP_MS) continue;

    const ema50Val = ema50At(i);
    const rsiVal = rsiAt(i);
    const atrVal = atrAt(i);
    const bb = bbAt(i);

    if (ema50Val === undefined || rsiVal === undefined || !atrVal || bb === undefined) continue;

    const bbUpper = bb.mean + 2 * bb.std;
    const bbLower = bb.mean - 2 * bb.std;

    // Entry conditions - relaxed RSI for more signals
    const longSetup = candle.close <= bbLower && 
      rsiVal < 35 && 
      (isBullishEngulfing(m5Candles, i) || isBullishPinBar(m5Candles, i) || candle.close > candle.open);

    const shortSetup = candle.close >= bbUpper && 
      rsiVal > 65 && 
      (isBearishEngulfing(m5Candles, i) || isBearishPinBar(m5Candles, i) || candle.close < candle.open);

    if (!longSetup && !shortSetup) continue;

    const direction = longSetup ? 'LONG' : 'SHORT';
    const entry = candle.close;

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

    // TP: 0.7R, 1.5R, 2.5R (very tight TP1 for 60%+ win rate)
    const risk = Math.abs(entry - sl);
    const tp1 = direction === 'LONG' ? entry + risk * 0.7 : entry - risk * 0.7;
    const tp2 = direction === 'LONG' ? entry + risk * 1.5 : entry - risk * 1.5;
    const tp3 = direction === 'LONG' ? entry + risk * 2.5 : entry - risk * 2.5;

    // Confidence
    let confidence = 65;
    if (rsiVal < 25 || rsiVal > 75) confidence += 10;
    if (isBullishEngulfing(m5Candles, i) || isBearishEngulfing(m5Candles, i)) confidence += 10;
    if (isBullishPinBar(m5Candles, i) || isBearishPinBar(m5Candles, i)) confidence += 5;

    confidence = Math.min(confidence, 100);

    const slPips = risk / pipMultiplier;

    const reason = `${direction} | BB extreme, RSI ${rsiVal.toFixed(1)}, reversal candle, SL ${slPips.toFixed(1)} pips`;

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
