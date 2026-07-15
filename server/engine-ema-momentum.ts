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
  return result; // result[0] -> candle index `period`
}

// Wilder's RSI
function calculateRSI(closes: number[], period: number = 14): number[] {
  const result: number[] = [];
  if (closes.length < period + 1) return result;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }
  return result; // result[0] -> candle index `period`
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

function isGoodSession(timestamp: string): boolean {
  const hour = new Date(timestamp).getUTCHours();
  return hour >= 7 && hour <= 21;
}

/**
 * EMA200 + EMA110 Strategy with Momentum Confirmation (M5, single timeframe)
 *
 * NOTE ON VOLUME: TwelveData's cached M5 candles report volume:0 for every
 * forex AND crypto pair in this feed (spot FX has no centralized volume, and
 * this data source doesn't supply real crypto volume either). Per project
 * rule of using only real data (no mock/synthetic), the "volume confirmation"
 * leg of this strategy is NOT implemented — faking volume would be worse
 * than skipping it. Everything else (EMA200 trend+slope, EMA110 pullback,
 * RSI momentum) uses real price data only.
 *
 * 1. Trend filter: EMA200 — price must be above/below EMA200 AND EMA200 must
 *    be sloped (not flat) over the last 20 candles relative to ATR.
 * 2. Big-move trend line: EMA110 — price must have been "riding" EMA110
 *    (>=70% of the last 10 candles on the trend side) before the pullback.
 * 3. Pullback + bounce: within the last 5 candles price touches/retests
 *    EMA110, then the current candle closes back through EMA110 in trend
 *    direction (decisive reclaim).
 * 4. Momentum: RSI(14) — long requires RSI 40-70 (not overbought), short
 *    requires RSI 30-60 (not oversold).
 */
export function scanEMAMomentumSignals(pair: string, m5Candles: Candle[]): TradeSignal[] {
  const signals: TradeSignal[] = [];
  const MIN_LEN = 260;
  if (m5Candles.length < MIN_LEN) return signals;

  const closes = m5Candles.map(c => c.close);
  const ema200Arr = ema(closes, 200);
  const ema110Arr = ema(closes, 110);
  const rsiArr = calculateRSI(closes, 14);
  const atrArr = atr(m5Candles, 14);

  const rsiAt = (i: number) => (i - 14 >= 0 && i - 14 < rsiArr.length) ? rsiArr[i - 14] : undefined;
  const atrAt = (i: number) => (i - 14 >= 0 && i - 14 < atrArr.length) ? atrArr[i - 14] : undefined;

  const SLOPE_LOOKBACK = 20;
  const SLOPE_MIN_ATR_MULT = 0.5;
  const RIDE_LOOKBACK = 10;
  const RIDE_MIN_RATIO = 0.7;
  const PULLBACK_WINDOW = 5;
  const PULLBACK_ATR_BUFFER = 0.15;

  const pipMultiplier = getPipMultiplier(pair);
  const floorRisk = getFloorRisk(pair, pipMultiplier);
  const maxRisk = getMaxRisk(pair, pipMultiplier);

  let lastTs = 0;

  for (let i = 250; i < m5Candles.length; i++) {
    const current = m5Candles[i];
    if (!isGoodSession(current.timestamp)) continue;

    const ts = new Date(current.timestamp).getTime();
    if (ts - lastTs < 3600000) continue; // min 1hr gap between signals

    const currentAtr = atrAt(i);
    const currentRsi = rsiAt(i);
    if (!currentAtr || currentRsi === undefined) continue;

    const e200 = ema200Arr[i];
    const e200Prev = ema200Arr[i - SLOPE_LOOKBACK];
    const e110 = ema110Arr[i];
    const slope = e200 - e200Prev;
    const slopeOk = Math.abs(slope) > SLOPE_MIN_ATR_MULT * currentAtr;
    if (!slopeOk) continue; // flat EMA200 = ranging market, skip

    const bullBias = current.close > e200 && slope > 0;
    const bearBias = current.close < e200 && slope < 0;
    if (!bullBias && !bearBias) continue;

    // "Riding" EMA110 check over the recent window (excludes current candle)
    let rideCount = 0;
    for (let k = i - RIDE_LOOKBACK; k < i; k++) {
      if (bullBias && closes[k] > ema110Arr[k]) rideCount++;
      if (bearBias && closes[k] < ema110Arr[k]) rideCount++;
    }
    if (rideCount / RIDE_LOOKBACK < RIDE_MIN_RATIO) continue;

    // Pullback touch/retest of EMA110 within the last few candles
    let pullbackLow = Infinity, pullbackHigh = -Infinity;
    for (let k = i - PULLBACK_WINDOW; k < i; k++) {
      if (m5Candles[k].low < pullbackLow) pullbackLow = m5Candles[k].low;
      if (m5Candles[k].high > pullbackHigh) pullbackHigh = m5Candles[k].high;
    }
    const pulledBack = bullBias
      ? pullbackLow <= e110 + currentAtr * PULLBACK_ATR_BUFFER
      : pullbackHigh >= e110 - currentAtr * PULLBACK_ATR_BUFFER;
    if (!pulledBack) continue;

    // Bounce candle: decisive close back through EMA110 in trend direction
    const bounceOk = bullBias
      ? (current.close > e110 && current.close > current.open)
      : (current.close < e110 && current.close < current.open);
    if (!bounceOk) continue;

    // Momentum confirmation (RSI)
    const rsiOk = bullBias
      ? (currentRsi >= 40 && currentRsi <= 70)
      : (currentRsi <= 60 && currentRsi >= 30);
    if (!rsiOk) continue;

    // Volume confirmation intentionally skipped: no real volume data available
    // for any pair in this feed (see note above).

    let signal: TradeSignal | null = null;
    if (bullBias) {
      const slBase = Math.min(pullbackLow, e110);
      const risk = Math.min(Math.max(current.close - slBase + currentAtr * 0.1, floorRisk), maxRisk);
      if (risk > 0) {
        signal = buildSignal(pair, 'LONG', current.close, current.close - risk, pipMultiplier,
          `M5 EMA200(sloped)+EMA110 pullback-bounce | RSI ${currentRsi.toFixed(1)} confirms momentum (volume check skipped: no real volume data in feed)`,
          i, 62);
      }
    } else {
      const slBase = Math.max(pullbackHigh, e110);
      const risk = Math.min(Math.max(slBase - current.close + currentAtr * 0.1, floorRisk), maxRisk);
      if (risk > 0) {
        signal = buildSignal(pair, 'SHORT', current.close, current.close + risk, pipMultiplier,
          `M5 EMA200(sloped)+EMA110 pullback-bounce | RSI ${currentRsi.toFixed(1)} confirms momentum (volume check skipped: no real volume data in feed)`,
          i, 62);
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
