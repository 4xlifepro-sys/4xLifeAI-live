import type { Candle } from '../src/types.js';

export type ConditionMode = 'REQUIRED' | 'OPTIONAL' | 'DISABLED';
export type AnalysisState = 'WAITING' | 'NO TRADE' | 'BUY' | 'SELL';
export type PoiType = 'SBR' | 'RBS' | 'CLASSIC A' | 'CLASSIC V' | 'OCL' | 'MAJOR SUPPORT' | 'MAJOR RESISTANCE';
export type StrategyTimeframeRole = 'HIGHER' | 'MIDDLE' | 'LOWER';

export interface StrategyTimeframe {
  timeframe: string;
  role: StrategyTimeframeRole;
  enabled: boolean;
}

export interface StrategyConfig {
  name: string;
  version: number;
  active: boolean;
  backtestApproved: boolean;
  timeframes: StrategyTimeframe[];
  conditions: Record<string, ConditionMode>;
  poiModes: Record<PoiType, ConditionMode>;
  sessionWindowsUtc: { londonStart: number; londonEnd: number; newYorkStart: number; newYorkEnd: number };
  poiWeights: Record<PoiType, number>;
  conditionWeights: Record<string, number>;
  minimumScore: number;
  countertrendEnabled: boolean;
  countertrendMinimumScore: number;
  riskPercent: number;
  maximumRiskPercent: number;
  minimumRewardRisk: number;
  maximumConfidence: 80;
  poiAtrTolerance: number;
  swingLookback: number;
  slBufferAtr: number;
  allowedSymbols: string[];
}

export interface StrategyPoi {
  type: PoiType;
  price: number;
  timeframe: string;
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  strength: number;
  status: 'FRESH' | 'TESTED' | 'WEAKENED';
  score: number;
  sourceTimestamp: string;
}

export interface StrategyAnalysis {
  pair: string;
  state: AnalysisState;
  direction: 'BUY' | 'SELL' | null;
  analyzedAt: string;
  strategyVersion: number;
  dataStatus: 'VALID' | 'DATA INSUFFICIENT' | 'STALE';
  lastMarketTimestamp: string | null;
  lowerTimeframe: string;
  timeframeStatus: Record<string, 'AVAILABLE' | 'MISSING' | 'INSUFFICIENT' | 'STALE'>;
  htfBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'UNKNOWN';
  marketStructure: string;
  mainPoi: StrategyPoi | null;
  middleSetup: 'CONFIRMED' | 'NOT CONFIRMED' | 'WAITING' | 'UNKNOWN';
  mss: 'BULLISH' | 'BEARISH' | 'NOT CONFIRMED' | 'UNKNOWN';
  conditions: Record<string, { mode: ConditionMode; confirmed: boolean | null; reason: string }>;
  entry: number | null;
  stopLoss: number | null;
  targets: number[];
  riskReward: number | null;
  riskPercent: number;
  internalScore: number | null;
  confidence: number | null;
  reason: string;
  warnings: string[];
}

export const SUPPORTED_TIMEFRAMES = ['1M', '3M', '5M', '15M', '30M', '1H', '2H', '4H', '1D', '1W'] as const;
export const STRATEGY_POIS: PoiType[] = ['SBR', 'RBS', 'CLASSIC A', 'CLASSIC V', 'OCL', 'MAJOR SUPPORT', 'MAJOR RESISTANCE'];

export const DEFAULT_STRATEGY_CONFIG: StrategyConfig = {
  name: 'FULL ICT + SMC + MSNR',
  version: 1,
  active: false,
  backtestApproved: false,
  timeframes: [
    { timeframe: '1D', role: 'HIGHER', enabled: true },
    { timeframe: '4H', role: 'HIGHER', enabled: true },
    { timeframe: '1H', role: 'MIDDLE', enabled: true },
    { timeframe: '15M', role: 'MIDDLE', enabled: true },
    { timeframe: '5M', role: 'LOWER', enabled: true },
  ],
  conditions: {
    POI: 'REQUIRED',
    HTF_BIAS: 'REQUIRED',
    MIDDLE_SETUP: 'REQUIRED',
    MSS: 'REQUIRED',
    LIQUIDITY_SWEEP: 'OPTIONAL',
    FVG: 'OPTIONAL',
    FVG_RETEST: 'OPTIONAL',
    DISPLACEMENT: 'OPTIONAL',
    PREMIUM_DISCOUNT: 'OPTIONAL',
    EMA_200: 'DISABLED',
    OCL: 'OPTIONAL',
    QML: 'OPTIONAL',
    ORDER_BLOCK: 'OPTIONAL',
    LONDON_SESSION: 'OPTIONAL',
    NEW_YORK_SESSION: 'OPTIONAL',
    RISK: 'REQUIRED',
  },
  poiModes: {
    SBR: 'OPTIONAL',
    RBS: 'OPTIONAL',
    'CLASSIC A': 'OPTIONAL',
    'CLASSIC V': 'OPTIONAL',
    OCL: 'OPTIONAL',
    'MAJOR SUPPORT': 'OPTIONAL',
    'MAJOR RESISTANCE': 'OPTIONAL',
  },
  sessionWindowsUtc: { londonStart: 7, londonEnd: 10, newYorkStart: 12, newYorkEnd: 15 },
  poiWeights: {
    SBR: 72,
    RBS: 72,
    'CLASSIC A': 78,
    'CLASSIC V': 78,
    OCL: 58,
    'MAJOR SUPPORT': 70,
    'MAJOR RESISTANCE': 70,
  },
  conditionWeights: {
    POI: 20,
    HTF_BIAS: 15,
    MIDDLE_SETUP: 15,
    LIQUIDITY_SWEEP: 10,
    MSS: 20,
    FVG: 5,
    OCL: 5,
    QML: 5,
    DISPLACEMENT: 5,
    PREMIUM_DISCOUNT: 5,
    EMA_200: 5,
    ORDER_BLOCK: 5,
    SESSION: 0,
    RISK: 10,
  },
  minimumScore: 65,
  countertrendEnabled: false,
  countertrendMinimumScore: 80,
  riskPercent: 1,
  maximumRiskPercent: 2,
  minimumRewardRisk: 1,
  maximumConfidence: 80,
  poiAtrTolerance: 0.6,
  swingLookback: 80,
  slBufferAtr: 0.15,
  allowedSymbols: ['EURUSD', 'GBPUSD', 'USDJPY', 'GBPJPY', 'XAUUSD'],
};

