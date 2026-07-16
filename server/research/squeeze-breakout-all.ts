import type { Candle } from '../src/types.js';

// ---------------------------------------------------------------------------
// NEW ISOLATED STRATEGY: Volatility Squeeze Breakout (fixed 2R target)
// Fresh design - does NOT reuse any existing engine logic.
//   1. Squeeze: Bollinger(20,2) band-width in the lowest 25% of the last 50 bars
//   2. Breakout: a candle CLOSES outside the band after the squeeze
//   3. Entry: breakout close, direction = breakout side
//   4. SL: 1.5 x ATR(14) ; TP: fixed 2R (2 x risk)
//   5. One open trade per pair at a time
// Real per-pair costs applied to every trade. Full 6-month M5 + walk-forward.
// ---------------------------------------------------------------------------

const fs = await import('fs');
const path = await import('path');
const CACHE = path.default.join(process.cwd(), '.cache');

const CRYPTO = ['BTCUSD','ETHUSD','SOLUSD','BNBUSD','LTCUSD','ADAUSD','XRPUSD','DOGEUSD'];

function pipMult(pair: string): number {
  if (pair === 'XAUUSD') return 0.1;
  if (pair === 'XAGUSD') return 0.01;
  if (pair.includes('JPY')) return 0.01;
  if (CRYPTO.includes(pair)) return 1;
  return 0.0001;
}
function costPrice(pair: string, entry: number): number {
  if (CRYPTO.includes(pair)) return entry * 0.0006;
  const map: Record<string, number> = {
    EURUSD:1.0,GBPUSD:1.2,USDJPY:1.0,USDCHF:1.5,USDCAD:1.5,AUDUSD:1.2,NZDUSD:1.6,
    EURGBP:1.5,EURJPY:1.5,GBPJPY:2.0,AUDJPY:1.8,CADJPY:2.0,CHFJPY:2.3,NZDJPY:2.3,AUDNZD:2.3,
    XAUUSD:25.7,XAGUSD:3.7,
  };
  return (map[pair] ?? 2.0) * pipMult(pair);
}

function normTs(ts: string): string { return (ts.includes('T')||ts.endsWith('Z')) ? ts : ts.replace(' ','T')+'Z'; }
function loadM5(pair: string): Candle[] | null {
  const f = path.default.join(CACHE, `${pair}_5min_6m.json`);
  if (!fs.default.existsSync(f)) return null;
  const raw: Candle[] = JSON.parse(fs.default.readFileSync(f,'utf-8'));
  if (!Array.isArray(raw) || raw.length < 60) return null;
  const norm = raw.map(c => ({...c, timestamp: normTs(c.timestamp)}));
  const seen = new Set<string>();
  const d = norm.filter(c => { if (seen.has(c.timestamp)) return false; seen.add(c.timestamp); return true; });
  d.sort((a,b)=>new Date(a.timestamp).getTime()-new Date(b.timestamp).getTime());
  return d;
}

function sma(v: number[], i: number, p: number): number { let s=0; for(let k=i-p+1;k<=i;k++) s+=v[k]; return s/p; }
function stdev(v: number[], i: number, p: number, mean: number): number { let s=0; for(let k=i-p+1;k<=i;k++){const d=v[k]-mean; s+=d*d;} return Math.sqrt(s/p); }

function atrArr(c: Candle[], p=14): number[] {
  const tr:number[]=[]; for(let i=0;i<c.length;i++){ if(i===0){tr.push(c[i].high-c[i].low);continue;} tr.push(Math.max(c[i].high-c[i].low, Math.abs(c[i].high-c[i-1].close), Math.abs(c[i].low-c[i-1].close))); }
  const a:number[]=new Array(c.length).fill(NaN); let sum=0;
  for(let i=0;i<c.length;i++){ sum+=tr[i]; if(i===p-1){a[i]=sum/p;} else if(i>=p){ a[i]=(a[i-1]*(p-1)+tr[i])/p; } }
  return a;
}

interface Trade { pair:string; dir:'LONG'|'SHORT'; entry:number; sl:number; tp:number; entryIdx:number; exitIdx:number; r:number; result:'WIN'|'LOSS'; }

