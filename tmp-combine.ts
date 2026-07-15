const btc = {n:4, avgR:-1.000};
const eth = {n:9, avgR:0.458};
const sol = {n:18, avgR:0.043};
const xrp = {n:8, avgR:-0.125};
const bnb = {n:3, avgR:-0.304};
const ada = {n:29, avgR:0.041};
const ltc = {n:6, avgR:0.104};
const doge = {n:11, avgR:0.000};
function combine(list: {n:number; avgR:number}[]){
  const totalN = list.reduce((s,x)=>s+x.n,0);
  const totalR = list.reduce((s,x)=>s+x.n*x.avgR,0);
  return {n: totalN, avgR: totalR/totalN};
}
console.log('All 8:', combine([btc,eth,sol,xrp,bnb,ada,ltc,doge]));
console.log('Exclude BTC+BNB:', combine([eth,sol,xrp,ada,ltc,doge]));
console.log('Exclude BTC+BNB+XRP:', combine([eth,sol,ada,ltc,doge]));
