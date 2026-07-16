import type { Candle } from '../src/types.js';

// ---------------------------------------------------------------------------
// H1 TREND-FOLLOWING BREAKOUT for METALS + CRYPTO (catch big trends).
//   Trend: EMA50 > EMA200 (long) / EMA50 < EMA200 (short)
//   Entry: breakout of prior 20-bar high/low in trend direction (strong close)
//   SL: 2.0 x ATR(14)
//   Exit: trailing EMA50 (close back through it) - WIDE trail, let winners run
// Real costs applied. 6-month H1 (from M5) + walk-forward. Rank top 5.
// ---------------------------------------------------------------------------

const fs = await import('fs');
const path = await import('path');
const CACHE = path.default.join(process.cwd(), '.cache');
const CRYPTO = ['BTCUSD','ETHUSD','SOLUSD','BNBUSD','LTCUSD','ADAUSD','XRPUSD','DOGEUSD'];

function pipMult(p:string){ if(p==='XAUUSD')return 0.1; if(p==='XAGUSD')return 0.01; if(CRYPTO.includes(p))return 1; return 0.0001; }
function costPrice(p:string,entry:number){ if(CRYPTO.includes(p))return entry*0.0006; const m:Record<string,number>={XAUUSD:25.7,XAGUSD:3.7}; return (m[p]??2)*pipMult(p); }
function normTs(ts:string){ return (ts.includes('T')||ts.endsWith('Z'))?ts:ts.replace(' ','T')+'Z'; }
function loadM5(p:string):Candle[]|null{ const f=path.default.join(CACHE,`${p}_5min_6m.json`); if(!fs.default.existsSync(f))return null; const raw:Candle[]=JSON.parse(fs.default.readFileSync(f,'utf-8')); if(!Array.isArray(raw)||raw.length<60)return null; const norm=raw.map(c=>({...c,timestamp:normTs(c.timestamp)})); const seen=new Set<string>(); const d=norm.filter(c=>{if(seen.has(c.timestamp))return false;seen.add(c.timestamp);return true;}); d.sort((a,b)=>new Date(a.timestamp).getTime()-new Date(b.timestamp).getTime()); return d; }
function toH1(m5:Candle[]):Candle[]{ const out:Candle[]=[];let cur:Candle|null=null;let key=''; for(const c of m5){const d=new Date(c.timestamp);const k=`${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}-${d.getUTCHours()}`; if(k!==key){if(cur)out.push(cur);cur={timestamp:c.timestamp,open:c.open,high:c.high,low:c.low,close:c.close,volume:c.volume||0} as Candle;key=k;} else if(cur){cur.high=Math.max(cur.high,c.high);cur.low=Math.min(cur.low,c.low);cur.close=c.close;(cur as any).volume+=(c.volume||0);}} if(cur)out.push(cur); return out; }
function ema(v:number[],p:number):number[]{const k=2/(p+1);const o:number[]=new Array(v.length).fill(NaN);let prev=v[0];o[0]=v[0];for(let i=1;i<v.length;i++){prev=v[i]*k+prev*(1-k);o[i]=prev;}return o;}
function atrArr(c:Candle[],p=14):number[]{const tr:number[]=[];for(let i=0;i<c.length;i++)tr.push(i===0?c[i].high-c[i].low:Math.max(c[i].high-c[i].low,Math.abs(c[i].high-c[i-1].close),Math.abs(c[i].low-c[i-1].close)));const a:number[]=new Array(c.length).fill(NaN);let s=0;for(let i=0;i<c.length;i++){s+=tr[i];if(i===p-1)a[i]=s/p;else if(i>=p)a[i]=(a[i-1]*(p-1)+tr[i])/p;}return a;}

interface Trade{pair:string;dir:'LONG'|'SHORT';entry:number;sl:number;entryIdx:number;exitIdx:number;r:number;result:'WIN'|'LOSS';}
const ATR_SL=2.0, DON=20, MAXHOLD=500;

