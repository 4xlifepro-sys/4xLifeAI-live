import { supabase } from './server/supabase.js';

async function run() {
  if (!supabase) {
    console.log("No supabase client");
    return;
  }
  const { data, error } = await supabase.from('signals').select('*');
  if (error) {
    console.error(error);
    return;
  }
  
  const accepted = data.filter(s => s.status !== 'REJECTED' && ['WIN', 'LOSS'].includes(s.result));
  const wins = accepted.filter(s => s.result === 'WIN');
  const losses = accepted.filter(s => s.result === 'LOSS');
  
  console.log(`Total Trades: ${accepted.length}`);
  console.log(`Wins: ${wins.length}`);
  console.log(`Losses: ${losses.length}`);
  
  if (accepted.length === 0) return;

  const winRate = wins.length / accepted.length;
  const lossRate = losses.length / accepted.length;
  console.log(`Win Rate: ${(winRate * 100).toFixed(2)}%`);
  console.log(`Loss Rate: ${(lossRate * 100).toFixed(2)}%`);

  // Calculate Average R:R based on TP/SL distance
  let totalRR = 0;
  let totalRisk = 0;
  let totalReward = 0;

  // Let's assume we can calculate gross profit / loss roughly by R:R
  let grossProfit = 0;
  let grossLoss = 0;
  let largestWinner = 0;
  let largestLoser = 0;

  let currentStreak = 0;
  let longestWinningStreak = 0;
  let longestLosingStreak = 0;
  let currentLossStreak = 0;
  
  // order by timestamp
  accepted.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  let equity = 100;
  let peakEquity = 100;
  let maxDrawdown = 0;

  const pairStats: any = {};
  const dirStats: any = {};
  const tierStats: any = {};

  for (const s of accepted) {
    const risk = Math.abs(s.entry_price - s.sl);
    const reward = Math.abs(s.entry_price - s.tp1); // Use TP1 for reward proxy
    const rr = risk > 0 ? reward / risk : 0;
    totalRR += rr;
    
    let tradeResult = 0;
    if (s.result === 'WIN') {
      tradeResult = rr; // + R
      grossProfit += rr;
      if (rr > largestWinner) largestWinner = rr;
      
      currentStreak++;
      if (currentStreak > longestWinningStreak) longestWinningStreak = currentStreak;
      currentLossStreak = 0;
    } else {
      tradeResult = -1; // -1 R
      grossLoss += 1;
      if (1 > largestLoser) largestLoser = 1;
      
      currentLossStreak++;
      if (currentLossStreak > longestLosingStreak) longestLosingStreak = currentLossStreak;
      currentStreak = 0;
    }

    equity += tradeResult;
    if (equity > peakEquity) peakEquity = equity;
    const drawdown = ((peakEquity - equity) / peakEquity) * 100;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;

    // Stats
    if (!pairStats[s.pair]) pairStats[s.pair] = { w: 0, l: 0 };
    if (!dirStats[s.direction]) dirStats[s.direction] = { w: 0, l: 0 };
    if (!tierStats[s.tier]) tierStats[s.tier] = { w: 0, l: 0 };

    if (s.result === 'WIN') {
      pairStats[s.pair].w++;
      dirStats[s.direction].w++;
      tierStats[s.tier].w++;
    } else {
      pairStats[s.pair].l++;
      dirStats[s.direction].l++;
      tierStats[s.tier].l++;
    }
  }

  const avgRR = totalRR / accepted.length;
  console.log(`Average R:R: ${avgRR.toFixed(2)}`);
  
  const avgWin = grossProfit / (wins.length || 1);
  const avgLoss = grossLoss / (losses.length || 1);
  
  const expectancy = (winRate * avgWin) - (lossRate * avgLoss);
  console.log(`Expectancy: ${expectancy.toFixed(2)} R`);
  
  const profitFactor = grossProfit / (grossLoss || 1);
  console.log(`Profit Factor: ${profitFactor.toFixed(2)}`);

  console.log(`Largest Winner: ${largestWinner.toFixed(2)} R`);
  console.log(`Largest Loser: ${largestLoser.toFixed(2)} R`);
  
  console.log(`Max Drawdown: ${maxDrawdown.toFixed(2)}%`);
  console.log(`Longest Winning Streak: ${longestWinningStreak}`);
  console.log(`Longest Losing Streak: ${longestLosingStreak}`);

  const getBest = (stats: any) => Object.keys(stats).map(k => ({ k, wr: stats[k].w / ((stats[k].w + stats[k].l)||1) })).sort((a,b) => b.wr - a.wr);
  const pairs = getBest(pairStats);
  const dirs = getBest(dirStats);
  const tiers = getBest(tierStats);

  console.log(`Best Pair: ${pairs.length > 0 ? pairs[0].k : 'N/A'}`);
  console.log(`Worst Pair: ${pairs.length > 0 ? pairs[pairs.length-1].k : 'N/A'}`);
  
  console.log(`Best Direction: ${dirs.length > 0 ? dirs[0].k : 'N/A'}`);
  console.log(`Worst Direction: ${dirs.length > 0 ? dirs[dirs.length-1].k : 'N/A'}`);
  
  console.log(`Best Tier: ${tiers.length > 0 ? tiers[0].k : 'N/A'}`);
  console.log(`Worst Tier: ${tiers.length > 0 ? tiers[tiers.length-1].k : 'N/A'}`);
}

run();
