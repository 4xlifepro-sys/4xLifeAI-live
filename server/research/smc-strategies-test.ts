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
    if (i < period - 1) {
      result.push(0);
    } else if (i === period - 1) {
      result.push(trSum / period);
    } else {
      const atrVal = (result[i - 1] * (period - 1) + tr) / period;
      result.push(atrVal);
    }
  }
  return result;
}

function rsi(closes: number[], period: number = 14): number[] {
  const result: number[] = [];
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  result.push(100 - 100 / (1 + avgGain / avgLoss));
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) {
      avgGain = (avgGain * (period - 1) + diff) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) - diff) / period;
    }
    result.push(100 - 100 / (1 + avgGain / avgLoss));
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

// ===== SMC HELPER FUNCTIONS =====

// Detect swing highs and lows
function findSwingPoints(candles: Candle[], lookback: number): { swingHighs: number[], swingLows: number[] } {
  const swingHighs: number[] = [];
  const swingLows: number[] = [];
  
  for (let i = lookback; i < candles.length - lookback; i++) {
    let isSwingHigh = true;
    let isSwingLow = true;
    
    for (let j = 1; j <= lookback; j++) {
      if (candles[i].high <= candles[i - j].high || candles[i].high <= candles[i + j].high) {
        isSwingHigh = false;
      }
      if (candles[i].low >= candles[i - j].low || candles[i].low >= candles[i + j].low) {
        isSwingLow = false;
      }
    }
    
    swingHighs.push(isSwingHigh ? candles[i].high : NaN);
    swingLows.push(isSwingLow ? candles[i].low : NaN);
  }
  
  // Pad beginning
  for (let i = 0; i < lookback; i++) {
    swingHighs.unshift(NaN);
    swingLows.unshift(NaN);
  }
  
  return { swingHighs, swingLows };
}

// Detect Order Blocks (last opposite candle before strong move)
function findOrderBlocks(candles: Candle[], atrValues: number[]): { bullishOB: { top: number, bottom: number, idx: number }[], bearishOB: { top: number, bottom: number, idx: number }[] } {
  const bullishOB: { top: number, bottom: number, idx: number }[] = [];
  const bearishOB: { top: number, bottom: number, idx: number }[] = [];
  
  for (let i = 2; i < candles.length - 1; i++) {
    const prevCandle = candles[i - 1];
    const currCandle = candles[i];
    const atrVal = atrValues[i];
    
    if (atrVal === 0) continue;
    
    // Bullish OB: bearish candle followed by strong bullish move
    if (prevCandle.close < prevCandle.open && // previous was bearish
        currCandle.close > currCandle.open && // current is bullish
        (currCandle.close - currCandle.open) > atrVal * 0.5) { // strong move
      bullishOB.push({
        top: prevCandle.open,  // OB top = bearish candle open
        bottom: prevCandle.low, // OB bottom = bearish candle low
        idx: i - 1
      });
    }
    
    // Bearish OB: bullish candle followed by strong bearish move
    if (prevCandle.close > prevCandle.open && // previous was bullish
        currCandle.close < currCandle.open && // current is bearish
        (currCandle.open - currCandle.close) > atrVal * 0.5) { // strong move
      bearishOB.push({
        top: prevCandle.high,  // OB top = bullish candle high
        bottom: prevCandle.close, // OB bottom = bullish candle close
        idx: i - 1
      });
    }
  }
  
  return { bullishOB, bearishOB };
}

// Detect Fair Value Gaps (imbalance between 3 candles)
function findFVGs(candles: Candle[]): { bullishFVG: { top: number, bottom: number, idx: number }[], bearishFVG: { top: number, bottom: number, idx: number }[] } {
  const bullishFVG: { top: number, bottom: number, idx: number }[] = [];
  const bearishFVG: { top: number, bottom: number, idx: number }[] = [];
  
  for (let i = 2; i < candles.length; i++) {
    const c1 = candles[i - 2];
    const c2 = candles[i - 1]; // middle candle (strong move)
    const c3 = candles[i];
    
    // Bullish FVG: gap between c1.high and c3.low (c2 is strong bullish)
    if (c3.low > c1.high && c2.close > c2.open) {
      bullishFVG.push({
        top: c3.low,
        bottom: c1.high,
        idx: i
      });
    }
    
    // Bearish FVG: gap between c1.low and c3.high (c2 is strong bearish)
    if (c3.high < c1.low && c2.close < c2.open) {
      bearishFVG.push({
        top: c1.low,
        bottom: c3.high,
        idx: i
      });
    }
  }
  
  return { bullishFVG, bearishFVG };
}

