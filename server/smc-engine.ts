import type { Candle } from '../src/types.js';
import { getPipMultiplier } from './engine.js';

export interface SMCSignal {
  symbol: string;
  direction: 'LONG' | 'SHORT';
  entry: number;
  sl: number;
  tp1: number;
  tp2: number;
  confidence: number;
  timeframe: 'M5';
  reason: string;
  h4CandleIndex: number;
  sweepCandleIndex: number;
  bosCandleIndex: number;
  obCandleIndex: number;
  entryCandleIndex: number;
}

interface StrongH4Candle {
  candle: Candle;
  index: number;
  high: number;
  low: number;
  bodyTop: number;
  bodyBottom: number;
  direction: 'bullish' | 'bearish';
}

interface LiquiditySweep {
  sweepCandle: Candle;
  sweepIndex: number;
  wickTip: number;
  closeBackIndex: number;
  mostExtremeWick: number;
}

interface BreakOfStructure {
  bosCandle: Candle;
  bosIndex: number;
  swingLevel: number;
}

interface OrderBlock {
  candle: Candle;
  index: number;
  bodyTop: number;
  bodyBottom: number;
  fullTop: number;
  fullBottom: number;
}

// Step 1: Find a strong H4 candle (body > 1.5x average of last 20)
// Only consider the most recent H4 candle, not the strongest from all 20
function findStrongH4Candle(h4Candles: Candle[]): StrongH4Candle | null {
  if (h4Candles.length < 20) return null;
  
  // Use only the most recent H4 candle
  const candle = h4Candles[h4Candles.length - 1];
  const body = Math.abs(candle.close - candle.open);
  
  // Calculate average body size from last 20 candles
  const recent = h4Candles.slice(-20);
  let totalBody = 0;
  for (const c of recent) {
    totalBody += Math.abs(c.close - c.open);
  }
  const avgBody = totalBody / recent.length;
  
  // Check if it's strong enough (> 1.5x average)
  if (body < avgBody * 1.5) return null;
  
  const isBullish = candle.close > candle.open;
  return {
    candle,
    index: h4Candles.length - 1,
    high: candle.high,
    low: candle.low,
    bodyTop: Math.max(candle.open, candle.close),
    bodyBottom: Math.min(candle.open, candle.close),
    direction: isBullish ? 'bullish' : 'bearish'
  };
}

// Step 2: Detect liquidity sweep on M5
// Sweep = wick beyond level + close back within same or next 1-2 candles
// If close-back takes 2 candles, use the more extreme wick for SL
function detectLiquiditySweep(
  m5Candles: Candle[],
  startIndex: number,
  h4Level: number,
  direction: 'bullish' | 'bearish'
): LiquiditySweep | null {
  for (let i = startIndex; i < m5Candles.length - 2; i++) {
    const candle = m5Candles[i];
    if (direction === 'bullish') {
      // Same-candle sweep: wick below level, close above level
      if (candle.low < h4Level && candle.close > h4Level) {
        return {
          sweepCandle: candle,
          sweepIndex: i,
          wickTip: candle.low,
          closeBackIndex: i,
          mostExtremeWick: candle.low
        };
      }
      // Multi-candle sweep: wick below on this candle, close above on next 1-2
      if (candle.low < h4Level && candle.close < h4Level) {
        let mostExtremeWick = candle.low;
        let extremeCandle = candle;
        for (let j = 1; j <= 2 && i + j < m5Candles.length; j++) {
          const next = m5Candles[i + j];
          if (next.low < mostExtremeWick) {
            mostExtremeWick = next.low;
            extremeCandle = next;
          }
          // Close-back found
          if (next.close > h4Level) {
            return {
              sweepCandle: extremeCandle,
              sweepIndex: i,
              wickTip: mostExtremeWick,
              closeBackIndex: i + j,
              mostExtremeWick
            };
          }
          // Still below, continue checking next candle
        }
        // If we get here, no close-back found in 2 candles = real breakout, skip
        i += 2;
      }
    } else {
      // Bearish: wick above H4 high, close back below
      if (candle.high > h4Level && candle.close < h4Level) {
        return {
          sweepCandle: candle,
          sweepIndex: i,
          wickTip: candle.high,
          closeBackIndex: i,
          mostExtremeWick: candle.high
        };
      }
      if (candle.high > h4Level && candle.close > h4Level) {
        let mostExtremeWick = candle.high;
        let extremeCandle = candle;
        for (let j = 1; j <= 2 && i + j < m5Candles.length; j++) {
          const next = m5Candles[i + j];
          if (next.high > mostExtremeWick) {
            mostExtremeWick = next.high;
            extremeCandle = next;
          }
          if (next.close < h4Level) {
            return {
              sweepCandle: extremeCandle,
              sweepIndex: i,
              wickTip: mostExtremeWick,
              closeBackIndex: i + j,
              mostExtremeWick
            };
          }
        }
        i += 2;
      }
    }
  }
  return null;
}

