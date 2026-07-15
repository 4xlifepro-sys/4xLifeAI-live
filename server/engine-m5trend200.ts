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
    if (avgLoss === 0) result.push(100);
    else {
      const rs = avgGain / avgLoss;
      result.push(100 - (100 / (1 + rs)));
    }
  }
  return result; // result[0] aligns with candle index `period`
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
  return result; // result[0] aligns with candle index `period`
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

/**
 * M5-ONLY TREND-PULLBACK STRATEGY (user spec)
 *
 * Everything runs on M5 candles only — no H4 needed.
 *
 * Step 1 - Trend: M5 EMA200. Price above EMA200 -> BULL (BUY only).
 *          Price below EMA200 -> BEAR (SELL only).
 * Step 2 - Pullback: M5 EMA110 is the pullback zone. Price must pull back
 *          close to/near EMA110 (not too far away from it) in trend direction.
 * Step 3 - Filters: RSI(14) blocks BUY if RSI>75 (overbought), blocks SELL if
 *          RSI<25 (oversold). Session filter: London/NY only (07:00-21:00 UTC).
 *          ATR-based SL: ATR*1.5 (forex) or ATR*2.0 (crypto), floored/capped
 *          per pair so SL is never too tight or too wide.
 * Step 4 - Entry & Targets: Entry = M5 close. SL = entry +/- risk.
 *          TP1 = 1.5R, TP2 = 3R, TP3 = 5R.
 * Step 5 - Confidence (55-85): +10 if RSI near neutral (40-60), +5 if price
 *          isn't too deep in the pullback, +5 if EMA200 slope is strong (not flat).
 */
export function scanM5Trend200Signals(pair: string, m5Candles: Candle[]): TradeSignal[] {
  const signals: TradeSignal[] = [];
  if (m5Candles.length < 220) return signals;

  const closes = m5Candles.map(c => c.close);
  const ema200Arr = ema(closes, 200);  // ema200Arr[i] aligns with candle i
  const ema110Arr = ema(closes, 110);  // ema110Arr[i] aligns with candle i
  const rsiArr = rsi(closes, 14);      // rsiArr[0] -> candle index 14
  const atrArr = atr(m5Candles, 14);   // atrArr[0] -> candle index 14

  const rsiAt = (i: number) => (i - 14 >= 0 && i - 14 < rsiArr.length) ? rsiArr[i - 14] : undefined;
  const atrAt = (i: number) => (i - 14 >= 0 && i - 14 < atrArr.length) ? atrArr[i - 14] : undefined;

  const pipMultiplier = getPipMultiplier(pair);
  const isCrypto = ['BTC', 'ETH', 'SOL', 'BNB', 'LTC', 'XRP', 'ADA', 'DOGE', 'DOT', 'AVAX'].some(c => pair.includes(c));
  const slMultiplier = isCrypto ? 2.0 : 1.5;
  const floorRisk = getFloorRisk(pair, pipMultiplier);
  const maxRisk = getMaxRisk(pair, pipMultiplier);

  const SLOPE_LOOKBACK = 20;

  let lastTs = 0;

  for (let i = 220; i < m5Candles.length; i++) {
    const current = m5Candles[i];
    if (!isGoodSession(current.timestamp)) continue;

    const ts = new Date(current.timestamp).getTime();
    if (ts - lastTs < 3600000) continue; // min 1hr gap between signals

    const currentAtr = atrAt(i);
    const currentRsi = rsiAt(i);
    if (!currentAtr || currentRsi === undefined) continue;

    const currentPrice = current.close;
    const currentEma200 = ema200Arr[i];
    const currentEma110 = ema110Arr[i];

    const trendBull = currentPrice > currentEma200;
    const trendBear = currentPrice < currentEma200;

    // EMA200 slope over lookback (used for confidence, not a hard filter)
    let slopeStrong = false;
    if (i - SLOPE_LOOKBACK >= 0) {
      const slope = currentEma200 - ema200Arr[i - SLOPE_LOOKBACK];
      slopeStrong = Math.abs(slope) / currentAtr > 0.3 && (trendBull ? slope > 0 : slope < 0);
    }

    let risk = Math.min(Math.max(currentAtr * slMultiplier, floorRisk), maxRisk);
    const riskPips = risk / pipMultiplier;
    let evenRiskPips = Math.round(riskPips / 2) * 2;
    const floorPips = Math.ceil(floorRisk / pipMultiplier);
    if (evenRiskPips < floorPips) evenRiskPips = Math.ceil(floorPips / 2) * 2;
    risk = evenRiskPips * pipMultiplier;
    if (risk === 0) continue;

    let signal: TradeSignal | null = null;

    if (trendBull) {
      if (currentRsi > 75) continue;

      const distanceFromEma = currentPrice - currentEma110;
      if (currentPrice > currentEma110 + currentAtr * 0.5) continue; // too far from pullback zone

      const entry = currentPrice;
      const sl = entry - risk;
      const tp1 = entry + risk * 1.5;
      const tp2 = entry + risk * 3;
      const tp3 = entry + risk * 5;

      let confidence = 55;
      if (currentRsi >= 40 && currentRsi <= 60) confidence += 10;
      if (distanceFromEma > -currentAtr * 0.3) confidence += 5;
      if (slopeStrong) confidence += 5;

      signal = {
        symbol: pair,
        direction: 'LONG',
        entry: Math.round(entry / pipMultiplier) * pipMultiplier,
        sl: Math.round(sl / pipMultiplier) * pipMultiplier,
        tp1: Math.round(tp1 / pipMultiplier) * pipMultiplier,
        tp2: Math.round(tp2 / pipMultiplier) * pipMultiplier,
        tp3: Math.round(tp3 / pipMultiplier) * pipMultiplier,
        confidence: Math.min(confidence, 85),
        reason: `M5 EMA200 BULL | pullback to EMA110 | RSI ${currentRsi.toFixed(1)} | ATR SL ${risk.toFixed(pipMultiplier === 0.0001 ? 5 : pipMultiplier === 0.01 ? 3 : 2)}`,
        candleIndex: i
      };
    } else if (trendBear) {
      if (currentRsi < 25) continue;

      const distanceFromEma = currentEma110 - currentPrice;
      if (currentPrice < currentEma110 - currentAtr * 0.5) continue; // too far from pullback zone

      const entry = currentPrice;
      const sl = entry + risk;
      const tp1 = entry - risk * 1.5;
      const tp2 = entry - risk * 3;
      const tp3 = entry - risk * 5;

      let confidence = 55;
      if (currentRsi >= 40 && currentRsi <= 60) confidence += 10;
      if (distanceFromEma > -currentAtr * 0.3) confidence += 5;
      if (slopeStrong) confidence += 5;

      signal = {
        symbol: pair,
        direction: 'SHORT',
        entry: Math.round(entry / pipMultiplier) * pipMultiplier,
        sl: Math.round(sl / pipMultiplier) * pipMultiplier,
        tp1: Math.round(tp1 / pipMultiplier) * pipMultiplier,
        tp2: Math.round(tp2 / pipMultiplier) * pipMultiplier,
        tp3: Math.round(tp3 / pipMultiplier) * pipMultiplier,
        confidence: Math.min(confidence, 85),
        reason: `M5 EMA200 BEAR | pullback to EMA110 | RSI ${currentRsi.toFixed(1)} | ATR SL ${risk.toFixed(pipMultiplier === 0.0001 ? 5 : pipMultiplier === 0.01 ? 3 : 2)}`,
        candleIndex: i
      };
    }

    if (signal) {
      signals.push(signal);
      lastTs = ts;
    }
  }

  return signals;
}