interface Pivot {
  index: number;
  price: number;
  time: string;
}

interface StructureSnapshot {
  highs: Pivot[];
  lows: Pivot[];
  bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'UNKNOWN';
  label: string;
}

const FRAME_MINUTES: Record<string, number> = {
  '1M': 1, '3M': 3, '5M': 5, '15M': 15, '30M': 30,
  '1H': 60, '2H': 120, '4H': 240, '1D': 1440, '1W': 10080,
};

function validCandles(candles: Candle[] | undefined, minimum: number, timeframe: string): Candle[] {
  if (!Array.isArray(candles)) return [];
  const cleaned = candles.filter(candle =>
    candle && Number.isFinite(candle.open) && Number.isFinite(candle.high)
    && Number.isFinite(candle.low) && Number.isFinite(candle.close)
    && candle.high >= candle.low && Date.parse(candle.timestamp) > 0
  );
  cleaned.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const unique = cleaned.filter((candle, index) => index === 0 || candle.timestamp !== cleaned[index - 1].timestamp);
  const periodMinutes = FRAME_MINUTES[timeframe] || 0;
  const closed = periodMinutes
    ? unique.filter(candle => Date.parse(candle.timestamp) + periodMinutes * 60_000 <= Date.now())
    : unique;
  if (closed.length < minimum) return [];
  const lastTime = Date.parse(closed[closed.length - 1].timestamp) + periodMinutes * 60_000;
  if (periodMinutes && Date.now() - lastTime > periodMinutes * 3 * 60_000) return [];
  return closed;
}

function findPivots(candles: Candle[], lookback: number, side: 'high' | 'low'): Pivot[] {
  const start = Math.max(2, candles.length - lookback);
  const end = candles.length - 2;
  const found: Pivot[] = [];
  for (let index = start; index < end; index++) {
    const price = side === 'high' ? candles[index].high : candles[index].low;
    const left = candles.slice(index - 2, index);
    const right = candles.slice(index + 1, index + 3);
    const isPivot = side === 'high'
      ? left.every(candle => candle.high < price) && right.every(candle => candle.high <= price)
      : left.every(candle => candle.low > price) && right.every(candle => candle.low >= price);
    if (isPivot) found.push({ index, price, time: candles[index].timestamp });
  }
  return found;
}

function averageTrueRange(candles: Candle[], period = 14): number | null {
  if (candles.length < period + 1) return null;
  const ranges = candles.slice(-period).map((candle, index, segment) => {
    const previous = candles[candles.length - period + index - 1];
    return Math.max(candle.high - candle.low, Math.abs(candle.high - previous.close), Math.abs(candle.low - previous.close));
  });
  const value = ranges.reduce((sum, range) => sum + range, 0) / ranges.length;
  return Number.isFinite(value) && value > 0 ? value : null;
}

function structure(candles: Candle[], lookback: number): StructureSnapshot {
  const highs = findPivots(candles, lookback, 'high');
  const lows = findPivots(candles, lookback, 'low');
  if (highs.length < 2 || lows.length < 2) return { highs, lows, bias: 'UNKNOWN', label: 'UNKNOWN' };
  const lastHighs = highs.slice(-2);
  const lastLows = lows.slice(-2);
  const higherHigh = lastHighs[1].price > lastHighs[0].price;
  const higherLow = lastLows[1].price > lastLows[0].price;
  const lowerHigh = lastHighs[1].price < lastHighs[0].price;
  const lowerLow = lastLows[1].price < lastLows[0].price;
  if (higherHigh && higherLow) return { highs, lows, bias: 'BULLISH', label: 'HH + HL' };
  if (lowerHigh && lowerLow) return { highs, lows, bias: 'BEARISH', label: 'LH + LL' };
  return { highs, lows, bias: 'NEUTRAL', label: 'MIXED STRUCTURE' };
}

function countRetests(candles: Candle[], level: number, tolerance: number, fromIndex: number): number {
  let tests = 0;
  for (const candle of candles.slice(fromIndex + 1)) {
    if (candle.low <= level + tolerance && candle.high >= level - tolerance) tests++;
  }
  return tests;
}

