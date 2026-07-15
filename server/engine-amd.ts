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

/**
 * AMD (Accumulation - Manipulation - Distribution) STRATEGY
 *
 * Session-based version of the liquidity sweep concept:
 * 1. ACCUMULATION: Asian session (00:00-07:00 UTC) forms a range —
 *    this is the "quiet" range where the level gets built.
 * 2. MANIPULATION: During London/NY session (07:00-21:00 UTC),
 *    price wicks beyond that Asian range (sweeping the accumulated
 *    stops) then closes back inside it — the fake move.
 * 3. DISTRIBUTION: We enter in the direction OPPOSITE the sweep,
 *    riding the real move — but only WITH the H4 trend for extra
 *    confluence (same trend filter as the live strategy).
 *
 * This differs from the generic liquidity-sweep engine by using the
 * actual Asian session range as the level (session-anchored), not a
 * rolling N-candle window.
 */
export function detectAMDSignal(
  pair: string,
  h4Candles: Candle[],
  m5Candles: Candle[]
): TradeSignal | null {
  if (h4Candles.length < 210 || m5Candles.length < 150) return null;

  const currentM5 = m5Candles[m5Candles.length - 1];
  const currentHour = new Date(currentM5.timestamp).getUTCHours();

  // Only trade during London/NY session (manipulation + distribution window)
  if (currentHour < 7 || currentHour > 21) return null;

  const currentDateStr = new Date(currentM5.timestamp).toISOString().split('T')[0];

  // Find this UTC day's Asian session range (00:00-07:00 UTC), looking back
  // through m5Candles for candles matching today's date and hour 0-6.
  const asianCandles: Candle[] = [];
  for (let i = m5Candles.length - 1; i >= 0 && i >= m5Candles.length - 400; i--) {
    const c = m5Candles[i];
    const cDate = new Date(c.timestamp);
    const cDateStr = cDate.toISOString().split('T')[0];
    const cHour = cDate.getUTCHours();
    if (cDateStr !== currentDateStr) {
      if (cDateStr < currentDateStr) break; // gone past today, stop
      continue;
    }
    if (cHour >= 0 && cHour < 7) asianCandles.push(c);
  }

  if (asianCandles.length < 10) return null; // not enough Asian session data

  const asianHigh = Math.max(...asianCandles.map(c => c.high));
  const asianLow = Math.min(...asianCandles.map(c => c.low));

  // === H4 TREND (EMA50 vs EMA200) ===
  const h4Closes = h4Candles.map(c => c.close);
  const h4Ema50 = ema(h4Closes, 50);
  const h4Ema200 = ema(h4Closes, 200);
  const h4Atr = atr(h4Candles, 14);
  const currentH4Atr = h4Atr.length > 0 ? h4Atr[h4Atr.length - 1] : 0;

  const emaSpread = h4Ema50[h4Ema50.length - 1] - h4Ema200[h4Ema200.length - 1];
  if (currentH4Atr === 0 || Math.abs(emaSpread) < currentH4Atr * 0.15) return null;

  const h4Trend: 'BULL' | 'BEAR' = emaSpread > 0 ? 'BULL' : 'BEAR';

  const m5Closes = m5Candles.slice(-100).map(c => c.close);
  const m5Rsi = rsi(m5Closes, 14);
  const currentRsi = m5Rsi.length > 0 ? m5Rsi[m5Rsi.length - 1] : 50;
  const m5Atr = atr(m5Candles.slice(-100), 14);
  const currentAtr = m5Atr.length > 0 ? m5Atr[m5Atr.length - 1] : 0;
  if (currentAtr === 0) return null;

  const pipMultiplier = getPipMultiplier(pair);
  const floorRisk = getFloorRisk(pair, pipMultiplier);
  const maxRisk = getMaxRisk(pair, pipMultiplier);
  const buffer = currentAtr * 0.15;

  // === BULLISH: manipulation sweep below Asian low, distribution UP, WITH H4 BULL ===
  if (h4Trend === 'BULL') {
    const sweptLow = currentM5.low < asianLow;
    const closedBackAbove = currentM5.close > asianLow;
    const bullishClose = currentM5.close > currentM5.open;

    if (sweptLow && closedBackAbove && bullishClose && currentRsi < 70) {
      const entry = currentM5.close;
      let risk = Math.min(Math.max(entry - (currentM5.low - buffer), floorRisk), maxRisk);
      if (risk <= 0) return null;

      const riskPips = risk / pipMultiplier;
      const evenRiskPips = Math.max(2, Math.round(riskPips / 2) * 2);
      risk = evenRiskPips * pipMultiplier;

      const sl = entry - risk;
      const tp1 = entry + risk * 1.5;
      const tp2 = entry + risk * 3;
      const tp3 = entry + risk * 5;

      const sweepDepth = (asianLow - currentM5.low) / currentAtr;
      let confidence = 55;
      if (sweepDepth > 0.2) confidence += 10;
      if (currentRsi >= 35 && currentRsi <= 60) confidence += 10;
      if (Math.abs(emaSpread) > currentH4Atr * 0.3) confidence += 10;

      return {
        symbol: pair,
        direction: 'LONG',
        entry: Math.round(entry / pipMultiplier) * pipMultiplier,
        sl: Math.round(sl / pipMultiplier) * pipMultiplier,
        tp1: Math.round(tp1 / pipMultiplier) * pipMultiplier,
        tp2: Math.round(tp2 / pipMultiplier) * pipMultiplier,
        tp3: Math.round(tp3 / pipMultiplier) * pipMultiplier,
        confidence: Math.min(confidence, 85),
        reason: `AMD | Asian low ${asianLow.toFixed(5)} swept + London/NY reversal UP | H4 BULL | RSI ${currentRsi.toFixed(1)}`,
        candleIndex: m5Candles.length - 1
      };
    }
  }

  // === BEARISH: manipulation sweep above Asian high, distribution DOWN, WITH H4 BEAR ===
  if (h4Trend === 'BEAR') {
    const sweptHigh = currentM5.high > asianHigh;
    const closedBackBelow = currentM5.close < asianHigh;
    const bearishClose = currentM5.close < currentM5.open;

    if (sweptHigh && closedBackBelow && bearishClose && currentRsi > 30) {
      const entry = currentM5.close;
      let risk = Math.min(Math.max((currentM5.high + buffer) - entry, floorRisk), maxRisk);
      if (risk <= 0) return null;

      const riskPips = risk / pipMultiplier;
      const evenRiskPips = Math.max(2, Math.round(riskPips / 2) * 2);
      risk = evenRiskPips * pipMultiplier;

      const sl = entry + risk;
      const tp1 = entry - risk * 1.5;
      const tp2 = entry - risk * 3;
      const tp3 = entry - risk * 5;

      const sweepDepth = (currentM5.high - asianHigh) / currentAtr;
      let confidence = 55;
      if (sweepDepth > 0.2) confidence += 10;
      if (currentRsi >= 40 && currentRsi <= 65) confidence += 10;
      if (Math.abs(emaSpread) > currentH4Atr * 0.3) confidence += 10;

      return {
        symbol: pair,
        direction: 'SHORT',
        entry: Math.round(entry / pipMultiplier) * pipMultiplier,
        sl: Math.round(sl / pipMultiplier) * pipMultiplier,
        tp1: Math.round(tp1 / pipMultiplier) * pipMultiplier,
        tp2: Math.round(tp2 / pipMultiplier) * pipMultiplier,
        tp3: Math.round(tp3 / pipMultiplier) * pipMultiplier,
        confidence: Math.min(confidence, 85),
        reason: `AMD | Asian high ${asianHigh.toFixed(5)} swept + London/NY reversal DOWN | H4 BEAR | RSI ${currentRsi.toFixed(1)}`,
        candleIndex: m5Candles.length - 1
      };
    }
  }

  return null;
}
