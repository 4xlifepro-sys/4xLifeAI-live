import type { Candle } from '../src/types.js';
import { getPipMultiplier } from './engine2.js';

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

// Commodity Channel Index: (TypicalPrice - SMA(TP)) / (0.015 * MeanDeviation)
function calculateCCI(candles: Candle[], period: number): number[] {
  const result: number[] = [];
  const typicalPrices = candles.map(c => (c.high + c.low + c.close) / 3);
  if (typicalPrices.length < period) return result;
  for (let i = period - 1; i < typicalPrices.length; i++) {
    const slice = typicalPrices.slice(i - period + 1, i + 1);
    const sma = slice.reduce((a, b) => a + b, 0) / period;
    const meanDeviation = slice.reduce((a, b) => a + Math.abs(b - sma), 0) / period;
    const cci = meanDeviation === 0 ? 0 : (typicalPrices[i] - sma) / (0.015 * meanDeviation);
    result.push(cci);
  }
  return result;
}

function getFloorRisk(pair: string, pipMultiplier: number): number {
  const minimumStopByPair: Record<string, number> = {
    AUDUSD: 6 * 0.0001, USDCAD: 6 * 0.0001, EURNZD: 8 * 0.0001,
    GBPAUD: 8 * 0.0001, GBPNZD: 10 * 0.0001, CADJPY: 8 * 0.01,
    NZDJPY: 8 * 0.01, XAUUSD: 12, XAGUSD: 0.50, BTCUSD: 250,
    ETHUSD: 15, SOLUSD: 1.5, LTCUSD: 0.8, BNBUSD: 2.5,
  };
  return minimumStopByPair[pair] ?? (pair.includes('JPY') ? 8 * pipMultiplier : 6 * pipMultiplier);
}

function getMaxRisk(pair: string, pipMultiplier: number): number {
  const maximumStopByPair: Record<string, number> = {
    AUDUSD: 20 * 0.0001, USDCAD: 20 * 0.0001, EURNZD: 25 * 0.0001,
    GBPAUD: 25 * 0.0001, GBPNZD: 100 * 0.0001, CADJPY: 25 * 0.01,
    NZDJPY: 25 * 0.01, XAUUSD: 30, XAGUSD: 1.50, BTCUSD: 2500,
    ETHUSD: 50, SOLUSD: 5, LTCUSD: 3, BNBUSD: 8,
  };
  return maximumStopByPair[pair] ?? (pair.includes('JPY') ? 25 * pipMultiplier : 20 * pipMultiplier);
}

function getHour(timestamp: string): number {
  return new Date(timestamp).getUTCHours();
}

function isGoodSession(timestamp: string): boolean {
  const hour = getHour(timestamp);
  return hour >= 7 && hour <= 21;
}

// Choppiness Index (Bill Dreiss): 100 * log10(sum(TR, n) / (highest high - lowest low)) / log10(n)
// >= 61.8 => choppy/ranging market (skip trend-following signals)
// <= 38.2 => strongly trending market (best conditions for this strategy)
const CHOPPINESS_PERIOD = 14;
const CHOPPINESS_THRESHOLD = 61.8;

function choppinessAt(candles: Candle[], endIndex: number, period: number = CHOPPINESS_PERIOD): number | undefined {
  if (endIndex - period + 1 < 1) return undefined;
  let trSum = 0;
  let highMax = -Infinity;
  let lowMin = Infinity;
  for (let idx = endIndex - period + 1; idx <= endIndex; idx++) {
    const c = candles[idx];
    const prevClose = candles[idx - 1].close;
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - prevClose),
      Math.abs(c.low - prevClose)
    );
    trSum += tr;
    if (c.high > highMax) highMax = c.high;
    if (c.low < lowMin) lowMin = c.low;
  }
  const range = highMax - lowMin;
  if (range <= 0) return 100;
  return 100 * Math.log10(trSum / range) / Math.log10(period);
}

/**
 * SINGLE-TIMEFRAME M5 CCI (14/25/50) + 200-EMA TREND STRATEGY (TraderDNA-style)
 *
 * Everything runs on M5 candles only — no higher/lower timeframe split.
 *
 * Trend: price above/below 200-EMA + all three CCI periods (14, 25, 50)
 * aligned on the same side of zero = confirmed M5 trend.
 *
 * Two entry methods (both on M5):
 * 1. EXTREME TREND CHANGE - M5 trend just flipped this candle (was not
 *    aligned last candle, is aligned now). Entered at M5 close, SL beyond
 *    the reversal candle's wick.
 * 2. TREND RETRACEMENT - M5 trend has been established for 3+ candles,
 *    price pulls back toward the M5 EMA110, then closes back in trend
 *    direction with M5 CCI14 confirming. SL beyond the retracement swing.
 */