function poiCandidates(timeframe: string, candles: Candle[], lookback: number): StrategyPoi[] {
  const snapshot = structure(candles, lookback);
  const atr = averageTrueRange(candles);
  if (!atr) return [];
  const candidates: StrategyPoi[] = [];
  for (const pivot of snapshot.highs.slice(-8)) {
    const subsequent = candles.slice(pivot.index + 1);
    const breakOffset = subsequent.findIndex(candle => candle.close > pivot.price + atr * 0.1);
    const broken = breakOffset >= 0;
    const touches = countRetests(candles, pivot.price, atr * 0.15, pivot.index);
    const retestsAfterBreak = broken ? countRetests(candles, pivot.price, atr * 0.15, pivot.index + breakOffset) : 0;
    const rejected = subsequent.slice(0, 12).some(candle => candle.close < pivot.price - atr * 0.2);
    const displacement = subsequent.slice(0, 8).some(candle => candle.close < candle.open && candle.open - candle.close >= atr * 0.8);
    const type: PoiType = broken && retestsAfterBreak > 0 ? 'RBS' : rejected && displacement ? 'CLASSIC A' : 'MAJOR RESISTANCE';
    const freshness = touches === 0 ? 'FRESH' : touches <= 2 ? 'TESTED' : 'WEAKENED';
    const direction = type === 'RBS' ? 'BULLISH' : type === 'CLASSIC A' || type === 'MAJOR RESISTANCE' ? 'BEARISH' : 'NEUTRAL';
    const agePenalty = Math.min(20, Math.max(0, candles.length - 1 - pivot.index) / lookback * 20);
    const quality = (rejected ? 16 : 0) + (displacement ? 12 : 0) + (freshness === 'FRESH' ? 14 : freshness === 'TESTED' ? 7 : 0) + (touches <= 2 ? 10 : 0);
    candidates.push({
      type,
      price: pivot.price,
      timeframe,
      direction,
      strength: Math.max(0, Math.min(100, 48 + quality - agePenalty)),
      status: freshness,
      score: Math.max(0, Math.min(100, 48 + quality - agePenalty)),
      sourceTimestamp: pivot.time,
    });
  }
  for (const pivot of snapshot.lows.slice(-8)) {
    const subsequent = candles.slice(pivot.index + 1);
    const breakOffset = subsequent.findIndex(candle => candle.close < pivot.price - atr * 0.1);
    const broken = breakOffset >= 0;
    const touches = countRetests(candles, pivot.price, atr * 0.15, pivot.index);
    const retestsAfterBreak = broken ? countRetests(candles, pivot.price, atr * 0.15, pivot.index + breakOffset) : 0;
    const rejected = subsequent.slice(0, 12).some(candle => candle.close > pivot.price + atr * 0.2);
    const displacement = subsequent.slice(0, 8).some(candle => candle.close > candle.open && candle.close - candle.open >= atr * 0.8);
    const type: PoiType = broken && retestsAfterBreak > 0 ? 'SBR' : rejected && displacement ? 'CLASSIC V' : 'MAJOR SUPPORT';
    const freshness = touches === 0 ? 'FRESH' : touches <= 2 ? 'TESTED' : 'WEAKENED';
    const direction = type === 'SBR' ? 'BEARISH' : type === 'CLASSIC V' || type === 'MAJOR SUPPORT' ? 'BULLISH' : 'NEUTRAL';
    const agePenalty = Math.min(20, Math.max(0, candles.length - 1 - pivot.index) / lookback * 20);
    const quality = (rejected ? 16 : 0) + (displacement ? 12 : 0) + (freshness === 'FRESH' ? 14 : freshness === 'TESTED' ? 7 : 0) + (touches <= 2 ? 10 : 0);
    candidates.push({
      type,
      price: pivot.price,
      timeframe,
      direction,
      strength: Math.max(0, Math.min(100, 48 + quality - agePenalty)),
      status: freshness,
      score: Math.max(0, Math.min(100, 48 + quality - agePenalty)),
      sourceTimestamp: pivot.time,
    });
  }
  const recentCandles = candles.slice(-40);
  const current = candles[candles.length - 1];
  const oclCandidates = recentCandles.flatMap((candle, index) => [
    { price: candle.open, index },
    { price: candle.close, index },
  ]).filter(level => Math.abs(level.price - current.close) <= atr * 0.6)
    .sort((a, b) => Math.abs(a.price - current.close) - Math.abs(b.price - current.close));
  for (const level of oclCandidates.slice(0, 4)) {
    const absoluteIndex = Math.max(0, candles.length - recentCandles.length + level.index);
    const touches = countRetests(candles, level.price, atr * 0.15, absoluteIndex);
    const bullishReaction = current.low <= level.price && current.close > level.price;
    const bearishReaction = current.high >= level.price && current.close < level.price;
    if (!bullishReaction && !bearishReaction) continue;
    const status = touches === 0 ? 'FRESH' : touches <= 2 ? 'TESTED' : 'WEAKENED';
    candidates.push({
      type: 'OCL',
      price: level.price,
      timeframe,
      direction: bullishReaction ? 'BULLISH' : 'BEARISH',
      strength: status === 'FRESH' ? 72 : status === 'TESTED' ? 58 : 0,
      status,
      score: status === 'FRESH' ? 72 : status === 'TESTED' ? 58 : 0,
      sourceTimestamp: candles[absoluteIndex].timestamp,
    });
  }
  return candidates;
}

function detectMss(candles: Candle[], lookback: number): 'BULLISH' | 'BEARISH' | 'NOT CONFIRMED' | 'UNKNOWN' {
  const snapshot = structure(candles, lookback);
  const last = candles[candles.length - 1];
  const previous = candles[candles.length - 2];
  const atr = averageTrueRange(candles);
  if (!last || !previous || !atr || snapshot.highs.length < 2 || snapshot.lows.length < 2) return 'UNKNOWN';
  const priorHigh = snapshot.highs[snapshot.highs.length - 1];
  const priorLow = snapshot.lows[snapshot.lows.length - 1];
  const recentPriorCandles = candles.slice(-4, -1);
  const bullishBreak = last.close > priorHigh.price && recentPriorCandles.some(candle => candle.close <= priorHigh.price);
  const bearishBreak = last.close < priorLow.price && recentPriorCandles.some(candle => candle.close >= priorLow.price);
  const bullishDisplacement = last.close > last.open && last.close - last.open >= atr * 0.45;
  const bearishDisplacement = last.close < last.open && last.open - last.close >= atr * 0.45;
  if (bullishBreak && bullishDisplacement) return 'BULLISH';
  if (bearishBreak && bearishDisplacement) return 'BEARISH';
  return 'NOT CONFIRMED';
}

