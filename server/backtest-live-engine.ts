import { detectTrendMomentumScannerV5 } from './engine.js';
import { readFileSync } from 'fs';

interface Candle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

interface TradeResult {
  pair: string;
  direction: string;
  entry: number;
  sl: number;
  tp1: number;
  tp2: number;
  tp3: number;
  entryTime: string;
  exitTime: string;
  exitPrice: number;
  result: string;
  pips: number;
  confidence: number;
  tier: string;
}

function getPipMultiplier(pair: string): number {
  if (pair.includes('JPY')) return 0.01;
  if (pair.includes('XAU')) return 0.1;
  if (pair.includes('XAG')) return 0.01;
  if (['BTC', 'ETH', 'LTC', 'XRP', 'ADA', 'SOL', 'DOGE', 'BNB'].some(c => pair.includes(c))) return 1;
  return 0.0001;
}

function runBacktest(pair: string, h4Raw: Candle[], m5Raw: Candle[]): TradeResult[] {
  console.log(`\n===== ${pair} BACKTEST (LIVE ENGINE: engine.ts) =====`);
  console.log(`H4 candles: ${h4Raw.length}`);
  console.log(`M5 candles: ${m5Raw.length}`);
  
  // CRITICAL: Reverse to ascending order (newest first → oldest first)
  const h4 = [...h4Raw].reverse();
  const m5 = [...m5Raw].reverse();
  
  console.log(`H4 range: ${h4[0].timestamp} to ${h4[h4.length-1].timestamp}`);
  console.log(`M5 range: ${m5[0].timestamp} to ${m5[m5.length-1].timestamp}`);

  const trades: TradeResult[] = [];
  let lastSignalTs = 0;
  const cooldownMs = 60 * 60 * 1000; // 1 hour cooldown
  const pipMult = getPipMultiplier(pair);

  for (let i = 100; i < m5.length - 10; i++) {
    // Sample every 12th candle (1 hour = 12 M5 candles)
    if (i % 12 !== 0) continue;

    const ts = new Date(m5[i].timestamp).getTime();

    // Session filter: 07:00-21:00 UTC only
    const hour = new Date(m5[i].timestamp).getUTCHours();
    if (hour < 7 || hour >= 21) continue;

    // Cooldown
    if (ts - lastSignalTs < cooldownMs) continue;

    const slice = m5.slice(0, i + 1);

    // CRITICAL: Only pass H4 candles up to this M5 candle's timestamp
    const h4Slice = h4.filter(h => new Date(h.timestamp).getTime() <= ts);
    if (h4Slice.length < 30) continue;

    const result = detectTrendMomentumScannerV5(pair, h4Slice, slice);
    const signal = result.signal;
    
    if (!signal || signal.status !== 'ACTIVE') continue;
    if (signal.tier === 'Reject') continue;

    // Simulate trade
    const isLong = signal.direction === 'LONG';
    const entry = signal.entry;
    const sl = signal.sl;
    const tp1 = signal.tp1;
    const tp2 = signal.tp2;
    const tp3 = signal.tp3;

    let bestTp: string | null = null;
    let exitPrice = entry;
    let exitTime = m5[i].timestamp;
    let tradeResult = 'OPEN';

    // Look ahead max 200 candles (16+ hours)
    const maxLook = Math.min(i + 201, m5.length);
    for (let j = i + 1; j < maxLook; j++) {
      const c = m5[j];
      if (isLong) {
        // Check TP levels (highest first)
        if (c.high >= tp3) { 
          bestTp = 'TP3'; exitPrice = tp3; exitTime = c.timestamp; 
        } else if (c.high >= tp2 && !bestTp) { 
          bestTp = 'TP2'; exitPrice = tp2; exitTime = c.timestamp; 
        } else if (c.high >= tp1 && !bestTp) { 
          bestTp = 'TP1'; exitPrice = tp1; exitTime = c.timestamp; 
        }
        // Check SL
        if (c.low <= sl) {
          exitTime = c.timestamp;
          if (bestTp) {
            tradeResult = `WIN_${bestTp}`;
          } else {
            exitPrice = sl;
            tradeResult = 'LOSS';
          }
          break;
        }
      } else {
        // SHORT trade
        if (c.low <= tp3) { 
          bestTp = 'TP3'; exitPrice = tp3; exitTime = c.timestamp; 
        } else if (c.low <= tp2 && !bestTp) { 
          bestTp = 'TP2'; exitPrice = tp2; exitTime = c.timestamp; 
        } else if (c.low <= tp1 && !bestTp) { 
          bestTp = 'TP1'; exitPrice = tp1; exitTime = c.timestamp; 
        }
        // Check SL (for SHORT, SL is above entry)
        if (c.high >= sl) {
          exitTime = c.timestamp;
          if (bestTp) {
            tradeResult = `WIN_${bestTp}`;
          } else {
            exitPrice = sl;
            tradeResult = 'LOSS';
          }
          break;
        }
      }
    }

    // If still open at end
    if (tradeResult === 'OPEN' && bestTp) {
      tradeResult = `WIN_${bestTp}`;
    } else if (tradeResult === 'OPEN') {
      const lastC = m5[maxLook - 1];
      exitPrice = lastC.close;
      exitTime = lastC.timestamp;
      tradeResult = 'CLOSED';
    }

    const pips = isLong
      ? (exitPrice - entry) / pipMult
      : (entry - exitPrice) / pipMult;

    trades.push({
      pair,
      direction: signal.direction,
      entry,
      sl,
      tp1,
      tp2,
      tp3,
      entryTime: m5[i].timestamp,
      exitTime,
      exitPrice,
      result: tradeResult,
      pips: Math.round(pips * 100) / 100,
      confidence: signal.aiConfidence,
      tier: signal.tier,
    });

    lastSignalTs = ts;
  }

  return trades;
}