export function detectCCISignal(
  pair: string,
  m5Candles: Candle[]
): TradeSignal | null {
  if (m5Candles.length < 220) return null;

  const currentM15 = m5Candles[m5Candles.length - 1];
  if (!isGoodSession(currentM15.timestamp)) return null;

  const closes = m5Candles.map(c => c.close);
  const ema50 = ema(closes, 200);
  const ema20 = ema(closes, 110);
  const cci14 = calculateCCI(m5Candles, 14);
  const cci25 = calculateCCI(m5Candles, 25);
  const cci50 = calculateCCI(m5Candles, 50);
  const atr14 = atr(m5Candles, 14);

  const minLen = Math.min(cci14.length, cci25.length, cci50.length, ema50.length);
  if (minLen < 4) return null;

  // Align all series to the same trailing window (they have different offsets
  // because CCI periods differ; use the last `minLen` values of each).
  const closesAligned = closes.slice(closes.length - minLen);
  const emaAligned = ema50.slice(ema50.length - minLen);
  const ema20Aligned = ema20.slice(ema20.length - minLen);
  const c14 = cci14.slice(cci14.length - minLen);
  const c25 = cci25.slice(cci25.length - minLen);
  const c50 = cci50.slice(cci50.length - minLen);
  const atrAligned = atr14.slice(Math.max(0, atr14.length - minLen));

  const currentAtr = atrAligned.length > 0 ? atrAligned[atrAligned.length - 1] : 0;
  if (currentAtr === 0) return null;

  // Chop protection: skip choppy/ranging conditions where trend-following whipsaws.
  const chop = choppinessAt(m5Candles, m5Candles.length - 1);
  if (chop === undefined || chop >= CHOPPINESS_THRESHOLD) return null;

  const isBullAligned = (i: number) => closesAligned[i] > emaAligned[i] && c14[i] > 0 && c25[i] > 0 && c50[i] > 0;
  const isBearAligned = (i: number) => closesAligned[i] < emaAligned[i] && c14[i] < 0 && c25[i] < 0 && c50[i] < 0;

  const last = minLen - 1;
  const trendBullNow = isBullAligned(last);
  const trendBearNow = isBearAligned(last);
  if (!trendBullNow && !trendBearNow) return null; // no clear aligned trend

  const pipMultiplier = getPipMultiplier(pair);
  const floorRisk = getFloorRisk(pair, pipMultiplier);
  const maxRisk = getMaxRisk(pair, pipMultiplier);

  // === METHOD 1: EXTREME TREND CHANGE (M5 trend just flipped) ===
  const wasBullAligned = isBullAligned(last - 1);
  const wasBearAligned = isBearAligned(last - 1);

  if (trendBullNow && !wasBullAligned) {
    const entry = currentM15.close;
    let risk = Math.min(Math.max(entry - (currentM15.low - currentAtr * 0.15), floorRisk), maxRisk);
    if (risk > 0) {
      const sl = entry - risk;
      return buildSignal(pair, 'LONG', entry, sl, pipMultiplier,
        `M5 EXTREME TREND CHANGE (BULL) | price crossed above 200-EMA, CCI 14/25/50 aligned positive`,
        m5Candles.length - 1, 65);
    }
  }
  if (trendBearNow && !wasBearAligned) {
    const entry = currentM15.close;
    let risk = Math.min(Math.max((currentM15.high + currentAtr * 0.15) - entry, floorRisk), maxRisk);
    if (risk > 0) {
      const sl = entry + risk;
      return buildSignal(pair, 'SHORT', entry, sl, pipMultiplier,
        `M5 EXTREME TREND CHANGE (BEAR) | price crossed below 200-EMA, CCI 14/25/50 aligned negative`,
        m5Candles.length - 1, 65);
    }
  }

  // === METHOD 2: TREND RETRACEMENT (trend established 3+ M5 candles, pullback entry) ===
  if (minLen >= 4) {
    const establishedBull = trendBullNow && isBullAligned(last - 1) && isBullAligned(last - 2);
    const establishedBear = trendBearNow && isBearAligned(last - 1) && isBearAligned(last - 2);

    if (establishedBull || establishedBear) {
      const currentEma110 = ema20Aligned[ema20Aligned.length - 1];
      const currentCci14 = c14[last];

      if (establishedBull) {
        const pulledBack = currentM15.low <= currentEma110 + currentAtr * 0.2;
        const bullishClose = currentM15.close > currentM15.open;
        if (pulledBack && bullishClose && currentCci14 > 0) {
          const entry = currentM15.close;
          const swingLow = Math.min(...m5Candles.slice(-10).map(c => c.low));
          let risk = Math.min(Math.max(entry - (swingLow - currentAtr * 0.15), floorRisk), maxRisk);
          if (risk > 0) {
            const sl = entry - risk;
            return buildSignal(pair, 'LONG', entry, sl, pipMultiplier,
              `M5 established BULL trend | pullback to EMA110 + CCI14 realigned positive`,
              m5Candles.length - 1, 60);
          }
        }
      } else if (establishedBear) {
        const pulledBack = currentM15.high >= currentEma110 - currentAtr * 0.2;
        const bearishClose = currentM15.close < currentM15.open;
        if (pulledBack && bearishClose && currentCci14 < 0) {
          const entry = currentM15.close;
          const swingHigh = Math.max(...m5Candles.slice(-10).map(c => c.high));
          let risk = Math.min(Math.max((swingHigh + currentAtr * 0.15) - entry, floorRisk), maxRisk);
          if (risk > 0) {
            const sl = entry + risk;
            return buildSignal(pair, 'SHORT', entry, sl, pipMultiplier,
              `M5 established BEAR trend | pullback to EMA110 + CCI14 realigned negative`,
              m5Candles.length - 1, 60);
          }
        }
      }
    }
  }

  return null;
}

