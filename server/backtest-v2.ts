import { fetchHistoricalCandles } from './live-market-feed.js';
import { detectSignalV2 } from './engine2.js';
import type { Candle } from '../src/types.js';

const PAIRS = [
  'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'USDCAD',
  'AUDUSD', 'NZDUSD', 'EURGBP', 'EURJPY', 'GBPJPY',
  'AUDJPY', 'NZDJPY', 'CADJPY', 'CHFJPY', 'EURAUD',
  'EURNZD', 'GBPAUD', 'XAUUSD', 'XAGUSD', 'BTCUSD',
  'ETHUSD', 'SOLUSD', 'XRPUSD', 'BNBUSD', 'ADAUSD',
  'LTCUSD', 'DOTUSD'
];

const MONTHS = 6;

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
  result?: 'WIN_TP1' | 'WIN_TP2' | 'WIN_TP3' | 'LOSS' | 'OPEN';
  confidence?: number;
  reason?: string;
}

// Pip multiplier
function getPipMultiplier(pair: string): number {
  if (pair.includes('JPY')) return 0.01;
  if (pair.startsWith('X') && !pair.includes('XRP')) return 0.1;
  if (['BTCUSD','ETHUSD','SOLUSD','BNBUSD','LTCUSD','DOTUSD','ADAUSD','XRPUSD'].includes(pair)) return 1;
  return 0.0001;
}

// Simulate trade with 3 TPs (partial close at each)
function simulateTrade(trade: Trade, futureCandles: Candle[], pair: string): Trade {
  const isLong = trade.direction === 'LONG';
  const pipMultiplier = getPipMultiplier(pair);
  const result = { ...trade };

  let highestTpHit: 'TP3' | 'TP2' | 'TP1' | null = null;

  for (let i = 0; i < futureCandles.length; i++) {
    const candle = futureCandles[i];

    if (isLong) {
      // SL check - if hit, determine result based on highest TP reached
      if (candle.low <= trade.sl) {
        result.exitPrice = trade.sl;
        result.exitTime = candle.timestamp;
        result.exitReason = 'SL';
        result.result = highestTpHit ? ('WIN_' + highestTpHit as any) : 'LOSS';
        if (!highestTpHit) result.pips = (trade.sl - trade.entry) / pipMultiplier;
        else result.pips = (trade[highestTpHit === 'TP1' ? 'tp1' : highestTpHit === 'TP2' ? 'tp2' : 'tp3'] - trade.entry) / pipMultiplier;
        return result;
      }

      // Track highest TP hit (check from highest to lowest)
      if (candle.high >= trade.tp3) { highestTpHit = 'TP3'; }
      else if (candle.high >= trade.tp2) { highestTpHit = 'TP2'; }
      else if (candle.high >= trade.tp1) { highestTpHit = 'TP1'; }
    } else {
      if (candle.high >= trade.sl) {
        result.exitPrice = trade.sl;
        result.exitTime = candle.timestamp;
        result.exitReason = 'SL';
        result.result = highestTpHit ? ('WIN_' + highestTpHit as any) : 'LOSS';
        if (!highestTpHit) result.pips = (trade.entry - trade.sl) / pipMultiplier;
        else result.pips = (trade.entry - trade[highestTpHit === 'TP1' ? 'tp1' : highestTpHit === 'TP2' ? 'tp2' : 'tp3']) / pipMultiplier;
        return result;
      }

      if (candle.low <= trade.tp3) { highestTpHit = 'TP3'; }
      else if (candle.low <= trade.tp2) { highestTpHit = 'TP2'; }
      else if (candle.low <= trade.tp1) { highestTpHit = 'TP1'; }
    }
  }

  // Trade didn't close - mark as OPEN
  const lastClose = futureCandles[futureCandles.length - 1]?.close || trade.entry;
  result.exitPrice = lastClose;
  result.exitTime = futureCandles[futureCandles.length - 1]?.timestamp || trade.entryTime;
  result.exitReason = 'OPEN';
  result.result = 'OPEN';
  if (isLong) {
    result.pips = (lastClose - trade.entry) / pipMultiplier;
  } else {
    result.pips = (trade.entry - lastClose) / pipMultiplier;
  }

  return result;
}

