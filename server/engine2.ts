import type { Candle, Signal } from '../src/types.js';
import crypto from 'crypto';

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

// Export for scanner.ts compatibility
export function getPipMultiplier(pair: string): number {
  if (pair.includes('JPY')) return 0.01;
  if (pair.startsWith('X') && !pair.includes('XRP')) return 0.1;
  if (pair.includes('BTC') || pair.includes('ETH') || pair.includes('SOL') || pair.includes('BNB') || pair.includes('LTC') || pair.includes('DOT') || pair.includes('ADA') || pair.includes('XRP')) return 1;
  return 0.0001;
}

// Get hour from timestamp (UTC)
function getHour(timestamp: string): number {
  return new Date(timestamp).getUTCHours();
}

// Check if within trading session (London or NY)
function isGoodSession(timestamp: string): boolean {
  const hour = getHour(timestamp);
  return hour >= 7 && hour <= 21;
}

/**
 * MAIN SIGNAL FUNCTION
 *
 * Trend-pullback strategy:
 * 1. H4 trend: EMA20 direction determines bias
 * 2. M5 pullback: price touches M5 EMA20 zone
 * 3. RSI: not overbought/oversold
 * 4. ATR-based SL (1 ATR)
 * 5. TP1=1.5R, TP2=3R, TP3=5R (wider for cost resistance)
 * 6. Session filter: London/NY only
 */
export function detectSignalV2(
  pair: string,
  h4Candles: Candle[],
  m5Candles: Candle[]
): TradeSignal | null {
  if (h4Candles.length < 30 || m5Candles.length < 50) return null;

  const currentM5 = m5Candles[m5Candles.length - 1];

  if (!isGoodSession(currentM5.timestamp)) return null;

  // === H4 TREND ===
  const h4Closes = h4Candles.map(c => c.close);
  const h4Ema20 = ema(h4Closes, 20);
  const h4Trend = h4Closes[h4Closes.length - 1] > h4Ema20[h4Ema20.length - 1] ? 'BULL' : 'BEAR';

  // === M5 INDICATORS ===
  const m5Window = m5Candles.slice(-200);
  const m5Closes = m5Window.map(c => c.close);
  const m5Ema20 = ema(m5Closes, 20);
  const m5Ema9 = ema(m5Closes, 9);
  const m5Rsi = rsi(m5Closes, 14);
  const m5Atr = atr(m5Window, 14);

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
    if (currentRsi > 75) return null;

    const pullbackZone = currentEma20;
    const distanceFromEma = currentPrice - pullbackZone;

    if (currentPrice > pullbackZone + currentAtr * 0.5) return null;
    if (currentEma9 <= currentEma20) return null;

    const entry = currentPrice;
    const sl = entry - risk;
    const tp1 = entry + risk * 1.5;
    const tp2 = entry + risk * 3;
    const tp3 = entry + risk * 5;

    let confidence = 55;
    if (currentRsi >= 40 && currentRsi <= 60) confidence += 10;
    if (distanceFromEma > -currentAtr * 0.3) confidence += 5;
    if (h4Closes[h4Closes.length - 1] > h4Ema20[h4Ema20.length - 1] * 1.001) confidence += 5;

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
    if (currentRsi < 25) return null;

    const pullbackZone = currentEma20;
    const distanceFromEma = pullbackZone - currentPrice;

    if (currentPrice < pullbackZone - currentAtr * 0.5) return null;
    if (currentEma9 >= currentEma20) return null;

    const entry = currentPrice;
    const sl = entry + risk;
    const tp1 = entry - risk * 1.5;
    const tp2 = entry - risk * 3;
    const tp3 = entry - risk * 5;

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

/**
 * ADAPTER: Wraps detectSignalV2 to return scanner.ts-compatible Signal format.
 * This replaces detectTrendMomentumScannerV5 from engine.js.
 */
export function detectTrendMomentumScannerV5(
  pair: string,
  htf: Candle[],
  setup: Candle[],
  entryTf: Candle[]
): { signal: Signal; scores: any; regime: string; regimeReason: string } {
  const result = detectSignalV2(pair, htf, entryTf);

  if (!result) {
    // Return a rejected signal when no setup found
    return {
      signal: {
        id: crypto.randomUUID(),
        pair,
        direction: 'LONG',
        entry: 0,
        sl: 0,
        tp1: 0,
        tp2: 0,
        tp3: 0,
        aiConfidence: 0,
        tier: 'Reject',
        status: 'REJECTED',
        timestamp: new Date().toISOString(),
        aiReason: 'No valid setup detected',
        diagnostics: {
          regimeState: 'UNKNOWN',
          raw_4h: null,
          raw_5m_bos: null,
          pullbackHigh: 0,
          pullbackLow: 0,
          confidenceBreakdown: { regime: 0 }
        }
      } as Signal,
      scores: {},
      regime: 'UNKNOWN',
      regimeReason: 'No setup'
    };
  }

  const pipMult = getPipMultiplier(pair);
  const riskPips = Math.abs(result.entry - result.sl) / pipMult;
  const tp1Pips = Math.abs(result.tp1 - result.entry) / pipMult;
  const tp2Pips = Math.abs(result.tp2 - result.entry) / pipMult;
  const tp3Pips = Math.abs(result.tp3 - result.entry) / pipMult;

  const lastCandle = entryTf[entryTf.length - 1];
  const h4Last = htf[htf.length - 1];

  // Determine tier based on confidence
  let tier = 'Valid';
  if (result.confidence >= 75) tier = 'Strong';
  else if (result.confidence >= 65) tier = 'Good';

  return {
    signal: {
      id: crypto.randomUUID(),
      pair,
      direction: result.direction,
      entry: result.entry,
      sl: result.sl,
      tp1: result.tp1,
      tp2: result.tp2,
      tp3: result.tp3,
      aiConfidence: result.confidence,
      tier,
      status: 'ACTIVE',
      timestamp: lastCandle?.timestamp || new Date().toISOString(),
      aiReason: result.reason,
      diagnostics: {
        regimeState: result.direction === 'LONG' ? 'TRENDING_BULL' : 'TRENDING_BEAR',
        raw_4h: {
          open: h4Last?.open || 0,
          close: h4Last?.close || 0,
          start_time: h4Last?.timestamp || ''
        },
        raw_5m_bos: {
          open: lastCandle?.open || 0,
          close: lastCandle?.close || 0,
          start_time: lastCandle?.timestamp || ''
        },
        pullbackHigh: Math.max(...entryTf.slice(-20).map(c => c.high)),
        pullbackLow: Math.min(...entryTf.slice(-20).map(c => c.low)),
        confidenceBreakdown: {
          regime: result.confidence >= 65 ? 5 : 3,
          riskPips,
          tp1Pips,
          tp2Pips,
          tp3Pips,
          rsi: 0,
          atr: 0
        }
      }
    } as Signal,
    scores: { confidence: result.confidence },
    regime: result.direction === 'LONG' ? 'TRENDING_BULL' : 'TRENDING_BEAR',
    regimeReason: result.reason
  };
}
