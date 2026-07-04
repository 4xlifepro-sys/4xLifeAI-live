import type { Candle } from '../src/types.js';

export interface TradeSignal {
  symbol: string;
  direction: 'LONG' | 'SHORT';
  entry: number;
  sl: number;
  tp1: number;
  tp2: number;
  tp3: number;
  confidence: number;
  reason: string;
  candleIndex: number;
}

// EMA calculation
function ema(closes: number[], period: number): number[] {
  const result: number[] = [];
  const k = 2 / (period + 1);
  let prev = closes[0];
  result.push(prev);
  for (let i = 1; i < closes.length; i++) {
    prev = closes[i] * k + prev * (1 - k);
    result.push(prev);
  }
  return result;
}

// RSI calculation
function rsi(closes: number[], period: number = 14): number[] {
  const result: number[] = [];
  if (closes.length < period + 1) return result;

  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;

  for (let i = period; i < closes.length; i++) {
    if (i > period) {
      const change = closes[i] - closes[i - 1];
      const gain = change > 0 ? change : 0;
      const loss = change < 0 ? Math.abs(change) : 0;
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
    }
    if (avgLoss === 0) {
      result.push(100);
    } else {
      const rs = avgGain / avgLoss;
      result.push(100 - (100 / (1 + rs)));
    }
  }
  return result;
}

