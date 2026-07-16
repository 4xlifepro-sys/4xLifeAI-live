import type { Candle } from '../src/types.js';
import * as fs from 'fs';

function loadCacheFile(pair: string): Candle[] {
  const cachePath = `.cache/${pair}_5min_6m.json`;
  if (!fs.existsSync(cachePath)) return [];
  const raw = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
  const data = Array.isArray(raw) ? raw : raw.value || [];
  return data.map((c: any) => ({
    time: new Date(c.timestamp || c.time),
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume || 0,
  }));
}

function ema(values: number[], period: number): number[] {
  const result: number[] = [];
  const k = 2 / (period + 1);
  let emaCurrent = values[0];
  result.push(emaCurrent);
  for (let i = 1; i < values.length; i++) {
    emaCurrent = values[i] * k + emaCurrent * (1 - k);
    result.push(emaCurrent);
  }
  return result;
}

function sma(values: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) { result.push(0); continue; }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += values[j];
    result.push(sum / period);
  }
  return result;
}

function atr(candles: Candle[], period: number = 14): number[] {
  const result: number[] = [];
  let trSum = 0;
  for (let i = 0; i < candles.length; i++) {
    const tr = i === 0
      ? candles[i].high - candles[i].low
      : Math.max(
          candles[i].high - candles[i].low,
          Math.abs(candles[i].high - candles[i - 1].close),
          Math.abs(candles[i].low - candles[i - 1].close)
        );
    trSum += tr;
    if (i < period - 1) { result.push(0); }
    else if (i === period - 1) { result.push(trSum / period); }
    else { result.push((result[i - 1] * (period - 1) + tr) / period); }
  }
  return result;
}

function rsi(closes: number[], period: number = 14): number[] {
  const result: number[] = [];
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period, avgLoss = losses / period;
  result.push(100 - 100 / (1 + avgGain / avgLoss));
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) { avgGain = (avgGain * (period - 1) + diff) / period; avgLoss = (avgLoss * (period - 1)) / period; }
    else { avgGain = (avgGain * (period - 1)) / period; avgLoss = (avgLoss * (period - 1) - diff) / period; }
    result.push(100 - 100 / (1 + avgGain / avgLoss));
  }
  return result;
}

function adx(candles: Candle[], period: number = 14): number[] {
  const result: number[] = [];
  const pdm: number[] = [], ndm: number[] = [], tr: number[] = [];
  
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) { pdm.push(0); ndm.push(0); tr.push(candles[i].high - candles[i].low); continue; }
    const upMove = candles[i].high - candles[i - 1].high;
    const downMove = candles[i - 1].low - candles[i].low;
    pdm.push(upMove > downMove && upMove > 0 ? upMove : 0);
    ndm.push(downMove > upMove && downMove > 0 ? downMove : 0);
    tr.push(Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    ));
  }
  
  // Smoothed averages
  let smoothPDM = 0, smoothNDM = 0, smoothTR = 0;
  for (let i = 0; i < candles.length; i++) {
    if (i < period) { smoothPDM += pdm[i]; smoothNDM += ndm[i]; smoothTR += tr[i]; result.push(0); continue; }
    if (i === period) {
      smoothPDM = smoothPDM; smoothNDM = smoothNDM; smoothTR = smoothTR;
    } else {
      smoothPDM = smoothPDM - smoothPDM / period + pdm[i];
      smoothNDM = smoothNDM - smoothNDM / period + ndm[i];
      smoothTR = smoothTR - smoothTR / period + tr[i];
    }
    const pdi = smoothTR > 0 ? (smoothPDM / smoothTR) * 100 : 0;
    const ndi = smoothTR > 0 ? (smoothNDM / smoothTR) * 100 : 0;
    const dx = (pdi + ndi) > 0 ? Math.abs(pdi - ndi) / (pdi + ndi) * 100 : 0;
    
    if (i < period * 2 - 1) { result.push(0); continue; }
    if (i === period * 2 - 1) {
      let adxSum = 0;
      for (let j = period; j <= i; j++) {
        const p = smoothTR > 0 ? (pdm.slice(0, j+1).reduce((a,b) => a+b, 0) / (tr.slice(0, j+1).reduce((a,b) => a+b, 0) || 1)) * 100 : 0;
        const n = smoothTR > 0 ? (ndm.slice(0, j+1).reduce((a,b) => a+b, 0) / (tr.slice(0, j+1).reduce((a,b) => a+b, 0) || 1)) * 100 : 0;
        adxSum += (p + n) > 0 ? Math.abs(p - n) / (p + n) * 100 : 0;
      }
      result.push(adxSum / period);
      continue;
    }
    const prevAdx = result[i - 1];
    result.push((prevAdx * (period - 1) + dx) / period);
  }
  return result;
}

