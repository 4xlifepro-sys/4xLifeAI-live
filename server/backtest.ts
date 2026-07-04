import { fetchHistoricalCandles } from './live-market-feed.js';
import { detectTrendMomentumScannerV5, getPipMultiplier } from './engine.js';
import type { Candle } from '../src/types.js';
import 'dotenv/config';

const PAIRS = [
  'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'USDCAD', 
  'AUDUSD', 'NZDUSD', 'EURGBP', 'EURJPY', 'GBPJPY', 
  'AUDJPY', 'NZDJPY', 'CADJPY', 'CHFJPY', 'EURAUD', 
  'EURNZD', 'GBPAUD', 'XAUUSD', 'XAGUSD', 'BTCUSD',
  'ETHUSD', 'SOLUSD', 'XRPUSD', 'BNBUSD', 'ADAUSD',
  'LTCUSD', 'DOTUSD'
];

interface Trade {
  pair: string;
  direction: 'LONG' | 'SHORT';
  entry: number;
  sl: number;
  tp1: number;
  tp2: number;
  tp3: number;
  entryTime: string;
  exitTime?: string;
  exitPrice?: number;
  exitReason?: 'TP1' | 'TP2' | 'TP3' | 'SL' | 'OPEN';
  pips?: number;
  result?: 'WIN' | 'LOSS' | 'PARTIAL_WIN' | 'BREAKEVEN' | 'OPEN';
  confidence?: number;
  tier?: string;
}

interface BacktestResult {
  totalSignals: number;
  closedTrades: number;
  wins: number;
  losses: number;
  breakevens: number;
  partialWins: number;
  winRate: number;
  avgWinPips: number;
  avgLossPips: number;
  totalPips: number;
  maxDrawdown: number;
  maxConsecutiveLosses: number;
  avgTradeDuration: number;
  signalFrequency: number;
  firstSignalDate: string | null;
  lastSignalDate: string | null;
  daysToFirstSignal: number | null;
  dataRange: { start: string; end: string };
  trades: Trade[];
}

// Simulate trade outcome over subsequent candles
function simulateTradeOutcome(
  trade: Trade,
  futureCandles: Candle[],
  pair: string
): Trade {
  const isLong = trade.direction === 'LONG';
  const pipMultiplier = getPipMultiplier(pair);
  
  let effectiveSL = trade.sl;
  let tp1Hit = false;
  let tp2Hit = false;
  const result = { ...trade };
  
  for (let i = 0; i < futureCandles.length; i++) {
    const candle = futureCandles[i];
    
    if (isLong) {
      // Check SL first
      if (candle.low <= effectiveSL) {
        result.exitPrice = effectiveSL;
        result.exitTime = candle.timestamp;
        result.exitReason = 'SL';
        
        if (tp2Hit) {
          result.result = 'PARTIAL_WIN';
        } else if (tp1Hit) {
          result.result = 'BREAKEVEN';
        } else {
          result.result = 'LOSS';
        }
        break;
      }
      
      // Check TP3
      if (candle.high >= trade.tp3 && !tp2Hit) {
        result.exitPrice = trade.tp3;
        result.exitTime = candle.timestamp;
        result.exitReason = 'TP3';
        result.result = 'WIN';
        break;
      }
      
      // Check TP2
      if (candle.high >= trade.tp2 && !tp1Hit) {
        tp2Hit = true;
        effectiveSL = trade.tp1; // Move SL to TP1
      }
      
      // Check TP1
      if (candle.high >= trade.tp1 && !tp1Hit) {
        tp1Hit = true;
        effectiveSL = trade.entry; // Move SL to breakeven
      }
      
    } else {
      // SHORT position
      if (candle.high >= effectiveSL) {
        result.exitPrice = effectiveSL;
        result.exitTime = candle.timestamp;
        result.exitReason = 'SL';
        
        if (tp2Hit) {
          result.result = 'PARTIAL_WIN';
        } else if (tp1Hit) {
          result.result = 'BREAKEVEN';
        } else {
          result.result = 'LOSS';
        }
        break;
      }
      
      if (candle.low <= trade.tp3 && !tp2Hit) {
        result.exitPrice = trade.tp3;
        result.exitTime = candle.timestamp;
        result.exitReason = 'TP3';
        result.result = 'WIN';
        break;
      }
      
      if (candle.low <= trade.tp2 && !tp1Hit) {
        tp2Hit = true;
        effectiveSL = trade.tp1;
      }
      
      if (candle.low <= trade.tp1 && !tp1Hit) {
        tp1Hit = true;
        effectiveSL = trade.entry;
      }
    }
  }
  
  // If trade never closed, mark as OPEN
  if (!result.exitPrice) {
    const lastCandle = futureCandles[futureCandles.length - 1];
    if (lastCandle) {
      result.exitPrice = lastCandle.close;
      result.exitTime = lastCandle.timestamp;
    } else {
      result.exitPrice = trade.entry;
      result.exitTime = trade.entryTime;
    }
    result.exitReason = 'OPEN';
    result.result = 'OPEN';
  }
  
  // Calculate pips
  if (result.exitPrice !== undefined) {
    if (isLong) {
      result.pips = (result.exitPrice - trade.entry) / pipMultiplier;
    } else {
      result.pips = (trade.entry - result.exitPrice) / pipMultiplier;
    }
  }
  
  return result;
}

