import type { Candle } from '../src/types.js';
import { detectSMCSetup } from './smc-engine.js';
import { getPipMultiplier } from './engine.js';
import { TWELVEDATA_API_KEY } from '../config.local.js';

const PAIRS = (process.env.SMC_PAIRS
  ? process.env.SMC_PAIRS.split(',')
  : ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'GBPJPY', 'XAUUSD', 'BTCUSD', 'ETHUSD']);

const MONTHS = process.env.SMC_MONTHS ? parseInt(process.env.SMC_MONTHS) : 2;
const HTF_INTERVAL = (process.env.SMC_HTF || '1h') as any;
const LTF_INTERVAL = (process.env.SMC_LTF || '5min') as any;
const TP_RATIOS = [1.5, 2.0];

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
  reason?: string;
  tpRatio?: number;
}

function tdSymbol(pair: string): string {
  if (pair.length === 6) return pair.slice(0, 3) + '/' + pair.slice(3);
  return pair;
}

async function fetchTD(pair: string, interval: '5min' | '4h', months: number): Promise<Candle[] | null> {
  const symbol = tdSymbol(pair);
  const allCandles: Candle[] = [];
  const endDate = new Date();
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - months);
  let current = new Date(startDate);
  let reqCount = 0;

  console.log(`[TD] ${symbol} ${interval}: ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);

  while (current < endDate) {
    const chunkEnd = new Date(current);
    chunkEnd.setDate(chunkEnd.getDate() + 7);
    if (chunkEnd > endDate) chunkEnd.setTime(endDate.getTime());

    const url = `https://api.twelvedata.com/time_series?symbol=${symbol}&interval=${interval}&outputsize=5000&start_date=${current.toISOString().split('T')[0]}&end_date=${chunkEnd.toISOString().split('T')[0]}&apikey=${TWELVEDATA_API_KEY}`;

    try {
      const res = await fetch(url);
      reqCount++;
      if (reqCount % 7 === 0) {
        console.log(`[TD] Rate limit pause...`);
        await new Promise(r => setTimeout(r, 60000));
      } else {
        await new Promise(r => setTimeout(r, 300));
      }

      const data = await res.json();
      if (data.status === 'error') {
        console.error(`[TD] Error:`, data.message);
        return null;
      }

      if (data.values && data.values.length > 0) {
        const candles = data.values.map((v: any) => ({
          timestamp: v.datetime,
          open: parseFloat(v.open),
          high: parseFloat(v.high),
          low: parseFloat(v.low),
          close: parseFloat(v.close),
          volume: parseInt(v.volume || '0')
        }));
        allCandles.unshift(...candles);
      }

      current = chunkEnd;
    } catch (e: any) {
      console.error(`[TD] Error:`, e.message);
      return null;
    }
  }

  console.log(`[TD] ${symbol} ${interval}: ${allCandles.length} candles`);
  return allCandles.length > 0 ? allCandles : null;
}

const fs = await import('fs');
const path = await import('path');
const CACHE = path.default.join(process.cwd(), '.cache');
if (!fs.default.existsSync(CACHE)) fs.default.mkdirSync(CACHE);

function cacheKey(pair: string, interval: string, months: number) {
  return path.default.join(CACHE, `${pair}_${interval}_${months}m.json`);
}

function loadCache(pair: string, interval: string, months: number): Candle[] | null {
  const f = cacheKey(pair, interval, months);
  if (fs.default.existsSync(f)) {
    console.log(`[Cache] ${pair} ${interval} loaded`);
    return JSON.parse(fs.default.readFileSync(f, 'utf-8'));
  }
  return null;
}

function saveCache(pair: string, interval: string, months: number, data: Candle[]) {
  fs.default.writeFileSync(cacheKey(pair, interval, months), JSON.stringify(data));
  console.log(`[Cache] ${pair} ${interval} saved (${data.length})`);
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

function runVariant(pair: string, h4: Candle[], m5: Candle[], useIDM: boolean): Trade[] {
  const trades: Trade[] = [];

  for (let i = 50; i < m5.length - 100; i += 5) {
    const m5Slice = m5.slice(0, i + 1);
    const currentTs = new Date(m5[i].timestamp).getTime();
    // Only use H4 candles that had already closed by this point in time (no lookahead)
    let h4CutIdx = h4.length;
    for (let j = 0; j < h4.length; j++) {
      if (new Date(h4[j].timestamp).getTime() > currentTs) { h4CutIdx = j; break; }
    }
    const h4Slice = h4.slice(0, h4CutIdx);
    if (h4Slice.length < 20) continue;

    const signal = detectSMCSetup(pair, h4Slice, m5Slice, TP_RATIOS[0], useIDM);

    if (signal) {
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
          reason: signal.reason,
          tpRatio
        };

        const futureCandles = m5.slice(i + 1, Math.min(i + 101, m5.length));
        if (futureCandles.length > 0) {
          trades.push(simulateTrade(trade, futureCandles, pair));
        }
      }
      i += 50;
    }
  }

  return trades;
}

