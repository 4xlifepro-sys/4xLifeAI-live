import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

const APPROVED = ['EURUSD','USDJPY','USDCAD','NZDUSD','EURJPY','GBPJPY','XAUUSD','XAGUSD','BTCUSD','ETHUSD'];

const GROUPS: { label: string; pairs: string[]; icon: string }[] = [
  { label: 'FOREX', pairs: ['EURUSD','USDJPY','USDCAD','NZDUSD','EURJPY','GBPJPY'], icon: 'FX' },
  { label: 'METALS', pairs: ['XAUUSD','XAGUSD'], icon: 'MT' },
  { label: 'CRYPTO', pairs: ['BTCUSD','ETHUSD'], icon: 'CR' },
];

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
  if (h >= 13 && h < 17) return { name: 'NEW YORK', color: '#10b981' };
  if (h >= 7 && h < 13) return { name: 'LONDON', color: '#3b82f6' };
  if (h >= 0 && h < 7) return { name: 'TOKYO', color: '#f59e0b' };
  return { name: 'SYDNEY', color: '#8b5cf6' };
}

function isWeekend() {
  const d = new Date().getUTCDay(), h = new Date().getUTCHours();
  if (d === 5) return h >= 22;
  if (d === 6) return true;
  if (d === 0) return h < 22;
  return false;
}

function daysAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return '1d ago';
  return days + 'd ago';
}