function getPipMultiplier(pair: string): number {
  if (pair.includes('JPY')) return 0.01;
  return 0.0001;
}

function getBrokerCost(pair: string): number {
  const costs: { [key: string]: number } = {
    'EURUSD': 1.3, 'GBPUSD': 1.6, 'USDJPY': 1.4, 'USDCHF': 1.5, 'USDCAD': 1.4,
    'AUDUSD': 1.5, 'NZDUSD': 1.6, 'EURGBP': 1.7, 'EURJPY': 2.0, 'GBPJPY': 2.2,
    'AUDJPY': 2.0, 'CADJPY': 1.8, 'CHFJPY': 2.1, 'NZDJPY': 2.3, 'EURAUD': 2.0,
  };
  return costs[pair] || 1.5;
}

interface Trade {
  pair: string;
  direction: 'LONG' | 'SHORT';
  entry: number;
  sl: number;
  tp: number;
  exitPrice: number;
  exitReason: string;
  pipsWon: number;
  rMultiple: number;
}

// ===== STRATEGY #49: ADX TREND STRENGTH + EMA CROSSOVER =====
// Only trade when ADX > 25 (strong trend), enter on EMA20/50 cross
function testADXTrend(pair: string, candles: Candle[], brokerCost: number): Trade[] {
  if (candles.length < 200) return [];
  
  const closes = candles.map(c => c.close);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const atrValues = atr(candles, 14);
  const adxValues = adx(candles, 14);
  const pipMult = getPipMultiplier(pair);
  
  const trades: Trade[] = [];
  let lastSignalIdx = -50;
  let lastDirection: 'LONG' | 'SHORT' | null = null;
  
  for (let i = 100; i < candles.length; i++) {
    if (i - lastSignalIdx < 50) continue;
    
    const current = candles[i];
    const atrVal = atrValues[i];
    if (atrVal === 0 || adxValues[i] < 25) continue;
    
    // Bullish: EMA20 crosses above EMA50 + ADX strong
    if (ema20[i] > ema50[i] && ema20[i - 1] <= ema50[i - 1] && lastDirection !== 'LONG') {
      const sl = current.low - atrVal * 1.0;
      const risk = current.close - sl;
      const tp = current.close + risk * 3.0;
      
      const slPips = (risk / pipMult) + brokerCost;
      if (slPips < 8 || slPips > 60) continue;
      
      trades.push({ pair, direction: 'LONG', entry: current.close, sl, tp, exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0 });
      lastSignalIdx = i;
      lastDirection = 'LONG';
    }
    
    // Bearish: EMA20 crosses below EMA50
    if (ema20[i] < ema50[i] && ema20[i - 1] >= ema50[i - 1] && lastDirection !== 'SHORT') {
      const sl = current.high + atrVal * 1.0;
      const risk = sl - current.close;
      const tp = current.close - risk * 3.0;
      
      const slPips = (risk / pipMult) + brokerCost;
      if (slPips < 8 || slPips > 60) continue;
      
      trades.push({ pair, direction: 'SHORT', entry: current.close, sl, tp, exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0 });
      lastSignalIdx = i;
      lastDirection = 'SHORT';
    }
  }
  
  return simulateTrades(trades, candles, pipMult, brokerCost);
}

