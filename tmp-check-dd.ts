import fs from 'fs';
const data = JSON.parse(fs.readFileSync('backtest-crypto-metals-after.json','utf-8'));
function getPip(pair: string){
  if(pair.includes('JPY')) return 0.01;
  if(pair.startsWith('X') && !pair.includes('XRP')) return 0.1;
  if(['BTCUSD','ETHUSD','SOLUSD','BNBUSD','LTCUSD','DOTUSD','ADAUSD','XRPUSD','DOGEUSD'].includes(pair)) return 1;
  return 0.0001;
}
const closed = data.cryptoTrades.filter((t: any)=>t.result!=='OPEN');
let running=0, peak=0, maxDD=0;
for(const t of closed){
  const pip = getPip(t.pair);
  const risk = Math.abs(t.entry - t.sl)/pip;
  const r = risk>0 ? (t.pips||0)/risk : 0;
  running += r;
  if(running>peak) peak=running;
  const dd = peak-running;
  if(dd>maxDD) maxDD=dd;
}
console.log('Crypto MR maxDD (R units):', maxDD.toFixed(3));
console.log('Closed count:', closed.length);
console.log('Total R:', running.toFixed(3));
