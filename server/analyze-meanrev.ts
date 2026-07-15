import fs from 'fs';
import path from 'path';

const RESULTS = path.join(process.cwd(), 'backtest-confirm-compare-results.json');
const data = JSON.parse(fs.readFileSync(RESULTS, 'utf-8'));
const trades = data.variants.meanReversion as any[];

console.log(`Total trades loaded: ${trades.length}`);

function getPipMultiplier(pair: string): number {
  if (pair.includes('JPY')) return 0.01;
  if (pair.startsWith('X') && !pair.includes('XRP')) return 0.1;
  if (['BTCUSD', 'ETHUSD', 'SOLUSD', 'BNBUSD', 'LTCUSD', 'DOTUSD', 'ADAUSD', 'XRPUSD', 'DOGEUSD'].includes(pair)) return 1;
  return 0.0001;
}

const FOREX = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'USDCAD', 'AUDUSD', 'NZDUSD', 'EURGBP', 'EURJPY', 'GBPJPY', 'AUDJPY', 'CADJPY', 'CHFJPY', 'NZDJPY', 'EURAUD'];
const METALS = ['XAUUSD', 'XAGUSD'];
const CRYPTO = ['BTCUSD', 'ETHUSD', 'SOLUSD', 'XRPUSD', 'BNBUSD', 'ADAUSD', 'LTCUSD', 'DOGEUSD'];

function classOf(pair: string): string {
  if (FOREX.includes(pair)) return 'FOREX';
  if (METALS.includes(pair)) return 'METALS';
  if (CRYPTO.includes(pair)) return 'CRYPTO';
  return 'OTHER';
}

interface Stat {
  signals: number;
  closed: number;
  wins: number;
  losses: number;
  totalPips: number;
  totalR: number;
  rCount: number;
  cumPips: number;
  peak: number;
  maxDD: number;
  hours: Record<number, number>;
}

function newStat(): Stat {
  return { signals: 0, closed: 0, wins: 0, losses: 0, totalPips: 0, totalR: 0, rCount: 0, cumPips: 0, peak: 0, maxDD: 0, hours: {} };
}

function update(stat: Stat, t: any) {
  stat.signals++;
  if (t.result === 'OPEN' || t.result === undefined) return;
  stat.closed++;
  const pip = getPipMultiplier(t.pair);
  const riskPips = Math.abs(t.entry - t.sl) / pip;
  const pips = t.pips ?? 0;
  stat.totalPips += pips;
  if (riskPips > 0) {
    stat.totalR += pips / riskPips;
    stat.rCount++;
  }
  if (t.result === 'LOSS') stat.losses++;
  else stat.wins++;

  stat.cumPips += pips;
  if (stat.cumPips > stat.peak) stat.peak = stat.cumPips;
  const dd = stat.peak - stat.cumPips;
  if (dd > stat.maxDD) stat.maxDD = dd;

  const hour = new Date(t.entryTime).getUTCHours();
  stat.hours[hour] = (stat.hours[hour] || 0) + 1;
}

const perPair: Record<string, Stat> = {};
const perClass: Record<string, Stat> = { FOREX: newStat(), METALS: newStat(), CRYPTO: newStat(), OTHER: newStat() };
const overall = newStat();

for (const t of trades) {
  const pair = t.pair;
  if (!perPair[pair]) perPair[pair] = newStat();
  update(perPair[pair], t);
  update(perClass[classOf(pair)], t);
  update(overall, t);
}

function fmt(s: Stat) {
  const wr = s.closed > 0 ? (s.wins / s.closed * 100).toFixed(1) : '0.0';
  const avgR = s.rCount > 0 ? (s.totalR / s.rCount).toFixed(3) : '0.000';
  return `signals:${s.signals} closed:${s.closed} WR:${wr}% pips:${s.totalPips.toFixed(1)} avgR:${avgR} maxDD:${s.maxDD.toFixed(1)}`;
}

console.log('\n=== PER ASSET CLASS ===');
for (const cls of ['FOREX', 'METALS', 'CRYPTO', 'OTHER']) {
  console.log(`${cls.padEnd(8)} ${fmt(perClass[cls])}`);
}

console.log('\n=== OVERALL ===');
console.log(fmt(overall));

console.log('\n=== PER PAIR (sorted by pips desc) ===');
const pairEntries = Object.entries(perPair).sort((a, b) => b[1].totalPips - a[1].totalPips);
for (const [pair, s] of pairEntries) {
  console.log(`${pair.padEnd(8)} ${fmt(s)}`);
}

console.log('\n=== HOUR-OF-DAY DISTRIBUTION (UTC) — per class ===');
for (const cls of ['FOREX', 'METALS', 'CRYPTO']) {
  const hours = perClass[cls].hours;
  const line = Array.from({length: 24}, (_, h) => `${h}:${hours[h] || 0}`).join(' ');
  console.log(`${cls}: ${line}`);
}