/**
 * Backtest-only fast path: computes EMA200/EMA110/CCI14/CCI25/CCI50/ATR14
 * ONCE over the full M5 candle array, then walks forward evaluating the
 * same two entry methods as detectCCISignal() at every candle. This avoids
 * O(n^2) recomputation that calling detectCCISignal() in a loop would cause.
 */
export function scanCCISignals(pair: string, m5Candles: Candle[]): TradeSignal[] {
  const signals: TradeSignal[] = [];
  if (m5Candles.length < 220) return signals;

  const closes = m5Candles.map(c => c.close);
  const ema200Arr = ema(closes, 200);   // ema200Arr[i] aligns with candle i
  const ema110Arr = ema(closes, 110);   // ema110Arr[i] aligns with candle i
  const cci14Arr = calculateCCI(m5Candles, 14);  // cci14Arr[0] -> candle index 13
  const cci25Arr = calculateCCI(m5Candles, 25);  // cci25Arr[0] -> candle index 24
  const cci50Arr = calculateCCI(m5Candles, 50);  // cci50Arr[0] -> candle index 49
  const atrArr = atr(m5Candles, 14);             // atrArr[0] -> candle index 14

  const cci14At = (i: number) => (i - 13 >= 0 && i - 13 < cci14Arr.length) ? cci14Arr[i - 13] : undefined;
  const cci25At = (i: number) => (i - 24 >= 0 && i - 24 < cci25Arr.length) ? cci25Arr[i - 24] : undefined;
  const cci50At = (i: number) => (i - 49 >= 0 && i - 49 < cci50Arr.length) ? cci50Arr[i - 49] : undefined;
  const atrAt = (i: number) => (i - 14 >= 0 && i - 14 < atrArr.length) ? atrArr[i - 14] : undefined;

  const isBullAligned = (i: number) => {
    const c14 = cci14At(i), c25 = cci25At(i), c50 = cci50At(i);
    if (c14 === undefined || c25 === undefined || c50 === undefined) return false;
    return closes[i] > ema200Arr[i] && c14 > 0 && c25 > 0 && c50 > 0;
  };
  const isBearAligned = (i: number) => {
    const c14 = cci14At(i), c25 = cci25At(i), c50 = cci50At(i);
    if (c14 === undefined || c25 === undefined || c50 === undefined) return false;
    return closes[i] < ema200Arr[i] && c14 < 0 && c25 < 0 && c50 < 0;
  };

  const pipMultiplier = getPipMultiplier(pair);
  const floorRisk = getFloorRisk(pair, pipMultiplier);
  const maxRisk = getMaxRisk(pair, pipMultiplier);

  let lastTs = 0;

  for (let i = 220; i < m5Candles.length; i++) {
    const current = m5Candles[i];
    if (!isGoodSession(current.timestamp)) continue;

    const ts = new Date(current.timestamp).getTime();
    if (ts - lastTs < 3600000) continue; // min 1hr gap between CCI signals

    const currentAtr = atrAt(i);
    if (!currentAtr) continue;

    // Chop protection: skip choppy/ranging conditions where trend-following whipsaws.
    const chop = choppinessAt(m5Candles, i);
    if (chop === undefined || chop >= CHOPPINESS_THRESHOLD) continue;

    const trendBullNow = isBullAligned(i);
    const trendBearNow = isBearAligned(i);
    if (!trendBullNow && !trendBearNow) continue;

    const wasBullAligned = isBullAligned(i - 1);
    const wasBearAligned = isBearAligned(i - 1);

    let signal: TradeSignal | null = null;

    // METHOD 1: EXTREME TREND CHANGE
    if (trendBullNow && !wasBullAligned) {
      const entry = current.close;
      const risk = Math.min(Math.max(entry - (current.low - currentAtr * 0.15), floorRisk), maxRisk);
      if (risk > 0) {
        signal = buildSignal(pair, 'LONG', entry, entry - risk, pipMultiplier,
          `M5 EXTREME TREND CHANGE (BULL) | price crossed above 200-EMA, CCI 14/25/50 aligned positive`,
          i, 65);
      }
    } else if (trendBearNow && !wasBearAligned) {
      const entry = current.close;
      const risk = Math.min(Math.max((current.high + currentAtr * 0.15) - entry, floorRisk), maxRisk);
      if (risk > 0) {
        signal = buildSignal(pair, 'SHORT', entry, entry + risk, pipMultiplier,
          `M5 EXTREME TREND CHANGE (BEAR) | price crossed below 200-EMA, CCI 14/25/50 aligned negative`,
          i, 65);
      }
    }

    // METHOD 2: TREND RETRACEMENT
    if (!signal) {
      const establishedBull = trendBullNow && isBullAligned(i - 1) && isBullAligned(i - 2);
      const establishedBear = trendBearNow && isBearAligned(i - 1) && isBearAligned(i - 2);

      if (establishedBull || establishedBear) {
        const currentEma110 = ema110Arr[i];
        const currentCci14 = cci14At(i)!;

        if (establishedBull) {
          const pulledBack = current.low <= currentEma110 + currentAtr * 0.2;
          const bullishClose = current.close > current.open;
          if (pulledBack && bullishClose && currentCci14 > 0) {
            const entry = current.close;
            const swingLow = Math.min(...m5Candles.slice(Math.max(0, i - 9), i + 1).map(c => c.low));
            const risk = Math.min(Math.max(entry - (swingLow - currentAtr * 0.15), floorRisk), maxRisk);
            if (risk > 0) {
              signal = buildSignal(pair, 'LONG', entry, entry - risk, pipMultiplier,
                `M5 established BULL trend | pullback to EMA110 + CCI14 realigned positive`,
                i, 60);
            }
          }
        } else if (establishedBear) {
          const pulledBack = current.high >= currentEma110 - currentAtr * 0.2;
          const bearishClose = current.close < current.open;
          if (pulledBack && bearishClose && currentCci14 < 0) {
            const entry = current.close;
            const swingHigh = Math.max(...m5Candles.slice(Math.max(0, i - 9), i + 1).map(c => c.high));
            const risk = Math.min(Math.max((swingHigh + currentAtr * 0.15) - entry, floorRisk), maxRisk);
            if (risk > 0) {
              signal = buildSignal(pair, 'SHORT', entry, entry + risk, pipMultiplier,
                `M5 established BEAR trend | pullback to EMA110 + CCI14 realigned negative`,
                i, 60);
            }
          }
        }
      }
    }

    if (signal) {
      signals.push(signal);
      lastTs = ts;
    }
  }

  return signals;
}

