import fs from 'fs';
const data = JSON.parse(fs.readFileSync('backtest-crypto-metals-after.json','utf-8'));
const trades = data.cryptoTrades;
console.log('ALL crypto trades (including OPEN):');
for (const t of trades) console.log(t.pair, t.direction, t.result, 'entryTime=', t.entryTime, 'pips=', t.pips?.toFixed(2), 'risk=', Math.abs(t.entry-t.sl).toFixed(4));
