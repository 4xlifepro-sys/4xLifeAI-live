import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

const APPROVED_PAIRS = ['EURUSD', 'USDJPY', 'USDCAD', 'NZDUSD', 'EURJPY', 'GBPJPY', 'XAUUSD', 'XAGUSD', 'BTCUSD', 'ETHUSD'];

function StatCard({ label, value, color = "#ffffff" }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-[#0d1220] border border-[#1a2332] rounded-lg px-4 py-3">
      <span className="text-[10px] text-[#5d6b80] uppercase tracking-wider font-bold block mb-1">{label}</span>
      <span className="text-xl font-mono font-bold" style={{ color }}>{value}</span>
    </div>
  );
}

function PriceBox({ label, value, pair, highlight = false, danger = false, success = false }: { label: string; value: number; pair: string; highlight?: boolean; danger?: boolean; success?: boolean }) {
  const fmt = (v: number) => {
    if (v === 0) return '--';
    if (pair.includes('JPY')) return v.toFixed(3);
    if (pair === 'XAUUSD' || pair === 'XAGUSD') return v.toFixed(2);
    if (v > 100) return v.toFixed(2);
    return v.toFixed(5);
  };
  const clr = danger ? '#ff4d6d' : success ? '#00e08a' : highlight ? '#3b82f6' : '#ffffff';
  return (
    <div className="bg-[#0a0e17] border border-[#1a2332] rounded-lg px-3 py-2.5">
      <span className="text-[10px] text-[#5d6b80] uppercase tracking-wider block mb-1">{label}</span>
      <span className="text-base font-mono font-bold" style={{ color: clr }}>{fmt(value)}</span>
    </div>
  );
}

const isWeekend = () => {
  const now = new Date();
  const day = now.getUTCDay();
  const hours = now.getUTCHours();
  if (day === 5) return hours >= 22;
  if (day === 6) return true;
  if (day === 0) return hours < 22;
  return false;
};