// Detect Break of Structure (BOS) - when price breaks recent swing high/low
function detectBOS(candles: Candle[], lookback: number = 10): { bullishBOS: number[], bearishBOS: number[] } {
  const bullishBOS: number[] = [];
  const bearishBOS: number[] = [];
  
  for (let i = lookback + 1; i < candles.length; i++) {
    // Find recent swing high/low
    let recentHigh = -Infinity;
    let recentLow = Infinity;
    for (let j = i - lookback; j < i; j++) {
      recentHigh = Math.max(recentHigh, candles[j].high);
      recentLow = Math.min(recentLow, candles[j].low);
    }
    
    // Bullish BOS: close above recent swing high
    if (candles[i].close > recentHigh) {
      bullishBOS.push(i);
    }
    
    // Bearish BOS: close below recent swing low
    if (candles[i].close < recentLow) {
      bearishBOS.push(i);
    }
  }
  
  return { bullishBOS, bearishBOS };
}

// ===== STRATEGY #39: ORDER BLOCK ENTRY =====
// Enter when price returns to a fresh Order Block zone
function testOrderBlock(pair: string, candles: Candle[], brokerCost: number): Trade[] {
  if (candles.length < 100) return [];
  
  const closes = candles.map(c => c.close);
  const ema50 = ema(closes, 50);
  const atrValues = atr(candles, 14);
  const pipMult = getPipMultiplier(pair);
  
  const { bullishOB, bearishOB } = findOrderBlocks(candles, atrValues);
  
  const trades: Trade[] = [];
  let lastSignalIdx = -30;
  
  for (let i = 50; i < candles.length; i++) {
    if (i - lastSignalIdx < 30) continue;
    
    const current = candles[i];
    const atrVal = atrValues[i];
    if (atrVal === 0) continue;
    
    // BULLISH: Price returns to bullish OB + EMA50 support
    for (const ob of bullishOB) {
      if (ob.idx >= i - 3 || ob.idx < i - 40) continue; // OB must be recent but not too fresh
      
      // Price touching OB zone
      if (current.low <= ob.top && current.low >= ob.bottom * 0.999) {
        // Trend filter
        if (current.close > ema50[i]) {
          const sl = ob.bottom - atrVal * 0.5;
          const risk = current.close - sl;
          const tp = current.close + risk * 2.5;
          
          const slPips = (risk / pipMult) + brokerCost;
          if (slPips < 5 || slPips > 50) continue;
          
          trades.push({
            pair, direction: 'LONG', entry: current.close, sl, tp,
            exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0
          });
          lastSignalIdx = i;
          break;
        }
      }
    }
    
    // BEARISH: Price returns to bearish OB + EMA50 resistance
    for (const ob of bearishOB) {
      if (ob.idx >= i - 3 || ob.idx < i - 40) continue;
      
      if (current.high >= ob.bottom && current.high <= ob.top * 1.001) {
        if (current.close < ema50[i]) {
          const sl = ob.top + atrVal * 0.5;
          const risk = sl - current.close;
          const tp = current.close - risk * 2.5;
          
          const slPips = (risk / pipMult) + brokerCost;
          if (slPips < 5 || slPips > 50) continue;
          
          trades.push({
            pair, direction: 'SHORT', entry: current.close, sl, tp,
            exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0
          });
          lastSignalIdx = i;
          break;
        }
      }
    }
  }
  
  return simulateTrades(trades, candles, pipMult, brokerCost);
}

