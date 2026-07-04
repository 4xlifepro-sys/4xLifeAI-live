import type { Candle } from '../src/types.js';
import { detectSignalV2 } from './engine2.js';
import { TWELVEDATA_API_KEY } from '../config.local.js';

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
}

function getPipMultiplier(pair: string): number {
  if (pair.includes('JPY')) return 0.01;
  if (pair.startsWith('X') && !pair.includes('XRP')) return 0.1;
  if (['BTCUSD','ETHUSD','SOLUSD','BNBUSD','LTCUSD','DOTUSD','ADAUSD','XRPUSD'].includes(pair)) return 1;
  return 0.0001;
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

// Cache
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

function simulate(trade: Trade, future: Candle[], pair: string): Trade {
  const isLong = trade.direction === 'LONG';
  const pip = getPipMultiplier(pair);
  const r = { ...trade };
  let bestTp: 'TP3' | 'TP2' | 'TP1' | null = null;

  for (let i = 0; i < future.length; i++) {
    const c = future[i];
    if (isLong) {
      if (c.low <= trade.sl) {
        r.exitPrice = trade.sl;
        r.exitTime = c.timestamp;
        r.exitReason = 'SL';
        r.result = bestTp ? ('WIN_' + bestTp as any) : 'LOSS';
        const exitAt = bestTp ? trade[bestTp === 'TP1' ? 'tp1' : bestTp === 'TP2' ? 'tp2' : 'tp3'] : trade.sl;
        r.pips = (exitAt - trade.entry) / pip;
        return r;
      }
      if (c.high >= trade.tp3) bestTp = 'TP3';
      else if (c.high >= trade.tp2) bestTp = 'TP2';
      else if (c.high >= trade.tp1) bestTp = 'TP1';
    } else {
      if (c.high >= trade.sl) {
        r.exitPrice = trade.sl;
        r.exitTime = c.timestamp;
        r.exitReason = 'SL';
        r.result = bestTp ? ('WIN_' + bestTp as any) : 'LOSS';
        const exitAt = bestTp ? trade[bestTp === 'TP1' ? 'tp1' : bestTp === 'TP2' ? 'tp2' : 'tp3'] : trade.sl;
        r.pips = (trade.entry - exitAt) / pip;
        return r;
      }
      if (c.low <= trade.tp3) bestTp = 'TP3';
      else if (c.low <= trade.tp2) bestTp = 'TP2';
      else if (c.low <= trade.tp1) bestTp = 'TP1';
    }
  }

  const last = future[future.length - 1]?.close || trade.entry;
  r.exitPrice = last;
  r.exitTime = future[future.length - 1]?.timestamp || trade.entryTime;
  r.exitReason = 'OPEN';
  r.result = 'OPEN';
  r.pips = isLong ? (last - trade.entry) / pip : (trade.entry - last) / pip;
  return r;
}

async function main() {
  console.log('\n====================================');
  console.log('[TWELVE-BACKTEST] Trend Pullback');
  console.log('Data: TwelveData 6 months M5+H4');
  console.log('====================================\n');

  const trades: Trade[] = [];
  const t0 = Date.now();

  for (const pair of PAIRS) {
    console.log(`\n--- ${pair} ---`);

    let h4 = loadCache(pair, '4h', MONTHS);
    let m5 = loadCache(pair, '5min', MONTHS);

    if (!h4) { h4 = await fetchTD(pair, '4h', MONTHS); if (h4) saveCache(pair, '4h', MONTHS, h4); }
    if (!m5) { m5 = await fetchTD(pair, '5min', MONTHS); if (m5) saveCache(pair, '5min', MONTHS, m5); }

    if (!h4 || !m5) { console.warn('  SKIP'); continue; }
    if (h4.length < 30 || m5.length < 50) { console.warn('  SKIP (too few)'); continue; }

    console.log(`  H4: ${h4.length} (${h4[0].timestamp} to ${h4[h4.length-1].timestamp})`);
    console.log(`  M5: ${m5.length} (${m5[0].timestamp} to ${m5[m5.length-1].timestamp})`);

    let count = 0;
    let lastTs = 0;

    for (let i = 50; i < m5.length - 50; i++) {
      if (i % 3 !== 0) continue;
      const ts = new Date(m5[i].timestamp).getTime();
      if (ts - lastTs < 4 * 3600000) continue;

      const sig = detectSignalV2(pair, h4, m5.slice(0, i + 1));
      if (!sig) continue;

      const future = m5.slice(i + 1, Math.min(i + 101, m5.length));
      if (future.length === 0) continue;

      const completed = simulate({
        pair, direction: sig.direction,
        entry: sig.entry, sl: sig.sl,
        tp1: sig.tp1, tp2: sig.tp2, tp3: sig.tp3,
        entryTime: m5[i].timestamp,
        confidence: sig.confidence
      }, future, pair);

      trades.push(completed);
      count++;
      lastTs = ts;
    }

    console.log(`  Signals: ${count}`);
  }

  // Stats
  const closed = trades.filter(t => t.exitReason !== 'OPEN');
  const wins = closed.filter(t => t.result !== 'LOSS' && t.result !== 'OPEN');
  const losses = closed.filter(t => t.result === 'LOSS');
  const tp1w = closed.filter(t => t.result === 'WIN_TP1');
  const tp2w = closed.filter(t => t.result === 'WIN_TP2');
  const tp3w = closed.filter(t => t.result === 'WIN_TP3');

  const wr = closed.length > 0 ? wins.length / closed.length * 100 : 0;
  const winPips = wins.reduce((s, t) => s + (t.pips || 0), 0);
  const lossPips = Math.abs(losses.reduce((s, t) => s + (t.pips || 0), 0));
  const avgW = wins.length > 0 ? winPips / wins.length : 0;
  const avgL = losses.length > 0 ? lossPips / losses.length : 0;
  const totalPips = trades.reduce((s, t) => s + (t.pips || 0), 0);

  let maxDD = 0, peak = 0, run = 0;
  for (const t of closed) {
    run += t.pips || 0;
    if (run > peak) peak = run;
    const dd = peak - run;
    if (dd > maxDD) maxDD = dd;
  }

  const first = trades[0]?.entryTime || null;
  const last = trades[trades.length - 1]?.entryTime || null;
  let days = 0, perWeek = 0;
  if (first && last) {
    days = (new Date(last).getTime() - new Date(first).getTime()) / 86400000;
    perWeek = days > 0 ? trades.length / (days / 7) : 0;
  }

  console.log('\n====================================');
  console.log('SUMMARY');
  console.log('====================================');
  console.log(`Days of data: ${days.toFixed(0)}`);
  console.log(`Total signals: ${trades.length}`);
  console.log(`Closed trades: ${closed.length}`);
  console.log(`Win rate: ${wr.toFixed(1)}%`);
  console.log(`  TP1: ${tp1w.length} (${closed.length > 0 ? tp1w.length/closed.length*100 : 0}%)`);
  console.log(`  TP2: ${tp2w.length} (${closed.length > 0 ? tp2w.length/closed.length*100 : 0}%)`);
  console.log(`  TP3: ${tp3w.length} (${closed.length > 0 ? tp3w.length/closed.length*100 : 0}%)`);
  console.log(`Losses: ${losses.length}`);
  console.log(`Avg win: ${avgW.toFixed(2)} pips`);
  console.log(`Avg loss: ${avgL.toFixed(2)} pips`);
  console.log(`Total pips: ${totalPips.toFixed(2)}`);
  console.log(`Max drawdown: ${maxDD.toFixed(2)} pips`);
  console.log(`Signals/week: ${perWeek.toFixed(1)}`);
  console.log(`Time: ${((Date.now() - t0) / 1000).toFixed(0)}s`);

  fs.default.writeFileSync('backtest-twelve-results.json', JSON.stringify({
    summary: { days: days.toFixed(0), signals: trades.length, winRate: wr.toFixed(1)+'%', tp1: tp1w.length, tp2: tp2w.length, tp3: tp3w.length, losses: losses.length, avgWin: avgW.toFixed(2), avgLoss: avgL.toFixed(2), totalPips: totalPips.toFixed(2), maxDD: maxDD.toFixed(2), perWeek: perWeek.toFixed(1) },
    trades
  }, null, 2));
  console.log(`Saved: backtest-twelve-results.json`);
}

main().catch(e => { console.error(e); process.exit(1); });