function structureTargets(direction: 'BUY' | 'SELL', entry: number, snapshots: StructureSnapshot[]): number[] {
  const levels = snapshots.flatMap(snapshot => direction === 'BUY' ? snapshot.highs : snapshot.lows)
    .map(pivot => pivot.price)
    .filter(price => direction === 'BUY' ? price > entry : price < entry);
  const unique = [...new Set(levels)].sort((a, b) => direction === 'BUY' ? a - b : b - a);
  return unique.slice(0, 3);
}

function detectFvg(candles: Candle[], direction: 'BUY' | 'SELL' | null): { formed: boolean; retested: boolean } {
  if (!direction || candles.length < 5) return { formed: false, retested: false };
  const start = Math.max(0, candles.length - 20);
  for (let index = candles.length - 2; index >= Math.max(start + 2, candles.length - 12); index--) {
    const first = candles[index - 2];
    const middle = candles[index - 1];
    const third = candles[index];
    const bullishGap = direction === 'BUY' && first.high < third.low;
    const bearishGap = direction === 'SELL' && first.low > third.high;
    if (bullishGap) {
      const retested = candles.slice(index + 1).some(candle => candle.low <= third.low && candle.high >= first.high && candle.close >= first.high);
      return { formed: true, retested };
    }
    if (bearishGap) {
      const retested = candles.slice(index + 1).some(candle => candle.high >= third.high && candle.low <= first.low && candle.close <= first.low);
      return { formed: true, retested };
    }
  }
  return { formed: false, retested: false };
}

function detectOclReaction(higherCandles: Candle[][], lowerCandles: Candle[], direction: 'BUY' | 'SELL' | null, tolerance: number): boolean | null {
  const last = lowerCandles.at(-1);
  if (!last || !direction) return null;
  const levels = higherCandles.flatMap(candles => candles.slice(-40).flatMap(candle => [candle.open, candle.close]));
  const level = levels.filter(price => Math.abs(price - last.close) <= tolerance).sort((a, b) => Math.abs(a - last.close) - Math.abs(b - last.close))[0];
  if (level === undefined) return false;
  return direction === 'BUY' ? last.low <= level && last.close > level : last.high >= level && last.close < level;
}

function detectOrderBlock(candles: Candle[], direction: 'BUY' | 'SELL' | null): boolean {
  if (!direction || candles.length < 20) return false;
  const atr = averageTrueRange(candles);
  if (!atr) return false;
  const recent = candles.slice(-12);
  for (let index = 0; index < recent.length - 1; index++) {
    const candle = recent[index];
    const next = recent[index + 1];
    const oppositeCandle = direction === 'BUY' ? candle.close < candle.open : candle.close > candle.open;
    const displacement = direction === 'BUY' ? next.close - next.open >= atr * 0.8 : next.open - next.close >= atr * 0.8;
    const retest = recent.slice(index + 2).some(item => item.low <= candle.high && item.high >= candle.low);
    if (oppositeCandle && displacement && retest) return true;
  }
  return false;
}

function isActiveSession(candles: Candle[], startHour: number, endHour: number): boolean | null {
  const last = candles.at(-1);
  if (!last || !Number.isInteger(startHour) || !Number.isInteger(endHour)) return null;
  const hour = new Date(last.timestamp).getUTCHours();
  return hour >= startHour && hour < endHour;
}

function getActiveTimeframes(config: StrategyConfig, role: StrategyTimeframeRole): StrategyTimeframe[] {
  return config.timeframes.filter(item => item.enabled && item.role === role);
}

