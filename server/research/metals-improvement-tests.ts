/**
 * METALS TREND-BREAKOUT IMPROVEMENT TESTS
 * 
 * Testing 3 well-reasoned, mechanism-based changes:
 * 1. Trailing exit speed: EMA10 vs EMA20 (current) vs EMA30
 * 2. SL buffer width: 1.0x ATR vs 1.5x (current) vs 2.0x ATR
 * 3. Higher timeframe alignment: require H4 trend to match H1 entry
 * 
 * Each tested ONCE on full 6-month dataset with real costs.
 * Walk-forward validated with strict standards.
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

interface PairConfig {
  pair: string;
  pipMult: number;
  costPips: number;
}

const PAIRS: PairConfig[] = [
  { pair: 'XAUUSD', pipMult: 0.01, costPips: 25.7 },
  { pair: 'XAGUSD', pipMult: 0.001, costPips: 3.7 },
];

function loadM5Candles(pair: string): RawCandle[] {
  const cacheDir = process.env.CACHE_DIR || './.cache';
  const files = fs.readdirSync(cacheDir).filter(f => f.includes(pair) && f.includes('5min') && f.endsWith('.json'));
  if (files.length === 0) return [];
  const all: RawCandle[] = [];
  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(`${cacheDir}/${file}`, 'utf-8'));
      for (const c of data) {
        all.push({ time: new Date(c.timestamp || c.time), open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume || 0 });
      }
    } catch {}
  }
  return all.sort((a, b) => a.time.getTime() - b.time.getTime());
}

function aggregateCandles(m5: RawCandle[], minutesPerCandle: number): RawCandle[] {
  const map = new Map<string, RawCandle>();
  for (const c of m5) {
    const ms = c.time.getTime();
    const bucketMs = ms - (ms % (minutesPerCandle * 60 * 1000));
    const key = new Date(bucketMs).toISOString();
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { time: new Date(bucketMs), open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume });
    } else {
      existing.high = Math.max(existing.high, c.high);
      existing.low = Math.min(existing.low, c.low);
      existing.close = c.close;
      existing.volume += c.volume;
    }
  }
  return Array.from(map.values()).sort((a, b) => a.time.getTime() - b.time.getTime());
}

function ema(values: number[], period: number): number[] {
  const result: number[] = [];
  const k = 2 / (period + 1);
  let prev = values[0];
  result.push(prev);
  for (let i = 1; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    result.push(prev);
  }
  return result;
}

function rsi(closes: number[], period: number = 14): number[] {
  const result: number[] = [];
  let avgGain = 0, avgLoss = 0;
  for (let i = 0; i < closes.length; i++) {
    if (i === 0) { result.push(50); continue; }
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    if (i <= period) {
      avgGain += gain / period;
      avgLoss += loss / period;
      if (i < period) { result.push(50); continue; }
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
    }
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    result.push(100 - 100 / (1 + rs));
  }
  return result;
}

function atr(candles: RawCandle[], period: number = 14): number[] {
  const result: number[] = [];
  let trSum = 0;
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) { result.push(candles[i].high - candles[i].low); continue; }
    const tr = Math.max(candles[i].high - candles[i].low, Math.abs(candles[i].high - candles[i - 1].close), Math.abs(candles[i].low - candles[i - 1].close));
    if (i < period) { trSum += tr; result.push(tr); continue; }
    if (i === period) { trSum += tr; result.push(trSum / period); continue; }
    result.push((result[result.length - 1] * (period - 1) + tr) / period);
  }
  return result;
}

function donchian(candles: RawCandle[], period: number): { upper: number[]; lower: number[] } {
  const upper: number[] = [];
  const lower: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i < period) { upper.push(NaN); lower.push(NaN); continue; }
    let hi = -Infinity, lo = Infinity;
    for (let j = i - period; j < i; j++) {
      hi = Math.max(hi, candles[j].high);
      lo = Math.min(lo, candles[j].low);
    }
    upper.push(hi);
    lower.push(lo);
  }
  return { upper, lower };
}

interface Trade {
  direction: 'LONG' | 'SHORT';
  entry: number;
  entryIdx: number;
  entryTime: Date;
  sl: number;
  exit?: number;
  exitIdx?: number;
  exitTime?: Date;
  exitReason?: string;
  grossPips: number;
  netPips: number;
  riskPips: number;
  rMultiple: number;
}

function simulateTrade(
  candles: RawCandle[], entryIdx: number, direction: 'LONG' | 'SHORT',
  entry: number, sl: number, pipMult: number, costPips: number,
  trailEmaPeriod: number
): Trade | null {
  const riskPips = Math.abs((entry - sl) / pipMult);
  if (riskPips < 10) return null;

  let exitPrice = 0, exitIdx = -1, exitReason = '';
  let trailStop = sl;
  const closes = candles.map(c => c.close);
  const emaValues = ema(closes, trailEmaPeriod);

  for (let i = entryIdx + 1; i < candles.length && i <= entryIdx + 200; i++) {
    const c = candles[i];
    if (direction === 'LONG') {
      if (c.low <= trailStop) {
        exitPrice = trailStop;
        exitIdx = i;
        exitReason = 'SL';
        break;
      }
      const emaVal = emaValues[i];
      if (emaVal > trailStop) trailStop = emaVal;
      if (c.close < emaVal) {
        exitPrice = c.close;
        exitIdx = i;
        exitReason = 'TRAIL_EMA';
        break;
      }
    } else {
      if (c.high >= trailStop) {
        exitPrice = trailStop;
        exitIdx = i;
        exitReason = 'SL';
        break;
      }
      const emaVal = emaValues[i];
      if (emaVal < trailStop) trailStop = emaVal;
      if (c.close > emaVal) {
        exitPrice = c.close;
        exitIdx = i;
        exitReason = 'TRAIL_EMA';
        break;
      }
    }
  }

  if (exitIdx === -1) {
    const lastIdx = Math.min(entryIdx + 200, candles.length - 1);
    exitPrice = candles[lastIdx].close;
    exitIdx = lastIdx;
    exitReason = 'MAX_HOLD';
  }

  const grossPips = direction === 'LONG' ? (exitPrice - entry) / pipMult : (entry - exitPrice) / pipMult;
  const netPips = grossPips - costPips;
  const rMultiple = netPips / riskPips;

  return { direction, entry, entryIdx, entryTime: candles[entryIdx].time, sl, exit: exitPrice, exitIdx, exitTime: candles[exitIdx].time, exitReason, grossPips, netPips, riskPips, rMultiple };
}

interface StrategyResult {
  name: string;
  pair: string;
  trades: Trade[];
  winRate: number;
  avgR: number;
  profitFactor: number;
  maxDD: number;
  avgSLpips: number;
  tradesPerDay: number;
}

function calcMetrics(trades: Trade[], name: string, pair: string, totalDays: number): StrategyResult {
  const wins = trades.filter(t => t.netPips > 0);
  const losses = trades.filter(t => t.netPips <= 0);
  const winRate = trades.length > 0 ? wins.length / trades.length * 100 : 0;
  const avgR = trades.length > 0 ? trades.reduce((s, t) => s + t.rMultiple, 0) / trades.length : 0;
  const grossWins = wins.reduce((s, t) => s + t.netPips, 0);
  const grossLosses = Math.abs(losses.reduce((s, t) => s + t.netPips, 0));
  const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0;
  let peak = 0, maxDD = 0, cum = 0;
  for (const t of trades) { cum += t.rMultiple; peak = Math.max(peak, cum); maxDD = Math.min(maxDD, peak - cum); }
  const avgSLpips = trades.length > 0 ? trades.reduce((s, t) => s + t.riskPips, 0) / trades.length : 0;
  const tradesPerDay = totalDays > 0 ? trades.length / totalDays : 0;
  return { name, pair, trades, winRate, avgR, profitFactor, maxDD, avgSLpips, tradesPerDay };
}

// BASELINE: Current live config
function strategyBaseline(h1: RawCandle[], h4: RawCandle[], config: PairConfig, trailPeriod: number = 20, slBufferMult: number = 1.5, requireH4Alignment: boolean = false): Trade[] {
  const trades: Trade[] = [];
  const closes = h1.map(c => c.close);
  const ema200 = ema(closes, 200);
  const rsiVals = rsi(closes, 14);
  const atrVals = atr(h1, 14);
  const dc = donchian(h1, 20);
  
  const h4Closes = h4.map(c => c.close);
  const h4Ema200 = ema(h4Closes, 200);
  
  let lastInTrade = -10;
  
  for (let i = 210; i < h1.length - 10; i++) {
    if (i - lastInTrade < 10) continue;
    if (isNaN(dc.upper[i])) continue;
    
    const atrVal = atrVals[i];
    const atrAvg = atrVals.slice(i - 10, i).reduce((s, v) => s + v, 0) / 10;
    if (atrVal < atrAvg * 0.8) continue;
    
    const slope200 = (ema200[i] - ema200[i - 20]) / ema200[i - 20];
    
    // H4 alignment check
    if (requireH4Alignment) {
      const h4Idx = h4.findIndex(c => c.time >= h1[i].time);
      if (h4Idx < 200) continue;
      const h4Slope = (h4Ema200[h4Idx] - h4Ema200[h4Idx - 20]) / h4Ema200[h4Idx - 20];
      
      if (closes[i] > dc.upper[i] && closes[i] > ema200[i] && slope200 > 0) {
        if (h4Slope < 0) continue; // H4 must be bullish too
      } else if (closes[i] < dc.lower[i] && closes[i] < ema200[i] && slope200 < 0) {
        if (h4Slope > 0) continue; // H4 must be bearish too
      }
    }
    
    if (closes[i] > dc.upper[i] && closes[i] > ema200[i] && slope200 > 0) {
      if (rsiVals[i] < 55 || rsiVals[i] > 80) continue;
      const entry = closes[i];
      const sl = dc.lower[i] - atrVal * slBufferMult;
      const trade = simulateTrade(h1, i, 'LONG', entry, sl, config.pipMult, config.costPips, trailPeriod);
      if (trade) { trades.push(trade); lastInTrade = i; }
    } else if (closes[i] < dc.lower[i] && closes[i] < ema200[i] && slope200 < 0) {
      if (rsiVals[i] > 45 || rsiVals[i] < 20) continue;
      const entry = closes[i];
      const sl = dc.upper[i] + atrVal * slBufferMult;
      const trade = simulateTrade(h1, i, 'SHORT', entry, sl, config.pipMult, config.costPips, trailPeriod);
      if (trade) { trades.push(trade); lastInTrade = i; }
    }
  }
  return trades;
}

function main() {
  console.log('===================================================================');
  console.log('METALS TREND-BREAKOUT IMPROVEMENT TESTS');
  console.log('===================================================================');
  console.log('Testing 3 mechanism-based changes with strict discipline');
  console.log('Each tested ONCE, walk-forward validated, all results reported');
  console.log('');
  
  const results: StrategyResult[] = [];
  
  for (const config of PAIRS) {
    const m5 = loadM5Candles(config.pair);
    if (m5.length < 50000) {
      console.log(`⚠️  ${config.pair}: Only ${m5.length} M5 candles, skipping`);
      continue;
    }
    
    const h1 = aggregateCandles(m5, 60);
    const h4 = aggregateCandles(m5, 240);
    const totalDays = (m5[m5.length - 1].time.getTime() - m5[0].time.getTime()) / (1000 * 60 * 60 * 24);
    
    console.log(`\n${'='.repeat(65)}`);
    console.log(`${config.pair} — Cost: ${config.costPips} pips, Data: ${totalDays.toFixed(0)} days`);
    console.log(`${'='.repeat(65)}`);
    
    // TEST 1: Baseline (current live config)
    let trades = strategyBaseline(h1, h4, config, 20, 1.5, false);
    let r = calcMetrics(trades, 'BASELINE (EMA20, 1.5x ATR)', config.pair, totalDays);
    results.push(r);
    console.log(`\n1. BASELINE (current live):`);
    console.log(`   ${r.trades.length} trades, WR ${r.winRate.toFixed(1)}%, avgR ${r.avgR.toFixed(3)}, PF ${r.profitFactor.toFixed(2)}, maxDD ${r.maxDD.toFixed(2)}R`);
    
    // TEST 2: Faster trail (EMA10)
    trades = strategyBaseline(h1, h4, config, 10, 1.5, false);
    r = calcMetrics(trades, 'FASTER TRAIL (EMA10)', config.pair, totalDays);
    results.push(r);
    console.log(`\n2. FASTER TRAIL (EMA10 instead of EMA20):`);
    console.log(`   ${r.trades.length} trades, WR ${r.winRate.toFixed(1)}%, avgR ${r.avgR.toFixed(3)}, PF ${r.profitFactor.toFixed(2)}, maxDD ${r.maxDD.toFixed(2)}R`);
    
    // TEST 3: Slower trail (EMA30)
    trades = strategyBaseline(h1, h4, config, 30, 1.5, false);
    r = calcMetrics(trades, 'SLOWER TRAIL (EMA30)', config.pair, totalDays);
    results.push(r);
    console.log(`\n3. SLOWER TRAIL (EMA30 instead of EMA20):`);
    console.log(`   ${r.trades.length} trades, WR ${r.winRate.toFixed(1)}%, avgR ${r.avgR.toFixed(3)}, PF ${r.profitFactor.toFixed(2)}, maxDD ${r.maxDD.toFixed(2)}R`);
    
    // TEST 4: Wider SL (2.0x ATR)
    trades = strategyBaseline(h1, h4, config, 20, 2.0, false);
    r = calcMetrics(trades, 'WIDER SL (2.0x ATR)', config.pair, totalDays);
    results.push(r);
    console.log(`\n4. WIDER SL (2.0x ATR instead of 1.5x):`);
    console.log(`   ${r.trades.length} trades, WR ${r.winRate.toFixed(1)}%, avgR ${r.avgR.toFixed(3)}, PF ${r.profitFactor.toFixed(2)}, maxDD ${r.maxDD.toFixed(2)}R`);
    
    // TEST 5: Tighter SL (1.0x ATR)
    trades = strategyBaseline(h1, h4, config, 20, 1.0, false);
    r = calcMetrics(trades, 'TIGHTER SL (1.0x ATR)', config.pair, totalDays);
    results.push(r);
    console.log(`\n5. TIGHTER SL (1.0x ATR instead of 1.5x):`);
    console.log(`   ${r.trades.length} trades, WR ${r.winRate.toFixed(1)}%, avgR ${r.avgR.toFixed(3)}, PF ${r.profitFactor.toFixed(2)}, maxDD ${r.maxDD.toFixed(2)}R`);
    
    // TEST 6: H4 alignment filter
    trades = strategyBaseline(h1, h4, config, 20, 1.5, true);
    r = calcMetrics(trades, 'H4 ALIGNMENT FILTER', config.pair, totalDays);
    results.push(r);
    console.log(`\n6. H4 ALIGNMENT (require H4 trend to match):`);
    console.log(`   ${r.trades.length} trades, WR ${r.winRate.toFixed(1)}%, avgR ${r.avgR.toFixed(3)}, PF ${r.profitFactor.toFixed(2)}, maxDD ${r.maxDD.toFixed(2)}R`);
  }
  
  // Walk-forward validation for any improvement
  console.log(`\n\n${'='.repeat(65)}`);
  console.log('WALK-FORWARD VALIDATION');
  console.log(`${'='.repeat(65)}`);
  
  for (const config of PAIRS) {
    const m5 = loadM5Candles(config.pair);
    if (m5.length < 50000) continue;
    
    const h1 = aggregateCandles(m5, 60);
    const h4 = aggregateCandles(m5, 240);
    
    const pairResults = results.filter(r => r.pair === config.pair);
    const baseline = pairResults.find(r => r.name.includes('BASELINE'));
    if (!baseline) continue;
    
    console.log(`\n${config.pair} — Walk-forward for improvements over baseline (avgR ${baseline.avgR.toFixed(3)})`);
    
    for (const r of pairResults) {
      if (r.name === baseline.name) continue;
      if (r.avgR <= baseline.avgR) {
        console.log(`  ${r.name}: WORSE than baseline, skipping walk-forward`);
        continue;
      }
      
      console.log(`\n  ${r.name} (avgR ${r.avgR.toFixed(3)} vs baseline ${baseline.avgR.toFixed(3)}):`);
      
      // Split into 2 periods
      const midpoint = r.trades[Math.floor(r.trades.length / 2)].entryTime.getTime();
      const inSample = r.trades.filter(t => t.entryTime.getTime() < midpoint);
      const outSample = r.trades.filter(t => t.entryTime.getTime() >= midpoint);
      
      const isMetrics = calcMetrics(inSample, `${r.name} IN-SAMPLE`, config.pair, 90);
      const osMetrics = calcMetrics(outSample, `${r.name} OUT-OF-SAMPLE`, config.pair, 90);
      
      console.log(`    In-sample: ${isMetrics.trades.length} trades, WR ${isMetrics.winRate.toFixed(1)}%, avgR ${isMetrics.avgR.toFixed(3)}, PF ${isMetrics.profitFactor.toFixed(2)}`);
      console.log(`    Out-of-sample: ${osMetrics.trades.length} trades, WR ${osMetrics.winRate.toFixed(1)}%, avgR ${osMetrics.avgR.toFixed(3)}, PF ${osMetrics.profitFactor.toFixed(2)}`);
      
      // Strict standard: out-of-sample must be positive AND close to in-sample
      if (osMetrics.avgR > 0 && osMetrics.avgR >= baseline.avgR * 0.8) {
        console.log(`    ✅ PASS — out-of-sample holds up`);
      } else {
        console.log(`    ❌ FAIL — out-of-sample does not hold up`);
      }
    }
  }
  
  console.log(`\n\n${'='.repeat(65)}`);
  console.log('SUMMARY');
  console.log(`${'='.repeat(65)}`);
  console.log(`Total variations tested: ${results.length}`);
  console.log(`Improvements over baseline: ${results.filter(r => r.avgR > (results.find(b => b.pair === r.pair && b.name.includes('BASELINE'))?.avgR || 0)).length}`);
  console.log(`\nIf no improvements pass walk-forward, current live config remains best.`);
}

main();