const BB_P = 20, BB_K = 2, WIDTH_LOOK = 50, SQUEEZE_PCT = 0.25, ATR_SL = 1.5, RR = 2.0, MAXHOLD = 288; // ~1 day

function backtest(pair: string, c: Candle[]): Trade[] {
  const closes = c.map(x=>x.close);
  const atr = atrArr(c, 14);
  const width:number[] = new Array(c.length).fill(NaN);
  for (let i=BB_P-1;i<c.length;i++){ const m=sma(closes,i,BB_P); const sd=stdev(closes,i,BB_P,m); width[i]=(4*BB_K*sd)/m; }
  const trades: Trade[] = [];
  let openUntil = -1;

  for (let i=WIDTH_LOOK+BB_P; i<c.length-1; i++) {
    if (i <= openUntil) continue;
    if (isNaN(width[i]) || isNaN(atr[i])) continue;
    // squeeze check: current width in lowest 25% of last WIDTH_LOOK bars
    let mn=Infinity, mx=-Infinity;
    for (let k=i-WIDTH_LOOK;k<i;k++){ if(isNaN(width[k]))continue; if(width[k]<mn)mn=width[k]; if(width[k]>mx)mx=width[k]; }
    if (!isFinite(mn)||!isFinite(mx)||mx<=mn) continue;
    const rank = (width[i]-mn)/(mx-mn);
    if (rank > SQUEEZE_PCT) continue; // not squeezed
    // breakout: close outside the band
    const m = sma(closes,i,BB_P); const sd = stdev(closes,i,BB_P,m);
    const upper = m + BB_K*sd, lower = m - BB_K*sd;
    let dir: 'LONG'|'SHORT'|null = null;
    if (c[i].close > upper) dir='LONG'; else if (c[i].close < lower) dir='SHORT';
    if (!dir) continue;

    const entry = c[i].close;
    const risk = ATR_SL * atr[i];
    if (risk<=0) continue;
    const sl = dir==='LONG' ? entry-risk : entry+risk;
    const tp = dir==='LONG' ? entry+RR*risk : entry-RR*risk;
    const cost = costPrice(pair, entry);

    // simulate
    const end = Math.min(i+1+MAXHOLD, c.length);
    let done: Trade | null = null;
    for (let j=i+1;j<end;j++){
      const b=c[j];
      if (dir==='LONG'){
        if (b.low<=sl){ done={pair,dir,entry,sl,tp,entryIdx:i,exitIdx:j,r:(-risk-cost)/risk,result:'LOSS'}; break; }
        if (b.high>=tp){ done={pair,dir,entry,sl,tp,entryIdx:i,exitIdx:j,r:(RR*risk-cost)/risk,result:'WIN'}; break; }
      } else {
        if (b.high>=sl){ done={pair,dir,entry,sl,tp,entryIdx:i,exitIdx:j,r:(-risk-cost)/risk,result:'LOSS'}; break; }
        if (b.low<=tp){ done={pair,dir,entry,sl,tp,entryIdx:i,exitIdx:j,r:(RR*risk-cost)/risk,result:'WIN'}; break; }
      }
    }
    if (!done){ const last=c[end-1]; const gross=dir==='LONG'?last.close-entry:entry-last.close; done={pair,dir,entry,sl,tp,entryIdx:i,exitIdx:end-1,r:(gross-cost)/risk,result:(gross-cost)>0?'WIN':'LOSS'}; }
    trades.push(done);
    openUntil = done.exitIdx;
  }
  return trades;
}

function stats(t: Trade[]){ const n=t.length; const w=t.filter(x=>x.result==='WIN').length; const wr=n?w/n*100:0; const totalR=t.reduce((s,x)=>s+x.r,0); const avgR=n?totalR/n:0; const gw=t.filter(x=>x.r>0).reduce((s,x)=>s+x.r,0); const gl=Math.abs(t.filter(x=>x.r<0).reduce((s,x)=>s+x.r,0)); const pf=gl>0?gw/gl:(gw>0?Infinity:0); let peak=0,eq=0,dd=0; for(const x of t){eq+=x.r; if(eq>peak)peak=eq; if(peak-eq>dd)dd=peak-eq;} return {n,wr,avgR,pf,dd}; }
function split(t: Trade[]){ const s=[...t].sort((a,b)=>a.entryIdx-b.entryIdx); const cut=Math.floor(s.length*4/6); return {inS:s.slice(0,cut),outS:s.slice(cut)}; }