// Step 3: Detect Break of Structure (BOS) on M5
// Find most recent swing high/low, then first close above/below it
function detectBOS(
  m5Candles: Candle[],
  afterIndex: number,
  direction: 'bullish' | 'bearish'
): BreakOfStructure | null {
  if (afterIndex >= m5Candles.length - 5) return null;
  const lookbackStart = Math.max(0, afterIndex - 10);
  let swingLevel: number;
  let foundSwing = false;

  if (direction === 'bullish') {
    let maxHigh = -Infinity;
    for (let i = lookbackStart; i < afterIndex; i++) {
      if (i < 2 || i >= m5Candles.length - 2) continue;
      const c = m5Candles[i];
      const isSwingHigh =
        c.high > m5Candles[i - 1].high &&
        c.high > m5Candles[i - 2].high &&
        c.high > m5Candles[i + 1].high &&
        c.high > m5Candles[i + 2].high;
      if (isSwingHigh && c.high > maxHigh) {
        maxHigh = c.high;
        foundSwing = true;
      }
    }
    if (!foundSwing) return null;
    swingLevel = maxHigh;
    for (let i = afterIndex; i < m5Candles.length; i++) {
      if (m5Candles[i].close > swingLevel) {
        return { bosCandle: m5Candles[i], bosIndex: i, swingLevel };
      }
    }
  } else {
    let minLow = Infinity;
    for (let i = lookbackStart; i < afterIndex; i++) {
      if (i < 2 || i >= m5Candles.length - 2) continue;
      const c = m5Candles[i];
      const isSwingLow =
        c.low < m5Candles[i - 1].low &&
        c.low < m5Candles[i - 2].low &&
        c.low < m5Candles[i + 1].low &&
        c.low < m5Candles[i + 2].low;
      if (isSwingLow && c.low < minLow) {
        minLow = c.low;
        foundSwing = true;
      }
    }
    if (!foundSwing) return null;
    swingLevel = minLow;
    for (let i = afterIndex; i < m5Candles.length; i++) {
      if (m5Candles[i].close < swingLevel) {
        return { bosCandle: m5Candles[i], bosIndex: i, swingLevel };
      }
    }
  }
  return null;
}

// Step 4: Identify Order Block
// Last opposite-colored candle immediately before BOS
function identifyOrderBlock(
  m5Candles: Candle[],
  bosIndex: number,
  direction: 'bullish' | 'bearish'
): OrderBlock | null {
  for (let i = bosIndex - 1; i >= Math.max(0, bosIndex - 20); i--) {
    const candle = m5Candles[i];
    const isBullish = candle.close > candle.open;
    if ((direction === 'bullish' && !isBullish) || (direction === 'bearish' && isBullish)) {
      return {
        candle,
        index: i,
        bodyTop: Math.max(candle.open, candle.close),
        bodyBottom: Math.min(candle.open, candle.close),
        fullTop: candle.high,
        fullBottom: candle.low
      };
    }
  }
  return null;
}

