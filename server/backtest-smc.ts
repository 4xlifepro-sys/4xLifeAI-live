import 'dotenv/config';
import { fetchHistoricalCandles } from './live-market-feed.js';
import { detectSMCSetup } from './smc-engine.js';
import { getPipMultiplier } from './engine.js';
import type { Candle } from '../src/types.js';

const PAIRS = [
  'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'USDCAD',
  'AUDUSD', 'NZDUSD', 'EURGBP', 'EURJPY', 'GBPJPY',
  'AUDJPY', 'NZDJPY', 'CADJPY', 'CHFJPY', 'EURAUD',
  'EURNZD', 'GBPAUD', 'XAUUSD', 'XAGUSD', 'BTCUSD',
  'ETHUSD', 'SOLUSD', 'XRPUSD', 'BNBUSD', 'ADAUSD',
  'LTCUSD', 'DOTUSD'
];

const TP_RATIOS = [1.5, 2.0];
const USE_IDM = process.env.USE_IDM === 'true';
const OUTPUT_FILE = USE_IDM ? 'backtest-smc-idm-results.json' : 'backtest-smc-results.json';

interface Trade {
  pair: string;
  direction: 'LONG' | 'SHORT';
  entry: number;
  sl: number;
  tp1: number;
  tp2: number;
  entryTime: string;
  exitTime?: string;
  exitPrice?: number;
  exitReason?: 'TP1' | 'TP2' | 'SL' | 'OPEN';
  pips?: number;
  result?: 'WIN' | 'LOSS' | 'BREAKEVEN' | 'OPEN';
  confidence?: number;
  timeframe?: 'M5';
  reason?: string;
  tpRatio?: number;
}

async function fetchHistoricalData(pair: string, months: number = 6) {
  console.log(`[BACKTEST-SMC] Fetching ${months} months of data for ${pair}...`);

  try {
    const h4Count = months * 180;
    const m5Count = months * 8640;

    const h4 = await fetchHistoricalCandles(pair, '4h', h4Count);
    await new Promise(r => setTimeout(r, 200));

    const m5 = await fetchHistoricalCandles(pair, '5min', m5Count);
    await new Promise(r => setTimeout(r, 200));

    if (!h4 || !m5) {
      console.warn(`[BACKTEST-SMC] Failed to fetch data for ${pair}`);
      return null;
    }

    if (h4.length < 50 || m5.length < 50) {
      console.warn(`[BACKTEST-SMC] Insufficient data for ${pair}: H4=${h4.length}, M5=${m5.length}`);
      return null;
    }

    return { h4, m5 };
  } catch (e: any) {
    console.error(`[BACKTEST-SMC] Error fetching ${pair}:`, e.message);
    return null;
  }
}