function buildSignal(
  pair: string,
  direction: 'LONG' | 'SHORT',
  entry: number,
  sl: number,
  pipMultiplier: number,
  reason: string,
  candleIndex: number,
  baseConfidence: number
): TradeSignal {
  let risk = Math.abs(entry - sl);
  const riskPips = risk / pipMultiplier;
  const evenRiskPips = Math.max(2, Math.round(riskPips / 2) * 2);
  risk = evenRiskPips * pipMultiplier;

  const isLong = direction === 'LONG';
  const finalSl = isLong ? entry - risk : entry + risk;
  const tp1 = isLong ? entry + risk * 1.5 : entry - risk * 1.5;
  const tp2 = isLong ? entry + risk * 3 : entry - risk * 3;
  const tp3 = isLong ? entry + risk * 5 : entry - risk * 5;

  return {
    symbol: pair,
    direction,
    entry: Math.round(entry / pipMultiplier) * pipMultiplier,
    sl: Math.round(finalSl / pipMultiplier) * pipMultiplier,
    tp1: Math.round(tp1 / pipMultiplier) * pipMultiplier,
    tp2: Math.round(tp2 / pipMultiplier) * pipMultiplier,
    tp3: Math.round(tp3 / pipMultiplier) * pipMultiplier,
    confidence: baseConfidence,
    reason,
    candleIndex
  };
}