// ===== STRATEGY #50: BOLLINGER BAND SQUEEZE BREAKOUT =====
// When BB width contracts to minimum then expands, trade the breakout direction
function testBBSqueeze(pair: string, candles: Candle[], brokerCost: number): Trade[] {
  if (candles.length < 100) return [];
  
  const closes = candles.map(c => c.close);
  const sma20 = sma(closes, 20);
  const atrValues = atr(candles, 14);
  const pipMult = getPipMultiplier(pair);
  
  // Calculate BB width
  const bbWidth: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < 20) { bbWidth.push(0); continue; }
    let sumSq = 0;
    for (let j = i - 19; j <= i; j++) sumSq += (closes[j] - sma20[i]) ** 2;
    const std = Math.sqrt(sumSq / 20);
    bbWidth.push((std * 4) / sma20[i] * 100); // width as % of price
  }
  
  const trades: Trade[] = [];
  let lastSignalIdx = -40;
  
  for (let i = 50; i < candles.length; i++) {
    if (i - lastSignalIdx < 40) continue;
    
    const current = candles[i];
    const atrVal = atrValues[i];
    if (atrVal === 0) continue;
    
    // Find if BB was squeezed (narrowest in last 30 bars) then expanding
    let minBB = Infinity;
    for (let j = Math.max(20, i - 30); j < i; j++) {
      minBB = Math.min(minBB, bbWidth[j]);
    }
    
    const isSqueezed = bbWidth[i - 1] <= minBB * 1.05; // was near minimum
    const isExpanding = bbWidth[i] > bbWidth[i - 1] * 1.2; // now expanding 20%+
    
    if (!isSqueezed || !isExpanding) continue;
    
    // Direction: breakout candle
    const bullishBreakout = current.close > sma20[i] && current.close > candles[i - 1].high;
    const bearishBreakout = current.close < sma20[i] && current.close < candles[i - 1].low;
    
    if (bullishBreakout) {
      const sl = current.low - atrVal * 0.8;
      const risk = current.close - sl;
      const tp = current.close + risk * 3.0;
      
      const slPips = (risk / pipMult) + brokerCost;
      if (slPips < 8 || slPips > 60) continue;
      
      trades.push({ pair, direction: 'LONG', entry: current.close, sl, tp, exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0 });
      lastSignalIdx = i;
    } else if (bearishBreakout) {
      const sl = current.high + atrVal * 0.8;
      const risk = sl - current.close;
      const tp = current.close - risk * 3.0;
      
      const slPips = (risk / pipMult) + brokerCost;
      if (slPips < 8 || slPips > 60) continue;
      
      trades.push({ pair, direction: 'SHORT', entry: current.close, sl, tp, exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0 });
      lastSignalIdx = i;
    }
  }
  
  return simulateTrades(trades, candles, pipMult, brokerCost);
}

// ===== STRATEGY #51: MULTI-TIMEFRAME MOMENTUM (H1 direction + M5 entry) =====
// H1 EMA50/200 determines direction, M5 RSI extreme triggers entry
function testMTF_Momentum(pair: string, candles: Candle[], brokerCost: number): Trade[] {
  if (candles.length < 300) return [];
  
  const closes = candles.map(c => c.close);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200); // H1 trend proxy
  const rsiValues = rsi(closes, 14);
  const atrValues = atr(candles, 14);
  const pipMult = getPipMultiplier(pair);
  
  const trades: Trade[] = [];
  let lastSignalIdx = -30;
  
  for (let i = 200; i < candles.length; i++) {
    if (i - lastSignalIdx < 30) continue;
    
    const current = candles[i];
    const atrVal = atrValues[i];
    if (atrVal === 0) continue;
    
    const h1Bullish = ema50[i] > ema200[i];
    const h1Bearish = ema50[i] < ema200[i];
    
    // BUY: H1 bullish + M5 RSI dips below 40 then recovers above 45
    if (h1Bullish && rsiValues[i] > 45 && rsiValues[i - 1] <= 45 && rsiValues[i - 2] < 40) {
      const sl = current.low - atrVal * 1.0;
      const risk = current.close - sl;
      const tp = current.close + risk * 3.0;
      
      const slPips = (risk / pipMult) + brokerCost;
      if (slPips < 8 || slPips > 60) continue;
      
      trades.push({ pair, direction: 'LONG', entry: current.close, sl, tp, exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0 });
      lastSignalIdx = i;
    }
    
    // SELL: H1 bearish + M5 RSI spikes above 60 then drops below 55
    if (h1Bearish && rsiValues[i] < 55 && rsiValues[i - 1] >= 55 && rsiValues[i - 2] > 60) {
      const sl = current.high + atrVal * 1.0;
      const risk = sl - current.close;
      const tp = current.close - risk * 3.0;
      
      const slPips = (risk / pipMult) + brokerCost;
      if (slPips < 8 || slPips > 60) continue;
      
      trades.push({ pair, direction: 'SHORT', entry: current.close, sl, tp, exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0 });
      lastSignalIdx = i;
    }
  }
  
  return simulateTrades(trades, candles, pipMult, brokerCost);
}