// ===== STRATEGY #40: FAIR VALUE GAP (FVG) FILL =====
// Enter when price fills a Fair Value Gap (imbalance)
function testFVG(pair: string, candles: Candle[], brokerCost: number): Trade[] {
  if (candles.length < 100) return [];
  
  const closes = candles.map(c => c.close);
  const ema50 = ema(closes, 50);
  const atrValues = atr(candles, 14);
  const pipMult = getPipMultiplier(pair);
  
  const { bullishFVG, bearishFVG } = findFVGs(candles);
  
  const trades: Trade[] = [];
  let lastSignalIdx = -20;
  
  for (let i = 50; i < candles.length; i++) {
    if (i - lastSignalIdx < 20) continue;
    
    const current = candles[i];
    const atrVal = atrValues[i];
    if (atrVal === 0) continue;
    
    // BULLISH: Price drops into bullish FVG (buying the dip into imbalance)
    for (const fvg of bullishFVG) {
      if (fvg.idx >= i - 2 || fvg.idx < i - 30) continue;
      
      // Price entering FVG zone from above
      if (current.low <= fvg.top && current.close > fvg.bottom) {
        if (current.close > ema50[i]) { // trend filter
          const sl = fvg.bottom - atrVal * 0.5;
          const risk = current.close - sl;
          const tp = current.close + risk * 2.0;
          
          const slPips = (risk / pipMult) + brokerCost;
          if (slPips < 5 || slPips > 40) continue;
          
          trades.push({
            pair, direction: 'LONG', entry: current.close, sl, tp,
            exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0
          });
          lastSignalIdx = i;
          break;
        }
      }
    }
    
    // BEARISH: Price rises into bearish FVG
    for (const fvg of bearishFVG) {
      if (fvg.idx >= i - 2 || fvg.idx < i - 30) continue;
      
      if (current.high >= fvg.bottom && current.close < fvg.top) {
        if (current.close < ema50[i]) {
          const sl = fvg.top + atrVal * 0.5;
          const risk = sl - current.close;
          const tp = current.close - risk * 2.0;
          
          const slPips = (risk / pipMult) + brokerCost;
          if (slPips < 5 || slPips > 40) continue;
          
          trades.push({
            pair, direction: 'SHORT', entry: current.close, sl, tp,
            exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0
          });
          lastSignalIdx = i;
          break;
        }
      }
    }
  }
  
  return simulateTrades(trades, candles, pipMult, brokerCost);
}

// ===== STRATEGY #41: BOS + ORDER BLOCK (Classic SMC) =====
// After Break of Structure, enter on pullback to the OB that caused the break
function testBOS_OB(pair: string, candles: Candle[], brokerCost: number): Trade[] {
  if (candles.length < 100) return [];
  
  const closes = candles.map(c => c.close);
  const ema50 = ema(closes, 50);
  const atrValues = atr(candles, 14);
  const pipMult = getPipMultiplier(pair);
  
  const { bullishOB, bearishOB } = findOrderBlocks(candles, atrValues);
  const { bullishBOS, bearishBOS } = detectBOS(candles, 10);
  
  const trades: Trade[] = [];
  let lastSignalIdx = -25;
  
  for (let i = 50; i < candles.length; i++) {
    if (i - lastSignalIdx < 25) continue;
    
    const current = candles[i];
    const atrVal = atrValues[i];
    if (atrVal === 0) continue;
    
    // BULLISH: Recent bullish BOS + price pulls back to the OB
    for (const bosIdx of bullishBOS) {
      if (bosIdx < i - 15 || bosIdx > i - 2) continue; // BOS happened recently
      
      // Find the OB that caused this BOS (should be before the BOS)
      const causingOB = bullishOB.find(ob => ob.idx < bosIdx && ob.idx > bosIdx - 10);
      if (!causingOB) continue;
      
      // Price pulling back to OB zone
      if (current.low <= causingOB.top && current.low >= causingOB.bottom * 0.999) {
        if (current.close > ema50[i]) {
          const sl = causingOB.bottom - atrVal * 0.5;
          const risk = current.close - sl;
          const tp = current.close + risk * 3.0;
          
          const slPips = (risk / pipMult) + brokerCost;
          if (slPips < 6 || slPips > 45) continue;
          
          trades.push({
            pair, direction: 'LONG', entry: current.close, sl, tp,
            exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0
          });
          lastSignalIdx = i;
          break;
        }
      }
    }
    
    // BEARISH: Recent bearish BOS + price pulls back to OB
    for (const bosIdx of bearishBOS) {
      if (bosIdx < i - 15 || bosIdx > i - 2) continue;
      
      const causingOB = bearishOB.find(ob => ob.idx < bosIdx && ob.idx > bosIdx - 10);
      if (!causingOB) continue;
      
      if (current.high >= causingOB.bottom && current.high <= causingOB.top * 1.001) {
        if (current.close < ema50[i]) {
          const sl = causingOB.top + atrVal * 0.5;
          const risk = sl - current.close;
          const tp = current.close - risk * 3.0;
          
          const slPips = (risk / pipMult) + brokerCost;
          if (slPips < 6 || slPips > 45) continue;
          
          trades.push({
            pair, direction: 'SHORT', entry: current.close, sl, tp,
            exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0
          });
          lastSignalIdx = i;
          break;
        }
      }
    }
  }
  
  return simulateTrades(trades, candles, pipMult, brokerCost);
}

