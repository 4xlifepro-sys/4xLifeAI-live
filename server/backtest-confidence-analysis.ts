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
  direction: 'LONG' | 'SHORT' | 'BUY' | 'SELL';
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
  timeframe?: 'H4' | 'M5';
}

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
      
      if (candle.high >= trade.tp3 && !tp2Hit) {
        result.exitPrice = trade.tp3;
        result.exitTime = candle.timestamp;
        result.exitReason = 'TP3';
        result.result = 'WIN';
        break;
      }
      
      if (candle.high >= trade.tp2 && !tp1Hit) {
        tp2Hit = true;
        effectiveSL = trade.tp1;
      }
      
      if (candle.high >= trade.tp1 && !tp1Hit) {
        tp1Hit = true;
        effectiveSL = trade.entry;
      }
      
    } else {
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
  
  if (result.exitPrice !== undefined) {
    if (isLong) {
      result.pips = (result.exitPrice - trade.entry) / pipMultiplier;
    } else {
      result.pips = (trade.entry - result.exitPrice) / pipMultiplier;
    }
  }
  
  return result;
}

async function fetchHistoricalData(pair: string, months: number = 6): Promise<{ h4: Candle[], m5: Candle[], h4Range: {start: string, end: string}, m5Range: {start: string, end: string} } | null> {
  console.log(`[BACKTEST] Fetching ${months} months of data for ${pair}...`);
  
  try {
    const h4Count = months * 180;
    const m5Count = months * 8640;
    
    const h4 = await fetchHistoricalCandles(pair, '4h', h4Count);
    await new Promise(r => setTimeout(r, 200));
    
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
    
    const h4Range = {
      start: h4[0].timestamp,
      end: h4[h4.length - 1].timestamp
    };
    
    const m5Range = {
      start: m5[0].timestamp,
      end: m5[m5.length - 1].timestamp
    };
    
    console.log(`[BACKTEST] ${pair}: ${h4.length} H4 candles, ${m5.length} M5 candles`);
    
    return { h4, m5, h4Range, m5Range };
  } catch (e: any) {
    console.error(`[BACKTEST] Error fetching ${pair}:`, e.message);
    return null;
  }
}

