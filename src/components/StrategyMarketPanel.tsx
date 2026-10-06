import { useEffect, useState } from 'react';
import { Activity, AlertTriangle, Clock3 } from 'lucide-react';
import { supabase } from '../lib/supabase';

type Analysis = {
  pair: string;
  state: string;
  dataStatus: string;
  lowerTimeframe: string;
  htfBias: string;
  mainPoi: null | { type: string; price: number; timeframe: string; direction: string; status: string };
  middleSetup: string;
  mss: string;
  entry: number | null;
  stopLoss: number | null;
  targets: number[];
  confidence: number | null;
  reason: string;
  analyzedAt: string;
};

type Row = { symbol: string; analysis: Analysis; analyzed_at: string };

function price(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? 'UNKNOWN' : value.toString();
}

function stateStyle(state: string) {
  if (state === 'BUY') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
  if (state === 'SELL') return 'border-rose-500/30 bg-rose-500/10 text-rose-300';
  if (state === 'WAITING') return 'border-amber-500/30 bg-amber-500/10 text-amber-200';
  return 'border-slate-600 bg-slate-700/30 text-slate-300';
}

export default function StrategyMarketPanel() {
  const [rows, setRows] = useState<Row[]>([]);
  const [active, setActive] = useState<boolean | null>(null);
  const [message, setMessage] = useState('Loading automatic strategy status…');

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        if (mounted) setMessage('Sign in to view automated market analysis.');
        return;
      }
      try {
        const response = await fetch('/api/strategy/analysis', { headers: { Authorization: `Bearer ${session.access_token}` } });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || 'Market analysis is currently unavailable.');
        if (mounted) {
          setRows(body.analyses || []);
          setActive(Boolean(body.active));
          setMessage(body.active ? (body.analyses?.length ? '' : 'The strategy is active. Waiting for its first verified market scan.') : 'The automated strategy is inactive. No strategy-generated signals are being published.');
        }
      } catch (cause: any) {
        if (mounted) setMessage(cause?.message || 'Automated market analysis is unavailable.');
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => { mounted = false; window.clearInterval(timer); };
  }, []);

  return <section className="mb-6 rounded-xl border border-slate-700/70 bg-[#0b1018] p-4 text-slate-200 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2"><Activity size={17} className="text-emerald-300" /><h2 className="text-sm font-semibold uppercase tracking-wider text-white">Automatic Strategy</h2></div>
      <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold ${active ? stateStyle('BUY') : stateStyle('NO TRADE')}`}>{active ? 'ANALYSIS ACTIVE' : 'INACTIVE'}</span>
    </div>
    {message && <div className="mt-3 flex items-start gap-2 text-sm text-slate-400">{message.toLowerCase().includes('unavailable') ? <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-300" /> : <Clock3 size={15} className="mt-0.5 shrink-0" />}{message}</div>}
    {rows.length > 0 && <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {rows.map(row => {
        const result = row.analysis;
        return <article key={row.symbol} className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
          <div className="flex items-center justify-between gap-2"><strong className="text-sm text-white">{row.symbol}</strong><span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${stateStyle(result.state)}`}>{result.state}</span></div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div><span className="text-slate-500">HTF BIAS</span><div className="mt-1">{result.htfBias}</div></div>
            <div><span className="text-slate-500">MAIN POI</span><div className="mt-1">{result.mainPoi?.type || 'UNKNOWN'}</div></div>
            <div><span className="text-slate-500">MIDDLE SETUP</span><div className="mt-1">{result.middleSetup}</div></div>
            <div><span className="text-slate-500">{result.lowerTimeframe} MSS</span><div className="mt-1">{result.mss}</div></div>
            <div><span className="text-slate-500">ENTRY</span><div className="mt-1">{price(result.entry)}</div></div>
            <div><span className="text-slate-500">STOP</span><div className="mt-1">{price(result.stopLoss)}</div></div>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-slate-400">{result.reason}</p>
          <div className="mt-3 text-[10px] text-slate-600">Analysis: {new Date(row.analyzed_at).toLocaleString()}</div>
        </article>;
      })}
    </div>}
  </section>;
}