// Step 5: Wait for retracement into Order Block body
function waitForRetracement(
  m5Candles: Candle[],
  orderBlock: OrderBlock,
  afterBOSIndex: number,
  direction: 'bullish' | 'bearish'
): { entryCandle: Candle; entryIndex: number; entryPrice: number } | null {
  for (let i = afterBOSIndex + 1; i < m5Candles.length; i++) {
    const candle = m5Candles[i];
    if (direction === 'bullish') {
      if (candle.low <= orderBlock.bodyTop) {
        return {
          entryCandle: candle,
          entryIndex: i,
          entryPrice: (orderBlock.bodyTop + orderBlock.bodyBottom) / 2
        };
      }
    } else {
      if (candle.high >= orderBlock.bodyBottom) {
        return {
          entryCandle: candle,
          entryIndex: i,
          entryPrice: (orderBlock.bodyTop + orderBlock.bodyBottom) / 2
        };
      }
    }
  }
  return null;
}

// Step 6: Risk management
// SL: beyond sweep wick tip by 2 pips buffer
// TP1: 1:tpRatio R:R, TP2: 1:(tpRatio*1.5) R:R
function calculateRiskManagement(
  sweepWickTip: number,
  entryPrice: number,
  direction: 'LONG' | 'SHORT',
  pair: string,
  tpRatio: number = 2.0
): { sl: number; tp1: number; tp2: number } {
  const pipMultiplier = getPipMultiplier(pair);
  const buffer = 2 * pipMultiplier;
  let sl: number;
  if (direction === 'LONG') {
    sl = sweepWickTip - buffer;
    const risk = entryPrice - sl;
    return { sl, tp1: entryPrice + risk * tpRatio, tp2: entryPrice + risk * (tpRatio * 1.5) };
  } else {
    sl = sweepWickTip + buffer;
    const risk = sl - entryPrice;
    return { sl, tp1: entryPrice - risk * tpRatio, tp2: entryPrice - risk * (tpRatio * 1.5) };
  }
}

/**
 * Main SMC detection function.
 * Called at each M5 candle step in the backtest loop.
 * Multiple signals fire over time as new H4 candles form.
 */
export function detectSMCSetup(
  pair: string,
  h4Candles: Candle[],
  m5Candles: Candle[],
  tpRatio: number = 2.0
): SMCSignal | null {
  // Step 1: Find strong H4 candle
  const h4Candle = findStrongH4Candle(h4Candles);
  if (!h4Candle) return null;

  // Only look for M5 setups AFTER the H4 candle's timestamp
  const h4Timestamp = h4Candle.candle.timestamp;
  let startM5Index = 0;
  for (let i = 0; i < m5Candles.length; i++) {
    if (m5Candles[i].timestamp > h4Timestamp) {
      startM5Index = i;
      break;
    }
  }
  if (startM5Index === 0) return null;

  // Step 2: Detect liquidity sweep
  const h4Level = h4Candle.direction === 'bullish' ? h4Candle.low : h4Candle.high;
  const sweep = detectLiquiditySweep(m5Candles, startM5Index, h4Level, h4Candle.direction);
  if (!sweep) return null;

  // Step 3: Detect BOS after sweep
  const bos = detectBOS(m5Candles, sweep.closeBackIndex + 1, h4Candle.direction);
  if (!bos) return null;

  // Step 4: Identify Order Block before BOS
  const orderBlock = identifyOrderBlock(m5Candles, bos.bosIndex, h4Candle.direction);
  if (!orderBlock) return null;

  // Step 5: Wait for retracement into OB
  const retracement = waitForRetracement(m5Candles, orderBlock, bos.bosIndex, h4Candle.direction);
  if (!retracement) return null;

  // Step 6: Calculate risk management
  const direction = h4Candle.direction === 'bullish' ? 'LONG' : 'SHORT';
  const risk = calculateRiskManagement(sweep.mostExtremeWick, retracement.entryPrice, direction, pair, tpRatio);

  const reason = `H4 ${h4Candle.direction} candle -> M5 liquidity sweep -> BOS -> retracement to OB`;

  return {
    symbol: pair,
    direction,
    entry: retracement.entryPrice,
    sl: risk.sl,
    tp1: risk.tp1,
    tp2: risk.tp2,
    confidence: 80,
    timeframe: 'M5',
    reason,
    h4CandleIndex: h4Candle.index,
    sweepCandleIndex: sweep.sweepIndex,
    bosCandleIndex: bos.bosIndex,
    obCandleIndex: orderBlock.index,
    entryCandleIndex: retracement.entryIndex
  };
}