function simulateTrade(trade: Trade, futureCandles: Candle[], pair: string): Trade {
  const isLong = trade.direction === 'LONG';
  const pipMultiplier = getPipMultiplier(pair);

  let effectiveSL = trade.sl;
  let tp1Hit = false;
  const result = { ...trade };

  for (let i = 0; i < futureCandles.length; i++) {
    const candle = futureCandles[i];

    if (isLong) {
      if (candle.low <= effectiveSL) {
        result.exitPrice = effectiveSL;
        result.exitTime = candle.timestamp;
        result.exitReason = 'SL';
        result.result = tp1Hit ? 'BREAKEVEN' : 'LOSS';
        break;
      }

      if (candle.high >= trade.tp2 && tp1Hit) {
        result.exitPrice = trade.tp2;
        result.exitTime = candle.timestamp;
        result.exitReason = 'TP2';
        result.result = 'WIN';
        break;
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
        result.result = tp1Hit ? 'BREAKEVEN' : 'LOSS';
        break;
      }

      if (candle.low <= trade.tp2 && tp1Hit) {
        result.exitPrice = trade.tp2;
        result.exitTime = candle.timestamp;
        result.exitReason = 'TP2';
        result.result = 'WIN';
        break;
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

async function runBacktest() {
  console.log('\n====================================');
  console.log(`[BACKTEST-SMC] Starting SMC Backtest ${USE_IDM ? '(WITH IDM)' : '(BASELINE, no IDM)'}`);
  console.log('====================================\n');

  const allTrades: Trade[] = [];
  const startTime = Date.now();
  let globalH4Start: string | null = null;
  let globalH4End: string | null = null;
  let globalM5Start: string | null = null;
  let globalM5End: string | null = null;

  for (const pair of PAIRS) {
    console.log(`\n[BACKTEST-SMC] Processing ${pair}...`);

    const data = await fetchHistoricalData(pair, 6);
    if (!data) continue;

    const { h4, m5 } = data;

    if (!globalH4Start) {
      globalH4Start = h4[0].timestamp;
      globalH4End = h4[h4.length - 1].timestamp;
      globalM5Start = m5[0].timestamp;
      globalM5End = m5[m5.length - 1].timestamp;
    }

    console.log(`[BACKTEST-SMC] ${pair} data ranges:`);
    console.log(`  H4: ${h4[0].timestamp} to ${h4[h4.length - 1].timestamp} (${h4.length} candles)`);
    console.log(`  M5: ${m5[0].timestamp} to ${m5[m5.length - 1].timestamp} (${m5.length} candles)`);

    let pairSignalCount = 0;

    for (let i = 50; i < m5.length - 100; i += 5) {
      const m5Slice = m5.slice(0, i + 1);

      // Try first TP ratio
      const signal = detectSMCSetup(pair, h4, m5Slice, TP_RATIOS[0], USE_IDM);

      if (signal) {
        // Create trades for each TP ratio using the SAME signal entry/SL
        const risk = signal.direction === 'LONG'
          ? signal.entry - signal.sl
          : signal.sl - signal.entry;

        for (const tpRatio of TP_RATIOS) {
          const tp1 = signal.direction === 'LONG'
            ? signal.entry + risk * tpRatio
            : signal.entry - risk * tpRatio;
          const tp2 = signal.direction === 'LONG'
            ? signal.entry + risk * tpRatio * 1.5
            : signal.entry - risk * tpRatio * 1.5;

          const trade: Trade = {
            pair,
            direction: signal.direction,
            entry: signal.entry,
            sl: signal.sl,
            tp1,
            tp2,
            entryTime: m5[i].timestamp,
            confidence: signal.confidence,
            timeframe: 'M5',
            reason: signal.reason,
            tpRatio
          };

          const futureCandles = m5.slice(i + 1, Math.min(i + 101, m5.length));

          if (futureCandles.length > 0) {
            const completedTrade = simulateTrade(trade, futureCandles, pair);
            allTrades.push(completedTrade);
            pairSignalCount++;

            if (pairSignalCount % 10 === 0) {
              console.log(`  ✓ ${pair}: ${pairSignalCount} signals (TP ratio ${tpRatio})`);
            }
          }
        }
        
        // Skip ahead to avoid re-firing the same setup
        // Skip past the entry candle plus some buffer
        i += 50;
      }
    }

    console.log(`[BACKTEST-SMC] ${pair} complete: ${pairSignalCount} signals`);
  }

  const closedTrades = allTrades.filter(t => t.exitReason !== 'OPEN');
  const wins = closedTrades.filter(t => t.result === 'WIN');
  const losses = closedTrades.filter(t => t.result === 'LOSS');
  const breakevens = closedTrades.filter(t => t.result === 'BREAKEVEN');

  const winRate = closedTrades.length > 0 ? (wins.length / closedTrades.length) * 100 : 0;

  const winPips = wins.reduce((sum, t) => sum + (t.pips || 0), 0);
  const lossPips = Math.abs(losses.reduce((sum, t) => sum + (t.pips || 0), 0));

  const avgWinPips = wins.length > 0 ? winPips / wins.length : 0;
  const avgLossPips = losses.length > 0 ? lossPips / losses.length : 0;

  const totalPips = allTrades.reduce((sum, t) => sum + (t.pips || 0), 0);

  let maxDrawdown = 0;
  let peak = 0;
  let runningTotal = 0;

  for (const trade of closedTrades) {
    runningTotal += trade.pips || 0;
    if (runningTotal > peak) peak = runningTotal;
    const drawdown = peak - runningTotal;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }

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

  const firstSignalDate = allTrades.length > 0 ? allTrades[0].entryTime : null;
  const lastSignalDate = allTrades.length > 0 ? allTrades[allTrades.length - 1].entryTime : null;

  let daysToFirstSignal: number | null = null;
  let signalFrequency = 0;

  if (firstSignalDate && globalM5Start) {
    const firstSignal = new Date(firstSignalDate);
    const dataStart = new Date(globalM5Start);
    daysToFirstSignal = (firstSignal.getTime() - dataStart.getTime()) / (1000 * 60 * 60 * 24);

    if (lastSignalDate) {
      const lastSignal = new Date(lastSignalDate);
      const days = (lastSignal.getTime() - firstSignal.getTime()) / (1000 * 60 * 60 * 24);
      signalFrequency = days > 0 ? allTrades.length / (days / 7) : 0;
    }
  }

  const durations = closedTrades
    .filter(t => t.exitTime && t.entryTime)
    .map(t => new Date(t.exitTime!).getTime() - new Date(t.entryTime).getTime());

  const avgTradeDuration = durations.length > 0
    ? durations.reduce((sum, d) => sum + d, 0) / durations.length
    : 0;

  const trades15 = closedTrades.filter(t => t.tpRatio === 1.5);
  const trades20 = closedTrades.filter(t => t.tpRatio === 2.0);

  console.log('\n====================================');
  console.log('[BACKTEST-SMC] Summary Statistics');
  console.log('====================================\n');

  console.log(`H4 Data Range: ${globalH4Start || 'N/A'} to ${globalH4End || 'N/A'}`);
  console.log(`M5 Data Range: ${globalM5Start || 'N/A'} to ${globalM5End || 'N/A'}`);
  console.log(`\nTotal Signals Fired: ${allTrades.length}`);
  console.log(`Closed Trades: ${closedTrades.length}`);
  console.log(`  Wins: ${wins.length}`);
  console.log(`  Losses: ${losses.length}`);
  console.log(`  Breakevens: ${breakevens.length}`);
  console.log(`\nWin Rate: ${winRate.toFixed(2)}%`);
  console.log(`Average Win: ${avgWinPips.toFixed(2)} pips`);
  console.log(`Average Loss: ${avgLossPips.toFixed(2)} pips`);
  console.log(`Reward:Risk Ratio: ${avgLossPips > 0 ? (avgWinPips / avgLossPips).toFixed(2) : 'N/A'}:1`);
  console.log(`Total Pips: ${totalPips.toFixed(2)}`);
  console.log(`\nMax Drawdown: ${maxDrawdown.toFixed(2)} pips`);
  console.log(`Max Consecutive Losses: ${maxConsecutiveLosses}`);
  console.log(`\nAvg Trade Duration: ${(avgTradeDuration / (1000 * 60)).toFixed(1)} minutes`);
  console.log(`\nSignal Frequency: ${signalFrequency.toFixed(2)} signals per week`);
  console.log(`Days to First Signal: ${daysToFirstSignal?.toFixed(1) || 'N/A'}`);
  console.log(`First Signal: ${firstSignalDate || 'N/A'}`);
  console.log(`Last Signal: ${lastSignalDate || 'N/A'}`);

  console.log('\n--- Breakdown by TP Ratio ---');
  console.log(`\nTP Ratio 1.5:`);
  console.log(`  Trades: ${trades15.length}`);
  console.log(`  Wins: ${trades15.filter(t => t.result === 'WIN').length}`);
  console.log(`  Losses: ${trades15.filter(t => t.result === 'LOSS').length}`);
  console.log(`  Win Rate: ${trades15.length > 0 ? ((trades15.filter(t => t.result === 'WIN').length / trades15.length) * 100).toFixed(2) : 0}%`);
  console.log(`  Total Pips: ${trades15.reduce((sum, t) => sum + (t.pips || 0), 0).toFixed(2)}`);

  console.log(`\nTP Ratio 2.0:`);
  console.log(`  Trades: ${trades20.length}`);
  console.log(`  Wins: ${trades20.filter(t => t.result === 'WIN').length}`);
  console.log(`  Losses: ${trades20.filter(t => t.result === 'LOSS').length}`);
  console.log(`  Win Rate: ${trades20.length > 0 ? ((trades20.filter(t => t.result === 'WIN').length / trades20.length) * 100).toFixed(2) : 0}%`);
  console.log(`  Total Pips: ${trades20.reduce((sum, t) => sum + (t.pips || 0), 0).toFixed(2)}`);

  console.log('\n====================================');
  console.log(`[BACKTEST-SMC] Complete in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
  console.log('====================================\n');

  const fs = await import('fs');
  const outputPath = OUTPUT_FILE;
  fs.writeFileSync(outputPath, JSON.stringify({
    summary: {
      totalSignals: allTrades.length,
      closedTrades: closedTrades.length,
      winRate: winRate.toFixed(2) + '%',
      avgWinPips: avgWinPips.toFixed(2),
      avgLossPips: avgLossPips.toFixed(2),
      rrRatio: avgLossPips > 0 ? (avgWinPips / avgLossPips).toFixed(2) + ':1' : 'N/A',
      totalPips: totalPips.toFixed(2),
      maxDrawdown: maxDrawdown.toFixed(2),
      maxConsecutiveLosses
    },
    trades: allTrades
  }, null, 2));

  console.log(`\n[BACKTEST-SMC] Results saved to: ${outputPath}`);
}

runBacktest().catch(err => {
  console.error('[BACKTEST-SMC] Fatal error:', err);
  process.exit(1);
});