async function fetchHistoricalData(pair: string, months: number = 6): Promise<{ h4: Candle[], m5: Candle[] } | null> {
  console.log(`[BACKTEST] Fetching ${months} months of data for ${pair}...`);
  
  try {
    // Calculate how many candles we need
    // 4H: months * 30 days * 24 hours / 4 = months * 180
    // 5M: months * 30 days * 24 hours * 12 (per hour) = months * 8640
    const h4Count = months * 180;
    const m5Count = months * 8640;
    
    const h4 = await fetchHistoricalCandles(pair, '4h', h4Count);
    await new Promise(r => setTimeout(r, 200)); // Rate limit
    
    const m5 = await fetchHistoricalCandles(pair, '5min', m5Count);
    await new Promise(r => setTimeout(r, 200));
    
    if (!h4 || !m5) {
      console.warn(`[BACKTEST] Failed to fetch data for ${pair}`);
      return null;
    }
    
    if (h4.length < 50 || m5.length < 50) {
      console.warn(`[BACKTEST] Insufficient data for ${pair}: H4=${h4.length}, M5=${m5.length}`);
      return null;
    }
    
    const dataRange = {
      start: m5[0].timestamp,
      end: m5[m5.length - 1].timestamp
    };
    
    console.log(`[BACKTEST] ${pair}: ${h4.length} H4 candles, ${m5.length} M5 candles`);
    console.log(`         Range: ${dataRange.start} to ${dataRange.end}`);
    
    return { h4, m5 };
  } catch (e: any) {
    console.error(`[BACKTEST] Error fetching ${pair}:`, e.message);
    return null;
  }
}