async function runBacktest(): Promise<Trade[]> {
  console.log('\n====================================');
  console.log('[BACKTEST] Starting Historical Backtest');
  console.log('====================================\n');
  
  const allTrades: Trade[] = [];
  const startTime = Date.now();
  
  for (const pair of PAIRS) {
    console.log(`\n[BACKTEST] Processing ${pair}...`);
    
    const data = await fetchHistoricalData(pair, 6);
    if (!data) continue;
    
    const { h4, m5 } = data;
    
    let pairSignalCount = 0;
    
    for (let i = 50; i < m5.length - 100; i++) {
      const m5Slice = m5.slice(0, i + 1);
      const h4Slice = h4;
      
      const result = detectTrendMomentumScannerV5(pair, h4Slice, m5Slice, m5Slice);
      
      if (result.signal && result.signal.status === 'ACTIVE' && result.signal.tier !== 'Reject') {
        const trade: Trade = {
          pair,
          direction: result.signal.direction,
          entry: result.signal.entry,
          sl: result.signal.sl,
          tp1: result.signal.tp1,
          tp2: result.signal.tp2,
          tp3: result.signal.tp3,
          entryTime: m5[i].timestamp,
          confidence: result.signal.aiConfidence,
          tier: result.signal.tier,
          timeframe: 'M5'
        };
        
        const futureCandles = m5.slice(i + 1, Math.min(i + 101, m5.length));
        
        if (futureCandles.length > 0) {
          const completedTrade = simulateTradeOutcome(trade, futureCandles, pair);
          allTrades.push(completedTrade);
          pairSignalCount++;
        }
      }
      
      if (i % 5 !== 0) {
        i += 4;
      }
    }
    
    console.log(`[BACKTEST] ${pair} complete: ${pairSignalCount} signals`);
  }
  
  console.log(`\n====================================`);
  console.log(`[BACKTEST] Complete in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
  console.log(`[BACKTEST] Total trades: ${allTrades.length}`);
  console.log('====================================\n');
  
  return allTrades;
}

function analyzeByConfidence(trades: Trade[]) {
  const closedTrades = trades.filter(t => t.exitReason !== 'OPEN');
  
  if (closedTrades.length === 0) {
    console.log('No closed trades to analyze.');
    return;
  }
  
  const buckets: { [key: string]: Trade[] } = {
    '70-75': [],
    '75-80': [],
    '80-85': [],
    '85-90': [],
    '90+': []
  };
  
  for (const trade of closedTrades) {
    const conf = trade.confidence || 0;
    
    if (conf >= 90) {
      buckets['90+'].push(trade);
    } else if (conf >= 85) {
      buckets['85-90'].push(trade);
    } else if (conf >= 80) {
      buckets['80-85'].push(trade);
    } else if (conf >= 75) {
      buckets['75-80'].push(trade);
    } else if (conf >= 70) {
      buckets['70-75'].push(trade);
    }
  }
  
  console.log('\n====================================');
  console.log('[ANALYSIS] Win Rate by Confidence Bucket');
  console.log('====================================\n');
  
  console.log('Confidence | Trades | Wins | Losses | Win Rate | Avg Win | Avg Loss | Net Pips');
  console.log('-----------|--------|------|--------|----------|---------|----------|----------');
  
  for (const [bucket, bucketTrades] of Object.entries(buckets)) {
    if (bucketTrades.length === 0) {
      console.log(`${bucket.padEnd(11)}| ${'0'.padEnd(6)} | ${'0'.padEnd(4)} | ${'0'.padEnd(6)} | ${'N/A'.padEnd(8)} | ${'N/A'.padEnd(7)} | ${'N/A'.padEnd(8)} | N/A`);
      continue;
    }
    
    const wins = bucketTrades.filter(t => t.result === 'WIN' || t.result === 'PARTIAL_WIN' || t.result === 'BREAKEVEN');
    const losses = bucketTrades.filter(t => t.result === 'LOSS');
    const winRate = (wins.length / bucketTrades.length) * 100;
    
    const winPips = wins.reduce((sum, t) => sum + (t.pips || 0), 0);
    const lossPips = Math.abs(losses.reduce((sum, t) => sum + (t.pips || 0), 0));
    const avgWin = wins.length > 0 ? winPips / wins.length : 0;
    const avgLoss = losses.length > 0 ? lossPips / losses.length : 0;
    
    const netPips = bucketTrades.reduce((sum, t) => sum + (t.pips || 0), 0);
    
    console.log(
      `${bucket.padEnd(11)}| ` +
      `${bucketTrades.length.toString().padEnd(6)} | ` +
      `${wins.length.toString().padEnd(4)} | ` +
      `${losses.length.toString().padEnd(6)} | ` +
      `${winRate.toFixed(1).padEnd(7)}% | ` +
      `${avgWin.toFixed(2).padEnd(7)} | ` +
      `${avgLoss.toFixed(2).padEnd(8)} | ` +
      `${netPips.toFixed(1).padEnd(8)}`
    );
  }
  
  console.log('\n====================================');
  console.log('[ANALYSIS] Interpretation');
  console.log('====================================\n');
  
  const bucketWinRates: number[] = [];
  for (const bucketTrades of Object.values(buckets)) {
    if (bucketTrades.length > 10) {
      const wins = bucketTrades.filter(t => t.result === 'WIN' || t.result === 'PARTIAL_WIN' || t.result === 'BREAKEVEN');
      const winRate = (wins.length / bucketTrades.length) * 100;
      bucketWinRates.push(winRate);
    }
  }
  
  if (bucketWinRates.length >= 2) {
    const maxDiff = Math.max(...bucketWinRates) - Math.min(...bucketWinRates);
    
    if (maxDiff < 10) {
      console.log('❌ CONFIDENCE SCORE IS NOT PREDICTIVE');
      console.log(`   Win rates across buckets vary by only ${maxDiff.toFixed(1)}%`);
      console.log('   The confidence scoring system is not correlated with actual win/loss outcomes.');
      console.log('   Recommendation: Redesign the scoring formula to include factors that actually predict success.');
    } else if (maxDiff < 20) {
      console.log('⚠️  CONFIDENCE SCORE HAS WEAK PREDICTIVE POWER');
      console.log(`   Win rates across buckets vary by ${maxDiff.toFixed(1)}%`);
      console.log('   Some correlation exists, but not strong enough to rely on for filtering.');
    } else {
      console.log('✅ CONFIDENCE SCORE HAS PREDICTIVE POWER');
      console.log(`   Win rates across buckets vary by ${maxDiff.toFixed(1)}%`);
      console.log('   Higher confidence scores correlate with higher win rates.');
      console.log('   Recommendation: Focus on higher confidence buckets for live signals.');
    }
  }
  
  // Find profitable buckets
  const profitableBuckets: string[] = [];
  for (const [bucket, bucketTrades] of Object.entries(buckets)) {
    if (bucketTrades.length > 0) {
      const netPips = bucketTrades.reduce((sum, t) => sum + (t.pips || 0), 0);
      if (netPips > 0) {
        profitableBuckets.push(`${bucket} (+${netPips.toFixed(1)} pips)`);
      }
    }
  }
  
  if (profitableBuckets.length > 0) {
    console.log(`\n✅ PROFITABLE BUCKETS FOUND:`);
    profitableBuckets.forEach(b => console.log(`   ${b}`));
    console.log('   These confidence ranges generated positive returns in the backtest.');
  } else {
    console.log(`\n❌ NO PROFITABLE BUCKETS`);
    console.log('   All confidence ranges lost money in this backtest.');
    console.log('   The strategy needs fundamental changes, not just threshold tuning.');
  }
}

runBacktest().then(async trades => {
  analyzeByConfidence(trades);
  
  const fs = await import('fs');
  const path = await import('path');
  
  const outputPath = path.default.join(process.cwd(), 'backtest-confidence-analysis.json');
  fs.default.writeFileSync(outputPath, JSON.stringify(trades, null, 2));
  
  console.log(`\n[BACKTEST] Trades saved to: ${outputPath}`);
  process.exit(0);
}).catch(err => {
  console.error('[BACKTEST] Fatal error:', err);
  process.exit(1);
});
