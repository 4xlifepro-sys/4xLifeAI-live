import type { Candle } from '../src/types.js';

// H4 TREND-FOLLOWING BREAKOUT - ALL CRYPTO (18) + METALS (2)
// Reads _4h_6m.json directly (full 6 months). H4 = biggest moves = best vs costs.
//   Trend: EMA50 vs EMA200 ; Entry: 20-bar Donchian breakout in trend dir
//   SL: 2.0 x ATR(14) ; Exit: trailing EMA50 close-through (let winners run)
const fs = await import('fs');
const path = await import('path');
const CACHE = path.default.join(process.cwd(), '.cache');

const CRYPTO = ['BTCUSD','ETHUSD','SOLUSD','BNBUSD','LTCUSD','ADAUSD','XRPUSD','DOGEUSD',
  'DOTUSD','LINKUSD','AVAXUSD','POLUSD','ATOMUSD','UNIUSD','XLMUSD','TRXUSD','ETCUSD','NEARUSD'];
const METALS = ['XAUUSD','XAGUSD'];

function costPrice(p:string,entry:number){ if(CRYPTO.includes(p))return entry*0.0006; if(p==='XAUUSD')return 25.7*0.1; if(p==='XAGUSD')return 3.7*0.01; return 0; }
function normTs(ts:string){ return (ts.includes('T')||ts.endsWith('Z'))?ts:ts.replace(' ','T')+'Z'; }
function loadH4(p:string):Candle[]|null{ const f=path.default.join(CACHE,`${p}_4h_6m.json`); if(!fs.default.existsSync(f))return null; const raw:Candle[]=JSON.parse(fs.default.readFileSync(f,'utf-8')); if(!Array.isArray(raw)||raw.length<250)return null; const norm=raw.map(c=>({...c,timestamp:normTs(c.timestamp)})); const seen=new Set<string>(); const d=norm.filter(c=>{if(seen.has(c.timestamp))return false;seen.add(c.timestamp);return true;}); d.sort((a,b)=>new Date(a.timestamp).getTime()-new Date(b.timestamp).getTime()); return d; }
function ema(v:number[],p:number):number[]{const k=2/(p+1);const o:number[]=new Array(v.length).fill(NaN);let prev=v[0];o[0]=v[0];for(let i=1;i<v.length;i++){prev=v[i]*k+prev*(1-k);o[i]=prev;}return o;}
function atrArr(c:Candle[],p=14):number[]{const tr:number[]=[];for(let i=0;i<c.length;i++)tr.push(i===0?c[i].high-c[i].low:Math.max(c[i].high-c[i].low,Math.abs(c[i].high-c[i-1].close),Math.abs(c[i].low-c[i-1].close)));const a:number[]=new Array(c.length).fill(NaN);let s=0;for(let i=0;i<c.length;i++){s+=tr[i];if(i===p-1)a[i]=s/p;else if(i>=p)a[i]=(a[i-1]*(p-1)+tr[i])/p;}return a;}