function buildCondition(mode: ConditionMode | undefined, confirmed: boolean | null, reason: string) {
  return { mode: mode || 'DISABLED', confirmed, reason };
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function buildReason(state: AnalysisState, poi: StrategyPoi | null, bias: string, mss: string, lowerTimeframe: string, missing: string[], conditions: StrategyAnalysis['conditions']): string {
  if (state === 'NO TRADE') return 'No valid setup meets the active strategy requirements using the available market data.';
  if (state === 'WAITING') {
    if (!poi) return 'Waiting for a valid higher-timeframe Main POI; no trade will be forced.';
    if (missing.includes('POI proximity')) return `Price has not reached the ${poi.type} Main POI; waiting for price to enter its zone.`;
    if (missing.includes('MSS')) return `Price is at the ${poi.type} Main POI, but the required ${lowerTimeframe} MSS has not confirmed yet.`;
    return `Higher-timeframe bias is ${bias.toLowerCase()}, but confirmation is still missing: ${missing.join(', ')}.`;
  }
  const side = state === 'BUY' ? 'bullish' : 'bearish';
  const details = [`Price reacted from the ${poi?.status.toLowerCase()} ${poi?.type} Main POI`, `higher-timeframe bias is ${bias.toLowerCase()}`];
  if (mss === 'BULLISH' || mss === 'BEARISH') details.push(`${lowerTimeframe} ${mss.toLowerCase()} MSS confirmed the entry`);
  const supporting = Object.entries(conditions)
    .filter(([key, condition]) => condition.mode !== 'DISABLED' && condition.confirmed === true && !['POI', 'HTF_BIAS', 'MIDDLE_SETUP', 'MSS', 'RISK'].includes(key))
    .map(([, condition]) => condition.reason);
  details.push(...supporting);
  return `${details.join(', ')}. Structural risk and target validation passed for the ${side} setup.`;
}

export function analyzeStrategyMarket(pair: string, rawCandles: Record<string, Candle[]>, config: StrategyConfig): StrategyAnalysis {
  const symbol = pair.trim().toUpperCase();
  const now = new Date().toISOString();
  const timeframeStatus: StrategyAnalysis['timeframeStatus'] = {};
  const candlesByTimeframe: Record<string, Candle[]> = {};
  const warnings: string[] = [];
  const needed = config.timeframes.filter(item => item.enabled);
  for (const item of needed) {
    const valid = validCandles(rawCandles[item.timeframe], 25, item.timeframe);
    candlesByTimeframe[item.timeframe] = valid;
    timeframeStatus[item.timeframe] = valid.length ? 'AVAILABLE' : rawCandles[item.timeframe]?.length ? 'STALE' : 'MISSING';
  }
  const missingData = needed.filter(item => !candlesByTimeframe[item.timeframe]?.length);
  const lowerTf = getActiveTimeframes(config, 'LOWER').at(-1);
  const lowerCandles = lowerTf ? candlesByTimeframe[lowerTf.timeframe] || [] : [];
  const lastMarketTimestamp = lowerCandles.at(-1)?.timestamp || null;
  const empty: StrategyAnalysis = {
    pair: symbol,
    state: 'NO TRADE',
    direction: null,
    analyzedAt: now,
    strategyVersion: config.version,
    dataStatus: missingData.length ? 'DATA INSUFFICIENT' : 'VALID',
    lastMarketTimestamp,
    lowerTimeframe: lowerTf?.timeframe || 'UNKNOWN',
    timeframeStatus,
    htfBias: 'UNKNOWN',
    marketStructure: 'UNKNOWN',
    mainPoi: null,
    middleSetup: 'UNKNOWN',
    mss: 'UNKNOWN',
    conditions: {},
    entry: null,
    stopLoss: null,
    targets: [],
    riskReward: null,
    riskPercent: config.riskPercent,
    internalScore: null,
    confidence: null,
    reason: '',
    warnings,
  };
  if (!config.active) {
    empty.state = 'NO TRADE';
    empty.reason = 'The strategy is inactive. An Admin must activate a validated strategy before it can generate signals.';
    return empty;
  }
  if (!config.allowedSymbols.includes(symbol)) {
    empty.reason = `NO TRADE: ${symbol} is not in the active strategy symbol allowlist.`;
    return empty;
  }
  if (!needed.length || !getActiveTimeframes(config, 'HIGHER').length || !getActiveTimeframes(config, 'MIDDLE').length || !lowerTf) {
    empty.reason = 'Strategy configuration error: enable at least one HIGHER, MIDDLE, and LOWER timeframe.';
    return empty;
  }
  if (missingData.length) {
    empty.state = 'WAITING';
    empty.reason = `DATA INSUFFICIENT: market candles unavailable or stale for ${missingData.map(item => item.timeframe).join(', ')}.`;
    empty.warnings.push('No prices, structure, POI, MSS, entry, stop, or target were inferred from missing data.');
    return empty;
  }

  const higher = getActiveTimeframes(config, 'HIGHER');
  const middle = getActiveTimeframes(config, 'MIDDLE');
  const higherSnapshots = higher.map(item => structure(candlesByTimeframe[item.timeframe], config.swingLookback));
  const middleSnapshots = middle.map(item => structure(candlesByTimeframe[item.timeframe], config.swingLookback));
  const lowerSnapshot = structure(lowerCandles, config.swingLookback);
  const bullishVotes = higherSnapshots.filter(snapshot => snapshot.bias === 'BULLISH').length;
  const bearishVotes = higherSnapshots.filter(snapshot => snapshot.bias === 'BEARISH').length;
  const htfBias = bullishVotes > bearishVotes ? 'BULLISH' : bearishVotes > bullishVotes ? 'BEARISH' : 'NEUTRAL';
  const requiredPoiTypes = STRATEGY_POIS.filter(type => config.poiModes[type] === 'REQUIRED');
  const candidates = higher.flatMap(item => poiCandidates(item.timeframe, candlesByTimeframe[item.timeframe], config.swingLookback))
    .filter(poi => poi.status !== 'WEAKENED' && config.poiModes[poi.type] !== 'DISABLED' && (!requiredPoiTypes.length || requiredPoiTypes.includes(poi.type)))
    .map(poi => ({ ...poi, score: Math.max(0, Math.min(100, poi.score * (Number(config.poiWeights[poi.type]) / 70))) }))
    .sort((a, b) => b.score - a.score || Date.parse(b.sourceTimestamp) - Date.parse(a.sourceTimestamp));
  const mainPoi = candidates[0] || null;
  const mostRecentLower = lowerCandles.at(-1);
  const lowerAtr = averageTrueRange(lowerCandles);
  const inPoiZone = Boolean(mainPoi && mostRecentLower && lowerAtr && Math.abs(mostRecentLower.close - mainPoi.price) <= lowerAtr * config.poiAtrTolerance);
  const baseDirection = htfBias === 'BULLISH' ? 'BUY' : htfBias === 'BEARISH' ? 'SELL' : null;
  const poiDirection = mainPoi?.direction === 'BULLISH' ? 'BUY' : mainPoi?.direction === 'BEARISH' ? 'SELL' : null;
  const countertrendCandidate = Boolean(config.countertrendEnabled && baseDirection && poiDirection && baseDirection !== poiDirection);
  const candidateDirection = countertrendCandidate ? poiDirection : baseDirection;
  const tradeBias = candidateDirection === 'BUY' ? 'BULLISH' : candidateDirection === 'SELL' ? 'BEARISH' : 'NEUTRAL';
  const poiAligned = Boolean(mainPoi && (mainPoi.direction === tradeBias || mainPoi.direction === 'NEUTRAL'));
  const middleBiasVotes = middleSnapshots.filter(snapshot => snapshot.bias === tradeBias).length;
  const middleConfirmed = tradeBias !== 'NEUTRAL' && middleBiasVotes === middleSnapshots.length && middleSnapshots.length > 0;
  const mss = detectMss(lowerCandles, config.swingLookback);
  const directionMss = candidateDirection === 'BUY' ? mss === 'BULLISH' : candidateDirection === 'SELL' ? mss === 'BEARISH' : false;
  const liquiditySweep = Boolean(mainPoi && lowerCandles.slice(-4).some(candle =>
    mainPoi.direction === 'BULLISH' ? candle.low < mainPoi.price && candle.close > mainPoi.price : candle.high > mainPoi.price && candle.close < mainPoi.price
  ));
  const displacement = Boolean(mostRecentLower && lowerAtr && Math.abs(mostRecentLower.close - mostRecentLower.open) >= lowerAtr * 0.45);
  const ema200 = lowerCandles.length >= 200
    ? lowerCandles.slice(-200).reduce((sum, candle) => sum + candle.close, 0) / 200
    : null;
  const emaAligned = ema200 !== null && mostRecentLower !== undefined
    ? htfBias === 'BULLISH' ? mostRecentLower.close > ema200 : htfBias === 'BEARISH' ? mostRecentLower.close < ema200 : false
    : null;
  const fvg = detectFvg(lowerCandles, candidateDirection);
  const higherCandles = higher.map(item => candlesByTimeframe[item.timeframe]);
  const oclReaction = detectOclReaction(higherCandles, lowerCandles, candidateDirection, lowerAtr ? lowerAtr * 0.2 : 0);
  const orderBlock = detectOrderBlock(lowerCandles, candidateDirection);
  const londonSession = isActiveSession(lowerCandles, config.sessionWindowsUtc.londonStart, config.sessionWindowsUtc.londonEnd);
  const newYorkSession = isActiveSession(lowerCandles, config.sessionWindowsUtc.newYorkStart, config.sessionWindowsUtc.newYorkEnd);
  const rangeHigh = Math.max(...higherCandles.flatMap(candles => candles.slice(-40).map(candle => candle.high)));
  const rangeLow = Math.min(...higherCandles.flatMap(candles => candles.slice(-40).map(candle => candle.low)));
  const equilibrium = Number.isFinite(rangeHigh - rangeLow) && rangeHigh > rangeLow ? rangeLow + (rangeHigh - rangeLow) / 2 : null;
  const premiumDiscount = equilibrium === null || !mostRecentLower || !candidateDirection
    ? null
    : candidateDirection === 'BUY' ? mostRecentLower.close < equilibrium : mostRecentLower.close > equilibrium;
  const conditions: StrategyAnalysis['conditions'] = {
    POI: buildCondition(config.conditions.POI, Boolean(mainPoi), mainPoi ? `Selected ${mainPoi.type} as the single highest-scoring enabled Main POI.` : 'No valid higher-timeframe POI was detected.'),
    HTF_BIAS: buildCondition(config.conditions.HTF_BIAS, htfBias !== 'NEUTRAL', `${higher.map(item => item.timeframe).join('/')} structure vote: ${htfBias}.`),
    MIDDLE_SETUP: buildCondition(config.conditions.MIDDLE_SETUP, middleConfirmed, middleConfirmed ? `All enabled ${middle.map(item => item.timeframe).join('/')} timeframes agree with the higher-timeframe bias.` : 'Middle timeframe structure is not aligned or remains unclear.'),
    MSS: buildCondition(config.conditions.MSS, directionMss, mss === 'UNKNOWN' ? `Not enough closed ${lowerTf?.timeframe} structure is available.` : `${lowerTf?.timeframe} structure break and displacement: ${mss}.`),
    LIQUIDITY_SWEEP: buildCondition(config.conditions.LIQUIDITY_SWEEP, liquiditySweep, liquiditySweep ? 'A sweep and close back across the selected POI was found.' : 'No qualifying sweep at the selected POI was found.'),
    FVG: buildCondition(config.conditions.FVG, fvg.formed, fvg.formed ? `A directional fair value gap was found on ${lowerTf?.timeframe}.` : 'No directional fair value gap was found.'),
    FVG_RETEST: buildCondition(config.conditions.FVG_RETEST, fvg.formed ? fvg.retested : false, fvg.formed && fvg.retested ? 'Price retested the detected fair value gap.' : 'A qualifying fair value gap retest was not found.'),
    OCL: buildCondition(config.conditions.OCL, oclReaction, oclReaction ? 'Price reacted at a higher-timeframe open/close level.' : 'No open/close level reaction is confirmed.'),
    PREMIUM_DISCOUNT: buildCondition(config.conditions.PREMIUM_DISCOUNT, premiumDiscount, premiumDiscount === null ? 'Range location is unavailable.' : premiumDiscount ? 'Price is on the preferred side of equilibrium for the trade direction.' : 'Price is not on the preferred side of equilibrium.'),
    ORDER_BLOCK: buildCondition(config.conditions.ORDER_BLOCK, orderBlock, orderBlock ? 'An opposite candle, displacement and subsequent retest were detected.' : 'No qualifying order-block displacement and retest was detected.'),
    QML: buildCondition(config.conditions.QML, null, 'QML is not reliably detected by the current deterministic data rules.'),
    LONDON_SESSION: buildCondition(config.conditions.LONDON_SESSION, londonSession, `UTC session window ${config.sessionWindowsUtc.londonStart}:00–${config.sessionWindowsUtc.londonEnd}:00.`),
    NEW_YORK_SESSION: buildCondition(config.conditions.NEW_YORK_SESSION, newYorkSession, `UTC session window ${config.sessionWindowsUtc.newYorkStart}:00–${config.sessionWindowsUtc.newYorkEnd}:00.`),
    DISPLACEMENT: buildCondition(config.conditions.DISPLACEMENT, displacement, displacement ? `The latest ${lowerTf?.timeframe} candle body exceeded the ATR displacement threshold.` : 'Required displacement was not observed.'),
    EMA_200: buildCondition(config.conditions.EMA_200, emaAligned, ema200 === null ? 'EMA 200 is unavailable because there are not enough candles.' : `Price is ${emaAligned ? 'aligned' : 'not aligned'} with EMA 200.`),
  };
  const missingRequired = Object.entries(conditions)
    .filter(([, item]) => item.mode === 'REQUIRED' && item.confirmed !== true)
    .map(([name]) => name);
  const missing = [...missingRequired];
  if (!mainPoi) missing.push('Main POI');
  if (!poiAligned) missing.push('POI and HTF bias alignment');
  if (!inPoiZone) missing.push('POI proximity');
  if (!middleConfirmed) missing.push('middle-timeframe setup');
  if (!candidateDirection) missing.push('clear higher-timeframe bias');
  if (!directionMss && !missingRequired.includes('MSS')) missing.push('MSS');

  const snapshots = [...higherSnapshots, ...middleSnapshots, lowerSnapshot];
  const entry = mostRecentLower?.close ?? null;
  let stopLoss: number | null = null;
  let targets: number[] = [];
  let rewardRisk: number | null = null;
  if (candidateDirection && entry !== null && lowerAtr && mainPoi) {
    const stopPivot = candidateDirection === 'BUY'
      ? lowerSnapshot.lows.filter(pivot => pivot.price < entry).at(-1)
      : lowerSnapshot.highs.filter(pivot => pivot.price > entry).at(-1);
    if (stopPivot) {
      stopLoss = candidateDirection === 'BUY' ? stopPivot.price - lowerAtr * config.slBufferAtr : stopPivot.price + lowerAtr * config.slBufferAtr;
      targets = structureTargets(candidateDirection, entry, snapshots);
      const risk = Math.abs(entry - stopLoss);
      targets = targets.filter(target => Math.abs(target - entry) / risk >= config.minimumRewardRisk);
      rewardRisk = targets.length && risk > 0 ? Math.abs(targets[0] - entry) / risk : null;
    }
  }
  const riskValid = Number.isFinite(entry) && Number.isFinite(stopLoss) && stopLoss !== null && entry !== stopLoss
    && (candidateDirection === 'BUY' ? stopLoss < (entry || 0) : stopLoss > (entry || 0))
    && config.riskPercent > 0 && config.riskPercent <= config.maximumRiskPercent
    && targets.length > 0 && rewardRisk !== null;
  conditions.RISK = buildCondition(config.conditions.RISK || 'REQUIRED', riskValid, riskValid ? 'A structural invalidation and opposing structural target passed the risk filter.' : 'Structural stop/target or configured risk validation is unavailable.');
  if (!riskValid) missing.push('structural risk/target validation');

  const conditionScore = Object.entries(conditions).reduce((score, [name, item]) => {
    if (item.confirmed !== true || item.mode === 'DISABLED') return score;
    return score + (config.conditionWeights[name] || 0);
  }, 0);
  const poiScore = mainPoi ? (config.conditionWeights.POI || 0) * (mainPoi.score / 100) : 0;
  const htfScore = htfBias !== 'NEUTRAL' ? config.conditionWeights.HTF_BIAS || 0 : 0;
  const middleScore = middleConfirmed ? config.conditionWeights.MIDDLE_SETUP || 0 : 0;
  const internalScore = clampScore(conditionScore + poiScore + htfScore + middleScore);
  const countertrend = countertrendCandidate;
  const countertrendEvidence = liquiditySweep || fvg.retested || orderBlock;
  const scoreFloor = countertrend ? config.countertrendMinimumScore : config.minimumScore;
  const finalMissing = [...new Set(missing)];
  if (countertrend && !countertrendEvidence) finalMissing.push('additional countertrend confluence');
  if (internalScore < scoreFloor) finalMissing.push(`minimum score ${scoreFloor}`);
  const requiredOverrides = Object.entries(conditions).some(([, item]) => item.mode === 'REQUIRED' && item.confirmed !== true);
  const tradable = finalMissing.length === 0 && !requiredOverrides && Boolean(candidateDirection);
  let state: AnalysisState = 'WAITING';
  if (!mainPoi || (htfBias === 'NEUTRAL' && !config.countertrendEnabled) || (countertrend && !config.countertrendEnabled)) state = 'NO TRADE';
  else if (tradable) state = candidateDirection as 'BUY' | 'SELL';
  const confidence = tradable ? Math.min(80, config.maximumConfidence, Math.round(internalScore * 0.8)) : null;
  const reason = buildReason(state, mainPoi, htfBias, mss, lowerTf?.timeframe || 'UNKNOWN', finalMissing, conditions);
  return {
    pair: symbol,
    state,
    direction: state === 'BUY' || state === 'SELL' ? state : null,
    analyzedAt: now,
    strategyVersion: config.version,
    dataStatus: 'VALID',
    lastMarketTimestamp,
    lowerTimeframe: lowerTf?.timeframe || 'UNKNOWN',
    timeframeStatus,
    htfBias,
    marketStructure: higherSnapshots.map((snapshot, index) => `${higher[index].timeframe}: ${snapshot.label}`).join(' | '),
    mainPoi,
    middleSetup: middleConfirmed ? 'CONFIRMED' : 'NOT CONFIRMED',
    mss,
    conditions,
    entry: state === 'BUY' || state === 'SELL' ? entry : null,
    stopLoss: state === 'BUY' || state === 'SELL' ? stopLoss : null,
    targets: state === 'BUY' || state === 'SELL' ? targets : [],
    riskReward: state === 'BUY' || state === 'SELL' ? rewardRisk : null,
    riskPercent: config.riskPercent,
    internalScore,
    confidence,
    reason,
    warnings,
  };
}

export function validateStrategyConfig(input: unknown): { ok: true; config: StrategyConfig } | { ok: false; errors: string[] } {
  if (!input || typeof input !== 'object') return { ok: false, errors: ['Strategy configuration must be an object.'] };
  const candidate = input as Partial<StrategyConfig>;
  const errors: string[] = [];
  const timeframes = Array.isArray(candidate.timeframes) ? candidate.timeframes : [];
  if (!timeframes.some(item => item.enabled && item.role === 'HIGHER')) errors.push('Enable at least one HIGHER timeframe.');
  if (!timeframes.some(item => item.enabled && item.role === 'MIDDLE')) errors.push('Enable at least one MIDDLE timeframe.');
  if (!timeframes.some(item => item.enabled && item.role === 'LOWER')) errors.push('Enable at least one LOWER timeframe.');
  if (timeframes.some(item => !SUPPORTED_TIMEFRAMES.includes(item.timeframe as typeof SUPPORTED_TIMEFRAMES[number]))) errors.push('A timeframe is not supported.');
  if (timeframes.some(item => !['HIGHER', 'MIDDLE', 'LOWER'].includes(item.role))) errors.push('A timeframe role is invalid.');
  if (!Number.isFinite(candidate.minimumScore) || Number(candidate.minimumScore) < 1 || Number(candidate.minimumScore) > 100) errors.push('Minimum score must be from 1 to 100.');
  if (!Number.isFinite(candidate.countertrendMinimumScore) || Number(candidate.countertrendMinimumScore) < 1 || Number(candidate.countertrendMinimumScore) > 100) errors.push('Countertrend minimum score must be from 1 to 100.');
  if (!Number.isFinite(candidate.riskPercent) || Number(candidate.riskPercent) <= 0 || Number(candidate.riskPercent) > 2) errors.push('Risk must be greater than 0 and no more than 2%.');
  if (!Number.isFinite(candidate.maximumRiskPercent) || Number(candidate.maximumRiskPercent) <= 0 || Number(candidate.maximumRiskPercent) > 2) errors.push('Maximum risk must be greater than 0 and no more than 2%.');
  if (Number(candidate.riskPercent) > Number(candidate.maximumRiskPercent)) errors.push('Default risk cannot exceed maximum risk.');
  if (!Number.isFinite(candidate.minimumRewardRisk) || Number(candidate.minimumRewardRisk) < 0.1 || Number(candidate.minimumRewardRisk) > 10) errors.push('Minimum reward/risk must be between 0.1 and 10.');
  if (!Number.isFinite(candidate.poiAtrTolerance) || Number(candidate.poiAtrTolerance) <= 0 || Number(candidate.poiAtrTolerance) > 5) errors.push('POI ATR tolerance must be greater than 0 and no more than 5.');
  if (!Number.isInteger(candidate.swingLookback) || Number(candidate.swingLookback) < 20 || Number(candidate.swingLookback) > 500) errors.push('Swing lookback must be from 20 to 500 candles.');
  if (!Number.isFinite(candidate.slBufferAtr) || Number(candidate.slBufferAtr) < 0 || Number(candidate.slBufferAtr) > 2) errors.push('Stop buffer must be from 0 to 2 ATR.');
  if (!Array.isArray(candidate.allowedSymbols) || !candidate.allowedSymbols.length) errors.push('At least one symbol must be allowed.');
  if (candidate.poiWeights && Object.values(candidate.poiWeights).some(value => !Number.isFinite(value) || value < 0 || value > 100)) errors.push('POI weights must be from 0 to 100.');
  if (candidate.conditionWeights && Object.values(candidate.conditionWeights).some(value => !Number.isFinite(value) || value < 0 || value > 100)) errors.push('Condition weights must be from 0 to 100.');
  const validModes = ['REQUIRED', 'OPTIONAL', 'DISABLED'];
  if (candidate.conditions && Object.values(candidate.conditions).some(mode => !validModes.includes(mode))) errors.push('A condition mode is invalid.');
  if (candidate.poiModes && Object.values(candidate.poiModes).some(mode => !validModes.includes(mode))) errors.push('A POI mode is invalid.');
  const sessionWindows = candidate.sessionWindowsUtc;
  if (!sessionWindows || [sessionWindows.londonStart, sessionWindows.londonEnd, sessionWindows.newYorkStart, sessionWindows.newYorkEnd].some(value => !Number.isInteger(value) || value < 0 || value > 24)
    || sessionWindows.londonStart >= sessionWindows.londonEnd || sessionWindows.newYorkStart >= sessionWindows.newYorkEnd) errors.push('Session hours must use valid UTC start/end ranges.');
  if (candidate.maximumConfidence !== 80) errors.push('Customer confidence maximum is locked to 80.');
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    config: {
      ...DEFAULT_STRATEGY_CONFIG,
      ...candidate,
      maximumConfidence: 80,
      version: Math.max(1, Math.round(Number(candidate.version) || 1)),
      timeframes: timeframes.map(item => ({ ...item, timeframe: item.timeframe.toUpperCase() })),
      allowedSymbols: [...new Set(candidate.allowedSymbols.map(symbol => String(symbol).toUpperCase().trim()).filter(Boolean))],
      conditions: { ...DEFAULT_STRATEGY_CONFIG.conditions, ...(candidate.conditions || {}) },
      poiModes: { ...DEFAULT_STRATEGY_CONFIG.poiModes, ...(candidate.poiModes || {}) },
      sessionWindowsUtc: { ...DEFAULT_STRATEGY_CONFIG.sessionWindowsUtc, ...(candidate.sessionWindowsUtc || {}) },
      poiWeights: { ...DEFAULT_STRATEGY_CONFIG.poiWeights, ...(candidate.poiWeights || {}) },
      conditionWeights: { ...DEFAULT_STRATEGY_CONFIG.conditionWeights, ...(candidate.conditionWeights || {}) },
    },
  };
}
