/**
 * VOLATILITY PROFILE — Raw movement data per pair on H4
 * No strategy logic. Just measuring how much each pair actually moves.
 * Compares forex to metals (XAUUSD/XAGUSD).
 */

import * as fs from 'fs';

interface RawCandle {
  time: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

function loadM5Cache(pair: string): RawCandle[] {
  const cachePath = `.cache/${pair}_5min_6m.json`;
  if (!fs.existsSync(cachePath)) return [];
  const raw = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
  const data = Array.isArray(raw) ? raw : raw.value || [];
  return data.map((c: any) => ({
    time: new Date(c.timestamp || c.time),
    open: c.open, high: c.high, low: c.low, close: c.close,
    volume: c.volume || 0,
  }));
}

function aggregateToH4(m5Candles: RawCandle[]): RawCandle[] {
  if (m5Candles.length === 0) return [];
  const h4Map = new Map<string, RawCandle>();
  for (const c of m5Candles) {
    const h = c.time.getUTCHours();
    const h4Hour = Math.floor(h / 4) * 4;
    const bucketKey = `${c.time.getUTCFullYear()}-${c.time.getUTCMonth()}-${c.time.getUTCDate()}-${h4Hour}`;
    if (!h4Map.has(bucketKey)) {
      h4Map.set(bucketKey, {
        time: new Date(Date.UTC(c.time.getUTCFullYear(), c.time.getUTCMonth(), c.time.getUTCDate(), h4Hour, 0, 0)),
        open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume,
      });
    } else {
      const existing = h4Map.get(bucketKey)!;
      existing.high = Math.max(existing.high, c.high);
      existing.low = Math.min(existing.low, c.low);
      existing.close = c.close;
      existing.volume += c.volume;
    }
  }
  return Array.from(h4Map.values()).sort((a, b) => a.time.getTime() - b.time.getTime());
}

function getPipMultiplier(pair: string): number {
  if (pair === 'XAUUSD') return 0.01;   // gold: 1 pip = $0.01
  if (pair === 'XAGUSD') return 0.001;  // silver: 1 pip = $0.001
  if (pair.includes('JPY')) return 0.01;
  return 0.0001;
}

function atr(candles: RawCandle[], period: number = 14): number[] {
  const result: number[] = [];
  let trSum = 0;
  for (let i = 0; i < candles.length; i++) {
    const tr = i === 0 ? candles[i].high - candles[i].low :
      Math.max(candles[i].high - candles[i].low, Math.abs(candles[i].high - candles[i - 1].close), Math.abs(candles[i].low - candles[i - 1].close));
    trSum += tr;
    if (i < period - 1) result.push(0);
    else if (i === period - 1) result.push(trSum / period);
    else result.push((result[i - 1] * (period - 1) + tr) / period);
  }
  return result;
}

// ===== ALL PAIRS =====
const FOREX_PAIRS = [
  'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'USDCAD',
  'AUDUSD', 'NZDUSD', 'EURGBP', 'EURJPY', 'GBPJPY',
  'AUDJPY', 'CADJPY', 'CHFJPY', 'NZDJPY', 'EURAUD'
];
const METALS_PAIRS = ['XAUUSD', 'XAGUSD'];
const ALL_PAIRS = [...FOREX_PAIRS, ...METALS_PAIRS];

// Expected: 6 months ≈ 180 trading days ≈ 180 * 6 = 1080 H4 candles
// Minimum acceptable: 900 H4 candles (~150 days)
const MIN_H4_CANDLES = 900;

console.log('===================================================================');
console.log('VOLATILITY PROFILE: H4 MOVEMENT DATA');
console.log('===================================================================');
console.log('No strategy logic. Just raw movement measurement.');
console.log('===================================================================\n');

// ===== DATA COVERAGE CHECK =====
console.log('--- DATA COVERAGE CHECK ---\n');

interface PairVolData {
  pair: string;
  category: string;
  m5Count: number;
  h4Count: number;
  tradingDays: number;
  dataOk: boolean;
  dateRange: string;
  avgH4RangePips: number;
  avgDailyRangePips: number;
  avgATR14Pips: number;
  candlesOver30Pips: number;
  pctOver30Pips: number;
  maxH4RangePips: number;
  medianH4RangePips: number;
}

const allData: PairVolData[] = [];

for (const pair of ALL_PAIRS) {
  const m5 = loadM5Cache(pair);
  if (m5.length === 0) {
    console.log(`  ${pair}: NO DATA`);
    continue;
  }
  
  const h4 = aggregateToH4(m5);
  const tradingDays = m5.length / 288; // 288 M5 candles per trading day
  const dataOk = h4.length >= MIN_H4_CANDLES;
  const dateRange = `${h4[0].time.toISOString().split('T')[0]} to ${h4[h4.length - 1].time.toISOString().split('T')[0]}`;
  
  const status = dataOk ? '✅' : '❌';
  console.log(`  ${pair.padEnd(10)} ${status} M5: ${String(m5.length).padStart(6)} | H4: ${String(h4.length).padStart(5)} | Days: ${tradingDays.toFixed(0).padStart(3)} | ${dateRange}`);
  
  // ===== VOLATILITY MEASUREMENTS =====
  const pipMult = getPipMultiplier(pair);
  const atrValues = atr(h4, 14);
  
  // 1. Average H4 candle range (high - low) in pips
  const h4Ranges: number[] = h4.map(c => (c.high - c.low) / pipMult);
  const avgH4Range = h4Ranges.reduce((a, b) => a + b, 0) / h4Ranges.length;
  const maxH4Range = Math.max(...h4Ranges);
  
  // Median H4 range
  const sortedRanges = [...h4Ranges].sort((a, b) => a - b);
  const medianH4Range = sortedRanges[Math.floor(sortedRanges.length / 2)];
  
  // 2. Average daily range (group H4 candles by day, sum ranges)
  const dailyMap = new Map<string, { high: number; low: number }>();
  for (const c of h4) {
    const dayKey = `${c.time.getUTCFullYear()}-${c.time.getUTCMonth()}-${c.time.getUTCDate()}`;
    if (!dailyMap.has(dayKey)) {
      dailyMap.set(dayKey, { high: c.high, low: c.low });
    } else {
      const d = dailyMap.get(dayKey)!;
      d.high = Math.max(d.high, c.high);
      d.low = Math.min(d.low, c.low);
    }
  }
  const dailyRanges = Array.from(dailyMap.values()).map(d => (d.high - d.low) / pipMult);
  const avgDailyRange = dailyRanges.length > 0 ? dailyRanges.reduce((a, b) => a + b, 0) / dailyRanges.length : 0;
  
  // 3. Average ATR(14) in pips (skip warmup period)
  const atrSlice = atrValues.filter(v => v > 0);
  const avgATR = atrSlice.length > 0 ? atrSlice.reduce((a, b) => a + b, 0) / atrSlice.length : 0;
  const avgATRPips = avgATR / pipMult;
  
  // 4. Count of H4 candles with range > 30 pips
  const over30 = h4Ranges.filter(r => r > 30);
  const pctOver30 = (over30.length / h4Ranges.length) * 100;
  
  const category = METALS_PAIRS.includes(pair) ? 'METAL' : 'FOREX';
  
  allData.push({
    pair, category, m5Count: m5.length, h4Count: h4.length,
    tradingDays, dataOk, dateRange,
    avgH4RangePips: avgH4Range,
    avgDailyRangePips: avgDailyRange,
    avgATR14Pips: avgATRPips,
    candlesOver30Pips: over30.length,
    pctOver30Pips: pctOver30,
    maxH4RangePips: maxH4Range,
    medianH4RangePips: medianH4Range,
  });
}

// ===== RANKED TABLE =====
console.log('\n\n===================================================================');
console.log('VOLATILITY RANKING (by Average ATR14, highest to lowest)');
console.log('===================================================================\n');

// Separate forex and metals for ranking
const forexData = allData.filter(d => d.category === 'FOREX' && d.dataOk).sort((a, b) => b.avgATR14Pips - a.avgATR14Pips);
const metalsData = allData.filter(d => d.category === 'METAL' && d.dataOk).sort((a, b) => b.avgATR14Pips - a.avgATR14Pips);
const shortData = allData.filter(d => !d.dataOk);

// Print header
console.log('  Rank | Pair       | Avg H4 Range | Avg Daily | Avg ATR(14) | >30pip Candles | Max H4    | Median H4');
console.log('  -----+------------+--------------+-----------+-------------+----------------+-----------+----------');

let rank = 1;

// Metals first (for reference)
for (const d of metalsData) {
  console.log(`  ${String(rank).padStart(4)} | ${d.pair.padEnd(10)} | ${d.avgH4RangePips.toFixed(1).padStart(9)}p | ${d.avgDailyRangePips.toFixed(1).padStart(7)}p | ${d.avgATR14Pips.toFixed(1).padStart(8)}p | ${String(d.candlesOver30Pips).padStart(5)} (${d.pctOver30Pips.toFixed(1).padStart(4)}%) | ${d.maxH4RangePips.toFixed(1).padStart(7)}p | ${d.medianH4RangePips.toFixed(1).padStart(7)}p`);
  rank++;
}

console.log('  -----+------------+--------------+-----------+-------------+----------------+-----------+----------');

// Forex ranked
for (const d of forexData) {
  console.log(`  ${String(rank).padStart(4)} | ${d.pair.padEnd(10)} | ${d.avgH4RangePips.toFixed(1).padStart(9)}p | ${d.avgDailyRangePips.toFixed(1).padStart(7)}p | ${d.avgATR14Pips.toFixed(1).padStart(8)}p | ${String(d.candlesOver30Pips).padStart(5)} (${d.pctOver30Pips.toFixed(1).padStart(4)}%) | ${d.maxH4RangePips.toFixed(1).padStart(7)}p | ${d.medianH4RangePips.toFixed(1).padStart(7)}p`);
  rank++;
}

// ===== DATA COVERAGE ISSUES =====
if (shortData.length > 0) {
  console.log('\n\n===================================================================');
  console.log('⚠️  DATA COVERAGE ISSUES (pairs with < 150 days of data)');
  console.log('===================================================================\n');
  for (const d of shortData) {
    console.log(`  ${d.pair.padEnd(10)}: ${d.h4Count} H4 candles = ${d.tradingDays.toFixed(0)} trading days (need ${MIN_H4_CANDLES}+ H4 / 150+ days)`);
    console.log(`    Range: ${d.dateRange}`);
  }
  console.log(`\n  These pairs were excluded from the volatility ranking.`);
  console.log(`  Their data covers only ~17 days, not 6 months.`);
}

// ===== COMPARISON SUMMARY =====
console.log('\n\n===================================================================');
console.log('FOREX vs METALS COMPARISON');
console.log('===================================================================\n');

if (metalsData.length > 0 && forexData.length > 0) {
  const metalsAvgATR = metalsData.reduce((s, d) => s + d.avgATR14Pips, 0) / metalsData.length;
  const forexAvgATR = forexData.reduce((s, d) => s + d.avgATR14Pips, 0) / forexData.length;
  const forexTop3AvgATR = forexData.slice(0, 3).reduce((s, d) => s + d.avgATR14Pips, 0) / Math.min(3, forexData.length);
  
  const metalsAvgDaily = metalsData.reduce((s, d) => s + d.avgDailyRangePips, 0) / metalsData.length;
  const forexAvgDaily = forexData.reduce((s, d) => s + d.avgDailyRangePips, 0) / forexData.length;
  const forexTop3AvgDaily = forexData.slice(0, 3).reduce((s, d) => s + d.avgDailyRangePips, 0) / Math.min(3, forexData.length);
  
  console.log(`  Metric              | Metals Avg    | Forex Avg     | Forex Top 3   | Ratio (Metals/Forex)`);
  console.log(`  --------------------+---------------+---------------+---------------+---------------------`);
  console.log(`  Avg ATR(14)         | ${metalsAvgATR.toFixed(1).padStart(10)}p | ${forexAvgATR.toFixed(1).padStart(10)}p | ${forexTop3AvgATR.toFixed(1).padStart(10)}p | ${(metalsAvgATR / forexAvgATR).toFixed(1).padStart(5)}x`);
  console.log(`  Avg Daily Range     | ${metalsAvgDaily.toFixed(1).padStart(10)}p | ${forexAvgDaily.toFixed(1).padStart(10)}p | ${forexTop3AvgDaily.toFixed(1).padStart(10)}p | ${(metalsAvgDaily / forexAvgDaily).toFixed(1).padStart(5)}x`);
  
  // Most volatile forex pair vs metals
  const topForex = forexData[0];
  console.log(`\n  Most volatile forex: ${topForex.pair} (ATR: ${topForex.avgATR14Pips.toFixed(1)}p)`);
  console.log(`  vs XAUUSD:           ATR: ${metalsData.find(d => d.pair === 'XAUUSD')?.avgATR14Pips.toFixed(1) || 'N/A'}p`);
  console.log(`  Ratio:               XAUUSD moves ${(metalsData.find(d => d.pair === 'XAUUSD')?.avgATR14Pips || 0) / topForex.avgATR14Pips | 0}x more than ${topForex.pair}`);
  
  // How many >30 pip candles
  const metalsOver30 = metalsData.reduce((s, d) => s + d.candlesOver30Pips, 0);
  const metalsTotal = metalsData.reduce((s, d) => s + d.h4Count, 0);
  const forexOver30 = forexData.reduce((s, d) => s + d.candlesOver30Pips, 0);
  const forexTotal = forexData.reduce((s, d) => s + d.h4Count, 0);
  
  console.log(`\n  Candles > 30 pips:`);
  console.log(`    Metals: ${metalsOver30} / ${metalsTotal} (${(metalsOver30 / metalsTotal * 100).toFixed(1)}%)`);
  console.log(`    Forex:  ${forexOver30} / ${forexTotal} (${(forexOver30 / forexTotal * 100).toFixed(1)}%)`);
}

// ===== KEY QUESTION =====
console.log('\n\n===================================================================');
console.log('KEY FINDINGS');
console.log('===================================================================\n');

if (forexData.length > 0) {
  const top3 = forexData.slice(0, 3);
  const bottom3 = forexData.slice(-3);
  
  console.log(`  Top 3 most volatile forex pairs:`);
  for (const d of top3) {
    console.log(`    ${d.pair}: ATR ${d.avgATR14Pips.toFixed(1)}p, daily range ${d.avgDailyRangePips.toFixed(1)}p, ${d.candlesOver30Pips} candles >30p (${d.pctOver30Pips.toFixed(1)}%)`);
  }
  
  console.log(`\n  Bottom 3 least volatile forex pairs:`);
  for (const d of bottom3) {
    console.log(`    ${d.pair}: ATR ${d.avgATR14Pips.toFixed(1)}p, daily range ${d.avgDailyRangePips.toFixed(1)}p, ${d.candlesOver30Pips} candles >30p (${d.pctOver30Pips.toFixed(1)}%)`);
  }
  
  // Is there a meaningful gap between top and bottom?
  const topATR = top3[0].avgATR14Pips;
  const bottomATR = bottom3[bottom3.length - 1].avgATR14Pips;
  const ratio = topATR / bottomATR;
  
  console.log(`\n  Volatility spread: ${top3[0].pair} (${topATR.toFixed(1)}p) vs ${bottom3[bottom3.length - 1].pair} (${bottomATR.toFixed(1)}p)`);
  console.log(`  Ratio: ${ratio.toFixed(2)}x`);
  
  if (ratio > 2.0) {
    console.log(`  → Significant volatility difference. Top pairs move ${ratio.toFixed(1)}x more than bottom pairs.`);
    console.log(`  → If testing further, focus on: ${top3.map(d => d.pair).join(', ')}`);
  } else {
    console.log(`  → All forex pairs are similarly volatile (within ${ratio.toFixed(1)}x of each other).`);
    console.log(`  → No pair stands out as meaningfully more volatile.`);
  }
  
  // Compare to metals
  if (metalsData.length > 0) {
    const xauATR = metalsData.find(d => d.pair === 'XAUUSD')?.avgATR14Pips || 0;
    console.log(`\n  vs Metals: XAUUSD ATR = ${xauATR.toFixed(1)}p`);
    console.log(`  ${top3[0].pair} (top forex) = ${topATR.toFixed(1)}p`);
    console.log(`  XAUUSD moves ${(xauATR / topATR).toFixed(1)}x more than the most volatile forex pair.`);
  }
}

console.log('\n===================================================================');