async function runBacktest() {
  console.log('\n====================================');
  console.log('[BACKTEST-V2] Trend Pullback Strategy');
  console.log('====================================\n');

  const allTrades: Trade[] = [];
  const startTime = Date.now();
  let globalH4Start: string | null = null;
  let globalH4End: string | null = null;
  let globalM5Start: string | null = null;
  let globalM5End: string | null = null;

  for (const pair of PAIRS) {
    console.log(`\n[BACKTEST-V2] Processing ${pair}...`);

    try {
      const h4 = await fetchHistoricalCandles(pair, '4h', MONTHS * 180);
      await new Promise(r => setTimeout(r, 200));

      const m5 = await fetchHistoricalCandles(pair, '5min', MONTHS * 8640);
      await new Promise(r => setTimeout(r, 200));

      if (!h4 || !m5) {
        console.warn(`  Failed to fetch data for ${pair}`);
        continue;
      }

      if (h4.length < 30 || m5.length < 50) {
        console.warn(`  Insufficient data: H4=${h4.length}, M5=${m5.length}`);
        continue;
      }

      if (!globalH4Start) {
        globalH4Start = h4[0].timestamp;
        globalH4End = h4[h4.length - 1].timestamp;
        globalM5Start = m5[0].timestamp;
        globalM5End = m5[m5.length - 1].timestamp;
      }

      console.log(`  H4: ${h4.length} candles (${h4[0].timestamp} to ${h4[h4.length-1].timestamp})`);
      console.log(`  M5: ${m5.length} candles (${m5[0].timestamp} to ${m5[m5.length-1].timestamp})`);

      let pairSignalCount = 0;
      let lastSignalTime = 0;

      // Step through M5 candles
      for (let i = 50; i < m5.length - 50; i++) {
        const m5Slice = m5.slice(0, i + 1);

        // Only check every 3rd candle for performance (one check per 15 min)
        if (i % 3 !== 0) continue;

        // Max 1 signal per pair per 4 hours
        const currentTime = new Date(m5[i].timestamp).getTime();
        if (currentTime - lastSignalTime < 4 * 60 * 60 * 1000) continue;

        const signal = detectSignalV2(pair, h4, m5Slice);

        if (signal) {
          const trade: Trade = {
            pair,
            direction: signal.direction,
            entry: signal.entry,
            sl: signal.sl,
            tp1: signal.tp1,
            tp2: signal.tp2,
            tp3: signal.tp3,
            entryTime: m5[i].timestamp,
            confidence: signal.confidence,
            reason: signal.reason
          };

          const futureCandles = m5.slice(i + 1, Math.min(i + 100, m5.length));
          if (futureCandles.length > 0) {
            const completed = simulateTrade(trade, futureCandles, pair);
            allTrades.push(completed);
            pairSignalCount++;
            lastSignalTime = currentTime;

            if (pairSignalCount % 5 === 0) {
              console.log(`  ✓ ${pairSignalCount} signals so far`);
            }
          }
        }
      }

      console.log(`[BACKTEST-V2] ${pair}: ${pairSignalCount} signals`);
    } catch (e: any) {
      console.error(`  Error processing ${pair}:`, e.message);
    }
  }

  // Calculate stats
  const closedTrades = allTrades.filter(t => t.exitReason !== 'OPEN');
  const wins = closedTrades.filter(t => t.result === 'WIN_TP1' || t.result === 'WIN_TP2' || t.result === 'WIN_TP3');
  const losses = closedTrades.filter(t => t.result === 'LOSS');
  const tp1Wins = closedTrades.filter(t => t.result === 'WIN_TP1');
  const tp2Wins = closedTrades.filter(t => t.result === 'WIN_TP2');
  const tp3Wins = closedTrades.filter(t => t.result === 'WIN_TP3');

  const winRate = closedTrades.length > 0 ? (wins.length / closedTrades.length) * 100 : 0;
  const tp1Rate = closedTrades.length > 0 ? (tp1Wins.length / closedTrades.length) * 100 : 0;
  const tp2Rate = closedTrades.length > 0 ? (tp2Wins.length / closedTrades.length) * 100 : 0;
  const tp3Rate = closedTrades.length > 0 ? (tp3Wins.length / closedTrades.length) * 100 : 0;

  const winPips = wins.reduce((sum, t) => sum + (t.pips || 0), 0);
  const lossPips = Math.abs(losses.reduce((sum, t) => sum + (t.pips || 0), 0));
  const avgWin = wins.length > 0 ? winPips / wins.length : 0;
  const avgLoss = losses.length > 0 ? lossPips / losses.length : 0;
  const totalPips = allTrades.reduce((sum, t) => sum + (t.pips || 0), 0);

  // Max drawdown
  let maxDrawdown = 0;
  let peak = 0;
  let running = 0;
  for (const t of closedTrades) {
    running += t.pips || 0;
    if (running > peak) peak = running;
    const dd = peak - running;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  // Signal frequency
  const firstSignal = allTrades.length > 0 ? allTrades[0].entryTime : null;
  const lastSignal = allTrades.length > 0 ? allTrades[allTrades.length - 1].entryTime : null;
  let signalsPerWeek = 0;
  if (firstSignal && lastSignal) {
    const days = (new Date(lastSignal).getTime() - new Date(firstSignal).getTime()) / (1000 * 60 * 60 * 24);
    signalsPerWeek = days > 0 ? allTrades.length / (days / 7) : 0;
  }

  console.log('\n====================================');
  console.log('[BACKTEST-V2] Summary Statistics');
  console.log('====================================\n');

  console.log(`H4 Data Range: ${globalH4Start || 'N/A'} to ${globalH4End || 'N/A'}`);
  console.log(`M5 Data Range: ${globalM5Start || 'N/A'} to ${globalM5End || 'N/A'}`);
  console.log(`\nTotal Signals: ${allTrades.length}`);
  console.log(`Closed Trades: ${closedTrades.length}`);
  console.log(`\n--- Win Breakdown ---`);
  console.log(`TP1 Wins: ${tp1Wins.length} (${tp1Rate.toFixed(1)}%)`);
  console.log(`TP2 Wins: ${tp2Wins.length} (${tp2Rate.toFixed(1)}%)`);
  console.log(`TP3 Wins: ${tp3Wins.length} (${tp3Rate.toFixed(1)}%)`);
  console.log(`Total Wins: ${wins.length} (${winRate.toFixed(1)}%)`);
  console.log(`Losses: ${losses.length}`);
  console.log(`\n--- Pips ---`);
  console.log(`Average Win: ${avgWin.toFixed(2)} pips`);
  console.log(`Average Loss: ${avgLoss.toFixed(2)} pips`);
  console.log(`Total Pips: ${totalPips.toFixed(2)}`);
  console.log(`Max Drawdown: ${maxDrawdown.toFixed(2)} pips`);
  console.log(`\nSignals/Week: ${signalsPerWeek.toFixed(1)}`);
  console.log(`First Signal: ${firstSignal || 'N/A'}`);
  console.log(`Last Signal: ${lastSignal || 'N/A'}`);

  // Save results
  const fs = await import('fs');
  fs.writeFileSync('backtest-v2-results.json', JSON.stringify({
    summary: {
      totalSignals: allTrades.length,
      closedTrades: closedTrades.length,
      winRate: `${winRate.toFixed(1)}%`,
      tp1Rate: `${tp1Rate.toFixed(1)}%`,
      tp2Rate: `${tp2Rate.toFixed(1)}%`,
      tp3Rate: `${tp3Rate.toFixed(1)}%`,
      avgWin: `${avgWin.toFixed(2)} pips`,
      avgLoss: `${avgLoss.toFixed(2)} pips`,
      totalPips: `${totalPips.toFixed(2)}`,
      maxDrawdown: `${maxDrawdown.toFixed(2)} pips`,
      signalsPerWeek: signalsPerWeek.toFixed(1)
    },
    trades: allTrades
  }, null, 2));

  console.log(`\nResults saved to: backtest-v2-results.json`);
  console.log(`\n====================================`);
  console.log(`Complete in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
  console.log('====================================\n');
}

runBacktest().catch(err => {
  console.error('[BACKTEST-V2] Fatal error:', err);
  process.exit(1);
});