function getPairCategory(pair: string) {
  if (['BTCUSD', 'ETHUSD'].includes(pair)) return 'Crypto';
  if (['XAUUSD', 'XAGUSD'].includes(pair)) return 'Metals';
  return 'Forex';
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [state, setState] = useState<any>({ stats: null, pairStatuses: [], signals: [], marketStates: [], rejectionStats: {}, activeOpportunities: [], prices: {} });
  const [tab, setTab] = useState<'SIGNALS' | 'MARKET' | 'PAIRS'>('SIGNALS');

  useEffect(() => {
    const es = new EventSource("/api/stream");
    es.onmessage = (e) => { try { setState(prev => ({ ...prev, ...JSON.parse(e.data) })); } catch {} };
    const fetchSignals = async () => { if (!supabase) return; const { data } = await supabase.from('signals').select('*').order('created_at', { ascending: false }).limit(50); if (data) setState(prev => ({ ...prev, activeOpportunities: data })); };
    const fetchPrices = async () => { try { const res = await fetch('/api/prices'); if (!res.ok) return; const data = await res.json(); const map: Record<string, number> = {}; (data.prices || []).forEach((p: any) => { if (p.pair && typeof p.price === 'number') map[p.pair] = p.price; }); setState(prev => ({ ...prev, prices: map })); } catch {} };
    fetchPrices();
    const priceInterval = setInterval(fetchPrices, 6000);
    let channel: any;
    if (supabase) { channel = supabase.channel('dash').on('postgres_changes', { event: '*', schema: 'public', table: 'signals' }, (payload: any) => { if (payload.eventType === 'INSERT') setState(prev => ({ ...prev, activeOpportunities: [payload.new, ...(prev.activeOpportunities || [])].slice(0, 50) })); else if (payload.eventType === 'UPDATE') setState(prev => ({ ...prev, activeOpportunities: (prev.activeOpportunities || []).map((s: any) => s.id === payload.new.id ? payload.new : s) })); }).subscribe(); }
    return () => { es.close(); if (channel) supabase!.removeChannel(channel); clearInterval(priceInterval); };
  }, []);

  const stats = state.stats || {};
  const prices = state.prices || {};
  const marketStates = (state.marketStates || []).filter((s: any) => APPROVED_PAIRS.includes(s.pair));
  const allSignals = state.activeOpportunities || [];
  const activeSignals = allSignals.filter((s: any) => APPROVED_PAIRS.includes(s.pair) && ['ACTIVE', 'TP1 HIT', 'TP2 HIT'].includes(s.status));
  const closedSignals = allSignals.filter((s: any) => APPROVED_PAIRS.includes(s.pair) && ['CLOSED', 'TP3 HIT', 'SL HIT', 'EXPIRED'].includes(s.status));

  return (
    <div className="min-h-screen bg-[#0a0e17] text-white">
      <header className="border-b border-[#1a2332] bg-[#0d1220] px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div><h1 className="text-2xl font-bold tracking-tight">4xLifeAI</h1><p className="text-xs text-[#5d6b80] mt-0.5">Professional Signal Provider</p></div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-[#00e08a] animate-pulse" /><span className="text-xs text-[#00e08a] font-mono">LIVE</span></div>
            <button onClick={() => navigate('/trades')} className="text-xs bg-[#1a2332] hover:bg-[#243044] px-3 py-1.5 rounded border border-[#2a3a50] transition-colors">Trade Monitor</button>
          </div>
        </div>
      </header>
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Engine Status" value={stats.isDegraded ? "DEGRADED" : "OPERATIONAL"} color={stats.isDegraded ? "#ff4d6d" : "#00e08a"} />
          <StatCard label="Active Pairs" value={`${stats.activeAssets || APPROVED_PAIRS.length} / ${stats.totalAssetsConfigured || APPROVED_PAIRS.length}`} />
          <StatCard label="Active Signals" value={String(activeSignals.length)} color={activeSignals.length > 0 ? "#00e08a" : "#5d6b80"} />
          <StatCard label="Last Scan" value={stats.lastScanTime ? new Date(stats.lastScanTime).toLocaleTimeString('en-US', { hour12: false, timeZone: 'UTC' }) + ' UTC' : '--'} />
        </div>
        {isWeekend() && (<div className="bg-[#f5a524]/10 border border-[#f5a524]/30 rounded-lg px-4 py-3 text-center text-[#f5a524] text-sm font-mono animate-pulse">WEEKEND MODE — Crypto &amp; Gold Only | Forex Resumes Monday 00:00 UTC</div>)}
        <div className="flex gap-1 bg-[#0d1220] p-1 rounded-lg border border-[#1a2332] w-fit">
          {(['SIGNALS', 'MARKET', 'PAIRS'] as const).map(t => (<button key={t} onClick={() => setTab(t)} className={`px-5 py-2 text-xs font-bold tracking-wider rounded transition-all ${tab === t ? 'bg-[#1a2332] text-white' : 'text-[#5d6b80] hover:text-[#8a95a5]'}`}>{t}</button>))}
        </div>
        {tab === 'SIGNALS' && (
          <div className="space-y-4">
            {activeSignals.length === 0 ? (
              <div className="bg-[#0d1220] border border-[#1a2332] rounded-lg p-12 text-center"><p className="text-[#5d6b80] text-lg mb-2">No Active Signals</p><p className="text-[#5d6b80] text-xs">Scanner is monitoring {APPROVED_PAIRS.length} pairs. Signals will appear here when a setup is confirmed.</p></div>
            ) : (
              <div className="grid gap-3">
                {activeSignals.map((s: any) => {
                  const isBuy = s.direction === 'LONG' || s.signal === 'BUY';
                  const price = prices[s.pair] || s.entry || 0;
                  const sl = s.sl || 0; const tp1 = s.tp1 || 0; const tp2 = s.tp2 || 0; const tp3 = s.tp3 || 0;
                  const statusColor = s.status === 'ACTIVE' ? '#f5a524' : s.status?.includes('TP') ? '#00e08a' : '#ff4d6d';
                  return (
                    <div key={s.id} className="bg-[#0d1220] border border-[#1a2332] rounded-lg p-5">
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <span className="text-lg font-bold">{s.pair}</span>
                          <span className={`px-2.5 py-1 rounded text-xs font-bold ${isBuy ? 'bg-[#00e08a]/10 text-[#00e08a]' : 'bg-[#ff4d6d]/10 text-[#ff4d6d]'}`}>{isBuy ? 'BUY' : 'SELL'}</span>
                          <span className="px-2 py-1 rounded text-[10px] font-mono border" style={{ borderColor: statusColor + '40', color: statusColor, background: statusColor + '10' }}>{s.status || 'ACTIVE'}</span>
                        </div>
                        <span className="text-xs text-[#5d6b80] font-mono">{s.timestamp ? new Date(s.timestamp).toLocaleString('en-US', { hour12: false }) : ''}</span>
                      </div>
                      <div className="grid grid-cols-5 gap-3 text-center">
                        <PriceBox label="Entry" value={price} pair={s.pair} highlight />
                        <PriceBox label="Stop Loss" value={sl} pair={s.pair} danger />
                        <PriceBox label="TP 1" value={tp1} pair={s.pair} success />
                        <PriceBox label="TP 2" value={tp2} pair={s.pair} success />
                        <PriceBox label="TP 3" value={tp3} pair={s.pair} success />
                      </div>
                      {s.aiReason && <p className="mt-3 text-xs text-[#8a95a5] border-t border-[#1a2332] pt-3">{s.aiReason}</p>}
                    </div>
                  );
                })}
              </div>
            )}
            {closedSignals.length > 0 && (
              <div><h3 className="text-xs text-[#5d6b80] uppercase tracking-wider mb-3 font-bold">Recently Closed</h3>
                <div className="grid gap-2">
                  {closedSignals.slice(0, 5).map((s: any) => {
                    const isBuy = s.direction === 'LONG' || s.signal === 'BUY';
                    const result = s.result || (s.status === 'TP3 HIT' ? 'WIN' : s.status === 'TP2 HIT' ? 'PARTIAL WIN' : 'LOSS');
                    const isWin = result === 'WIN' || result === 'PARTIAL WIN';
                    return (
                      <div key={s.id} className="bg-[#0d1220] border border-[#1a2332] rounded-lg px-4 py-3 flex items-center justify-between">
                        <div className="flex items-center gap-3"><span className="font-bold text-sm">{s.pair}</span><span className={`text-xs ${isBuy ? 'text-[#00e08a]' : 'text-[#ff4d6d]'}`}>{isBuy ? 'BUY' : 'SELL'}</span></div>
                        <div className="flex items-center gap-4">
                          {s.pips_won !== undefined && <span className="text-[#00e08a] text-xs font-mono">+{Number(s.pips_won).toFixed(1)}p</span>}
                          {s.pips_lost !== undefined && <span className="text-[#ff4d6d] text-xs font-mono">-{Number(s.pips_lost).toFixed(1)}p</span>}
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${isWin ? 'bg-[#00e08a]/10 text-[#00e08a]' : 'bg-[#ff4d6d]/10 text-[#ff4d6d]'}`}>{result}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
        {tab === 'MARKET' && (
          <div className="grid gap-4 md:grid-cols-2">
            {marketStates.map((s: any) => {
              const isBuy = s.direction === 'LONG'; const isSell = s.direction === 'SHORT';
              const biasColor = isBuy ? '#00e08a' : isSell ? '#ff4d6d' : '#5d6b80';
              const regimeColor = s.regime === 'TRENDING' ? '#00e08a' : s.regime === 'CHOP' ? '#ff4d6d' : s.regime === 'VOLATILE' ? '#f5a524' : '#5d6b80';
              return (
                <div key={s.pair} className="bg-[#0d1220] border border-[#1a2332] rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2"><span className="font-bold">{s.pair}</span><span className="text-[10px] text-[#5d6b80] bg-[#1a2332] px-1.5 py-0.5 rounded">{getPairCategory(s.pair)}</span></div>
                    <span className="text-[#5d6b80] text-xs font-mono">{s.timestamp ? new Date(s.timestamp).toLocaleTimeString('en-US', { hour12: false }) : '--'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div><span className="text-[10px] text-[#5d6b80] block">BIAS</span><span className="font-bold text-sm" style={{ color: biasColor }}>{isBuy ? 'BUY' : isSell ? 'SELL' : 'NONE'}</span></div>
                    <div><span className="text-[10px] text-[#5d6b80] block">REGIME</span><span className="font-bold text-sm" style={{ color: regimeColor }}>{s.regime || 'UNKNOWN'}</span></div>
                    <div><span className="text-[10px] text-[#5d6b80] block">PRICE</span><span className="font-bold text-sm text-[#3b82f6]">{prices[s.pair] || '-'}</span></div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {tab === 'PAIRS' && (
          <div className="bg-[#0d1220] border border-[#1a2332] rounded-lg overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#1a2332]">
                  <th className="text-left text-[10px] text-[#5d6b80] uppercase tracking-wider font-bold px-4 py-3">Pair</th>
                  <th className="text-left text-[10px] text-[#5d6b80] uppercase tracking-wider font-bold px-4 py-3">Category</th>
                  <th className="text-right text-[10px] text-[#5d6b80] uppercase tracking-wider font-bold px-4 py-3">Price</th>
                  <th className="text-right text-[10px] text-[#5d6b80] uppercase tracking-wider font-bold px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {APPROVED_PAIRS.map((pair) => {
                  const category = getPairCategory(pair);
                  const price = prices[pair];
                  const hasActiveSignal = activeSignals.some((s: any) => s.pair === pair);
                  const catColor = category === 'Crypto' ? '#f5a524' : category === 'Metals' ? '#3b82f6' : '#00e08a';
                  return (
                    <tr key={pair} className="border-b border-[#1a2332]/50 hover:bg-[#1a2332]/30 transition-colors">
                      <td className="px-4 py-3 font-bold text-sm">{pair}</td>
                      <td className="px-4 py-3"><span className="text-xs font-mono px-2 py-0.5 rounded" style={{ color: catColor, background: catColor + '15' }}>{category}</span></td>
                      <td className="px-4 py-3 text-right font-mono text-sm text-[#3b82f6]">{price ? (pair.includes('JPY') ? price.toFixed(3) : (pair === 'XAUUSD' || pair === 'XAGUSD' || price > 100) ? price.toFixed(2) : price.toFixed(5)) : '--'}</td>
                      <td className="px-4 py-3 text-right">{hasActiveSignal ? <span className="text-xs font-bold text-[#00e08a] bg-[#00e08a]/10 px-2 py-0.5 rounded">ACTIVE</span> : <span className="text-xs text-[#5d6b80]">Monitoring</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