interface Trade{pair:string;dir:'LONG'|'SHORT';entry:number;sl:number;entryIdx:number;exitIdx:number;r:number;result:'WIN'|'LOSS';}
const ATR_SL=2.0, DON=20, MAXHOLD=300;
function backtest(pair:string,h:Candle[]):Trade[]{
  const cl=h.map(c=>c.close);const e50=ema(cl,50),e200=ema(cl,200),atr=atrArr(h,14);const trades:Trade[]=[];let openUntil=-1;
  for(let i=200;i<h.length-1;i++){ if(i<=openUntil)continue; if(isNaN(e200[i])||isNaN(atr[i]))continue;
    let hh=-Infinity,ll=Infinity;for(let k=i-DON;k<i;k++){if(h[k].high>hh)hh=h[k].high;if(h[k].low<ll)ll=h[k].low;}
    const up=e50[i]>e200[i]&&h[i].close>e200[i];const dn=e50[i]<e200[i]&&h[i].close<e200[i];let dir:'LONG'|'SHORT'|null=null;
    if(up&&h[i].close>hh)dir='LONG';else if(dn&&h[i].close<ll)dir='SHORT'; if(!dir)continue;
    const entry=h[i].close;const risk=ATR_SL*atr[i];if(risk<=0)continue;const sl=dir==='LONG'?entry-risk:entry+risk;const cost=costPrice(pair,entry);
    const end=Math.min(i+1+MAXHOLD,h.length);let done:Trade|null=null;
    for(let j=i+1;j<end;j++){const b=h[j];
      if(dir==='LONG'){if(b.low<=sl){done={pair,dir,entry,sl,entryIdx:i,exitIdx:j,r:(-risk-cost)/risk,result:'LOSS'};break;}if(!isNaN(e50[j])&&b.close<e50[j]){const g=b.close-entry;done={pair,dir,entry,sl,entryIdx:i,exitIdx:j,r:(g-cost)/risk,result:(g-cost)>0?'WIN':'LOSS'};break;}}
      else{if(b.high>=sl){done={pair,dir,entry,sl,entryIdx:i,exitIdx:j,r:(-risk-cost)/risk,result:'LOSS'};break;}if(!isNaN(e50[j])&&b.close>e50[j]){const g=entry-b.close;done={pair,dir,entry,sl,entryIdx:i,exitIdx:j,r:(g-cost)/risk,result:(g-cost)>0?'WIN':'LOSS'};break;}}}
    if(!done){const last=h[end-1];const g=dir==='LONG'?last.close-entry:entry-last.close;done={pair,dir,entry,sl,entryIdx:i,exitIdx:end-1,r:(g-cost)/risk,result:(g-cost)>0?'WIN':'LOSS'};}
    trades.push(done);openUntil=done.exitIdx;}
  return trades;
}
function stats(t:Trade[]){const n=t.length;const w=t.filter(x=>x.result==='WIN').length;const wr=n?w/n*100:0;const avgR=n?t.reduce((s,x)=>s+x.r,0)/n:0;const gw=t.filter(x=>x.r>0).reduce((s,x)=>s+x.r,0);const gl=Math.abs(t.filter(x=>x.r<0).reduce((s,x)=>s+x.r,0));const pf=gl>0?gw/gl:(gw>0?Infinity:0);let peak=0,eq=0,dd=0;for(const x of t){eq+=x.r;if(eq>peak)peak=eq;if(peak-eq>dd)dd=peak-eq;}return{n,wr,avgR,pf,dd};}
function split(t:Trade[]){const s=[...t].sort((a,b)=>a.entryIdx-b.entryIdx);const c=Math.floor(s.length*4/6);return{outS:s.slice(c)};}

async function main(){
  console.log('\n================================================================');
  console.log(' H4 TREND-FOLLOWING - 18 CRYPTO + 2 METALS (real costs, walk-fwd)');
  console.log('================================================================\n');
  const rows:any[]=[];
  for(const p of [...METALS,...CRYPTO]){ const h=loadH4(p); if(!h){console.log(`SKIP ${p.padEnd(8)} - no/short data`);continue;}
    const t=backtest(p,h); if(!t.length){console.log(`${p.padEnd(8)} - 0 trades`);continue;}
    const f=stats(t);const {outS}=split(t);const so=stats(outS);const pass=f.n>=15&&f.avgR>0&&outS.length>=6&&so.avgR>0;
    rows.push({pair:p,cls:CRYPTO.includes(p)?'CRYPTO':'METALS',...f,outN:so.n,outAvgR:so.avgR,pass});
    console.log(`${p.padEnd(8)} n=${String(f.n).padStart(4)}  WR=${f.wr.toFixed(1).padStart(5)}%  avgR=${f.avgR.toFixed(3).padStart(7)}  PF=${(f.pf===Infinity?'∞':f.pf.toFixed(2)).padStart(5)}  maxDD=${f.dd.toFixed(1).padStart(6)}R | OUT n=${String(so.n).padStart(2)} avgR=${so.avgR.toFixed(3).padStart(7)}  ${pass?'✅ PASS':'❌'}`);
  }
  rows.sort((a,b)=>b.avgR-a.avgR);
  console.log('\n=============== RANKED BY avgR (after costs) ===============');
  rows.forEach((r,i)=>console.log(`${String(i+1).padStart(2)}. ${r.pair.padEnd(8)} [${r.cls}] avgR=${r.avgR.toFixed(3).padStart(7)} PF=${(r.pf===Infinity?'∞':r.pf.toFixed(2)).padStart(5)} WR=${r.wr.toFixed(1)}% n=${r.n} ${r.pass?'✅ PASS':'❌'}`));
  const pass=rows.filter(r=>r.pass);
  console.log('\n=============== PAIRS THAT PASS WALK-FORWARD ===============');
  if(!pass.length)console.log('None passed.');else pass.forEach(r=>console.log(`  ✅ ${r.pair} [${r.cls}] full avgR ${r.avgR.toFixed(3)}, out ${r.outAvgR.toFixed(3)}, PF ${r.pf===Infinity?'∞':r.pf.toFixed(2)}, WR ${r.wr.toFixed(1)}%, ${r.n} trades`));
  fs.default.writeFileSync('backtest-h4-crypto18-results.json',JSON.stringify({rows},null,0));
}
main().catch(e=>{console.error(e);process.exit(1);});
