/**
 * Analyze original metals walk-forward results broken out by pair
 * Compare XAUUSD vs XAGUSD performance separately
 */

const fs = require('fs');

const data = JSON.parse(fs.readFileSync('./backtest-walkforward-results.json', 'utf-8'));

// Extract all metals trades
const allMetalsTrades = [
  ...(data.metalsInSampleTrades || []),
  ...(data.metalsOutSampleTrades || [])
];

console.log('=== ORIGINAL METALS WALK-FORWARD (COMBINED) ===');
console.log(`In-sample: ${data.metalsInStats.signals} signals, ${data.metalsInStats.winRate.toFixed(1)}% WR, ${data.metalsInStats.avgR.toFixed(3)} avgR`);
console.log(`Out-of-sample: ${data.metalsOutStats.signals} signals, ${data.metalsOutStats.winRate.toFixed(1)}% WR, ${data.metalsOutStats.avgR.toFixed(3)} avgR`);

// Break out by pair
const xauIn = (data.metalsInSampleTrades || []).filter(t => t.pair === 'XAUUSD');
const xauOut = (data.metalsOutSampleTrades || []).filter(t => t.pair === 'XAUUSD');
const xagIn = (data.metalsInSampleTrades || []).filter(t => t.pair === 'XAGUSD');
const xagOut = (data.metalsOutSampleTrades || []).filter(t => t.pair === 'XAGUSD');

function calcStats(trades, label) {
  if (trades.length === 0) {
    console.log(`\n${label}: NO TRADES`);
    return;
  }
  
  const wins = trades.filter(t => t.result && t.result.startsWith('WIN'));
  const losses = trades.filter(t => t.result && t.result === 'LOSS');
  const winRate = (wins.length / trades.length * 100);
  
  // Calculate avgR from individual trade r values
  const totalR = trades.reduce((sum, t) => sum + (t.r || 0), 0);
  const avgR = totalR / trades.length;
  
  console.log(`\n${label}:`);
  console.log(`  Trades: ${trades.length}`);
  console.log(`  Wins: ${wins.length}, Losses: ${losses.length}`);
  console.log(`  Win Rate: ${winRate.toFixed(1)}%`);
  console.log(`  Avg R: ${avgR.toFixed(3)}`);
  console.log(`  Total R: ${totalR.toFixed(2)}`);
}

console.log('\n\n=== BREAKDOWN BY PAIR ===');

calcStats(xauIn, 'XAUUSD In-Sample (months 1-4)');
calcStats(xauOut, 'XAUUSD Out-of-Sample (months 5-6)');
calcStats(xagIn, 'XAGUSD In-Sample (months 1-4)');
calcStats(xagOut, 'XAGUSD Out-of-Sample (months 5-6)');

// Show sample trades
console.log('\n\n=== SAMPLE XAGUSD TRADES (first 5) ===');
const xagSample = [...xagIn, ...xagOut].slice(0, 5);
xagSample.forEach((t, i) => {
  console.log(`${i+1}. ${t.pair} ${t.direction} | Entry: ${t.entry} | Exit: ${t.exitPrice} | Pips: ${t.pips?.toFixed(1)} | R: ${t.r?.toFixed(3)} | Result: ${t.result}`);
});

console.log('\n\n=== SAMPLE XAUUSD TRADES (first 5) ===');
const xauSample = [...xauIn, ...xauOut].slice(0, 5);
xauSample.forEach((t, i) => {
  console.log(`${i+1}. ${t.pair} ${t.direction} | Entry: ${t.entry} | Exit: ${t.exitPrice} | Pips: ${t.pips?.toFixed(1)} | R: ${t.r?.toFixed(3)} | Result: ${t.result}`);
});

// Calculate what the combined result would be if we weighted by trade count
console.log('\n\n=== WEIGHTED AVERAGE ANALYSIS ===');
const xauTotalTrades = xauIn.length + xauOut.length;
const xagTotalTrades = xagIn.length + xagOut.length;
const totalTrades = xauTotalTrades + xagTotalTrades;

const xauAvgR = xauTotalTrades > 0 ? (xauIn.reduce((s, t) => s + (t.r || 0), 0) + xauOut.reduce((s, t) => s + (t.r || 0), 0)) / xauTotalTrades : 0;
const xagAvgR = xagTotalTrades > 0 ? (xagIn.reduce((s, t) => s + (t.r || 0), 0) + xagOut.reduce((s, t) => s + (t.r || 0), 0)) / xagTotalTrades : 0;

console.log(`XAUUSD: ${xauTotalTrades} trades, avgR ${xauAvgR.toFixed(3)}`);
console.log(`XAGUSD: ${xagTotalTrades} trades, avgR ${xagAvgR.toFixed(3)}`);
console.log(`Combined: ${totalTrades} trades`);
console.log(`Weighted avgR: ${((xauAvgR * xauTotalTrades + xagAvgR * xagTotalTrades) / totalTrades).toFixed(3)}`);
