import type { Candle } from '../src/types.js';

export type Direction = 'BUY' | 'SELL';

export type Target = {
  price: number;
  source: string;
  rr: number;
};

export type TargetPlan = {
  tp2: Target | null;
  tp3: Target | null;
  reasons: string[];
};

const EPSILON = 1e-9;

function isFinitePrice(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isSwingHigh(candles: Candle[], index: number): boolean {
  const candle = candles[index];
  const left = candles[index - 1];
  const right = candles[index + 1];
  return Boolean(candle && left && right && candle.high > left.high && candle.high >= right.high);
}

function isSwingLow(candles: Candle[], index: number): boolean {
  const candle = candles[index];
  const left = candles[index - 1];
  const right = candles[index + 1];
  return Boolean(candle && left && right && candle.low < left.low && candle.low <= right.low);
}

function uniqueLevels(levels: number[], tolerance: number): number[] {
  return levels
    .filter(isFinitePrice)
    .sort((a, b) => a - b)
    .filter((level, index, sorted) => index === 0 || Math.abs(level - sorted[index - 1]) > tolerance);
}

function directionalLevels(
  candles: Candle[],
  direction: Direction,
  entry: number,
): number[] {
  const levels: number[] = [];
  for (let index = 1; index < candles.length - 1; index += 1) {
    if (direction === 'BUY' && isSwingHigh(candles, index) && candles[index].high > entry) {
      levels.push(candles[index].high);
    }
    if (direction === 'SELL' && isSwingLow(candles, index) && candles[index].low < entry) {
      levels.push(candles[index].low);
    }
  }
  return levels;
}

export function calculateRr(
  direction: Direction,
  entry: number,
  stopLoss: number,
  target: number,
): number | null {
  if (![entry, stopLoss, target].every(isFinitePrice)) return null;
  const risk = direction === 'BUY' ? entry - stopLoss : stopLoss - entry;
  const reward = direction === 'BUY' ? target - entry : entry - target;
  if (risk <= EPSILON || reward <= EPSILON) return null;
  return reward / risk;
}

export function buildHistoricalTargetPlan(
  candles: Candle[],
  direction: Direction,
  entry: number,
  stopLoss: number,
  tp1: number | null,
): TargetPlan {
  const reasons: string[] = [];
  if (!Array.isArray(candles) || candles.length < 20) {
    return {
      tp2: null,
      tp3: null,
      reasons: ['Insufficient 1H historical market structure to determine TP2 and TP3.'],
    };
  }

  const tolerance = Math.max(Math.abs(entry) * 0.00025, 0.00001);
  const levels = uniqueLevels(directionalLevels(candles, direction, entry), tolerance);
  const ordered = direction === 'BUY' ? levels.filter(level => level > entry) : levels.filter(level => level < entry).reverse();
  const tp1Distance = tp1 === null ? null : Math.abs(tp1 - entry);
  const filtered = ordered.filter(level => tp1Distance === null || Math.abs(level - entry) > tp1Distance + tolerance);

  if (filtered.length === 0) {
    return {
      tp2: null,
      tp3: null,
      reasons: ['No valid 1H historical structure exists beyond TP1 for TP2.'],
    };
  }

  const tp2Price = filtered[0];
  const tp2Rr = calculateRr(direction, entry, stopLoss, tp2Price);
  const tp2 = tp2Rr === null ? null : {
    price: tp2Price,
    source: 'cTrader 1H swing structure',
    rr: tp2Rr,
  };

  if (tp2Rr !== null && tp2Rr < 2) {
    reasons.push('TP2 is a valid 1H target but is below the preferred 2R.');
  }

  const tp3Candidates = filtered.slice(1);
  const minimumTp3Rr = 3;
  const tp3Price = tp3Candidates.find(level => {
    const rr = calculateRr(direction, entry, stopLoss, level);
    return rr !== null && rr >= minimumTp3Rr;
  });

  if (tp3Price === undefined) {
    reasons.push('No valid 1H historical TP3 reaches the required 3R.');
  }

  const tp3Rr = tp3Price === undefined ? null : calculateRr(direction, entry, stopLoss, tp3Price);
  const tp3 = tp3Price === undefined || tp3Rr === null
    ? null
    : {
      price: tp3Price,
      source: 'cTrader 1H extended structure',
      rr: tp3Rr,
    };

  return { tp2, tp3, reasons };
}