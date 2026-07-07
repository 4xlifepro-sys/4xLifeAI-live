import { useEffect, useState, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { adaptCtraderData, type AdapterOverrides } from '../lib/adaptCtraderData';
import InstitutionalDashboard from '../components/InstitutionalDashboard';

export default function Dashboard() {
  const [rawPrices, setRawPrices] = useState<any>(null);
  const [allSignals, setAllSignals] = useState<any[]>([]);
  const [scannerState, setScannerState] = useState<any>({ stats: null, marketStates: [], prices: {} });
  const [loading, setLoading] = useState(true);
  const fallbackPrices = {
    prices: [],
    cached: true
  };

  // Fetch prices from /api/prices
  useEffect(() => {
    let mounted = true;
    const fetchPrices = async () => {
      try {
        const r = await fetch('/api/prices');
        if (!r.ok) return;
        const d = await r.json();
        if (mounted) setRawPrices(d);
      } catch {}
    };
    fetchPrices();
    const pi = setInterval(fetchPrices, 5000);
    return () => { mounted = false; clearInterval(pi); };
  }, []);

  // Fetch signals from Supabase
  useEffect(() => {
    let mounted = true;
    const fetchSignals = async () => {
      try {
        const response = await fetch('/api/today-signals');
        if (!response.ok) return;
        const data = await response.json();
        if (mounted && data) setAllSignals(data.filter((signal: any) => signal.status !== 'REJECTED'));
      } catch {}
    };
    fetchSignals();
    const si = setInterval(fetchSignals, 15000);
    let ch: any;
    if (supabase) {
      ch = supabase.channel('dash-realtime').on('postgres_changes', { event: '*', schema: 'public', table: 'signals' }, (pl: any) => {
        fetchSignals();
      }).subscribe();
    }
    return () => { mounted = false; clearInterval(si); if (ch) supabase!.removeChannel(ch); };
  }, []);

  // Stream scanner state from server SSE
  useEffect(() => {
    let timeout: NodeJS.Timeout;
    const es = new EventSource('/api/stream');
    
    // Safety timeout: if SSE doesn't respond in 10s, show dashboard anyway
    timeout = setTimeout(() => {
      setLoading(false);
    }, 3000);
    
    es.onmessage = (e) => {
      try { 
        setScannerState(p => ({ ...p, ...JSON.parse(e.data) })); 
        setLoading(false); 
        clearTimeout(timeout);
      } catch {}
    };
    es.onerror = () => {
      setLoading(false);
      clearTimeout(timeout);
    };
    return () => { 
      clearTimeout(timeout);
      es.close(); 
    };
  }, []);

  const PAIRS = ['EURUSD','USDJPY','USDCAD','NZDUSD','EURJPY','GBPJPY','XAUUSD','XAGUSD','BTCUSD','ETHUSD'];

  const dashboardData = useMemo(() => {
    const safeRawPrices = rawPrices || fallbackPrices;

    const prices = scannerState.prices || {};
    const marketStates = (scannerState.marketStates || []).filter((s: any) => PAIRS.includes(s.pair));

    const active = allSignals.filter(s => PAIRS.includes(s.pair) && ['LIVE', 'TP1_HIT', 'TP2_HIT'].includes(s.status));
    const closed = allSignals.filter(s => PAIRS.includes(s.pair) && ['CLOSED', 'TP3_HIT', 'STOP_LOSS_HIT'].includes(s.status));

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);
    const recent30 = closed.filter(s => new Date(s.created_at) > thirtyDaysAgo);
    const wins30 = recent30.filter(s => ['WIN', 'PARTIAL WIN'].includes(s.result) || s.status?.includes('TP')).length;
    const losses30 = recent30.filter(s => s.result === 'LOSS' || s.status === 'SL HIT').length;
    const winRate30d = wins30 + losses30 > 0 ? (wins30 / (wins30 + losses30)) * 100 : 0;

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthSignals = allSignals.filter(s => new Date(s.created_at) >= monthStart).length;
    const monthClosed = closed.filter(s => new Date(s.created_at) >= monthStart);
    const monthWins = monthClosed.filter(s => ['WIN', 'PARTIAL WIN'].includes(s.result) || s.status?.includes('TP'));
    const monthLosses = monthClosed.filter(s => s.result === 'LOSS' || s.status === 'SL HIT');

    const calcPips = (pair: string, entry: number, exit: number) => {
      if (!entry || !exit) return 0;
      const diff = exit - entry;
      if (pair.includes('JPY')) return Math.round(diff * 100);
      if (pair.includes('XAU') || pair.includes('XAG')) return Math.round(diff * 10);
      return Math.round(diff * 10000);
    };

    const withRR = monthClosed.filter(s => s.sl && s.tp1);
    let avgRR: number | null = null;
    if (withRR.length > 0) {
      let sum = 0;
      withRR.forEach(s => {
        const entry = s.entry || prices[s.pair] || 0;
        const risk = Math.abs(entry - s.sl);
        const reward = Math.abs(s.tp1 - entry);
        if (risk > 0) sum += reward / risk;
      });
      avgRR = sum / withRR.length;
    }

    let totalPipsClosed = 0;
    monthClosed.forEach(s => {
      const entry = s.entry || 0;
      const isWin = ['WIN', 'PARTIAL WIN'].includes(s.result) || s.status?.includes('TP');
      const exit = isWin ? s.tp3 || s.tp1 || 0 : s.sl || 0;
      const isLong = s.direction === 'LONG' || s.signal === 'BUY';
      totalPipsClosed += calcPips(s.pair, entry, exit) * (isLong ? 1 : -1);
    });

    const activeMapped = active.map(s => {
      const isLong = s.direction === 'BUY';
      const entry = s.entry_price || s.entry || prices[s.pair] || 0;
      const currentPrice = prices[s.pair] || entry;
      const pips = calcPips(s.pair, entry, currentPrice) * (isLong ? 1 : -1);
      let status: 'profit' | 'loss' | 'pending' = 'pending';
      if (pips > 0) status = 'profit';
      else if (pips < 0) status = 'loss';
      let tier: 'Strong' | 'Good' | 'Valid' = 'Valid';
      if (s.confidence >= 80) tier = 'Strong';
      else if (s.confidence >= 65) tier = 'Good';
      return {
        pair: s.pair,
        direction: isLong ? 'LONG' as const : 'SHORT' as const,
        entry,
        sl: s.sl || 0,
        tp1: s.tp1 || 0,
        tp2: s.tp2 || 0,
        tp3: s.tp3 || undefined,
        status,
        statusPips: Math.abs(pips),
        tier,
        openedAgo: daysAgo(s.created_at || s.timestamp || ''),
      };
    });

    const historyMapped = closed.slice(0, 10).map(s => {
      const isLong = s.direction === 'BUY';
      const entry = s.entry_price || s.entry || 0;
      const isWin = ['TP1_HIT', 'TP2_HIT', 'TP3_HIT', 'CLOSED'].includes(s.status) && s.status !== 'STOP_LOSS_HIT';
      const exit = isWin ? s.tp3 || s.tp1 || 0 : s.sl || 0;
      const pips = calcPips(s.pair, entry, exit) * (isLong ? 1 : -1);
      let result: 'win' | 'loss' | 'breakeven' = 'loss';
      if (Math.abs(pips) < 1) result = 'breakeven';
      else if (pips > 0) result = 'win';
      const d = new Date(s.created_at || s.timestamp);
      const closedAt = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ', ' +
        d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
      return { pair: s.pair, direction: isLong ? 'LONG' as const : 'SHORT' as const, entry, exit, result, pips: Math.round(pips), closedAt };
    });

    const h = new Date().getUTCHours();
    let sessionName = 'SYDNEY SESSION';
    if (h >= 13 && h < 17) sessionName = 'NEW YORK SESSION';
    else if (h >= 7 && h < 13) sessionName = 'LONDON SESSION';
    else if (h >= 0 && h < 7) sessionName = 'TOKYO SESSION';

    const d = new Date().getUTCDay();
    let weekendMode: string | undefined;
    if (d === 6 || (d === 5 && h >= 22) || (d === 0 && h < 22)) {
      weekendMode = 'Crypto & Metals only';
    }

    const overrides: AdapterOverrides = {
      activeSignals: activeMapped,
      history: historyMapped,
      stats: { winRate30d, signalsThisMonth: monthSignals, signalsSince: 'Since ' + monthStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), wins: monthWins.length, losses: monthLosses.length, avgRR, totalPipsClosed },
      session: sessionName,
      weekendMode,
    };

    const adapted = adaptCtraderData(safeRawPrices, overrides);

    // Replace inferred trend with real scanner bias
    adapted.watchlist.forEach(group => {
      group.items.forEach(item => {
        const ms = marketStates.find((m: any) => m.pair === item.pair);
        if (ms?.direction === 'LONG') item.trend = 'BULL';
        else if (ms?.direction === 'SHORT') item.trend = 'BEAR';
        else item.trend = 'NEUTRAL';
      });
    });

    adapted.clockUtc = new Date().toISOString().slice(11, 19) + ' UTC';
    return adapted;
  }, [rawPrices, allSignals, scannerState]);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#08090b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div className="loading-spinner" style={{ width: 36, height: 36, border: '2px solid #1f242c', borderTopColor: '#4fd1e8', borderRadius: '50%', animation: 'spin 0.9s linear infinite', margin: '0 auto 16px' }} />
          <div style={{ color: '#7c8794', fontSize: 13, fontFamily: "'IBM Plex Mono', monospace" }}>Initializing terminal...</div>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return <InstitutionalDashboard data={dashboardData} />;
}

function daysAgo(d: string): string {
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return mins + 'm ago';
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours + 'h ago';
  const days = Math.floor(hours / 24);
  return days + 'd ago';
}
