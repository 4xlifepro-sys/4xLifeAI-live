import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

const APPROVED = ['EURUSD','USDJPY','USDCAD','NZDUSD','EURJPY','GBPJPY','XAUUSD','XAGUSD','BTCUSD','ETHUSD'];

function fp(n: number, pair: string) {
  if (!n) return '--';
  if (pair.includes('JPY')) return n.toFixed(3);
  if (n >= 10000) return n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  if (n >= 100) return n.toFixed(2);
  if (n >= 1) return n.toFixed(4);
  return n.toFixed(5);
}

function getSession() {
  const h = new Date().getUTCHours();
  if (h >= 13 && h < 17) return { name: 'NEW YORK', color: '#10b981', bg: 'bg-emerald-500/10 border-emerald-500/20' };
  if (h >= 7 && h < 13) return { name: 'LONDON', color: '#3b82f6', bg: 'bg-blue-500/10 border-blue-500/20' };
  if (h >= 0 && h < 7) return { name: 'TOKYO', color: '#f59e0b', bg: 'bg-amber-500/10 border-amber-500/20' };
  return { name: 'SYDNEY', color: '#8b5cf6', bg: 'bg-purple-500/10 border-purple-500/20' };
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
  const sess = getSession();
  const total = APPROVED.length;
  const bullish = marketStates.filter((m:any)=>m.direction==='LONG').length;
  const bearish = marketStates.filter((m:any)=>m.direction==='SHORT').length;
  const neutral = total - bullish - bearish;

      {/* Stats Row */}
      <div className="max-w-7xl mx-auto px-6 py-4">
        <div className="grid grid-cols-4 gap-3">
          <div className="bg-[#0d1220] border border-[#1a2332] rounded-lg p-4">
            <div className="text-[10px] text-slate-500 font-mono mb-1">ACTIVE SIGNALS</div>
            <div className="text-2xl font-bold text-white">{active.length}</div>
            <div className="text-[10px] text-emerald-400 mt-1">{'>'}0 = live positions</div>
          </div>
          <div className="bg-[#0d1220] border border-[#1a2332] rounded-lg p-4">
            <div className="text-[10px] text-slate-500 font-mono mb-1">TODAY WIN RATE</div>
            <div className="text-2xl font-bold text-white">{(function(){const tc2=closed.filter((s:any)=>s.created_at?.startsWith(new Date().toISOString().split('T')[0]));const tw2=tc2.filter((s:any)=>['WIN','PARTIAL WIN'].includes(s.result)||s.status?.includes('TP')).length;const tl2=tc2.filter((s:any)=>s.result==='LOSS'||s.status==='SL HIT').length;return tw2+tl2>0?Math.round(tw2/(tw2+tl2)*100):0;})()}%</div>
            <div className="text-[10px] text-slate-400 mt-1">based on closed trades</div>
          </div>
          <div className="bg-[#0d1220] border border-[#1a2332] rounded-lg p-4">
            <div className="text-[10px] text-slate-500 font-mono mb-1">MARKET BIAS</div>
            <div className="text-2xl font-bold" style={{color:bullish>bearish?'#10b981':bearish>bullish?'#ef4444':'#94a3b8'}}>{bullish>bearish?'BULLISH':bearish>bullish?'BEARISH':'NEUTRAL'}</div>
            <div className="text-[10px] text-slate-400 mt-1">{bullish}/{total} pairs trending up</div>
          </div>
          <div className="bg-[#0d1220] border border-[#1a2332] rounded-lg p-4">
            <div className="text-[10px] text-slate-500 font-mono mb-1">TOTAL TRADES</div>
            <div className="text-2xl font-bold text-white">{allSig.length}</div>
            <div className="text-[10px] text-slate-400 mt-1">{closed.length} closed, {active.length} active</div>
          </div>
        </div>
      </div>

      {/* Active Signals */}
      {active.length > 0 ? (
        <div className="max-w-7xl mx-auto px-6 pb-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[11px] font-bold text-emerald-400 tracking-[0.15em]">ACTIVE TRADES</span>
            <span className="text-[10px] text-slate-500 font-mono bg-[#0d1220] px-2 py-0.5 rounded">{active.length}</span>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {active.map((s:any) => {
              const isLong = s.direction === 'LONG' || s.signal === 'BUY';
              const entry = prices[s.pair] || s.entry || 0;
              const sl = s.sl || 0;
              const tp1 = s.tp1 || 0;
              const tp2 = s.tp2 || 0;
              const tp3 = s.tp3 || 0;
              const risk = Math.abs(entry - sl);
              const rr1 = risk > 0 ? ((isLong ? (tp1 - entry) : (entry - tp1)) / risk).toFixed(1) : '0';
              const rr2 = risk > 0 ? ((isLong ? (tp2 - entry) : (entry - tp2)) / risk).toFixed(1) : '0';
              const rr3 = risk > 0 ? ((isLong ? (tp3 - entry) : (entry - tp3)) / risk).toFixed(1) : '0';
              return (
                <div key={s.id} className={'border rounded-xl p-5 transition-all cursor-pointer hover:scale-[1.01] ' + (isLong ? 'bg-gradient-to-br from-[#0d1a14] to-[#0d1220] border-emerald-500/20' : 'bg-gradient-to-br from-[#1a0d0d] to-[#0d1220] border-red-500/20')} onClick={()=>nav('/trades')}>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <span className="text-xl font-extrabold tracking-tight">{s.pair}</span>
                      <span className={'px-2.5 py-1 rounded-lg text-[10px] font-black tracking-wider ' + (isLong ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/15 text-red-400 border border-red-500/20')}>
                        {isLong ? 'LONG' : 'SHORT'}
                      </span>
                      <span className={'px-2 py-0.5 rounded text-[9px] font-bold ' + (s.status === 'TP1 HIT' ? 'bg-amber-500/15 text-amber-400' : s.status === 'TP2 HIT' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-slate-500/15 text-slate-400')}>
                        {s.status || 'ACTIVE'}
                      </span>
                    </div>
                    <svg className="w-4 h-4 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/></svg>
                  </div>
                  <div className="grid grid-cols-5 gap-2">
                    <div className="bg-[#0a0f18] rounded-lg p-3 border border-[#1a2332]">
                      <div className="text-[8px] text-slate-500 font-mono mb-1">ENTRY</div>
                      <div className="text-sm font-mono font-bold text-white">{fp(entry, s.pair)}</div>
                    </div>
                    <div className="bg-[#0a0f18] rounded-lg p-3 border border-red-500/10">
                      <div className="text-[8px] text-slate-500 font-mono mb-1">STOP LOSS</div>
                      <div className="text-sm font-mono font-bold text-red-400">{fp(sl, s.pair)}</div>
                    </div>
                    <div className="bg-[#0a0f18] rounded-lg p-3 border border-emerald-500/10">
                      <div className="text-[8px] text-slate-500 font-mono mb-1">TP1</div>
                      <div className="text-sm font-mono font-bold text-emerald-400">{fp(tp1, s.pair)}</div>
                      <div className="text-[8px] text-emerald-400/60">1:{rr1}</div>
                    </div>
                    <div className="bg-[#0a0f18] rounded-lg p-3 border border-emerald-500/10">
                      <div className="text-[8px] text-slate-500 font-mono mb-1">TP2</div>
                      <div className="text-sm font-mono font-bold text-emerald-400">{fp(tp2, s.pair)}</div>
                      <div className="text-[8px] text-emerald-400/60">1:{rr2}</div>
                    </div>
                    <div className="bg-[#0a0f18] rounded-lg p-3 border border-emerald-500/10">
                      <div className="text-[8px] text-slate-500 font-mono mb-1">TP3</div>
                      <div className="text-sm font-mono font-bold text-emerald-400">{fp(tp3, s.pair)}</div>
                      <div className="text-[8px] text-emerald-400/60">1:{rr3}</div>
                    </div>
                  </div>
                  {s.reason && (
                    <div className="mt-3 px-3 py-2 bg-[#0a0f18] rounded border border-[#1a2332]">
                      <span className="text-[9px] text-slate-500 font-mono">SETUP: </span>
                      <span className="text-[10px] text-slate-300">{s.reason}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="max-w-7xl mx-auto px-6 pb-4">
          <div className="border border-dashed border-[#1a2332] rounded-xl p-8 text-center">
            <div className="text-sm text-slate-500 font-mono">NO ACTIVE SIGNALS</div>
            <div className="text-[11px] text-slate-600 mt-1">Scanner is monitoring {total} pairs in real-time</div>
          </div>
        </div>
      )}

      {/* Market Overview */}
      <div className="max-w-7xl mx-auto px-6 pb-6">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[11px] font-bold text-slate-400 tracking-[0.15em]">MARKET OVERVIEW</span>
          <span className="text-[10px] text-slate-600 font-mono">{total} PAIRS</span>
        </div>
        <div className="bg-[#0d1220] border border-[#1a2332] rounded-xl overflow-hidden">
          <div className="grid grid-cols-12 px-4 py-2 bg-[#0a0f18] border-b border-[#1a2332] text-[9px] font-mono text-slate-500 tracking-wider">
            <div className="col-span-3">SYMBOL</div>
            <div className="col-span-3 text-right">PRICE</div>
            <div className="col-span-3 text-right">TREND</div>
            <div className="col-span-3 text-right">STATUS</div>
          </div>
          {APPROVED.map((pair) => {
            const ms = marketStates.find((m:any)=>m.pair===pair);
            const price = prices[pair] || 0;
            const dir = ms?.direction || 'NONE';
            const sig = active.find((a:any)=>a.pair===pair);
            const isLong = sig?.direction==='LONG'||sig?.signal==='BUY';
            return (
              <div key={pair} className={'grid grid-cols-12 px-4 py-3 border-b border-[#1a2332]/50 transition-colors ' + (sig ? (isLong ? 'bg-emerald-500/[0.03]' : 'bg-red-500/[0.03]') : 'hover:bg-[#0a0f18]')} onClick={()=>sig&&nav('/trades')}>
                <div className="col-span-3 flex items-center gap-2">
                  <span className="text-sm font-bold text-white">{pair}</span>
                </div>
                <div className="col-span-3 text-right">
                  <span className="text-sm font-mono font-semibold text-white tabular-nums">{fp(price, pair)}</span>
                </div>
                <div className="col-span-3 text-right flex justify-end items-center">
                  {dir==='LONG'?(
                    <span className="text-[10px] font-bold text-emerald-400">BULLISH</span>
                  ):dir==='SHORT'?(
                    <span className="text-[10px] font-bold text-red-400">BEARISH</span>
                  ):(
                    <span className="text-[10px] text-slate-600">NEUTRAL</span>
                  )}
                </div>
                <div className="col-span-3 text-right flex justify-end items-center">
                  {sig?(
                    <span className={'px-2 py-0.5 rounded text-[9px] font-bold ' + (isLong ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400')}>{sig.status||'ACTIVE'}</span>
                  ):(
                    <span className="text-[10px] text-slate-600">--</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Recently Closed */}
      {closed.length > 0 && (
        <div className="max-w-7xl mx-auto px-6 pb-6">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[11px] font-bold text-slate-500 tracking-[0.15em]">RECENTLY CLOSED</span>
          </div>
          <div className="space-y-1.5">
            {closed.slice(0,6).map((s:any) => {
              const result = s.result || (s.status==='TP3 HIT'||s.status==='TP2 HIT'?'WIN':'LOSS');
              const isWin = result==='WIN'||result==='PARTIAL WIN';
              const isLong = s.direction==='LONG'||s.signal==='BUY';
              return (
                <div key={s.id} className="bg-[#0d1220] border border-[#1a2332] rounded-lg px-4 py-3 flex items-center justify-between opacity-70 hover:opacity-100 transition-opacity">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-bold text-white">{s.pair}</span>
                    <span className={'text-[9px] font-bold px-1.5 py-0.5 rounded ' + (isLong ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400')}>{isLong?'LONG':'SHORT'}</span>
                  </div>
                  <div className={'text-xs font-bold ' + (isWin ? 'text-emerald-400' : 'text-red-400')}>{result}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