// ===== STRATEGY #52: ENVELOPE CHANNEL BREAKOUT =====
// Price breaks above/below a Keltner-style channel (EMA + ATR bands)
function testEnvelopeBreakout(pair: string, candles: Candle[], brokerCost: number): Trade[] {
  if (candles.length < 100) return [];
  
  const closes = candles.map(c => c.close);
  const ema20 = ema(closes, 20);
  const atrValues = atr(candles, 14);
  const pipMult = getPipMultiplier(pair);
  
  const trades: Trade[] = [];
  let lastSignalIdx = -40;
  
  for (let i = 50; i < candles.length; i++) {
    if (i - lastSignalIdx < 40) continue;
    
    const current = candles[i];
    const atrVal = atrValues[i];
    if (atrVal === 0) continue;
    
    const upperBand = ema20[i] + atrVal * 2.0;
    const lowerBand = ema20[i] - atrVal * 2.0;
    
    // Breakout above upper band with strong close
    if (current.close > upperBand && current.close > current.open && 
        (current.close - current.open) > atrVal * 0.3) {
      const sl = ema20[i] - atrVal * 0.5; // SL below midline
      const risk = current.close - sl;
      const tp = current.close + risk * 2.5;
      
      const slPips = (risk / pipMult) + brokerCost;
      if (slPips < 8 || slPips > 60) continue;
      
      trades.push({ pair, direction: 'LONG', entry: current.close, sl, tp, exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0 });
      lastSignalIdx = i;
    }
    
    // Breakout below lower band
    if (current.close < lowerBand && current.close < current.open &&
        (current.open - current.close) > atrVal * 0.3) {
      const sl = ema20[i] + atrVal * 0.5;
      const risk = sl - current.close;
      const tp = current.close - risk * 2.5;
      
      const slPips = (risk / pipMult) + brokerCost;
      if (slPips < 8 || slPips > 60) continue;
      
      trades.push({ pair, direction: 'SHORT', entry: current.close, sl, tp, exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0 });
      lastSignalIdx = i;
    }
  }
  
  return simulateTrades(trades, candles, pipMult, brokerCost);
}

// ===== STRATEGY #53: VOLUME SPIKE + TREND CONTINUATION =====
// Unusual volume spike in trend direction = continuation signal
function testVolumeSpike(pair: string, candles: Candle[], brokerCost: number): Trade[] {
  if (candles.length < 100) return [];
  
  const closes = candles.map(c => c.close);
  const ema50 = ema(closes, 50);
  const atrValues = atr(candles, 14);
  const pipMult = getPipMultiplier(pair);
  
  // Volume average
  const volumes = candles.map(c => c.volume);
  const volAvg: number[] = [];
  for (let i = 0; i < volumes.length; i++) {
    if (i < 20) { volAvg.push(0); continue; }
    let sum = 0;
    for (let j = i - 19; j <= i; j++) sum += volumes[j];
    volAvg.push(sum / 20);
  }
  
  const trades: Trade[] = [];
  let lastSignalIdx = -35;
  
  for (let i = 50; i < candles.length; i++) {
    if (i - lastSignalIdx < 35) continue;
    if (volAvg[i] === 0) continue;
    
    const current = candles[i];
    const atrVal = atrValues[i];
    if (atrVal === 0) continue;
    
    // Volume spike: current volume > 2x average
    const isVolumeSpike = volumes[i] > volAvg[i] * 2.0;
    if (!isVolumeSpike) continue;
    
    // Bullish: strong bullish candle + volume spike + above EMA50
    if (current.close > current.open && 
        (current.close - current.open) > atrVal * 0.5 &&
        current.close > ema50[i]) {
      const sl = current.low - atrVal * 0.8;
      const risk = current.close - sl;
      const tp = current.close + risk * 3.0;
      
      const slPips = (risk / pipMult) + brokerCost;
      if (slPips < 8 || slPips > 60) continue;
      
      trades.push({ pair, direction: 'LONG', entry: current.close, sl, tp, exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0 });
      lastSignalIdx = i;
    }
    
    // Bearish: strong bearish candle + volume spike + below EMA50
    if (current.close < current.open &&
        (current.open - current.close) > atrVal * 0.5 &&
        current.close < ema50[i]) {
      const sl = current.high + atrVal * 0.8;
      const risk = sl - current.close;
      const tp = current.close - risk * 3.0;
      
      const slPips = (risk / pipMult) + brokerCost;
      if (slPips < 8 || slPips > 60) continue;
      
      trades.push({ pair, direction: 'SHORT', entry: current.close, sl, tp, exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0 });
      lastSignalIdx = i;
    }
  }
  
  return simulateTrades(trades, candles, pipMult, brokerCost);
}