// ===== STRATEGY #42: LIQUIDITY SWEEP + REVERSAL =====
// Price sweeps recent high/low (takes liquidity) then reverses
function testLiquiditySweep(pair: string, candles: Candle[], brokerCost: number): Trade[] {
  if (candles.length < 100) return [];
  
  const closes = candles.map(c => c.close);
  const ema50 = ema(closes, 50);
  const atrValues = atr(candles, 14);
  const rsiValues = rsi(closes, 14);
  const pipMult = getPipMultiplier(pair);
  
  const trades: Trade[] = [];
  let lastSignalIdx = -20;
  
  for (let i = 50; i < candles.length; i++) {
    if (i - lastSignalIdx < 20) continue;
    
    const current = candles[i];
    const prev = candles[i - 1];
    const atrVal = atrValues[i];
    if (atrVal === 0) continue;
    
    // Find recent swing high/low (last 15 candles)
    let recentHigh = -Infinity;
    let recentLow = Infinity;
    let highIdx = i;
    let lowIdx = i;
    for (let j = Math.max(0, i - 15); j < i; j++) {
      if (candles[j].high > recentHigh) {
        recentHigh = candles[j].high;
        highIdx = j;
      }
      if (candles[j].low < recentLow) {
        recentLow = candles[j].low;
        lowIdx = j;
      }
    }
    
    // BULLISH: Price sweeps below recent low then reverses (stop hunt)
    if (current.low < recentLow && current.close > recentLow) {
      // Confirmation: bullish candle, RSI oversold or rising
      if (current.close > current.open && rsiValues[i] > rsiValues[i - 1]) {
        const sl = current.low - atrVal * 0.3;
        const risk = current.close - sl;
        const tp = current.close + risk * 2.5;
        
        const slPips = (risk / pipMult) + brokerCost;
        if (slPips < 5 || slPips > 40) continue;
        
        trades.push({
          pair, direction: 'LONG', entry: current.close, sl, tp,
          exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0
        });
        lastSignalIdx = i;
      }
    }
    
    // BEARISH: Price sweeps above recent high then reverses
    if (current.high > recentHigh && current.close < recentHigh) {
      if (current.close < current.open && rsiValues[i] < rsiValues[i - 1]) {
        const sl = current.high + atrVal * 0.3;
        const risk = sl - current.close;
        const tp = current.close - risk * 2.5;
        
        const slPips = (risk / pipMult) + brokerCost;
        if (slPips < 5 || slPips > 40) continue;
        
        trades.push({
          pair, direction: 'SHORT', entry: current.close, sl, tp,
          exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0
        });
        lastSignalIdx = i;
      }
    }
  }
  
  return simulateTrades(trades, candles, pipMult, brokerCost);
}

