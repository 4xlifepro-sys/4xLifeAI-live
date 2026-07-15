const fs = require('fs');

function getPipMultiplier(pair) {
  if (pair.includes('JPY')) return 0.01;
  if (pair.startsWith('X') && !pair.includes('XRP')) return 0.1;
  if (['BTCUSD', 'ETHUSD', 'SOLUSD', 'BNBUSD', 'LTCUSD', 'DOTUSD', 'ADAUSD', 'XRPUSD', 'DOGEUSD'].includes(pair)) return 1;
  return 0.0001;
}

function riskUnits(t) {
  const pip = getPipMultiplier(t.pair);
  return Math.abs(t.entry - t.sl) / pip;
}

function analyze(label, trades) {
  const closed = trades.filter(t => t.result !== 'OPEN');
  const wins = closed.filter(t => t.result && t.result.startsWith('WIN'));
  const winRate = closed.length ? (wins.length / closed.length) * 100 : 0;
  const totalPips = closed.reduce((s, t) => s + (t.pips || 0), 0);

  let totalR = 0;
  let peak = 0, running = 0, maxDD = 0;
  for (const t of closed) {
    const risk = riskUnits(t);
    const r = risk > 0 ? (t.pips || 0) / risk : 0;
    totalR += r;
    running += (t.pips || 0);
    if (running > peak) peak = running;
    const dd = peak - running;
    if (dd > maxDD) maxDD = dd;
  }
  const avgR = closed.length ? totalR / closed.length : 0;

  return {
    label,
    totalSignals: trades.length,
    closed: closed.length,
    open: trades.length - closed.length,
    winRate,
    avgR,
    maxDD,
    totalPips
  };
}

const d = JSON.parse(fs.readFileSync('backtest-crypto-metals-after.json', 'utf-8'));
const metalsTrades = d.metalsTrades;

const xau = metalsTrades.filter(t => t.pair === 'XAUUSD');
const xag = metalsTrades.filter(t => t.pair === 'XAGUSD');

const xauStats = analyze('XAUUSD', xau);
const xagStats = analyze('XAGUSD', xag);

function fmt(s) {
  return `Total signals: ${s.totalSignals} | Closed: ${s.closed} | Open: ${s.open}\nWin rate: ${s.winRate.toFixed(1)}%\nAvg R/trade: ${s.avgR.toFixed(3)}\nMax drawdown (raw units): ${s.maxDD.toFixed(1)}\nTotal pips (informational, gold/silver own units): ${s.totalPips.toFixed(1)}`;
}

console.log('\n=== XAUUSD (gold) ===');
console.log(fmt(xauStats));
console.log('\n=== XAGUSD (silver) ===');
console.log(fmt(xagStats));

console.log('\n\n| METRIC | XAUUSD | XAGUSD |');
console.log('|---|---|---|');
console.log(`| Closed trades | ${xauStats.closed} | ${xagStats.closed} |`);
console.log(`| Win rate | ${xauStats.winRate.toFixed(1)}% | ${xagStats.winRate.toFixed(1)}% |`);
console.log(`| Avg R/trade | ${xauStats.avgR.toFixed(3)} | ${xagStats.avgR.toFixed(3)} |`);
console.log(`| Max drawdown | ${xauStats.maxDD.toFixed(1)} | ${xagStats.maxDD.toFixed(1)} |`);
console.log(`| Total pips (not cross-comparable) | ${xauStats.totalPips.toFixed(1)} | ${xagStats.totalPips.toFixed(1)} |`);
