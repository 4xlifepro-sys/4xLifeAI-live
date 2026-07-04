import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

const APPROVED = ['EURUSD','USDJPY','USDCAD','NZDUSD','EURJPY','GBPJPY','XAUUSD','XAGUSD','BTCUSD','ETHUSD'];
const GROUPS = [
  { label: 'FOREX', pairs: ['EURUSD','USDJPY','USDCAD','NZDUSD','EURJPY','GBPJPY'], sym: { EURUSD:'\u20AC', USDJPY:'\u00A5', USDCAD:'C$', NZDUSD:'NZ', EURJPY:'\u20AC', GBPJPY:'\u00A3' } },
  { label: 'METALS', pairs: ['XAUUSD','XAGUSD'], sym: { XAUUSD:'Au', XAGUSD:'Ag' } },
  { label: 'CRYPTO', pairs: ['BTCUSD','ETHUSD'], sym: { BTCUSD:'\u20BF', ETHUSD:'\u039E' } },
];

function fp(n: number, pair: string) {
  if (!n) return '\u2014';
  if (pair.includes('JPY')) return n.toFixed(3);
  if (n >= 10000) return n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  if (n >= 100) return n.toFixed(2);
  if (n >= 1) return n.toFixed(4);
  return n.toFixed(5);
}

function getSession() {
  const h = new Date().getUTCHours();
  if (h >= 13 && h < 17) return { name: 'NEW YORK', color: '#00e08a' };
  if (h >= 7 && h < 13) return { name: 'LONDON', color: '#4a9eff' };
  if (h >= 0 && h < 7) return { name: 'TOKYO', color: '#f5a524' };
  return { name: 'SYDNEY', color: '#8b5cf6' };
}

function isWeekend() {
  const d = new Date().getUTCDay(), h = new Date().getUTCHours();
  if (d === 5) return h >= 22;
  if (d === 6) return true;
  if (d === 0) return h < 22;
  return false;
}