// ===== STRATEGY #43: PREMIUM/DISCOUNT + OB =====
// Buy in discount zone (below 50% of range) at bullish OB
// Sell in premium zone (above 50% of range) at bearish OB
function testPremiumDiscount(pair: string, candles: Candle[], brokerCost: number): Trade[] {
  if (candles.length < 100) return [];
  
  const closes = candles.map(c => c.close);
  const ema50 = ema(closes, 50);
  const atrValues = atr(candles, 14);
  const pipMult = getPipMultiplier(pair);
  
  const { bullishOB, bearishOB } = findOrderBlocks(candles, atrValues);
  
  const trades: Trade[] = [];
  let lastSignalIdx = -30;
  
  for (let i = 50; i < candles.length; i++) {
    if (i - lastSignalIdx < 30) continue;
    
    const current = candles[i];
    const atrVal = atrValues[i];
    if (atrVal === 0) continue;
    
    // Calculate recent range (last 30 candles)
    let rangeHigh = -Infinity;
    let rangeLow = Infinity;
    for (let j = Math.max(0, i - 30); j < i; j++) {
      rangeHigh = Math.max(rangeHigh, candles[j].high);
      rangeLow = Math.min(rangeLow, candles[j].low);
    }
    const rangeMid = (rangeHigh + rangeLow) / 2;
    
    // BULLISH: Price in discount zone (below mid) + at bullish OB
    if (current.close < rangeMid) {
      for (const ob of bullishOB) {
        if (ob.idx >= i - 3 || ob.idx < i - 40) continue;
        
        if (current.low <= ob.top && current.low >= ob.bottom * 0.999) {
          if (current.close > ema50[i] * 0.998) { // relaxed trend filter
            const sl = ob.bottom - atrVal * 0.5;
            const risk = current.close - sl;
            const tp = current.close + risk * 2.5;
            
            const slPips = (risk / pipMult) + brokerCost;
            if (slPips < 5 || slPips > 45) continue;
            
            trades.push({
              pair, direction: 'LONG', entry: current.close, sl, tp,
              exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0
            });
            lastSignalIdx = i;
            break;
          }
        }
      }
    }
    
    // BEARISH: Price in premium zone (above mid) + at bearish OB
    if (current.close > rangeMid) {
      for (const ob of bearishOB) {
        if (ob.idx >= i - 3 || ob.idx < i - 40) continue;
        
        if (current.high >= ob.bottom && current.high <= ob.top * 1.001) {
          if (current.close < ema50[i] * 1.002) {
            const sl = ob.top + atrVal * 0.5;
            const risk = sl - current.close;
            const tp = current.close - risk * 2.5;
            
            const slPips = (risk / pipMult) + brokerCost;
            if (slPips < 5 || slPips > 45) continue;
            
            trades.push({
              pair, direction: 'SHORT', entry: current.close, sl, tp,
              exitPrice: 0, exitReason: '', pipsWon: 0, rMultiple: 0
            });
            lastSignalIdx = i;
            break;
          }
        }
      }
    }
  }
  
  return simulateTrades(trades, candles, pipMult, brokerCost);
}

// ===== TRADE SIMULATION =====
function simulateTrades(rawTrades: Trade[], candles: Candle[], pipMult: number, brokerCost: number): Trade[] {
  const results: Trade[] = [];
  
  for (const trade of rawTrades) {
    const entryIdx = candles.findIndex((c, idx) => 
      idx > 0 && Math.abs(c.close - trade.entry) < pipMult * 2
    );
    
    if (entryIdx === -1) continue;
    
    let exitPrice = trade.entry;
    let exitReason = 'TIME';
    
    for (let j = entryIdx + 1; j < candles.length && j < entryIdx + 100; j++) {
      const c = candles[j];
      
      if (trade.direction === 'LONG') {
        if (c.low <= trade.sl) {
          exitPrice = trade.sl;
          exitReason = 'SL';
          break;
        }
        if (c.high >= trade.tp) {
          exitPrice = trade.tp;
          exitReason = 'TP';
          break;
        }
      } else {
        if (c.high >= trade.sl) {
          exitPrice = trade.sl;
          exitReason = 'SL';
          break;
        }
        if (c.low <= trade.tp) {
          exitPrice = trade.tp;
          exitReason = 'TP';
          break;
        }
      }
    }
    
    const grossPips = trade.direction === 'LONG'
      ? (exitPrice - trade.entry) / pipMult
      : (trade.entry - exitPrice) / pipMult;
    
    const netPips = grossPips - brokerCost;
    const riskPips = Math.abs(trade.entry - trade.sl) / pipMult;
    const rMultiple = riskPips > 0 ? netPips / riskPips : 0;
    
    results.push({
      ...trade,
      exitPrice,
      exitReason,
      pipsWon: netPips,
      rMultiple
    });
  }
  
  return results;
}