const PAIRS = ['XAUUSD','XAGUSD','BTCUSD','ETHUSD','SOLUSD','BNBUSD','LTCUSD','ADAUSD','XRPUSD','DOGEUSD',
  'EURUSD','GBPUSD','USDJPY','USDCHF','USDCAD','AUDUSD','NZDUSD','EURGBP','EURJPY','GBPJPY','AUDJPY','CADJPY','CHFJPY','NZDJPY','AUDNZD'];
function cls(p:string){ if(['XAUUSD','XAGUSD'].includes(p))return'METALS'; if(CRYPTO.includes(p))return'CRYPTO'; return'FOREX'; }

async function main(){
  console.log('\n==================================================================');
  console.log(' NEW STRATEGY: VOLATILITY SQUEEZE BREAKOUT (fixed 2R)  - all pairs');
  console.log(' Real costs applied. 6-month M5 + walk-forward.');
  console.log('==================================================================\n');
  const rows:any[]=[];
  for (const p of PAIRS){
    const c=loadM5(p);
    if(!c){ console.log(`SKIP ${p.padEnd(7)} - no data`); continue; }
    if(c.length<4000){ console.log(`SKIP ${p.padEnd(7)} - short (${c.length})`); continue; }
    const t=backtest(p,c);
    if(t.length===0){ console.log(`${p.padEnd(7)} [${cls(p)}] - 0 trades`); continue; }
    const f=stats(t); const {inS,outS}=split(t); const so=stats(outS);
    const pass = outS.length>=10 && so.avgR>0 && so.wr>=30;
    rows.push({pair:p,class:cls(p),...f,outN:so.n,outAvgR:so.avgR,outWR:so.wr,pass});
    console.log(`${p.padEnd(7)} [${cls(p).padEnd(6)}] n=${String(f.n).padStart(4)}  WR=${f.wr.toFixed(1).padStart(5)}%  avgR=${f.avgR.toFixed(3).padStart(7)}  PF=${(f.pf===Infinity?'∞':f.pf.toFixed(2)).padStart(5)}  maxDD=${f.dd.toFixed(1).padStart(6)}R | OUT n=${String(so.n).padStart(3)} avgR=${so.avgR.toFixed(3).padStart(7)} WR=${so.wr.toFixed(0)}%  ${pass?'✅ PASS':'❌'}`);
  }
  rows.sort((a,b)=>b.avgR-a.avgR);
  console.log('\n=============== RANKED BY avgR (after costs) ===============');
  rows.forEach((r,i)=>console.log(`${String(i+1).padStart(2)}. ${r.pair.padEnd(7)} [${r.class.padEnd(6)}] avgR=${r.avgR.toFixed(3).padStart(7)} PF=${(r.pf===Infinity?'∞':r.pf.toFixed(2)).padStart(5)} WR=${r.wr.toFixed(1)}% ${r.pass?'✅ PASS':'❌'}`));
  const pass=rows.filter(r=>r.pass);
  console.log('\n=============== FINAL VERDICT: PASSERS ===============');
  if(!pass.length) console.log('None passed strict walk-forward.');
  else pass.forEach(r=>console.log(`  ✅ ${r.pair} [${r.class}] full avgR ${r.avgR.toFixed(3)}, out-of-sample ${r.outAvgR.toFixed(3)}, PF ${r.pf===Infinity?'∞':r.pf.toFixed(2)}, WR ${r.wr.toFixed(1)}%`));
  fs.default.writeFileSync('backtest-squeeze-results.json', JSON.stringify({rows},null,0));
  console.log('\nSaved -> backtest-squeeze-results.json');
}
main().catch(e=>{console.error(e);process.exit(1);});