export default function Dashboard() {
  const nav = useNavigate();
  const [state, setState] = useState<any>({ stats:null, marketStates:[], activeOpportunities:[], prices:{} });

  useEffect(() => {
    const es = new EventSource('/api/stream');
    es.onmessage = (e) => { try { setState(p=>({...p,...JSON.parse(e.data)})); } catch {} };
    const fetchP = async () => {
      try { const r = await fetch('/api/prices'); if (!r.ok) return; const d = await r.json(); const m:Record<string,number>={}; (d.prices||[]).forEach((p:any)=>{ if(p.pair&&typeof p.price==='number') m[p.pair]=p.price; }); setState(p=>({...p,prices:m})); } catch {}
    };
    const fetchS = async () => {
      if (!supabase) return;
      const { data } = await supabase.from('signals').select('*').order('created_at',{ascending:false}).limit(100);
      if (data) setState(p=>({...p,activeOpportunities:data}));
    };
    fetchP(); fetchS();
    const pi = setInterval(fetchP, 5000);
    const si = setInterval(fetchS, 15000);
    let ch: any;
    if (supabase) { ch = supabase.channel('d2').on('postgres_changes',{event:'*',schema:'public',table:'signals'},(pl:any)=>{ if(pl.eventType==='INSERT') setState(p=>({...p,activeOpportunities:[pl.new,...(p.activeOpportunities||[])].slice(0,100)})); else if(pl.eventType==='UPDATE') setState(p=>({...p,activeOpportunities:(p.activeOpportunities||[]).map((s:any)=>s.id===pl.new.id?pl.new:s)})); }).subscribe(); }
    return () => { es.close(); if(ch) supabase!.removeChannel(ch); clearInterval(pi); clearInterval(si); };
  }, []);

  const prices = state.prices || {};
  const marketStates = (state.marketStates||[]).filter((s:any)=>APPROVED.includes(s.pair));
  const allSig = state.activeOpportunities || [];
  const active = allSig.filter((s:any)=>APPROVED.includes(s.pair)&&['ACTIVE','TP1 HIT','TP2 HIT'].includes(s.status));
  const closed = allSig.filter((s:any)=>APPROVED.includes(s.pair)&&['CLOSED','TP3 HIT','SL HIT','EXPIRED'].includes(s.status));

  const today = new Date().toISOString().split('T')[0];
  const tc = closed.filter((s:any)=>s.created_at?.startsWith(today));
  const tw = tc.filter((s:any)=>['WIN','PARTIAL WIN'].includes(s.result)||s.status?.includes('TP')).length;
  const tl = tc.filter((s:any)=>s.result==='LOSS'||s.status==='SL HIT').length;
  const wr = tw+tl>0?Math.round(tw/(tw+tl)*100):0;
  const aw = allSig.filter((s:any)=>['WIN','PARTIAL WIN'].includes(s.result)||s.status?.includes('TP')).length;
  const al = allSig.filter((s:any)=>s.result==='LOSS'||s.status==='SL HIT').length;
  const awr = aw+al>0?Math.round(aw/(aw+al)*100):0;
  const sess = getSession();

  return (
    <div className="min-h-screen bg-[#06090f] text-white antialiased">
      <header className="sticky top-0 z-50 bg-[#0a0e18]/95 backdrop-blur border-b border-[#141c2b]">
        <div className="max-w-5xl mx-auto px-4 h-11 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-sm bg-[#00e08a]" />
              <span className="text-sm font-extrabold tracking-tight">4xLife</span>
              <span className="text-[7px] font-black text-[#f5a524] tracking-widest mt-0.5">PRO</span>
            </div>
            <div className="hidden sm:flex items-center gap-3 text-[10px] font-mono text-[#3a4a5c]">
              <div className="flex items-center gap-1"><div className="w-1 h-1 rounded-full bg-[#00e08a] animate-pulse" /><span className="text-[#00e08a]">LIVE</span></div>
              <span className="text-[#1a2332]">|</span>
              <span style={{color:sess.color}}>{sess.name}</span>
              <span className="text-[#1a2332]">|</span>
              <span>{APPROVED.length} PAIRS</span>
            </div>
          </div>
          <div className="flex items-center gap-3 text-[10px] font-mono">
            <div className="hidden sm:flex items-center gap-2 bg-[#0d1220] rounded px-2 py-1 border border-[#141c2b]">
              <span className="text-[#3a4a5c]">TODAY</span>
              <span className="text-[#00e08a] font-bold">{tw}W</span>
              <span className="text-[#ff4d6d] font-bold">{tl}L</span>
              <span className="text-white font-bold">{wr}%</span>
            </div>
            <div className="hidden md:flex items-center gap-1 text-[#3a4a5c]">
              <span>ALL</span>
              <span className="text-white font-bold">{awr}%</span>
            </div>
            <span className="text-[#2a3a50] text-[9px]">
              {state.stats?.lastScanTime?new Date(state.stats.lastScanTime).toLocaleTimeString('en-US',{hour12:false,timeZone:'UTC'}):'\u2014'} UTC
            </span>
            <button onClick={()=>nav('/trades')} className="bg-[#00e08a]/10 hover:bg-[#00e08a]/20 text-[#00e08a] px-2.5 py-1 rounded text-[9px] font-bold tracking-wider border border-[#00e08a]/20 transition-colors">TRADES</button>
          </div>
        </div>
      </header>

      {isWeekend()&&(
        <div className="bg-[#f5a524]/[0.06] border-b border-[#f5a524]/10 text-center py-1.5">
          <span className="text-[#f5a524] text-[10px] font-mono font-bold tracking-wider">WEEKEND</span>
          <span className="text-[#f5a524]/50 text-[9px] font-mono ml-2">Crypto &amp; Metals only</span>
        </div>
      )}

      {active.length>0&&(
        <div className="border-b border-[#141c2b] bg-[#080d18]">
          <div className="max-w-5xl mx-auto px-4 py-3">
            <div className="flex items-center gap-2 mb-2.5">
              <div className="w-1.5 h-1.5 rounded-full bg-[#00e08a] animate-pulse" />
              <span className="text-[9px] font-black text-[#00e08a] tracking-[0.2em]">ACTIVE SIGNALS</span>
              <span className="text-[8px] font-mono text-[#3a4a5c] bg-[#0d1220] px-1.5 py-0.5 rounded">{active.length}</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {active.map((s:any)=>{
                const lng = s.direction==='LONG'||s.signal==='BUY';
                const ac = lng?'#00e08a':'#ff4d6d';
                return (
                  <div key={s.id} className="bg-[#0a1020] border border-[#141c2b] rounded-lg p-3 hover:border-[#1e2d44] transition-all cursor-pointer" onClick={()=>nav('/trades')}>
                    <div className="flex items-center justify-between mb-2.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-extrabold tracking-wide">{s.pair}</span>
                        <span className="px-1.5 py-0.5 rounded text-[8px] font-black tracking-wider" style={{backgroundColor:ac+'15',color:ac,border:'1px solid '+ac+'25'}}>{lng?'BUY':'SELL'}</span>
                        <span className="text-[9px] font-mono font-bold" style={{color:'#f5a524'}}>{s.status||'ACTIVE'}</span>
                      </div>
                      <svg className="w-3 h-3 text-[#2a3a50]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/></svg>
                    </div>
                    <div className="flex items-center gap-3 text-[11px] font-mono">
                      <div><span className="text-[#2a3a50] text-[8px] block">ENTRY</span><span className="text-white font-semibold">{fp(prices[s.pair]||s.entry||0,s.pair)}</span></div>
                      <div className="w-px h-6 bg-[#141c2b]" />
                      <div><span className="text-[#2a3a50] text-[8px] block">SL</span><span className="text-[#ff4d6d] font-semibold">{fp(s.sl||0,s.pair)}</span></div>
                      <div className="w-px h-6 bg-[#141c2b]" />
                      <div><span className="text-[#2a3a50] text-[8px] block">TP1</span><span className="text-[#00e08a] font-semibold">{fp(s.tp1||0,s.pair)}</span></div>
                      <div><span className="text-[#2a3a50] text-[8px] block">TP2</span><span className="text-[#00e08a] font-semibold">{fp(s.tp2||0,s.pair)}</span></div>
                      <div><span className="text-[#2a3a50] text-[8px] block">TP3</span><span className="text-[#00e08a] font-semibold">{fp(s.tp3||0,s.pair)}</span></div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <div className="max-w-5xl mx-auto">
        {GROUPS.map((g)=>(
          <div key={g.label}>
            <div className="sticky top-11 z-40 bg-[#06090f]/95 backdrop-blur-sm border-b border-[#141c2b] px-4 py-1.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-[9px] font-black text-[#3a4a5c] tracking-[0.3em]">{g.label}</span>
                <span className="text-[8px] font-mono text-[#1e2d44]">{g.pairs.length}</span>
              </div>
              <div className="flex items-center gap-4 text-[8px] font-mono text-[#1e2d44] tracking-wider pr-14">
                <span>PRICE</span>
                <span className="w-14 text-right">TREND</span>
              </div>
            </div>
            {g.pairs.filter(p=>APPROVED.includes(p)).map((pair)=>{
              const ms = marketStates.find((m:any)=>m.pair===pair);
              const price = prices[pair] || 0;
              const sym = g.sym[pair] || '$';
              const dir = ms?.direction || 'NONE';
              const isActive = active.some((a:any)=>a.pair===pair);
              const sig = active.find((a:any)=>a.pair===pair);
              const isLong = sig?.direction==='LONG'||sig?.signal==='BUY';
              return (
                <div key={pair} className={'px-4 py-3 flex items-center justify-between border-b border-[#0f1520] transition-colors ' + (isActive?(isLong?'bg-[#00e08a]/[0.025]':'bg-[#ff4d6d]/[0.025]'):dir==='LONG'?'bg-[#00e08a]/[0.012]':dir==='SHORT'?'bg-[#ff4d6d]/[0.012]':'hover:bg-[#0a0f18]')} onClick={()=>isActive&&nav('/trades')}>
                  <div className="flex items-center gap-3 w-40 shrink-0">
                    <span className="text-[10px] text-[#2a3a50] font-bold w-5 text-center">{sym}</span>
                    <span className="text-xs font-bold text-white tracking-wide">{pair}</span>
                    {isActive&&<div className={'w-1 h-1 rounded-full '+(isLong?'bg-[#00e08a]':'bg-[#ff4d6d]')} />}
                  </div>
                  <div className="flex-1 flex justify-center">
                    <span className="text-[15px] font-mono font-semibold text-white tabular-nums tracking-tight">{fp(price,pair)}</span>
                  </div>
                  <div className="w-14 shrink-0 flex justify-end">
                    {isActive?(
                      <span className={'px-1.5 py-0.5 rounded text-[8px] font-black tracking-wider '+(isLong?'bg-[#00e08a]/10 text-[#00e08a]':'bg-[#ff4d6d]/10 text-[#ff4d6d]')}>{sig?.status||'ACTIVE'}</span>
                    ):dir==='LONG'?(
                      <span className="text-[10px] text-[#00e08a]/60 font-bold">BULL</span>
                    ):dir==='SHORT'?(
                      <span className="text-[10px] text-[#ff4d6d]/60 font-bold">BEAR</span>
                    ):(
                      <span className="text-[10px] text-[#1a2332] font-mono">{'—'}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}

        {closed.length>0&&(
          <div className="mt-3 border-t border-[#141c2b]">
            <div className="sticky top-11 z-40 bg-[#06090f]/95 backdrop-blur-sm border-b border-[#141c2b] px-4 py-1.5">
              <span className="text-[9px] font-black text-[#3a4a5c] tracking-[0.3em]">RECENTLY CLOSED</span>
            </div>
            {closed.slice(0,8).map((s:any)=>{
              const result = s.result || (s.status==='TP3 HIT'||s.status==='TP2 HIT'?'WIN':'LOSS');
              const isWin = result==='WIN'||result==='PARTIAL WIN';
              return (
                <div key={s.id} className="px-4 py-2.5 flex items-center justify-between border-b border-[#0f1520] opacity-60">
                  <div className="flex items-center gap-3 w-40 shrink-0">
                    <span className="text-[10px] text-[#2a3a50] font-bold w-5 text-center">{'$'}</span>
                    <span className="text-xs font-bold text-[#5d6b80]">{s.pair}</span>
                  </div>
                  <div className="flex-1" />
                  <div className="w-14 shrink-0 flex justify-end">
                    <span className={'text-[10px] font-bold '+(isWin?'text-[#00e08a]':'text-[#ff4d6d]')}>{result}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
