import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

const APPROVED_PAIRS = [
  'EURUSD', 'USDJPY', 'USDCAD', 'NZDUSD', 'EURJPY', 'GBPJPY',
  'XAUUSD', 'XAGUSD',
  'BTCUSD', 'ETHUSD'
];

const GROUPS: { label: string; pairs: string[] }[] = [
  { label: 'FOREX', pairs: ['EURUSD', 'USDJPY', 'USDCAD', 'NZDUSD', 'EURJPY', 'GBPJPY'] },
  { label: 'METALS', pairs: ['XAUUSD', 'XAGUSD'] },
  { label: 'CRYPTO', pairs: ['BTCUSD', 'ETHUSD'] },
];

function getSymbol(pair: string) {
  const map: Record<string, string> = { EURUSD: '€', GBPJPY: '£', USDJPY: '$', USDCAD: 'C$', NZDUSD: 'NZ', EURJPY: '€', XAUUSD: 'Au', XAGUSD: 'Ag', BTCUSD: '₿', ETHUSD: 'Ξ' };
  return map[pair] || '$';
}

function fmt(price: number, pair: string) {
  if (!price || price === 0) return '--';
  if (pair.includes('JPY')) return price.toFixed(3);
  if (price >= 1000) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 100) return price.toFixed(2);
  return price.toFixed(5);
}

const isWeekend = () => {
  const now = new Date();
  const d = now.getUTCDay(), h = now.getUTCHours();
  if (d === 5) return h >= 22;
  if (d === 6) return true;
  if (d === 0) return h < 22;
  return false;
};

/* --- Status badge --- */
function StatusBadge({ pair, active, ms }: { pair: string; active: any; ms: any }) {
  if (active) {
    const dir = active.direction === 'LONG' || active.signal === 'BUY' ? 'BUY' : 'SELL';
    const win = active.status?.includes('TP');
    const bg = win ? 'bg-[#00e08a]/10 text-[#00e08a] border-[#00e08a]/20' : 'bg-[#f5a524]/10 text-[#f5a524] border-[#f5a524]/20';
    return (
      <div className="flex flex-col items-end gap-0.5">
        <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${bg}`}>{active.status || dir}</span>
        <span className="text-[9px] text-[#5d6b80]">{dir}</span>
      </div>
    );
  }
  if (ms?.direction === 'LONG') {
    return <span className="text-[10px] text-[#00e08a] font-bold">BULL</span>;
  }
  if (ms?.direction === 'SHORT') {
    return <span className="text-[10px] text-[#ff4d6d] font-bold">BEAR</span>;
  }
  return <span className="text-[10px] text-[#3a4a5c]">—</span>;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [state, setState] = useState<any>({ stats: null, pairStatuses: [], signals: [], marketStates: [], rejectionStats: {}, activeOpportunities: [], prices: {} });

  useEffect(() => {
    const es = new EventSource("/api/stream");
    es.onmessage = (e) => { try { setState(prev => ({ ...prev, ...JSON.parse(e.data) })); } catch {} };
    const fetchSignals = async () => { if (!supabase) return; const { data } = await supabase.from('signals').select('*').order('created_at', { ascending: false }).limit(50); if (data) setState(prev => ({ ...prev, activeOpportunities: data })); };
    fetchSignals();
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
    <div className="min-h-screen bg-[#080c14] text-white">
      {/* Header */}
      <header className="border-b border-[#1a2332] bg-[#0c1018] px-6 py-3">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold tracking-tight">4xLifeAI</h1>
            <p className="text-[10px] text-[#4a5568] mt-0.5">{stats.activeAssets || APPROVED_PAIRS.length} pairs | {activeSignals.length} active</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-[#00e08a] animate-pulse" />
              <span className="text-[10px] text-[#00e08a] font-mono">LIVE</span>
            </div>
            <span className="text-[10px] text-[#4a5568] font-mono">
              {stats.lastScanTime ? new Date(stats.lastScanTime).toLocaleTimeString('en-US', { hour12: false, timeZone: 'UTC' }) + ' UTC' : '--'}
            </span>
            <button onClick={() => navigate('/trades')} className="text-[10px] bg-[#1a2332] hover:bg-[#243044] px-3 py-1 rounded border border-[#2a3a50] transition-colors">Trade Monitor</button>
          </div>
        </div>
      </header>

      {isWeekend() && (
        <div className="bg-[#f5a524]/5 border-b border-[#f5a524]/20 text-center text-[#f5a524] text-[10px] font-mono py-1.5">
          WEEKEND MODE — Crypto & Gold Only
        </div>
      )}

      <div className="max-w-4xl mx-auto py-2">
        {GROUPS.map(group => {
          const groupPairs = group.pairs.filter(p => APPROVED_PAIRS.includes(p));
          return (
            <div key={group.label} className="mb-1">
              <div className="px-6 py-1.5 text-[9px] font-bold text-[#4a5568] tracking-[0.2em] bg-[#0c1018]">{group.label}</div>
              {groupPairs.map(pair => {
                const active = activeSignals.find((s: any) => s.pair === pair);
                const price = prices[pair] || 0;
                const ms = marketStates.find((m: any) => m.pair === pair);
                const dir = ms?.direction || 'NONE';
                
                return (
                  <div key={pair} className="px-6 py-2.5 flex items-center justify-between hover:bg-[#111827]/50 transition-colors cursor-pointer border-b border-[#1a2332]/30" onClick={() => active && navigate('/trades')}>
                    {/* Left: Symbol + Pair */}
                    <div className="flex items-center gap-3 w-36 shrink-0">
                      <span className="text-[10px] text-[#4a5568] w-5 text-center font-bold">{getSymbol(pair)}</span>
                      <span className="text-xs font-bold text-white tracking-wide">{pair}</span>
                    </div>

                    {/* Center: Price (most prominent) */}
                    <div className="flex-1 flex justify-center">
                      <span className="text-sm font-mono font-bold text-white tabular-nums">
                        {fmt(price, pair)}
                      </span>
                    </div>

                    {/* Right: Status */}
                    <div className="w-24 shrink-0 flex justify-end">
                      <StatusBadge pair={pair} active={active} ms={ms} />
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}

        {/* Recently closed trades */}
        {closedSignals.length > 0 && (
          <div className="mt-4">
            <div className="px-6 py-1.5 text-[9px] font-bold text-[#4a5568] tracking-[0.2em] bg-[#0c1018]">RECENTLY CLOSED</div>
            {closedSignals.slice(0, 5).map((s: any) => {
              const result = s.result || (s.status === 'TP3 HIT' || s.status === 'TP2 HIT' ? 'WIN' : 'LOSS');
              const isWin = result === 'WIN' || result === 'PARTIAL WIN';
              return (
                <div key={s.id} className="px-6 py-2 flex items-center justify-between border-b border-[#1a2332]/20 opacity-70">
                  <div className="flex items-center gap-3 w-36 shrink-0">
                    <span className="text-[10px] text-[#4a5568] w-5 text-center">{getSymbol(s.pair)}</span>
                    <span className="text-xs font-bold text-[#5d6b80]">{s.pair}</span>
                  </div>
                  <div className="flex-1" />
                  <div className="w-24 shrink-0 flex justify-end items-center gap-2">
                    <span className={`text-[10px] font-bold ${isWin ? 'text-[#00e08a]' : 'text-[#ff4d6d]'}`}>{result}</span>
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