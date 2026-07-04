import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

const APPROVED_PAIRS = ['EURUSD', 'USDJPY', 'USDCAD', 'NZDUSD', 'EURJPY', 'GBPJPY', 'XAUUSD', 'XAGUSD', 'BTCUSD', 'ETHUSD'];

function getIcon(pair: string) {
  if (['BTCUSD', 'ETHUSD'].includes(pair)) return '₿';
  if (['XAUUSD', 'XAGUSD'].includes(pair)) return '◆';
  if (pair.includes('EUR')) return '€';
  if (pair.includes('GBP')) return '£';
  if (pair.includes('JPY')) return '¥';
  if (pair.includes('AUD')) return 'A$';
  if (pair.includes('NZD')) return 'NZ$';
  if (pair.includes('CAD')) return 'C$';
  if (pair.includes('CHF')) return 'CHF';
  return '$';
}

function fmtPrice(price: number, pair: string) {
  if (!price || price === 0) return '--';
  if (pair.includes('JPY')) return price.toFixed(3);
  if (pair === 'XAUUSD' || pair === 'XAGUSD' || price > 1000) return price.toFixed(2);
  if (price > 100) return price.toFixed(2);
  return price.toFixed(5);
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

  const pairsWithSignals = APPROVED_PAIRS.map(pair => {
    const active = activeSignals.find((s: any) => s.pair === pair);
    const closed = closedSignals.find((s: any) => s.pair === pair);
    const ms = marketStates.find((m: any) => m.pair === pair);
    return { pair, active, closed, ms };
  });

  return (
    <div className="min-h-screen bg-[#0a0e17] text-white font-mono">
      <header className="border-b border-[#1a2332] bg-[#0d1220] px-6 py-3">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight">4xLifeAI</h1>
            <p className="text-[10px] text-[#5d6b80]">Professional Signal Provider</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-[#00e08a] animate-pulse" />
              <span className="text-xs text-[#00e08a]">LIVE</span>
            </div>
            <button onClick={() => navigate('/trades')} className="text-xs bg-[#1a2332] hover:bg-[#243044] px-3 py-1.5 rounded border border-[#2a3a50] transition-colors">Trade Monitor</button>
          </div>
        </div>
      </header>

      {isWeekend() && (
        <div className="bg-[#f5a524]/10 border-b border-[#f5a524]/30 text-center text-[#f5a524] text-xs py-2 animate-pulse">
          WEEKEND MODE — Crypto & Gold Only | Forex Resumes Monday 00:00 UTC
        </div>
      )}

      <div className="max-w-6xl mx-auto">
        <div className="border-b border-[#1a2332] bg-[#0d1220] px-6 py-2 flex items-center justify-between text-[10px] text-[#5d6b80]">
          <span>{stats.activeAssets || APPROVED_PAIRS.length} pairs monitored</span>
          <span>Active: <span className="text-[#00e08a]">{activeSignals.length}</span></span>
          <span>Last: {stats.lastScanTime ? new Date(stats.lastScanTime).toLocaleTimeString('en-US', { hour12: false, timeZone: 'UTC' }) + ' UTC' : '--'}</span>
        </div>

        <div className="divide-y divide-[#1a2332]/50">
          {pairsWithSignals.map(({ pair, active, closed, ms }) => {
            const price = prices[pair] || 0;
            const hasActive = !!active;
            const hasClosed = !!closed;
            
            let statusIcon = '○';
            let statusColor = '#5d6b80';
            let statusText = 'Monitoring';
            
            if (hasActive) {
              const dir = active.direction === 'LONG' || active.signal === 'BUY' ? 'BUY' : 'SELL';
              const isWin = active.status?.includes('TP');
              statusIcon = dir === 'BUY' ? '▲' : '▼';
              statusColor = isWin ? '#00e08a' : '#f5a524';
              statusText = active.status || dir;
            } else if (hasClosed) {
              const result = closed.result || (closed.status === 'TP3 HIT' ? 'WIN' : 'LOSS');
              statusIcon = result === 'WIN' ? '✓' : '✗';
              statusColor = result === 'WIN' ? '#00e08a' : '#ff4d6d';
              statusText = result;
            } else if (ms?.direction === 'LONG') {
              statusIcon = '▲';
              statusColor = '#00e08a';
              statusText = 'BULL';
            } else if (ms?.direction === 'SHORT') {
              statusIcon = '▼';
              statusColor = '#ff4d6d';
              statusText = 'BEAR';
            }

            const change = price > 0 ? ((price - (active?.entry || 0)) / price * 100) : 0;
            const changeColor = change > 0 ? '#00e08a' : change < 0 ? '#ff4d6d' : '#5d6b80';

            return (
              <div key={pair} className="px-6 py-3 hover:bg-[#1a2332]/30 transition-colors cursor-pointer" onClick={() => hasActive && navigate('/trades')}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 flex-1">
                    <span className="text-[#5d6b80] text-lg w-6">{getIcon(pair)}</span>
                    <span className="font-bold text-sm">{pair}</span>
                  </div>
                  <div className="flex items-center gap-6 flex-1 justify-end">
                    <div className="text-right">
                      <div className="text-sm font-bold text-[#3b82f6]">{fmtPrice(price, pair)}</div>
                      {active?.entry && <div className="text-[10px] text-[#5d6b80]">Entry: {fmtPrice(active.entry, pair)}</div>}
                    </div>
                    <div className="text-right w-20">
                      <div className="text-sm font-bold" style={{ color: statusColor }}>{statusIcon} {statusText}</div>
                      {active && <div className="text-[10px] text-[#5d6b80]">{active.direction === 'LONG' || active.signal === 'BUY' ? 'BUY' : 'SELL'}</div>}
                    </div>
                    <div className="text-right w-16">
                      <div className="text-sm font-bold" style={{ color: changeColor }}>{change > 0 ? '+' : ''}{change.toFixed(2)}%</div>
                      {active?.tp1 && <div className="text-[10px] text-[#00e08a]">TP: {fmtPrice(active.tp1, pair)}</div>}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}