// Main
try {
  const h4Path = '.cache/EURUSD_4h_6m.json';
  const m5Path = '.cache/EURUSD_5min_6m.json';

  const h4 = JSON.parse(readFileSync(h4Path, 'utf-8')) as Candle[];
  const m5 = JSON.parse(readFileSync(m5Path, 'utf-8')) as Candle[];

  const trades = runBacktest('EURUSD', h4, m5);

  // Summary stats
  const closed = trades.filter(t => !t.result.includes('OPEN') && t.result !== 'CLOSED');
  const wins = closed.filter(t => t.result.startsWith('WIN'));
  const losses = closed.filter(t => t.result === 'LOSS');
  const tp1 = closed.filter(t => t.result === 'WIN_TP1');
  const tp2 = closed.filter(t => t.result === 'WIN_TP2');
  const tp3 = closed.filter(t => t.result === 'WIN_TP3');

  const winRate = closed.length > 0 ? (wins.length / closed.length * 100).toFixed(1) : '0.0';
  const avgWin = wins.length > 0 ? (wins.reduce((s, t) => s + t.pips, 0) / wins.length).toFixed(2) : '0.00';
  const avgLoss = losses.length > 0 ? (Math.abs(losses.reduce((s, t) => s + t.pips, 0)) / losses.length).toFixed(2) : '0.00';
  const totalPips = trades.reduce((s, t) => s + t.pips, 0).toFixed(2);

  // Drawdown
  let maxDD = 0, peak = 0, run = 0;
  for (const t of closed) {
    run += t.pips;
    if (run > peak) peak = run;
    const dd = peak - run;
    if (dd > maxDD) maxDD = dd;
  }

  // Date range
  const days = trades.length > 1
    ? ((new Date(trades[trades.length - 1].entryTime).getTime() - new Date(trades[0].entryTime).getTime()) / 86400000).toFixed(0)
    : '0';
  const perWeek = Number(days) > 0 ? (trades.length / (Number(days) / 7)).toFixed(1) : '0.0';

  console.log('\n===== SUMMARY =====');
  console.log(`Total signals: ${trades.length}`);
  console.log(`Closed trades: ${closed.length}`);
  console.log(`Win rate: ${winRate}%`);
  console.log(`  TP1 hits: ${tp1.length} (${closed.length > 0 ? (tp1.length / closed.length * 100).toFixed(1) : 0}%)`);
  console.log(`  TP2 hits: ${tp2.length} (${closed.length > 0 ? (tp2.length / closed.length * 100).toFixed(1) : 0}%)`);
  console.log(`  TP3 hits: ${tp3.length} (${closed.length > 0 ? (tp3.length / closed.length * 100).toFixed(1) : 0}%)`);
  console.log(`Losses: ${losses.length}`);
  console.log(`Avg win: ${avgWin} pips`);
  console.log(`Avg loss: ${avgLoss} pips`);
  console.log(`Total pips: ${totalPips}`);
  console.log(`Max drawdown: ${maxDD.toFixed(2)} pips`);
  console.log(`Days covered: ${days}`);
  console.log(`Signals/week: ${perWeek}`);

  // Tier breakdown
  console.log('\n===== TIER BREAKDOWN =====');
  const tiers = ['Strong', 'Good', 'Valid'];
  for (const tier of tiers) {
    const tierTrades = closed.filter(t => t.tier === tier);
    if (tierTrades.length === 0) continue;
    const tierWins = tierTrades.filter(t => t.result.startsWith('WIN'));
    const tierPips = tierTrades.reduce((s, t) => s + t.pips, 0);
    console.log(`  ${tier}: ${tierTrades.length} trades, WR ${(tierWins.length / tierTrades.length * 100).toFixed(1)}%, ${tierPips.toFixed(1)} pips`);
  }

  // Confidence bucket analysis
  console.log('\n===== CONFIDENCE BUCKETS =====');
  const buckets = [
    { label: '50-60', min: 50, max: 60 },
    { label: '60-70', min: 60, max: 70 },
    { label: '70-80', min: 70, max: 80 },
    { label: '80-90', min: 80, max: 90 },
    { label: '90+', min: 90, max: 999 },
  ];

  for (const b of buckets) {
    const inBucket = closed.filter(t => t.confidence >= b.min && t.confidence < b.max);
    if (inBucket.length === 0) continue;
    const bWins = inBucket.filter(t => t.result.startsWith('WIN'));
    const bPips = inBucket.reduce((s, t) => s + t.pips, 0);
    console.log(`  ${b.label}: ${inBucket.length} trades, WR ${(bWins.length / inBucket.length * 100).toFixed(1)}%, ${bPips.toFixed(1)} pips`);
  }

  // Show first 10 trades
  console.log('\n===== FIRST 10 TRADES =====');
  for (const t of trades.slice(0, 10)) {
    console.log(`  ${t.entryTime} | ${t.direction} | tier=${t.tier} | conf=${t.confidence} | ${t.result} | ${t.pips} pips`);
  }
} catch (err: any) {
  console.error('Error:', err.message);
  console.error(err.stack);
}