async function runBacktest(): Promise<BacktestResult> {
  console.log('\n====================================');
  console.log('[BACKTEST] Starting Historical Backtest');
  console.log('====================================\n');
  
  const allTrades: Trade[] = [];
  const startTime = Date.now();
  let globalDataStart: string | null = null;
  let globalDataEnd: string | null = null;
  
  for (const pair of PAIRS) {
    console.log(`\n[BACKTEST] Processing ${pair}...`);
    
    const data = await fetchHistoricalData(pair, 6);
    if (!data) continue;
    
    const { h4, m5 } = data;
    
    if (!globalDataStart) globalDataStart = m5[0].timestamp;
    globalDataEnd = m5[m5.length - 1].timestamp;
    
    const h4StartIdx = Math.max(0, h4.length - 50);
    let pairSignalCount = 0;
    
    // Step through M5 candles one by one
    // Skip first 50 candles to ensure indicators are warmed up
    for (let i = 50; i < m5.length - 100; i++) {
      const m5Slice = m5.slice(0, i + 1);
      const h4Slice = h4.slice(h4StartIdx);
      
      // Run engine on historical slice
      const result = detectTrendMomentumScannerV5(pair, h4Slice, m5Slice, m5Slice);
      
      if (result.signal && result.signal.status === 'ACTIVE' && result.signal.tier !== 'Reject') {
        // Signal detected
        const trade: Trade = {
          pair,
          direction: result.signal.direction,
          entry: result.signal.entry,
          sl: result.signal.sl,
          tp1: result.signal.tp1,
          tp2: result.signal.tp2,
          tp3: result.signal.tp3,
          entryTime: result.signal.timestamp,
          confidence: result.signal.aiConfidence,
          tier: result.signal.tier
        };
        
        // Simulate outcome over next 100 candles (8+ hours)
        const futureCandles = m5.slice(i + 1, Math.min(i + 101, m5.length));
        
        if (futureCandles.length > 0) {
          const completedTrade = simulateTradeOutcome(trade, futureCandles, pair);
          allTrades.push(completedTrade);
          pairSignalCount++;
          
          if (pairSignalCount % 10 === 0) {
            console.log(`  ✓ ${pair}: ${pairSignalCount} signals so far`);
          }
        }
      }
      
      // Skip ahead to avoid scanning every single candle (performance)
      // Check every 5th candle instead of every candle
      if (i % 5 !== 0) {
        i += 4;
      }
    }
    
    console.log(`[BACKTEST] ${pair} complete: ${pairSignalCount} signals`);
  }
  
  // Calculate statistics
  const closedTrades = allTrades.filter(t => t.exitReason !== 'OPEN');
  const wins = closedTrades.filter(t => t.result === 'WIN' || t.result === 'PARTIAL_WIN' || t.result === 'BREAKEVEN');
  const losses = closedTrades.filter(t => t.result === 'LOSS');
  const breakevens = closedTrades.filter(t => t.result === 'BREAKEVEN');
  const partialWins = closedTrades.filter(t => t.result === 'PARTIAL_WIN');
  
  const winRate = closedTrades.length > 0 ? (wins.length / closedTrades.length) * 100 : 0;
  
  const winPips = wins.reduce((sum, t) => sum + (t.pips || 0), 0);
  const lossPips = Math.abs(losses.reduce((sum, t) => sum + (t.pips || 0), 0));
  
  const avgWinPips = wins.length > 0 ? winPips / wins.length : 0;
  const avgLossPips = losses.length > 0 ? lossPips / losses.length : 0;
  
  const totalPips = allTrades.reduce((sum, t) => sum + (t.pips || 0), 0);
  
  // Calculate max drawdown
  let maxDrawdown = 0;
  let peak = 0;
  let runningTotal = 0;
  
  for (const trade of closedTrades) {
    runningTotal += trade.pips || 0;
    if (runningTotal > peak) peak = runningTotal;
    const drawdown = peak - runningTotal;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }
  
  // Calculate max consecutive losses
  let maxConsecutiveLosses = 0;
  let currentStreak = 0;
  
  for (const trade of closedTrades) {
    if (trade.result === 'LOSS') {
      currentStreak++;
      if (currentStreak > maxConsecutiveLosses) maxConsecutiveLosses = currentStreak;
    } else {
      currentStreak = 0;
    }
  }
  
  // Calculate signal frequency
  const firstSignalDate = allTrades.length > 0 ? allTrades[0].entryTime : null;
  const lastSignalDate = allTrades.length > 0 ? allTrades[allTrades.length - 1].entryTime : null;
  
  let daysToFirstSignal: number | null = null;
  let signalFrequency = 0;
  
  if (firstSignalDate && globalDataStart) {
    const firstSignal = new Date(firstSignalDate);
    const dataStart = new Date(globalDataStart);
    daysToFirstSignal = (firstSignal.getTime() - dataStart.getTime()) / (1000 * 60 * 60 * 24);
    
    if (lastSignalDate) {
      const lastSignal = new Date(lastSignalDate);
      const days = (lastSignal.getTime() - firstSignal.getTime()) / (1000 * 60 * 60 * 24);
      signalFrequency = days > 0 ? allTrades.length / (days / 7) : 0; // signals per week
    }
  }
  
  // Calculate avg trade duration
  const durations = closedTrades
    .filter(t => t.exitTime && t.entryTime)
    .map(t => new Date(t.exitTime!).getTime() - new Date(t.entryTime).getTime());
  
  const avgTradeDuration = durations.length > 0 
    ? durations.reduce((sum, d) => sum + d, 0) / durations.length 
    : 0;
  
  const result: BacktestResult = {
    totalSignals: allTrades.length,
    closedTrades: closedTrades.length,
    wins: wins.length,
    losses: losses.length,
    breakevens: breakevens.length,
    partialWins: partialWins.length,
    winRate,
    avgWinPips,
    avgLossPips,
    totalPips,
    maxDrawdown,
    maxConsecutiveLosses,
    avgTradeDuration,
    signalFrequency,
    firstSignalDate,
    lastSignalDate,
    daysToFirstSignal,
    dataRange: {
      start: globalDataStart || 'N/A',
      end: globalDataEnd || 'N/A'
    },
    trades: allTrades
  };
  
  console.log('\n====================================');
  console.log('[BACKTEST] Summary Statistics');
  console.log('====================================\n');
  
  console.log(`Data Range: ${result.dataRange.start} to ${result.dataRange.end}`);
  console.log(`\nTotal Signals Fired: ${result.totalSignals}`);
  console.log(`Closed Trades: ${result.closedTrades}`);
  console.log(`  Wins: ${result.wins}`);
  console.log(`  Losses: ${result.losses}`);
  console.log(`  Breakevens: ${result.breakevens}`);
  console.log(`  Partial Wins: ${result.partialWins}`);
  console.log(`\nWin Rate: ${result.winRate.toFixed(2)}%`);
  console.log(`Average Win: ${result.avgWinPips.toFixed(2)} pips`);
  console.log(`Average Loss: ${result.avgLossPips.toFixed(2)} pips`);
  console.log(`Total Pips: ${result.totalPips.toFixed(2)}`);
  console.log(`\nMax Drawdown: ${result.maxDrawdown.toFixed(2)} pips`);
  console.log(`Max Consecutive Losses: ${result.maxConsecutiveLosses}`);
  console.log(`\nAvg Trade Duration: ${(result.avgTradeDuration / (1000 * 60)).toFixed(1)} minutes`);
  console.log(`\nSignal Frequency: ${result.signalFrequency.toFixed(2)} signals per week`);
  console.log(`Days to First Signal: ${result.daysToFirstSignal?.toFixed(1) || 'N/A'}`);
  console.log(`First Signal: ${result.firstSignalDate || 'N/A'}`);
  console.log(`Last Signal: ${result.lastSignalDate || 'N/A'}`);
  
  console.log('\n====================================');
  console.log(`[BACKTEST] Complete in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
  console.log('====================================\n');
  
  return result;
}

// Run backtest
runBacktest().then(async result => {
  // Save trades to JSON for analysis
  const fs = await import('fs');
  const path = await import('path');
  
  const outputPath = path.default.join(process.cwd(), 'backtest-results.json');
  fs.default.writeFileSync(outputPath, JSON.stringify(result, null, 2));
  
  console.log(`\n[BACKTEST] Results saved to: ${outputPath}`);
  process.exit(0);
}).catch(err => {
  console.error('[BACKTEST] Fatal error:', err);
  process.exit(1);
});