// ===== TRADE SIMULATION =====
function simulateTrades(rawTrades: Trade[], candles: Candle[], pipMult: number, brokerCost: number): Trade[] {
  const results: Trade[] = [];
  for (const trade of rawTrades) {
    const entryIdx = candles.findIndex((c, idx) => idx > 0 && Math.abs(c.close - trade.entry) < pipMult * 2);
    if (entryIdx === -1) continue;
    
    let exitPrice = trade.entry, exitReason = 'TIME';
    for (let j = entryIdx + 1; j < candles.length && j < entryIdx + 120; j++) {
      const c = candles[j];
      if (trade.direction === 'LONG') {
        if (c.low <= trade.sl) { exitPrice = trade.sl; exitReason = 'SL'; break; }
        if (c.high >= trade.tp) { exitPrice = trade.tp; exitReason = 'TP'; break; }
      } else {
        if (c.high >= trade.sl) { exitPrice = trade.sl; exitReason = 'SL'; break; }
        if (c.low <= trade.tp) { exitPrice = trade.tp; exitReason = 'TP'; break; }
      }
    }
    
    const grossPips = trade.direction === 'LONG'
      ? (exitPrice - trade.entry) / pipMult
      : (trade.entry - exitPrice) / pipMult;
    const netPips = grossPips - brokerCost;
    const riskPips = Math.abs(trade.entry - trade.sl) / pipMult;
    const rMultiple = riskPips > 0 ? netPips / riskPips : 0;
    
    results.push({ ...trade, exitPrice, exitReason, pipsWon: netPips, rMultiple });
  }
  return results;
}

// ===== MAIN =====
const PAIRS = [
  'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'USDCAD',
  'AUDUSD', 'NZDUSD', 'EURGBP', 'EURJPY', 'GBPJPY',
  'AUDJPY', 'CADJPY', 'CHFJPY', 'NZDJPY', 'EURAUD'
];

console.log('===================================================================');
console.log('TESTING 5 MORE STRATEGIES');
console.log('#49: ADX Trend Strength + EMA Cross');
console.log('#50: Bollinger Band Squeeze Breakout');
console.log('#51: Multi-Timeframe Momentum (H1+M5)');
console.log('#52: Envelope Channel Breakout');
console.log('#53: Volume Spike + Trend Continuation');
console.log('===================================================================\n');

const strategies = [
  { name: 'ADX + EMA Cross', fn: testADXTrend },
  { name: 'BB Squeeze', fn: testBBSqueeze },
  { name: 'MTF Momentum', fn: testMTF_Momentum },
  { name: 'Envelope Breakout', fn: testEnvelopeBreakout },
  { name: 'Volume Spike', fn: testVolumeSpike },
];

const allResults: { name: string; avgR: number; verdict: string }[] = [];