function summarize(label: string, trades: Trade[]) {
  const closed = trades.filter(t => t.exitReason !== 'OPEN');
  const wins = closed.filter(t => t.result === 'WIN');
  const losses = closed.filter(t => t.result === 'LOSS');
  const breakevens = closed.filter(t => t.result === 'BREAKEVEN');
  const winRate = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;

  const winPips = wins.reduce((s, t) => s + (t.pips || 0), 0);
  const lossPips = Math.abs(losses.reduce((s, t) => s + (t.pips || 0), 0));
  const avgWin = wins.length > 0 ? winPips / wins.length : 0;
  const avgLoss = losses.length > 0 ? lossPips / losses.length : 0;
  const totalPips = trades.reduce((s, t) => s + (t.pips || 0), 0);

  let maxDD = 0, peak = 0, run = 0;
  for (const t of closed) {
    run += t.pips || 0;
    if (run > peak) peak = run;
    const dd = peak - run;
    if (dd > maxDD) maxDD = dd;
  }

  console.log(`\n--- ${label} ---`);
  console.log(`Total Signals: ${trades.length}`);
  console.log(`Closed Trades: ${closed.length}`);
  console.log(`Wins: ${wins.length} | Losses: ${losses.length} | Breakeven: ${breakevens.length}`);
  console.log(`Win Rate: ${winRate.toFixed(2)}%`);
  console.log(`Avg Win: ${avgWin.toFixed(2)} pips | Avg Loss: ${avgLoss.toFixed(2)} pips`);
  console.log(`Total Pips: ${totalPips.toFixed(2)}`);
  console.log(`Max Drawdown: ${maxDD.toFixed(2)} pips`);

  return {
    totalSignals: trades.length,
    closedTrades: closed.length,
    wins: wins.length,
    losses: losses.length,
    breakevens: breakevens.length,
    winRate: winRate.toFixed(2) + '%',
    avgWin: avgWin.toFixed(2),
    avgLoss: avgLoss.toFixed(2),
    totalPips: totalPips.toFixed(2),
    maxDD: maxDD.toFixed(2)
  };
}

async function main() {
  console.log('\n====================================');
  console.log('[BACKTEST-SMC-COMPARE] Baseline vs IDM');
  console.log(`Data: TwelveData ${MONTHS} months, HTF=${HTF_INTERVAL} LTF=${LTF_INTERVAL}`);
  console.log('====================================\n');

  const t0 = Date.now();
  const baselineTrades: Trade[] = [];
  const idmTrades: Trade[] = [];

  for (const pair of PAIRS) {
    console.log(`\n--- ${pair} ---`);

    let h4 = loadCache(pair, HTF_INTERVAL, MONTHS);
    let m5 = loadCache(pair, LTF_INTERVAL, MONTHS);

    if (!h4) { h4 = await fetchTD(pair, HTF_INTERVAL, MONTHS); if (h4) saveCache(pair, HTF_INTERVAL, MONTHS, h4); }
    if (!m5) { m5 = await fetchTD(pair, LTF_INTERVAL, MONTHS); if (m5) saveCache(pair, LTF_INTERVAL, MONTHS, m5); }

    if (!h4 || !m5) { console.warn('  SKIP (no data)'); continue; }
    if (h4.length < 30 || m5.length < 50) { console.warn('  SKIP (too few candles)'); continue; }

    console.log(`  HTF: ${h4.length} candles | LTF: ${m5.length} candles`);

    const baseline = runVariant(pair, h4, m5, false);
    const withIdm = runVariant(pair, h4, m5, true);

    baselineTrades.push(...baseline);
    idmTrades.push(...withIdm);

    console.log(`  Baseline signals: ${baseline.length} | With-IDM signals: ${withIdm.length}`);
  }

  console.log('\n====================================');
  console.log('COMPARISON SUMMARY');
  console.log('====================================');

  const baselineSummary = summarize('BASELINE (no IDM)', baselineTrades);
  const idmSummary = summarize('WITH IDM', idmTrades);

  console.log('\n====================================');
  console.log(`Complete in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  console.log('====================================\n');

  fs.default.writeFileSync('backtest-smc-compare-results.json', JSON.stringify({
    baseline: baselineSummary,
    withIDM: idmSummary,
    baselineTrades,
    idmTrades
  }, null, 2));

  console.log('Saved: backtest-smc-compare-results.json');
}

main().catch(e => { console.error(e); process.exit(1); });
