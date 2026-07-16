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
  for (let i = 1; i < period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  result.push(100 - 100 / (1 + rs));
  for (let i = period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) {
      avgGain = (avgGain * (period - 1) + diff) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) + Math.abs(diff)) / period;
    }
    rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    result.push(100 - 100 / (1 + rs));
  }
  return result;
}

// Aggregate M5 candles into H1 candles
function aggregateToH1(m5Candles: Candle[]): Candle[] {
  const h1Candles: Candle[] = [];
  let currentH1: Candle | null = null;

  for (const candle of m5Candles) {
    const hour = candle.time.getUTCHours();
    const day = candle.time.getUTCDate();
    const key = `${day}-${hour}`;

    if (!currentH1 || currentH1.time.getUTCHours() !== hour || currentH1.time.getUTCDate() !== day) {
      if (currentH1) h1Candles.push(currentH1);
      currentH1 = {
        time: candle.time,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
      };
    } else {
      currentH1.high = Math.max(currentH1.high, candle.high);
      currentH1.low = Math.min(currentH1.low, candle.low);
      currentH1.close = candle.close;
      currentH1.volume += candle.volume;
    }
  }
  if (currentH1) h1Candles.push(currentH1);
  return h1Candles;
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

// Check if time is in London or NY session (UTC)
function isLondonOrNYSession(time: Date): boolean {
  const hour = time.getUTCHours();
  // London: 07:00-16:00 UTC, NY: 12:00-21:00 UTC
  // Combined: 07:00-21:00 UTC
  return hour >= 7 && hour < 21;
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

// ===== STRATEGY: H1 TREND + M5 ENTRY + SESSION FILTER =====
function testH1TrendM5Entry(pair: string, m5Candles: Candle[], brokerCost: number): Trade[] {
  if (m5Candles.length < 500) return [];

  const h1Candles = aggregateToH1(m5Candles);
  if (h1Candles.length < 100) return [];

  const h1Closes = h1Candles.map(c => c.close);
  const h1Ema50 = ema(h1Closes, 50);
  const h1Ema200 = ema(h1Closes, 200);

  const m5Closes = m5Candles.map(c => c.close);
  const m5Ema20 = ema(m5Closes, 20);
  const m5Ema50 = ema(m5Closes, 50);
  const m5Atr = atr(m5Candles, 14);
  const m5Rsi = rsi(m5Closes, 14);

  const trades: Trade[] = [];
  const pipMult = getPipMultiplier(pair);
  let lastSignalIdx = -60;

  // Map H1 candle index to M5 candle index
  let h1Idx = 0;

  for (let i = 200; i < m5Candles.length; i++) {
    if (i - lastSignalIdx < 60) continue;

    // Session filter: only London/NY
    if (!isLondonOrNYSession(m5Candles[i].time)) continue;

    // Find corresponding H1 candle
    while (h1Idx < h1Candles.length - 1 && h1Candles[h1Idx + 1].time <= m5Candles[i].time) {
      h1Idx++;
    }
    if (h1Idx < 200) continue;

    const current = m5Candles[i];
    const h1Ema50Val = h1Ema50[h1Idx];
    const h1Ema200Val = h1Ema200[h1Idx];
    const m5Ema20Val = m5Ema20[i];
    const m5Ema50Val = m5Ema50[i];
    const m5AtrVal = m5Atr[i];
    const m5RsiVal = m5Rsi[i];

    // ===== LONG SETUP =====
    // H1 trend: Price > EMA200, EMA50 > EMA200
    const h1Bullish = current.close > h1Ema200Val && h1Ema50Val > h1Ema200Val;

    if (h1Bullish) {
      // M5 entry: Pullback to EMA20/50 zone + bounce
      const inPullbackZone = current.close >= m5Ema20Val * 0.998 && current.close <= m5Ema50Val * 1.002;
      const bounce = current.close > current.open && m5RsiVal >= 40 && m5RsiVal <= 65;

      if (inPullbackZone && bounce) {
        const entry = current.close;
        const sl = Math.min(m5Candles[i - 1].low, m5Candles[i - 2].low) - m5AtrVal * 0.5;
        const slPips = Math.abs(entry - sl) / pipMult;

        if (slPips < 3 || slPips > 30) continue;

        // TP: 2.5x SL (wider target for bigger moves)
        const tp = entry + slPips * 2.5 * pipMult;

        let exitPrice = entry;
        let exitReason = 'OPEN';

        for (let j = i + 1; j < Math.min(i + 150, m5Candles.length); j++) {
          const candle = m5Candles[j];
          if (candle.high >= tp) {
            exitPrice = tp;
            exitReason = 'TP';
            break;
          }
          if (candle.low <= sl) {
            exitPrice = sl;
            exitReason = 'SL';
            break;
          }
          // Exit if H1 trend reverses
          if (j < m5Candles.length) {
            let h1J = h1Idx;
            while (h1J < h1Candles.length - 1 && h1Candles[h1J + 1].time <= m5Candles[j].time) h1J++;
            if (h1J < h1Candles.length && m5Candles[j].close < h1Ema200[h1J]) {
              exitPrice = candle.close;
              exitReason = 'H1_TREND_REVERSAL';
              break;
            }
          }
        }

        const grossPips = (exitPrice - entry) / pipMult;
        const netPips = grossPips - brokerCost;
        const rMultiple = netPips / slPips;

        trades.push({
          pair,
          direction: 'LONG',
          entry,
          sl,
          tp,
          exitPrice,
          exitReason,
          pipsWon: netPips,
          rMultiple,
        });

        lastSignalIdx = i;
      }
    }

    // ===== SHORT SETUP =====
    const h1Bearish = current.close < h1Ema200Val && h1Ema50Val < h1Ema200Val;

    if (h1Bearish) {
      const inPullbackZone = current.close <= m5Ema20Val * 1.002 && current.close >= m5Ema50Val * 0.998;
      const bounce = current.close < current.open && m5RsiVal >= 35 && m5RsiVal <= 60;

      if (inPullbackZone && bounce) {
        const entry = current.close;
        const sl = Math.max(m5Candles[i - 1].high, m5Candles[i - 2].high) + m5AtrVal * 0.5;
        const slPips = Math.abs(entry - sl) / pipMult;

        if (slPips < 3 || slPips > 30) continue;

        const tp = entry - slPips * 2.5 * pipMult;

        let exitPrice = entry;
        let exitReason = 'OPEN';

        for (let j = i + 1; j < Math.min(i + 150, m5Candles.length); j++) {
          const candle = m5Candles[j];
          if (candle.low <= tp) {
            exitPrice = tp;
            exitReason = 'TP';
            break;
          }
          if (candle.high >= sl) {
            exitPrice = sl;
            exitReason = 'SL';
            break;
          }
          if (j < m5Candles.length) {
            let h1J = h1Idx;
            while (h1J < h1Candles.length - 1 && h1Candles[h1J + 1].time <= m5Candles[j].time) h1J++;
            if (h1J < h1Candles.length && m5Candles[j].close > h1Ema200[h1J]) {
              exitPrice = candle.close;
              exitReason = 'H1_TREND_REVERSAL';
              break;
            }
          }
        }

        const grossPips = (entry - exitPrice) / pipMult;
        const netPips = grossPips - brokerCost;
        const rMultiple = netPips / slPips;

        trades.push({
          pair,
          direction: 'SHORT',
          entry,
          sl,
          tp,
          exitPrice,
          exitReason,
          pipsWon: netPips,
          rMultiple,
        });

        lastSignalIdx = i;
      }
    }
  }

  return trades;
}

const pairs = [
  'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'USDCAD',
  'AUDUSD', 'NZDUSD', 'EURGBP', 'EURJPY', 'GBPJPY',
  'AUDJPY', 'CADJPY', 'CHFJPY', 'NZDJPY', 'EURAUD',
];

console.log('===================================================================');
console.log('STRATEGY #17: H1 TREND + M5 ENTRY + SESSION FILTER');
console.log('H1: EMA50/EMA200 trend filter');
console.log('M5: Pullback to EMA20/50 zone + RSI confirmation');
console.log('Session: London/NY only (07:00-21:00 UTC)');
console.log('TP: 2.5x SL (wider target for bigger moves)');
console.log('Real costs: 1.3-2.3 pips per pair');
console.log('===================================================================\n');

const allTrades: Trade[] = [];
const pairResults: { [key: string]: Trade[] } = {};

for (const pair of pairs) {
  const candles = loadCacheFile(pair);
  if (candles.length < 500) {
    console.log(`  ${pair}: SKIP (insufficient cache)`);
    continue;
  }

  const cost = getBrokerCost(pair);
  const trades = testH1TrendM5Entry(pair, candles, cost);
  pairResults[pair] = trades;
  allTrades.push(...trades);
  console.log(`  ${pair}: ${trades.length} signals`);
}

console.log(`\nTotal signals: ${allTrades.length}\n`);

function analyzeResults(trades: Trade[], label: string) {
  if (trades.length === 0) {
    console.log(`  ${label.padEnd(50)} signals:    0 closed:    0 WR:   N/A  avgR:   N/A  PF:  N/A`);
    return;
  }

  const closed = trades.filter(t => t.exitReason !== 'OPEN');
  const wins = closed.filter(t => t.pipsWon > 0);
  const losses = closed.filter(t => t.pipsWon <= 0);

  const wr = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;
  const avgR = closed.length > 0 ? closed.reduce((sum, t) => sum + t.rMultiple, 0) / closed.length : 0;
  const avgWin = wins.length > 0 ? wins.reduce((sum, t) => sum + t.pipsWon, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((sum, t) => sum + t.pipsWon, 0) / losses.length : 0;
  const pf = avgLoss !== 0 ? Math.abs((wins.length * avgWin) / (losses.length * avgLoss)) : 0;

  let cumR = 0, maxDD = 0;
  for (const trade of closed) {
    cumR += trade.rMultiple;
    if (cumR < maxDD) maxDD = cumR;
  }
  maxDD = Math.abs(maxDD);

  const avgSL = closed.length > 0 ? closed.reduce((sum, t) => sum + Math.abs(t.entry - t.sl) / getPipMultiplier(t.pair), 0) / closed.length : 0;
  const avgTP = closed.length > 0 ? closed.reduce((sum, t) => sum + Math.abs(t.tp - t.entry) / getPipMultiplier(t.pair), 0) / closed.length : 0;

  console.log(`  ${label.padEnd(50)} signals:${trades.length.toString().padStart(5)} closed:${closed.length.toString().padStart(5)} WR:${wr.toFixed(1).padStart(5)}%  avgR:${avgR.toFixed(3).padStart(7)}  PF:${pf.toFixed(2).padStart(5)}  maxDD(R):${maxDD.toFixed(2).padStart(7)}  avgSL:${avgSL.toFixed(1).padStart(5)}p  avgTP:${avgTP.toFixed(1).padStart(5)}p`);
}

console.log('--- Full 6-month period (with real per-pair costs) ---\n');
analyzeResults(allTrades, 'H1 Trend + M5 Entry + Session');

console.log('\n--- Per-pair breakdown ---\n');
for (const pair of pairs) {
  const trades = pairResults[pair] || [];
  if (trades.length > 0) {
    analyzeResults(trades, `  ${pair}`);
  }
}

// Exit reason breakdown
const exitReasons: { [key: string]: number } = {};
for (const t of allTrades) {
  exitReasons[t.exitReason] = (exitReasons[t.exitReason] || 0) + 1;
}
console.log('\n--- Exit reason breakdown ---\n');
for (const [reason, count] of Object.entries(exitReasons)) {
  const pct = ((count / allTrades.length) * 100).toFixed(1);
  console.log(`  ${reason}: ${count} (${pct}%)`);
}

const closed = allTrades.filter(t => t.exitReason !== 'OPEN');
const wins = closed.filter(t => t.pipsWon > 0);
const avgR = closed.length > 0 ? closed.reduce((sum, t) => sum + t.rMultiple, 0) / closed.length : 0;
const wr = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;

console.log('\n===================================================================');
if (avgR > 0 && wr > 50) {
  console.log('✅ H1 TREND + M5 ENTRY PASSES');
  console.log(`   Win Rate: ${wr.toFixed(1)}%, Avg R: ${avgR.toFixed(3)}`);
} else if (avgR > 0) {
  console.log('⚠️  MARGINAL — Positive avgR but low win rate');
  console.log(`   Win Rate: ${wr.toFixed(1)}%, Avg R: ${avgR.toFixed(3)}`);
} else {
  console.log('❌ H1 TREND + M5 ENTRY FAILS');
  console.log(`   Win Rate: ${wr.toFixed(1)}%, Avg R: ${avgR.toFixed(3)}`);
}
console.log('===================================================================\n');

fs.writeFileSync('h1-trend-m5-entry-results.json', JSON.stringify({ allTrades, pairResults }, null, 2));
console.log('Saved to h1-trend-m5-entry-results.json');