// ===== MAIN TEST RUNNER =====
const PAIRS = [
  'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'USDCAD',
  'AUDUSD', 'NZDUSD', 'EURGBP', 'EURJPY', 'GBPJPY',
  'AUDJPY', 'CADJPY', 'CHFJPY', 'NZDJPY', 'EURAUD'
];

console.log('===================================================================');
console.log('TESTING 5 SMC (SMART MONEY CONCEPTS) STRATEGIES');
console.log('#39: Order Block Entry');
console.log('#40: Fair Value Gap (FVG) Fill');
console.log('#41: BOS + Order Block (Classic SMC)');
console.log('#42: Liquidity Sweep + Reversal');
console.log('#43: Premium/Discount + OB');
console.log('===================================================================\n');

const strategies = [
  { name: 'Order Block', fn: testOrderBlock },
  { name: 'FVG Fill', fn: testFVG },
  { name: 'BOS + OB', fn: testBOS_OB },
  { name: 'Liquidity Sweep', fn: testLiquiditySweep },
  { name: 'Premium/Discount', fn: testPremiumDiscount },
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
    
    // Max drawdown
    let equity = 0, peak = 0, maxDD = 0;
    for (const t of closed) {
      equity += t.rMultiple;
      peak = Math.max(peak, equity);
      maxDD = Math.max(maxDD, peak - equity);
    }
    
    // Avg SL pips
    const pipMult = getPipMultiplier(pair);
    const avgSL = closed.length > 0
      ? closed.reduce((s, t) => s + Math.abs(t.entry - t.sl) / pipMult, 0) / closed.length
      : 0;
    
    pairStats.push({ pair, signals: trades.length, closed: closed.length, wr, avgR, maxDD, avgSL });
    allTrades.push(...trades);
    
    console.log(`  ${pair}: ${trades.length} signals`);
  }
  
  // Combined stats
  const closed = allTrades.filter(t => t.exitReason !== 'TIME');
  const wins = closed.filter(t => t.pipsWon > 0);
  const losses = closed.filter(t => t.pipsWon <= 0);
  const wr = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;
  const avgR = closed.length > 0 ? closed.reduce((s, t) => s + t.rMultiple, 0) / closed.length : 0;
  
  let equity = 0, peak = 0, maxDD = 0;
  for (const t of closed) {
    equity += t.rMultiple;
    peak = Math.max(peak, equity);
    maxDD = Math.max(maxDD, peak - equity);
  }
  
  const grossProfit = wins.reduce((s, t) => s + t.rMultiple, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.rMultiple, 0));
  const pf = grossLoss > 0 ? grossProfit / grossLoss : 0;
  
  const pipMultAvg = getPipMultiplier('EURUSD'); // rough average
  const avgSL = closed.length > 0
    ? closed.reduce((s, t) => s + Math.abs(t.entry - t.sl) / getPipMultiplier(t.pair), 0) / closed.length
    : 0;
  
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
console.log('SMC STRATEGIES SUMMARY');
console.log('===================================================================\n');
console.log('#  | Strategy                    | avgR    | Verdict');
console.log('---+-----------------------------+---------+--------');
strategies.forEach((s, i) => {
  const r = allResults[i];
  console.log(`${(i + 39).toString().padEnd(3)}| ${s.name.padEnd(27)} | ${r.avgR.toFixed(3).padStart(7)} | ${r.verdict}`);
});
console.log('\n===================================================================');