// ATR calculation
function atr(candles: Candle[], period: number = 14): number[] {
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

// Get pip multiplier for a pair
function getPipMultiplier(pair: string): number {
  if (pair.includes('JPY')) return 0.01;
  if (pair.startsWith('X') && !pair.includes('XRP')) return 0.1; // Gold, Silver
  if (pair.includes('BTC') || pair.includes('ETH') || pair.includes('SOL') || pair.includes('BNB') || pair.includes('LTC') || pair.includes('DOT') || pair.includes('ADA') || pair.includes('XRP')) return 1;
  return 0.0001;
}

// Find recent swing low/high
function findSwingLow(candles: Candle[], lookback: number = 10): number {
  let low = Infinity;
  for (let i = candles.length - lookback; i < candles.length; i++) {
    if (candles[i].low < low) low = candles[i].low;
  }
  return low;
}

function findSwingHigh(candles: Candle[], lookback: number = 10): number {
  let high = -Infinity;
  for (let i = candles.length - lookback; i < candles.length; i++) {
    if (candles[i].high > high) high = candles[i].high;
  }
  return high;
}

// Get hour from timestamp (UTC)
function getHour(timestamp: string): number {
  return new Date(timestamp).getUTCHours();
}

// Check if within trading session (London or NY)
function isGoodSession(timestamp: string): boolean {
  const hour = getHour(timestamp);
  // London: 07-16 UTC, NY: 12-21 UTC, Overlap: 12-16 UTC (best)
  return hour >= 7 && hour <= 21;
}

/**
 * MAIN SIGNAL FUNCTION
 * 
 * Simple trend-pullback strategy:
 * 1. H4 trend: EMA20 direction determines bias
 * 2. M5 pullback: price touches M5 EMA20
 * 3. RSI: not overbought/oversold
 * 4. ATR-based SL
 * 5. TP1=1R, TP2=2R, TP3=3R
 * 6. Session filter: London/NY only
 */
export function detectSignalV2(
  pair: string,
  h4Candles: Candle[],
  m5Candles: Candle[]
): TradeSignal | null {
  if (h4Candles.length < 30 || m5Candles.length < 50) return null;

  const currentM5 = m5Candles[m5Candles.length - 1];

  // Session filter
  if (!isGoodSession(currentM5.timestamp)) return null;

  // === H4 TREND ===
  const h4Closes = h4Candles.map(c => c.close);
  const h4Ema20 = ema(h4Closes, 20);
  const h4Trend = h4Closes[h4Closes.length - 1] > h4Ema20[h4Ema20.length - 1] ? 'BULL' : 'BEAR';

  // === M5 INDICATORS ===
  const m5Closes = m5Candles.map(c => c.close);
  const m5Ema20 = ema(m5Closes, 20);
  const m5Ema9 = ema(m5Closes, 9);
  const m5Rsi = rsi(m5Closes, 14);
  const m5Atr = atr(m5Candles, 14);

  const currentPrice = currentM5.close;
  const currentEma20 = m5Ema20[m5Ema20.length - 1];
  const currentEma9 = m5Ema9[m5Ema9.length - 1];
  const currentRsi = m5Rsi.length > 0 ? m5Rsi[m5Rsi.length - 1] : 50;
  const currentAtr = m5Atr.length > 0 ? m5Atr[m5Atr.length - 1] : 0;

  const pipMultiplier = getPipMultiplier(pair);
  const risk = currentAtr; // SL distance = 1 ATR

  if (risk === 0) return null;

  // === BULLISH SETUP ===
  if (h4Trend === 'BULL') {
    // RSI not overbought
    if (currentRsi > 75) return null;

    // Price pulled back to EMA20 zone (within 1 ATR)
    const pullbackZone = currentEma20;
    const distanceFromEma = currentPrice - pullbackZone;

    // Price should be near or below EMA20, but EMA9 still above EMA20 (trend intact)
    if (currentPrice > pullbackZone + currentAtr * 0.5) return null; // Too far above
    if (currentEma9 <= currentEma20) return null; // M5 trend broken

    // Entry: current price
    const entry = currentPrice;
    const sl = entry - risk;
    const tp1 = entry + risk * 1;
    const tp2 = entry + risk * 2;
    const tp3 = entry + risk * 3;

    // Confidence: higher when RSI closer to 50 (more room to run) and price closer to EMA
    let confidence = 55;
    if (currentRsi >= 40 && currentRsi <= 60) confidence += 10; // Sweet spot
    if (distanceFromEma > -currentAtr * 0.3) confidence += 5; // Close to EMA
    if (h4Closes[h4Closes.length - 1] > h4Ema20[h4Ema20.length - 1] * 1.001) confidence += 5; // Strong H4 trend

    return {
      symbol: pair,
      direction: 'LONG',
      entry: Math.round(entry / pipMultiplier) * pipMultiplier,
      sl: Math.round(sl / pipMultiplier) * pipMultiplier,
      tp1: Math.round(tp1 / pipMultiplier) * pipMultiplier,
      tp2: Math.round(tp2 / pipMultiplier) * pipMultiplier,
      tp3: Math.round(tp3 / pipMultiplier) * pipMultiplier,
      confidence: Math.min(confidence, 85),
      reason: `H4 BULL | M5 pullback to EMA20 | RSI ${currentRsi.toFixed(1)} | ATR SL ${risk.toFixed(pipMultiplier === 0.0001 ? 5 : pipMultiplier === 0.01 ? 3 : 2)}`,
      candleIndex: m5Candles.length - 1
    };
  }

  // === BEARISH SETUP ===
  if (h4Trend === 'BEAR') {
    if (currentRsi < 25) return null; // RSI not oversold

    const pullbackZone = currentEma20;
    const distanceFromEma = pullbackZone - currentPrice;

    if (currentPrice < pullbackZone - currentAtr * 0.5) return null; // Too far below
    if (currentEma9 >= currentEma20) return null; // M5 trend broken

    const entry = currentPrice;
    const sl = entry + risk;
    const tp1 = entry - risk * 1;
    const tp2 = entry - risk * 2;
    const tp3 = entry - risk * 3;

    let confidence = 55;
    if (currentRsi >= 40 && currentRsi <= 60) confidence += 10;
    if (distanceFromEma > -currentAtr * 0.3) confidence += 5;
    if (h4Closes[h4Closes.length - 1] < h4Ema20[h4Ema20.length - 1] * 0.999) confidence += 5;

    return {
      symbol: pair,
      direction: 'SHORT',
      entry: Math.round(entry / pipMultiplier) * pipMultiplier,
      sl: Math.round(sl / pipMultiplier) * pipMultiplier,
      tp1: Math.round(tp1 / pipMultiplier) * pipMultiplier,
      tp2: Math.round(tp2 / pipMultiplier) * pipMultiplier,
      tp3: Math.round(tp3 / pipMultiplier) * pipMultiplier,
      confidence: Math.min(confidence, 85),
      reason: `H4 BEAR | M5 pullback to EMA20 | RSI ${currentRsi.toFixed(1)} | ATR SL ${risk.toFixed(pipMultiplier === 0.0001 ? 5 : pipMultiplier === 0.01 ? 3 : 2)}`,
      candleIndex: m5Candles.length - 1
    };
  }

  return null;
}