function calcPips(pair: string, entry: number, exit: number): number {
  if (!entry || !exit) return 0;
  const diff = exit - entry;
  if (pair.includes('JPY')) return Math.round(diff * 100);
  if (pair.includes('XAU') || pair.includes('XAG')) return Math.round(diff * 10);
  return Math.round(diff * 10000);
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
      const { data } = await supabase.from('signals').select('*').order('created_at',{ascending:false}).limit(200);
      if (data) setState(p=>({...p,activeOpportunities:data}));
    };
    fetchP(); fetchS();
    const pi = setInterval(fetchP, 5000);
    const si = setInterval(fetchS, 15000);
    let ch: any;
    if (supabase) { ch = supabase.channel('d3').on('postgres_changes',{event:'*',schema:'public',table:'signals'},(pl:any)=>{ if(pl.eventType==='INSERT') setState(p=>({...p,activeOpportunities:[pl.new,...(p.activeOpportunities||[])].slice(0,200)})); else if(pl.eventType==='UPDATE') setState(p=>({...p,activeOpportunities:(p.activeOpportunities||[]).map((s:any)=>s.id===pl.new.id?pl.new:s)})); }).subscribe(); }
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

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30*86400000);
  const recent30 = closed.filter((s:any)=> new Date(s.created_at) > thirtyDaysAgo);
  const wins30 = recent30.filter((s:any)=>['WIN','PARTIAL WIN'].includes(s.result)||s.status?.includes('TP')).length;
  const losses30 = recent30.filter((s:any)=>s.result==='LOSS'||s.status==='SL HIT').length;
  const winRate30 = wins30+losses30>0?Math.round(wins30/(wins30+losses30)*100):0;

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthSignals = allSig.filter((s:any)=>new Date(s.created_at) >= monthStart).length;
  const monthClosed = closed.filter((s:any)=>new Date(s.created_at) >= monthStart);
  const monthWins = monthClosed.filter((s:any)=>['WIN','PARTIAL WIN'].includes(s.result)||s.status?.includes('TP'));
  const monthLosses = monthClosed.filter((s:any)=>s.result==='LOSS'||s.status==='SL HIT');

  const avgRR = (() => {
    const withRR = monthClosed.filter((s:any)=>s.sl&&s.tp1&&(s.direction==='LONG'||s.direction==='SHORT'||s.signal==='BUY'||s.signal==='SELL'));
    if (withRR.length === 0) return null;
    let sum = 0;
    withRR.forEach((s:any) => {
      const entry = s.entry || prices[s.pair] || 0;
      const risk = Math.abs(entry - s.sl);
      const reward = Math.abs(s.tp1 - entry);
      if (risk > 0) sum += reward / risk;
    });
    return (sum / withRR.length).toFixed(1);
  })();

  const totalPipsMonth = (() => {
    let sum = 0;
    monthClosed.forEach((s:any) => {
      const entry = s.entry || 0;
      const isWin = ['WIN','PARTIAL WIN'].includes(s.result)||s.status?.includes('TP');
      const exit = isWin ? s.tp3 || s.tp1 || 0 : s.sl || 0;
      const isLong = s.direction==='LONG'||s.signal==='BUY';
      const diff = isLong ? exit - entry : entry - exit;
      if (s.pair.includes('JPY')) sum += Math.round(diff * 100);
      else if (s.pair.includes('XAU') || s.pair.includes('XAG')) sum += Math.round(diff * 10);
      else sum += Math.round(diff * 10000);
    });
    return sum;
  })();

  return (
    <div className="min-h-screen bg-[#080a0f] text-slate-200">
      {/* Header */}
      <header className="bg-[#0d1117] border-b border-[#1e2d3d] sticky top-0 z-50 backdrop-blur">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-emerald-400 shadow-lg shadow-emerald-500/50 animate-pulse" />
              <h1 className="text-xl font-bold tracking-tight text-white">4xLifeAI</h1>
              <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">LIVE</span>
            </div>
            <div className="h-5 w-px bg-[#1e2d3d]" />
            <div className="text-[11px] font-mono" style={{color: sess.color}}>
              {sess.name} SESSION
            </div>
            <div className="text-[11px] font-mono text-slate-500">
              {total} PAIRS
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button onClick={() => nav('/trades')} className="text-[11px] font-semibold text-slate-300 hover:text-white transition-colors">TRADE LOG</button>
            <div className="text-[10px] font-mono text-slate-500">
              {state.stats?.lastScanTime ? new Date(state.stats.lastScanTime).toLocaleTimeString('en-US', {hour12:false, timeZone:'UTC'}) : '--'} UTC
            </div>
          </div>
        </div>
      </header>

      {isWeekend() && (
        <div className="bg-amber-500/5 border-b border-amber-500/20 text-center py-2">
          <span className="text-[11px] font-semibold text-amber-400">WEEKEND MODE</span>
          <span className="text-[11px] text-amber-400/60 ml-2">Crypto & Metals only</span>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {/* Win Rate Card */}
          <div className="bg-[#0d1117] border border-[#1e2d3d] rounded-lg p-5">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Win Rate</div>
            </div>
            <div className="text-3xl font-bold text-white mb-1">{winRate30}%</div>
            <div className="text-[10px] text-slate-500">Last 30 days</div>
            <div className="mt-3 pt-3 border-t border-[#1e2d3d]">
              <span className="text-[9px] text-slate-600">{wins30}W {losses30}L</span>
            </div>
          </div>

          {/* Total Signals Card */}
          <div className="bg-[#0d1117] border border-[#1e2d3d] rounded-lg p-5">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Signals This Month</div>
            </div>
            <div className="text-3xl font-bold text-white mb-1">{monthSignals}</div>
            <div className="text-[10px] text-slate-500">Since {monthStart.toLocaleDateString('en-US', {month:'short', day:'numeric'})}</div>
            <div className="mt-3 pt-3 border-t border-[#1e2d3d]">
              <span className="text-[9px] text-slate-600">{monthWins.length} wins, {monthLosses.length} losses</span>
            </div>
          </div>

          {/* Active Signals Card */}
          <div className="bg-[#0d1117] border border-[#1e2d3d] rounded-lg p-5">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Active Now</div>
              {active.length > 0 && <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />}
            </div>
            <div className="text-3xl font-bold text-white mb-1">{active.length}</div>
            <div className="text-[10px] text-slate-500">{active.length > 0 ? 'Live positions' : 'Scanning markets'}</div>
            <div className="mt-3 pt-3 border-t border-[#1e2d3d]">
              <span className="text-[9px] text-slate-600">{bullish} bullish, {bearish} bearish</span>
            </div>
          </div>

          {/* Avg R:R Card */}
          <div className="bg-[#0d1117] border border-[#1e2d3d] rounded-lg p-5">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Avg Risk:Reward</div>
            </div>
            <div className="text-3xl font-bold text-white mb-1">1:{avgRR || '--'}</div>
            <div className="text-[10px] text-slate-500">From closed trades</div>
            <div className="mt-3 pt-3 border-t border-[#1e2d3d]">
              <span className="text-[9px] text-slate-600">Total: {totalPipsMonth} pips</span>
            </div>
          </div>
        </div>

        {/* Active Signals Section */}
        <section className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold text-white">Active Signals</h2>
              <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                {active.length}
              </span>
            </div>
          </div>

          {active.length > 0 ? (
            <div className="space-y-3">
              {active.map((s: any) => {
                const isLong = s.direction === 'LONG' || s.signal === 'BUY';
                const entry = s.entry || prices[s.pair] || 0;
                const currentPrice = prices[s.pair] || entry;
                const pips = calcPips(s.pair, entry, currentPrice) * (isLong ? 1 : -1);
                const pipsColor = pips > 0 ? 'text-emerald-400' : pips < 0 ? 'text-red-400' : 'text-slate-500';
                const pipsBg = pips > 0 ? 'bg-emerald-500/10' : pips < 0 ? 'bg-red-500/10' : 'bg-slate-500/10';
                
                return (
                  <div key={s.id} className={`bg-[#0d1117] border rounded-lg p-5 cursor-pointer transition-all hover:border-[#2a3f55] ${isLong ? 'border-l-4 border-l-emerald-500/50' : 'border-l-4 border-l-red-500/50'}`} onClick={() => nav('/trades')}>
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="text-lg font-bold text-white">{s.pair}</div>
                        <div className={`px-2 py-0.5 rounded text-[10px] font-bold ${isLong ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/15 text-red-400 border border-red-500/20'}`}>
                          {isLong ? 'LONG' : 'SHORT'}
                        </div>
                        <div className="text-[10px] font-mono text-slate-500">{daysAgo(s.created_at)}</div>
                      </div>
                      <div className={`px-2 py-0.5 rounded text-[10px] font-bold ${pipsBg} ${pipsColor}`}>
                        {pips > 0 ? '+' : ''}{pips} pips
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                      <div>
                        <div className="text-[9px] text-slate-600 mb-1">ENTRY</div>
                        <div className="text-sm font-mono font-semibold text-white">{fp(entry, s.pair)}</div>
                      </div>
                      <div>
                        <div className="text-[9px] text-slate-600 mb-1">STOP LOSS</div>
                        <div className="text-sm font-mono font-semibold text-red-400">{fp(s.sl || 0, s.pair)}</div>
                      </div>
                      <div>
                        <div className="text-[9px] text-slate-600 mb-1">TP1</div>
                        <div className="text-sm font-mono font-semibold text-emerald-400">{fp(s.tp1 || 0, s.pair)}</div>
                      </div>
                      <div>
                        <div className="text-[9px] text-slate-600 mb-1">TP2</div>
                        <div className="text-sm font-mono font-semibold text-emerald-400">{fp(s.tp2 || 0, s.pair)}</div>
                      </div>
                      <div>
                        <div className="text-[9px] text-slate-600 mb-1">TP3</div>
                        <div className="text-sm font-mono font-semibold text-emerald-400">{fp(s.tp3 || 0, s.pair)}</div>
                      </div>
                    </div>

                    {s.status && s.status !== 'ACTIVE' && (
                      <div className="mt-3 pt-3 border-t border-[#1e2d3d]">
                        <span className={`text-[10px] font-semibold ${s.status.includes('TP') ? 'text-emerald-400' : s.status.includes('SL') ? 'text-red-400' : 'text-slate-500'}`}>
                          {s.status}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="bg-[#0d1117] border border-dashed border-[#1e2d3d] rounded-lg p-12 text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-[#151c2c] mb-4">
                <div className="w-8 h-8 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
              </div>
              <div className="text-sm font-semibold text-slate-400 mb-1">No active signals</div>
              <div className="text-[11px] text-slate-600">Scanning {total} pairs in real-time</div>
            </div>
          )}
        </section>

        {/* Market Watchlist */}
        <section className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white">Market Watchlist</h2>
          </div>

          {GROUPS.map((group) => {
            const groupPairs = group.pairs.filter(p => APPROVED.includes(p));
            return (
              <div key={group.label} className="mb-6">
                <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                  <span>{group.icon}</span>
                  {group.label}
                  <span className="text-slate-700">({groupPairs.length})</span>
                </div>
                
                <div className="space-y-1">
                  {groupPairs.map((pair) => {
                    const ms = marketStates.find((m: any) => m.pair === pair);
                    const price = prices[pair] || 0;
                    const dir = ms?.direction || 'NONE';
                    const activeSig = active.find((a: any) => a.pair === pair);
                    
                    let trendLabel = 'NEUTRAL';
                    let trendBg = 'bg-slate-500/10';
                    let trendColor = 'text-slate-500';
                    if (dir === 'LONG') {
                      trendLabel = 'BULL';
                      trendBg = 'bg-emerald-500/10';
                      trendColor = 'text-emerald-400';
                    } else if (dir === 'SHORT') {
                      trendLabel = 'BEAR';
                      trendBg = 'bg-red-500/10';
                      trendColor = 'text-red-400';
                    }

                    return (
                      <div key={pair} className="bg-[#0d1117] border border-[#1e2d3d] rounded-lg px-4 py-3 flex items-center justify-between hover:border-[#2a3f55] transition-colors cursor-pointer" onClick={() => activeSig && nav('/trades')}>
                        <div className="flex items-center gap-4 flex-1">
                          <div className="text-sm font-bold text-white w-24">{pair}</div>
                          <div className="text-sm font-mono font-semibold text-white">{fp(price, pair)}</div>
                        </div>
                        
                        <div className="flex items-center gap-4">
                          <div className={`px-2 py-0.5 rounded text-[10px] font-bold ${trendBg} ${trendColor}`}>
                            {trendLabel}
                          </div>
                          {activeSig && (
                            <div className={`px-2 py-0.5 rounded text-[10px] font-bold ${activeSig.direction === 'LONG' || activeSig.signal === 'BUY' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
                              {activeSig.status || 'ACTIVE'}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </section>

        {/* Recent Signal History */}
        {closed.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-white">Recent Signal History</h2>
              <span className="text-[10px] text-slate-500">{closed.length} closed trades</span>
            </div>

            <div className="bg-[#0d1117] border border-[#1e2d3d] rounded-lg overflow-hidden">
              <div className="grid grid-cols-12 px-4 py-2 bg-[#151c2c] text-[9px] font-semibold text-slate-500 uppercase tracking-wider">
                <div className="col-span-2">Pair</div>
                <div className="col-span-1">Side</div>
                <div className="col-span-2 text-right">Entry</div>
                <div className="col-span-2 text-right">Exit</div>
                <div className="col-span-1 text-center">Result</div>
                <div className="col-span-2 text-right">Pips</div>
                <div className="col-span-2 text-right">Closed</div>
              </div>
              
              <div className="divide-y divide-[#1e2d3d]">
                {closed.slice(0, 10).map((s: any) => {
                  const isLong = s.direction === 'LONG' || s.signal === 'BUY';
                  const entry = s.entry || 0;
                  const exit = s.exit_price || (s.status?.includes('TP') ? s.tp3 : s.sl) || 0;
                  const pips = calcPips(s.pair, entry, exit);
                  const result = s.result || (s.status?.includes('TP') ? 'WIN' : s.status === 'SL HIT' ? 'LOSS' : 'CLOSED');
                  const isWin = result === 'WIN' || result === 'PARTIAL WIN';
                  
                  let resultBg = 'bg-slate-500/10';
                  let resultColor = 'text-slate-400';
                  if (isWin) {
                    resultBg = 'bg-emerald-500/10';
                    resultColor = 'text-emerald-400';
                  } else if (result === 'LOSS') {
                    resultBg = 'bg-red-500/10';
                    resultColor = 'text-red-400';
                  }

                  return (
                    <div key={s.id} className="grid grid-cols-12 px-4 py-3 hover:bg-[#151c2c]/50 transition-colors">
                      <div className="col-span-2 text-sm font-bold text-white">{s.pair}</div>
                      <div className="col-span-1">
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${isLong ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                          {isLong ? 'LONG' : 'SHORT'}
                        </span>
                      </div>
                      <div className="col-span-2 text-right text-sm font-mono text-slate-300">{fp(entry, s.pair)}</div>
                      <div className="col-span-2 text-right text-sm font-mono text-slate-300">{fp(exit, s.pair)}</div>
                      <div className="col-span-1 text-center">
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${resultBg} ${resultColor}`}>
                          {result}
                        </span>
                      </div>
                      <div className={`col-span-2 text-right text-sm font-mono font-semibold ${pips >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {pips > 0 ? '+' : ''}{pips}
                      </div>
                      <div className="col-span-2 text-right text-[11px] text-slate-500">{daysAgo(s.created_at)}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
