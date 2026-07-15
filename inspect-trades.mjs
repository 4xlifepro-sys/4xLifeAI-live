import fs from 'fs';
const data = JSON.parse(fs.readFileSync('backtest-crypto-metals-after.json','utf-8'));
const trades = data.cryptoTrades;
const closed = trades.filter(t=>t.result!=='OPEN');
const counts = {};
for (const t of closed) { counts[t.result] = (counts[t.result]||0)+1; }
console.log('result counts:', counts);
console.log('total closed:', closed.length);
for (const t of closed) console.log(t.pair, t.direction, t.result, 'pips=', t.pips?.toFixed(2), 'risk=', Math.abs(t.entry-t.sl).toFixed(4));