function backtest(pair:string,h1:Candle[]):Trade[]{
  const cl=h1.map(c=>c.close); const e50=ema(cl,50),e200=ema(cl,200),atr=atrArr(h1,14);
  const trades:Trade[]=[];let openUntil=-1;
  for(let i=200;i<h1.length-1;i++){
    if(i<=openUntil)continue; if(isNaN(e200[i])||isNaN(atr[i]))continue;
    let hh=-Infinity,ll=Infinity; for(let k=i-DON;k<i;k++){if(h1[k].high>hh)hh=h1[k].high;if(h1[k].low<ll)ll=h1[k].low;}
    const up=e50[i]>e200[i]&&h1[i].close>e200[i]; const dn=e50[i]<e200[i]&&h1[i].close<e200[i];
    let dir:'LONG'|'SHORT'|null=null;
    if(up && h1[i].close>hh) dir='LONG'; else if(dn && h1[i].close<ll) dir='SHORT';
    if(!dir)continue;
    const entry=h1[i].close; const risk=ATR_SL*atr[i]; if(risk<=0)continue;
    const sl=dir==='LONG'?entry-risk:entry+risk; const cost=costPrice(pair,entry);
    const end=Math.min(i+1+MAXHOLD,h1.length); let done:Trade|null=null;
    for(let j=i+1;j<end;j++){const b=h1[j];
      if(dir==='LONG'){ if(b.low<=sl){done={pair,dir,entry,sl,entryIdx:i,exitIdx:j,r:(-risk-cost)/risk,result:'LOSS'};break;} if(!isNaN(e50[j])&&b.close<e50[j]){const g=b.close-entry;done={pair,dir,entry,sl,entryIdx:i,exitIdx:j,r:(g-cost)/risk,result:(g-cost)>0?'WIN':'LOSS'};break;} }
      else { if(b.high>=sl){done={pair,dir,entry,sl,entryIdx:i,exitIdx:j,r:(-risk-cost)/risk,result:'LOSS'};break;} if(!isNaN(e50[j])&&b.close>e50[j]){const g=entry-b.close;done={pair,dir,entry,sl,entryIdx:i,exitIdx:j,r:(g-cost)/risk,result:(g-cost)>0?'WIN':'LOSS'};break;} }
    }
    if(!done){const last=h1[end-1];const g=dir==='LONG'?last.close-entry:entry-last.close;done={pair,dir,entry,sl,entryIdx:i,exitIdx:end-1,r:(g-cost)/risk,result:(g-cost)>0?'WIN':'LOSS'};}
    trades.push(done);openUntil=done.exitIdx;
  }
  return trades;
}
function stats(t:Trade[]){const n=t.length;const w=t.filter(x=>x.result==='WIN').length;const wr=n?w/n*100:0;const avgR=n?t.reduce((s,x)=>s+x.r,0)/n:0;const gw=t.filter(x=>x.r>0).reduce((s,x)=>s+x.r,0);const gl=Math.abs(t.filter(x=>x.r<0).reduce((s,x)=>s+x.r,0));const pf=gl>0?gw/gl:(gw>0?Infinity:0);let peak=0,eq=0,dd=0;for(const x of t){eq+=x.r;if(eq>peak)peak=eq;if(peak-eq>dd)dd=peak-eq;}return{n,wr,avgR,pf,dd};}
function split(t:Trade[]){const s=[...t].sort((a,b)=>a.entryIdx-b.entryIdx);const c=Math.floor(s.length*4/6);return{outS:s.slice(c)};}

async function main(){
  console.log('\n================================================================');
  console.log(' H1 TREND-FOLLOWING BREAKOUT - METALS + CRYPTO (real costs)');
  console.log('================================================================\n');
  const PAIRS=['XAUUSD','XAGUSD',...CRYPTO]; const rows:any[]=[];
  for(const p of PAIRS){ const m5=loadM5(p); if(!m5){console.log(`SKIP ${p} - no data`);continue;} const h1=toH1(m5);
    const t=backtest(p,h1); if(!t.length){console.log(`${p.padEnd(7)} - 0 trades`);continue;}
    const f=stats(t); const {outS}=split(t); const so=stats(outS); const pass=outS.length>=8&&f.avgR>0&&so.avgR>0;
    rows.push({pair:p,...f,outN:so.n,outAvgR:so.avgR,pass});
    console.log(`${p.padEnd(7)} n=${String(f.n).padStart(4)}  WR=${f.wr.toFixed(1).padStart(5)}%  avgR=${f.avgR.toFixed(3).padStart(7)}  PF=${(f.pf===Infinity?'∞':f.pf.toFixed(2)).padStart(5)}  maxDD=${f.dd.toFixed(1).padStart(6)}R | OUT avgR=${so.avgR.toFixed(3).padStart(7)}  ${pass?'✅ PASS':'❌'}`);
  }
  rows.sort((a,b)=>b.avgR-a.avgR);
  console.log('\n=============== RANKED BY avgR (after costs) ===============');
  rows.forEach((r,i)=>console.log(`${String(i+1).padStart(2)}. ${r.pair.padEnd(7)} avgR=${r.avgR.toFixed(3).padStart(7)} PF=${(r.pf===Infinity?'∞':r.pf.toFixed(2)).padStart(5)} WR=${r.wr.toFixed(1)}% ${r.pass?'✅':'❌'}`));
  console.log('\n=============== TOP 5 ===============');
  rows.slice(0,5).forEach((r,i)=>console.log(`  ${i+1}. ${r.pair}  avgR ${r.avgR.toFixed(3)}, PF ${r.pf===Infinity?'∞':r.pf.toFixed(2)}, WR ${r.wr.toFixed(1)}%, trades ${r.n} ${r.pass?'✅ passes walk-forward':''}`));
  fs.default.writeFileSync('backtest-h1-crypto-metals-results.json',JSON.stringify({rows},null,0));
}
main().catch(e=>{console.error(e);process.exit(1);});