for (const strat of strategies) {
  console.log(`\n--- Strategy: ${strat.name} ---\n`);
  
  const allTrades: Trade[] = [];
  const pairStats: { pair: string; signals: number; closed: number; wr: number; avgR: number; maxDD: number; avgSL: number }[] = [];
  
  for (const pair of PAIRS) {
    const candles = loadCacheFile(pair);
    if (candles.length === 0) continue;
    const cost = getBrokerCost(pair);
    const trades = strat.fn(pair, candles, cost);
    
    const closed = trades.filter(t => t.exitReason !== 'TIME');
    const wins = closed.filter(t => t.pipsWon > 0);
    const wr = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;
    const avgR = closed.length > 0 ? closed.reduce((s, t) => s + t.rMultiple, 0) / closed.length : 0;
    
    let equity = 0, peak = 0, maxDD = 0;
    for (const t of closed) { equity += t.rMultiple; peak = Math.max(peak, equity); maxDD = Math.max(maxDD, peak - equity); }
    
    const pipMult = getPipMultiplier(pair);
    const avgSL = closed.length > 0 ? closed.reduce((s, t) => s + Math.abs(t.entry - t.sl) / pipMult, 0) / closed.length : 0;
    
    pairStats.push({ pair, signals: trades.length, closed: closed.length, wr, avgR, maxDD, avgSL });
    allTrades.push(...trades);
    console.log(`  ${pair}: ${trades.length} signals`);
  }
  
  const closed = allTrades.filter(t => t.exitReason !== 'TIME');
  const wins = closed.filter(t => t.pipsWon > 0);
  const losses = closed.filter(t => t.pipsWon <= 0);
  const wr = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;
  const avgR = closed.length > 0 ? closed.reduce((s, t) => s + t.rMultiple, 0) / closed.length : 0;
  
  let equity = 0, peak = 0, maxDD = 0;
  for (const t of closed) { equity += t.rMultiple; peak = Math.max(peak, equity); maxDD = Math.max(maxDD, peak - equity); }
  
  const grossProfit = wins.reduce((s, t) => s + t.rMultiple, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.rMultiple, 0));
  const pf = grossLoss > 0 ? grossProfit / grossLoss : 0;
  
  const avgSL = closed.length > 0 ? closed.reduce((s, t) => s + Math.abs(t.entry - t.sl) / getPipMultiplier(t.pair), 0) / closed.length : 0;
  
  console.log(`\n  ${strat.name} (combined)`.padEnd(55) +
    `signals: ${String(closed.length).padStart(4)} closed: ${String(closed.length).padStart(4)} ` +
    `WR: ${wr.toFixed(1).padStart(4)}%  avgR: ${avgR.toFixed(3).padStart(7)}  ` +
    `PF: ${pf.toFixed(2).padStart(4)}  maxDD(R): ${maxDD.toFixed(2).padStart(7)}  avgSL: ${avgSL.toFixed(1)}p`);
  
  for (const ps of pairStats) {
    console.log(`    ${ps.pair}`.padEnd(55) +
      `signals: ${String(ps.signals).padStart(4)} closed: ${String(ps.closed).padStart(4)} ` +
      `WR: ${ps.wr.toFixed(1).padStart(4)}%  avgR: ${ps.avgR.toFixed(3).padStart(7)}  ` +
      `maxDD(R): ${ps.maxDD.toFixed(2).padStart(7)}  avgSL: ${ps.avgSL.toFixed(1)}p`);
  }
  
  const verdict = avgR > 0.05 ? '✅' : avgR > 0 ? '⚠️' : '❌';
  allResults.push({ name: strat.name, avgR, verdict });
}

console.log('\n===================================================================');
console.log('SUMMARY');
console.log('===================================================================\n');
console.log('#  | Strategy                    | avgR    | Verdict');
console.log('---+-----------------------------+---------+--------');
strategies.forEach((s, i) => {
  const r = allResults[i];
  console.log(`${(i + 49).toString().padEnd(3)}| ${s.name.padEnd(27)} | ${r.avgR.toFixed(3).padStart(7)} | ${r.verdict}`);
});
console.log('\n===================================================================');
console.log('TOTAL STRATEGIES TESTED: 53');
console.log('===================================================================');
