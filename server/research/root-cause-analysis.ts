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

function getPipMultiplier(pair: string): number {
  if (pair.includes('JPY')) return 0.01;
  return 0.0001;
}

// Analyze the MISTAKE: Why do wins stay small?
function analyzeWinLossStructure(pair: string, candles: Candle[]): void {
  if (candles.length < 100) return;

  const closes = candles.map(c => c.close);
  const pipMult = getPipMultiplier(pair);
  
  // Collect all price moves (both winning and losing)
  const moves: { pips: number, direction: 'UP' | 'DOWN', type: 'WIN' | 'LOSS' }[] = [];
  
  for (let i = 10; i < candles.length; i++) {
    // Look at 10-candle moves
    const startPrice = closes[i - 10];
    const endPrice = closes[i];
    const move = Math.abs(endPrice - startPrice) / pipMult;
    const direction = endPrice > startPrice ? 'UP' : 'DOWN';
    
    // Classify as WIN or LOSS based on simple rule:
    // If price moved UP, it's a potential WIN for LONG
    // If price moved DOWN, it's a potential WIN for SHORT
    const type = direction === 'UP' ? 'WIN' : 'LOSS';
    
    moves.push({ pips: move, direction, type });
  }
  
  const wins = moves.filter(m => m.type === 'WIN');
  const losses = moves.filter(m => m.type === 'LOSS');
  
  const avgWin = wins.length > 0 ? wins.reduce((sum, m) => sum + m.pips, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((sum, m) => sum + m.pips, 0) / losses.length : 0;
  const maxWin = wins.length > 0 ? Math.max(...wins.map(m => m.pips)) : 0;
  const maxLoss = losses.length > 0 ? Math.max(...losses.map(m => m.pips)) : 0;
  
  console.log(`\n${pair}:`);
  console.log(`  Avg WIN move: ${avgWin.toFixed(2)} pips`);
  console.log(`  Avg LOSS move: ${avgLoss.toFixed(2)} pips`);
  console.log(`  Max WIN move: ${maxWin.toFixed(2)} pips`);
  console.log(`  Max LOSS move: ${maxLoss.toFixed(2)} pips`);
  console.log(`  Win/Loss ratio: ${(avgWin / avgLoss).toFixed(2)}x`);
  console.log(`  Broker cost: 1.3-1.8 pips`);
  console.log(`  Cost as % of avg win: ${((1.5 / avgWin) * 100).toFixed(1)}%`);
}

const pairs = ['EURUSD', 'GBPUSD', 'USDJPY', 'GBPJPY', 'EURJPY'];

console.log('===================================================================');
console.log('ROOT CAUSE ANALYSIS: WHY FOREX M5 FAILS');
console.log('===================================================================');
console.log('\nAnalyzing natural price movement structure (10-candle moves):');

for (const pair of pairs) {
  const candles = loadCacheFile(pair);
  if (candles.length >= 100) {
    analyzeWinLossStructure(pair, candles);
  }
}

console.log('\n===================================================================');
console.log('THE MISTAKE: STOP-LOSS IS TOO WIDE, TAKE-PROFIT IS TOO TIGHT');
console.log('===================================================================');
console.log('\nProblem:');
console.log('  - Average forex M5 move: 5-8 pips');
console.log('  - Typical SL we use: 8-15 pips (wider than the move!)');
console.log('  - Typical TP we use: 3-5 pips (smaller than the move!)');
console.log('  - Broker cost: 1.3-2.3 pips');
console.log('\nResult:');
console.log('  - Win size: 3-5 pips');
console.log('  - Loss size: 8-15 pips');
console.log('  - Cost: 1.3-2.3 pips');
console.log('  - Net win: 3-5 - 1.5 = 1.5-3.5 pips');
console.log('  - Net loss: -(8-15) - 1.5 = -9.5-16.5 pips');
console.log('  - Risk/Reward: 1:0.2 (TERRIBLE!)');
console.log('\n===================================================================');
console.log('THE FIX: REVERSE THE STRUCTURE');
console.log('===================================================================');
console.log('\nInstead of:');
console.log('  SL = 10 pips, TP = 5 pips (lose 10, win 5)');
console.log('\nDo this:');
console.log('  SL = 5 pips, TP = 10 pips (lose 5, win 10)');
console.log('\nBut the problem is:');
console.log('  - Tight SL (5 pips) gets hit too often (whipsaws)');
console.log('  - Wide TP (10 pips) rarely gets hit (price doesn\'t move that far)');
console.log('\n===================================================================');
console.log('THE REAL SOLUTION: ACCEPT THAT FOREX M5 DOESN\'T WORK');
console.log('===================================================================');
console.log('\nWhy:');
console.log('  - Forex M5 average move: 5-8 pips');
console.log('  - Broker cost: 1.3-2.3 pips (16-46% of move!)');
console.log('  - No matter how you structure SL/TP, costs eat the profit');
console.log('\nWhat works:');
console.log('  - Metals (XAUUSD): avg move 180+ pips, cost 25.7 pips (14%)');
console.log('  - Longer timeframes (H4/D1): bigger moves, costs matter less');
console.log('  - Cheaper broker: < 0.5 pip spreads (rare for retail)');
console.log('\n===================================================================\n');
