const fs = require('fs');

const data = JSON.parse(fs.readFileSync('backtest-walkforward-results.json', 'utf8'));

console.log('=== ORIGINAL METALS WALK-FORWARD RESULTS ===\n');

// Extract per-pair data from metalsTradesFull
const metalsTrades = data.metalsTradesFull || {};

console.log('Available pairs in metalsTradesFull:', Object.keys(metalsTrades));
console.log('');

// Analyze each pair separately
for (const [pair, trades] of Object.entries(metalsTrades)) {
  if (!Array.isArray(trades) || trades.length === 0) {
    console.log(`${pair}: No trades`);
    continue;
  }

  const inSampleTrades = trades.filter(t => new Date(t.entryTime) < new Date(data.metalsCutoff));
  const outSampleTrades = trades.filter(t => new Date(t.entryTime) >= new Date(data.metalsCutoff));

  // Calculate in-sample stats
  const inSampleWins = inSampleTrades.filter(t => t.result && t.result.startsWith('WIN')).length;
  const inSampleLosses = inSampleTrades.filter(t => t.result === 'LOSS').length;
  const inSampleWinRate = inSampleTrades.length > 0 ? (inSampleWins / inSampleTrades.length * 100) : 0;
  const inSampleAvgR = inSampleTrades.length > 0 
    ? inSampleTrades.reduce((sum, t) => sum + (t.r || 0), 0) / inSampleTrades.length 
    : 0;

  // Calculate out-of-sample stats
  const outSampleWins = outSampleTrades.filter(t => t.result && t.result.startsWith('WIN')).length;
  const outSampleLosses = outSampleTrades.filter(t => t.result === 'LOSS').length;
  const outSampleWinRate = outSampleTrades.length > 0 ? (outSampleWins / outSampleTrades.length * 100) : 0;
  const outSampleAvgR = outSampleTrades.length > 0 
    ? outSampleTrades.reduce((sum, t) => sum + (t.r || 0), 0) / outSampleTrades.length 
    : 0;

  console.log(`\n${pair}:`);
  console.log(`  Total trades: ${trades.length}`);
  console.log(`  In-sample (months 1-4):`);
  console.log(`    Trades: ${inSampleTrades.length}`);
  console.log(`    Win rate: ${inSampleWinRate.toFixed(1)}% (${inSampleWins}W / ${inSampleLosses}L)`);
  console.log(`    Avg R: ${inSampleAvgR.toFixed(3)}`);
  console.log(`  Out-of-sample (months 5-6):`);
  console.log(`    Trades: ${outSampleTrades.length}`);
  console.log(`    Win rate: ${outSampleWinRate.toFixed(1)}% (${outSampleWins}W / ${outSampleLosses}L)`);
  console.log(`    Avg R: ${outSampleAvgR.toFixed(3)}`);
}

// Calculate combined stats
console.log('\n\n=== COMBINED METALS (XAUUSD + XAGUSD) ===\n');

const allMetalsTrades = [...(metalsTrades.XAUUSD || []), ...(metalsTrades.XAGUSD || [])];
const allInSample = allMetalsTrades.filter(t => new Date(t.entryTime) < new Date(data.metalsCutoff));
const allOutSample = allMetalsTrades.filter(t => new Date(t.entryTime) >= new Date(data.metalsCutoff));

const combinedInSampleAvgR = allInSample.length > 0 
  ? allInSample.reduce((sum, t) => sum + (t.r || 0), 0) / allInSample.length 
  : 0;
const combinedOutSampleAvgR = allOutSample.length > 0 
  ? allOutSample.reduce((sum, t) => sum + (t.r || 0), 0) / allOutSample.length 
  : 0;

console.log(`Combined in-sample avg R: ${combinedInSampleAvgR.toFixed(3)}`);
console.log(`Combined out-of-sample avg R: ${combinedOutSampleAvgR.toFixed(3)}`);

// Compare to reported stats
console.log('\n\n=== COMPARISON TO REPORTED STATS ===\n');
console.log(`Reported metalsInStats.avgR: ${data.metalsInStats?.avgR?.toFixed(3) || 'N/A'}`);
console.log(`Calculated combined in-sample avg R: ${combinedInSampleAvgR.toFixed(3)}`);
console.log(`Reported metalsOutStats.avgR: ${data.metalsOutStats?.avgR?.toFixed(3) || 'N/A'}`);
console.log(`Calculated combined out-of-sample avg R: ${combinedOutSampleAvgR.toFixed(3)}`);

// Show sample trades for each pair
console.log('\n\n=== SAMPLE TRADES ===\n');

for (const [pair, trades] of Object.entries(metalsTrades)) {
  if (!Array.isArray(trades) || trades.length === 0) continue;
  
  console.log(`\n${pair} - First 3 trades:`);
  trades.slice(0, 3).forEach((t, i) => {
    console.log(`  ${i+1}. ${t.direction} | Entry: ${t.entry} | Exit: ${t.exit} | R: ${t.r?.toFixed(3)} | Result: ${t.result}`);
  });
}
