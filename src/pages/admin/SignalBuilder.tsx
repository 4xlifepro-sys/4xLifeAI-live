import { useEffect, useMemo, useState } from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { SlidersHorizontal, Save, Send, X, Trash2, Loader2, CheckCircle2, AlertTriangle, Copy, Check } from 'lucide-react';
import { supabase } from '../../lib/supabase';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const APPROVED_PAIRS = ['XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'BTCUSD', 'ETHUSD', 'SOLUSD'];
const STRATEGIES = ['Classic V', 'Classic A'];
const DIRECTIONS = ['BUY', 'SELL'];
const OCL_OPTIONS = ['OCL Support', 'OCL Resistance'];
const TP_MULTIPLES = [
  { label: '1R', value: 1 },
  { label: '2.1R', value: 2.1 },
  { label: '3.1R', value: 3.1 },
  { label: '4.1R', value: 4.1 },
  { label: '5R', value: 5 },
  { label: '6R', value: 6 },
];
const CONFIDENCE_OPTIONS = [65, 70, 75, 80];

interface Draft {
  id: string;
  pair: string;
  strategy: string;
  direction: 'BUY' | 'SELL';
  ocl: string;
  entry: number;
  sl: number;
  tp_multiples: number[];
  confidence: number;
  updated_at: string;
}

function formatPrice(value: number, pair: string): string {
  if (!Number.isFinite(value)) return '-';
  const p = pair.toUpperCase();
  if (p.includes('XAU') || p.includes('XAG')) return value.toFixed(3);
  if (p.includes('BTC') || p.includes('ETH') || p.includes('SOL')) return value.toFixed(2);
  if (p.includes('JPY')) return value.toFixed(3);
  return value.toFixed(5);
}

function calculateTp(direction: 'BUY' | 'SELL', entry: number, sl: number, r: number): number {
  if (direction === 'BUY') return entry + (entry - sl) * r;
  return entry - (sl - entry) * r;
}

export default function SignalBuilder() {
  const [pair, setPair] = useState('XAUUSD');
  const [strategy, setStrategy] = useState('');
  const [direction, setDirection] = useState<'BUY' | 'SELL' | ''>('');
  const [ocl, setOcl] = useState('');
  const [entry, setEntry] = useState('');
  const [sl, setSl] = useState('');
  const [selectedMultiples, setSelectedMultiples] = useState<Set<number>>(new Set([2.1, 3.1, 4.1]));
  const [confidence, setConfidence] = useState(78);

  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [status, setStatus] = useState<'idle' | 'saving' | 'publishing' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [copiedAll, setCopiedAll] = useState(false);

  const numericEntry = Number(entry);
  const numericSl = Number(sl);

  useEffect(() => {
    fetchDrafts();
  }, []);

  const fetchDrafts = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/admin/signal-builder/drafts', {
        headers: { ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
      });
      const data = await res.json();
      if (res.ok && data.success) setDrafts(data.drafts || []);
    } catch (e) {
      console.error('Failed to load drafts', e);
    }
  };

  const tpPrices = useMemo(() => {
    if (!direction || !Number.isFinite(numericEntry) || !Number.isFinite(numericSl)) return [];
    return TP_MULTIPLES.map((m) => ({
      ...m,
      price: calculateTp(direction, numericEntry, numericSl, m.value),
    }));
  }, [direction, numericEntry, numericSl]);

  const selectedTps = useMemo(() => {
    return tpPrices
      .filter((tp) => selectedMultiples.has(tp.value))
      .sort((a, b) => a.value - b.value);
  }, [tpPrices, selectedMultiples]);

  const validationError = useMemo(() => {
    if (!strategy) return 'Select a strategy.';
    if (!direction) return 'Select a direction.';
    if (!ocl) return 'Select an OCL option.';
    if (!Number.isFinite(numericEntry) || numericEntry <= 0) return 'Enter a valid entry price.';
    if (!Number.isFinite(numericSl) || numericSl <= 0) return 'Enter a valid stop loss.';
    if (direction === 'BUY' && numericSl >= numericEntry) return 'BUY stop loss must be below entry.';
    if (direction === 'SELL' && numericSl <= numericEntry) return 'SELL stop loss must be above entry.';
    if (selectedMultiples.size === 0) return 'Select at least one TP level.';
    if (confidence <= 0 || confidence > 80) return 'Confidence must be between 1 and 80.';
    return '';
  }, [strategy, direction, ocl, numericEntry, numericSl, selectedMultiples, confidence]);

  const toggleMultiple = (value: number) => {
    setSelectedMultiples((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  };

  const resetForm = () => {
    setPair('XAUUSD');
    setStrategy('');
    setDirection('');
    setOcl('');
    setEntry('');
    setSl('');
    setSelectedMultiples(new Set([2.1, 3.1, 4.1]));
    setConfidence(78);
    setStatus('idle');
    setMessage('');
  };

  const getPayload = () => ({
    pair,
    strategy,
    direction,
    ocl,
    entry: numericEntry,
    sl: numericSl,
    tpMultiples: Array.from(selectedMultiples),
    confidence,
  });

  const handleSaveDraft = async () => {
    setStatus('saving');
    setMessage('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/admin/signal-builder/drafts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify(getPayload()),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Save failed');
      setStatus('success');
      setMessage('Draft saved.');
      fetchDrafts();
    } catch (e: any) {
      setStatus('error');
      setMessage(e.message || 'Could not save draft');
    }
  };

  const handlePublish = async () => {
    if (validationError) {
      setStatus('error');
      setMessage(validationError);
      return;
    }
    setStatus('publishing');
    setMessage('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/admin/signal-builder/publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify(getPayload()),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Publish failed');
      setStatus('success');
      setMessage('Signal published. It is now live in Today Signals and signal history.');
    } catch (e: any) {
      setStatus('error');
      setMessage(e.message || 'Could not publish signal');
    }
  };

  const loadDraft = (draft: Draft) => {
    setPair(draft.pair || 'XAUUSD');
    setStrategy(draft.strategy || '');
    setDirection(draft.direction || '');
    setOcl(draft.ocl || '');
    setEntry(Number.isFinite(draft.entry) ? String(draft.entry) : '');
    setSl(Number.isFinite(draft.sl) ? String(draft.sl) : '');
    setSelectedMultiples(new Set((draft.tp_multiples || []).map(Number)));
    setConfidence(Number.isFinite(draft.confidence) ? draft.confidence : 78);
    setStatus('idle');
    setMessage('Draft loaded.');
  };

  const deleteDraft = async (id: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/admin/signal-builder/drafts/${id}`, {
        method: 'DELETE',
        headers: { ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
      });
      if (res.ok) fetchDrafts();
    } catch (e) {
      console.error('Failed to delete draft', e);
    }
  };

  const copyPreview = () => {
    const lines = [
      `${pair} — ${direction}`,
      `Strategy: ${strategy}`,
      `OCL: ${ocl}`,
      `Entry: ${formatPrice(numericEntry, pair)}`,
      `SL: ${formatPrice(numericSl, pair)}`,
      ...selectedTps.map((tp, i) => `TP${i + 1}: ${formatPrice(tp.price, pair)}`),
      `Confidence: ${confidence}/100`,
    ];
    navigator.clipboard.writeText(lines.join('\n'));
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  };

  return (
    <div className="space-y-6">
      <div className="bg-[#11141A] border border-[#202735] rounded-2xl overflow-hidden shadow-2xl">
        <div className="p-4 sm:p-6 border-b border-[#202735]">
          <h2 className="text-xl font-semibold text-white flex items-center gap-2">
            <SlidersHorizontal className="w-5 h-5 text-[#00E08A]" />
            Signal Builder
          </h2>
          <p className="text-sm text-[#8A95A5] mt-1">
            Build and publish a manual signal. No screenshot analysis or live market data is used.
          </p>
        </div>

        <div className="p-4 sm:p-6 space-y-6">
          {/* Pair */}
          <div className="space-y-2">
            <label className="block text-xs font-bold text-[#8A95A5] tracking-wider uppercase">Pair</label>
            <select
              value={pair}
              onChange={(e) => setPair(e.target.value)}
              className="w-full bg-[#0D1017] border border-[#202735] rounded-xl p-3 text-white focus:outline-none focus:border-[#00E08A]/50"
            >
              {APPROVED_PAIRS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>

          {/* Strategy */}
          <div className="space-y-2">
            <label className="block text-xs font-bold text-[#8A95A5] tracking-wider uppercase">Strategy</label>
            <div className="grid grid-cols-2 gap-3">
              {STRATEGIES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStrategy(s)}
                  className={cn(
                    'px-4 py-3 rounded-xl text-sm font-bold border transition-all',
                    strategy === s
                      ? 'bg-[#00E08A]/10 border-[#00E08A] text-[#00E08A] shadow-[0_0_15px_rgba(0,224,138,0.15)]'
                      : 'bg-[#0D1017] border-[#202735] text-[#8A95A5] hover:border-[#00E08A]/30 hover:text-white'
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Direction */}
          <div className="space-y-2">
            <label className="block text-xs font-bold text-[#8A95A5] tracking-wider uppercase">Direction</label>
            <div className="grid grid-cols-2 gap-3">
              {DIRECTIONS.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDirection(d as 'BUY' | 'SELL')}
                  className={cn(
                    'px-4 py-3 rounded-xl text-sm font-bold border transition-all',
                    direction === d
                      ? d === 'BUY'
                        ? 'bg-emerald-500/10 border-emerald-500 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.15)]'
                        : 'bg-red-500/10 border-red-500 text-red-400 shadow-[0_0_15px_rgba(239,68,68,0.15)]'
                      : 'bg-[#0D1017] border-[#202735] text-[#8A95A5] hover:border-white/20 hover:text-white'
                  )}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          {/* OCL */}
          <div className="space-y-2">
            <label className="block text-xs font-bold text-[#8A95A5] tracking-wider uppercase">OCL</label>
            <div className="grid grid-cols-2 gap-3">
              {OCL_OPTIONS.map((o) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => setOcl(o)}
                  className={cn(
                    'px-4 py-3 rounded-xl text-sm font-bold border transition-all',
                    ocl === o
                      ? 'bg-[#00E08A]/10 border-[#00E08A] text-[#00E08A] shadow-[0_0_15px_rgba(0,224,138,0.15)]'
                      : 'bg-[#0D1017] border-[#202735] text-[#8A95A5] hover:border-[#00E08A]/30 hover:text-white'
                  )}
                >
                  {o}
                </button>
              ))}
            </div>
          </div>

          {/* Entry / SL */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="block text-xs font-bold text-[#8A95A5] tracking-wider uppercase">Entry</label>
              <input
                type="number"
                step="any"
                value={entry}
                onChange={(e) => setEntry(e.target.value)}
                placeholder="0.00000"
                className="w-full bg-[#0D1017] border border-[#202735] rounded-xl p-3 text-white font-mono focus:outline-none focus:border-[#00E08A]/50"
              />
            </div>
            <div className="space-y-2">
              <label className="block text-xs font-bold text-[#8A95A5] tracking-wider uppercase">SL</label>
              <input
                type="number"
                step="any"
                value={sl}
                onChange={(e) => setSl(e.target.value)}
                placeholder="0.00000"
                className="w-full bg-[#0D1017] border border-[#202735] rounded-xl p-3 text-white font-mono focus:outline-none focus:border-[#00E08A]/50"
              />
            </div>
          </div>

          {/* TP R-multiples */}
          <div className="space-y-3">
            <label className="block text-xs font-bold text-[#8A95A5] tracking-wider uppercase">TP R-Multiples</label>
            <div className="flex flex-wrap gap-3">
              {TP_MULTIPLES.map((m) => {
                const isSelected = selectedMultiples.has(m.value);
                const price = direction && Number.isFinite(numericEntry) && Number.isFinite(numericSl)
                  ? calculateTp(direction, numericEntry, numericSl, m.value)
                  : null;
                return (
                  <button
                    key={m.label}
                    type="button"
                    onClick={() => toggleMultiple(m.value)}
                    className={cn(
                      'flex items-center gap-2 px-4 py-3 rounded-xl border text-sm font-bold transition-all',
                      isSelected
                        ? 'bg-[#00E08A]/10 border-[#00E08A] text-[#00E08A] shadow-[0_0_15px_rgba(0,224,138,0.15)]'
                        : 'bg-[#0D1017] border-[#202735] text-[#8A95A5] hover:border-[#00E08A]/30 hover:text-white'
                    )}
                  >
                    <span>{m.label}</span>
                    {price != null && isSelected && (
                      <span className="text-xs font-mono opacity-90">{formatPrice(price, pair)}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Confidence */}
          <div className="space-y-3">
            <label className="block text-xs font-bold text-[#8A95A5] tracking-wider uppercase">Confidence (max 80)</label>
            <div className="flex items-center gap-3">
              {CONFIDENCE_OPTIONS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setConfidence(c)}
                  className={cn(
                    'px-4 py-2 rounded-lg text-sm font-bold border transition-all',
                    confidence === c
                      ? 'bg-[#00E08A]/10 border-[#00E08A] text-[#00E08A]'
                      : 'bg-[#0D1017] border-[#202735] text-[#8A95A5] hover:border-[#00E08A]/30 hover:text-white'
                  )}
                >
                  {c}
                </button>
              ))}
              <input
                type="number"
                min={1}
                max={80}
                value={confidence}
                onChange={(e) => setConfidence(Math.min(80, Math.max(0, Number(e.target.value) || 0)))}
                className="w-24 bg-[#0D1017] border border-[#202735] rounded-lg p-2 text-white font-mono text-sm focus:outline-none focus:border-[#00E08A]/50"
              />
            </div>
          </div>

          {/* Live preview */}
          <div className="bg-[#0D1017] border border-[#202735] rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">Customer Preview</h3>
              <button
                type="button"
                onClick={copyPreview}
                className="flex items-center gap-1.5 text-xs font-medium text-[#8A95A5] hover:text-[#00E08A] transition-colors"
              >
                {copiedAll ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedAll ? 'Copied' : 'Copy'}
              </button>
            </div>

            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-white font-bold text-lg">{pair} — {direction || '—'}</span>
                <span className="text-[#F5A524] font-mono font-bold">{confidence}/100</span>
              </div>
              <div className="text-[#8A95A5]">Strategy: <span className="text-white">{strategy || '—'}</span></div>
              <div className="text-[#8A95A5]">OCL: <span className="text-white">{ocl || '—'}</span></div>
              <div className="grid grid-cols-2 gap-3 pt-2">
                <div className="bg-[#11141A] rounded-xl p-3 border border-[#202735]">
                  <div className="text-[10px] text-[#5D6B80] uppercase tracking-wider mb-1">Entry</div>
                  <div className="text-white font-mono font-bold">{formatPrice(numericEntry, pair)}</div>
                </div>
                <div className="bg-[#11141A] rounded-xl p-3 border border-[#202735]">
                  <div className="text-[10px] text-[#5D6B80] uppercase tracking-wider mb-1">SL</div>
                  <div className="text-red-400 font-mono font-bold">{formatPrice(numericSl, pair)}</div>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {selectedTps.length > 0 ? selectedTps.map((tp, i) => (
                  <div key={tp.value} className="bg-[#11141A] rounded-xl p-3 border border-[#202735]">
                    <div className="text-[10px] text-[#5D6B80] uppercase tracking-wider mb-1">TP{i + 1} ({tp.label})</div>
                    <div className="text-[#00E08A] font-mono font-bold">{formatPrice(tp.price, pair)}</div>
                  </div>
                )) : (
                  <div className="col-span-full text-xs text-[#5D6B80]">Select TP R-multiples to see preview</div>
                )}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              onClick={handleSaveDraft}
              disabled={status === 'saving' || status === 'publishing'}
              className="flex-1 flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-[#1A2332] hover:bg-[#2A3441] border border-[#202735] text-white font-bold text-sm transition-all disabled:opacity-50"
            >
              {status === 'saving' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save Draft
            </button>
            <button
              type="button"
              onClick={handlePublish}
              disabled={status === 'saving' || status === 'publishing'}
              className="flex-[2] flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-[#00E08A] hover:bg-[#00C278] text-[#0A0D12] font-black text-sm uppercase tracking-wider transition-all disabled:opacity-50"
            >
              {status === 'publishing' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Publish Signal
            </button>
            <button
              type="button"
              onClick={resetForm}
              disabled={status === 'saving' || status === 'publishing'}
              className="flex-1 flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-[#0D1017] hover:bg-red-500/10 border border-[#202735] hover:border-red-500/30 text-[#8A95A5] hover:text-red-400 font-bold text-sm transition-all disabled:opacity-50"
            >
              <X className="w-4 h-4" />
              Cancel
            </button>
          </div>

          {/* Status message */}
          {message && (
            <div className={cn(
              'rounded-xl p-4 text-sm font-bold flex items-center gap-2',
              status === 'success' ? 'bg-[#00E08A]/10 border border-[#00E08A]/30 text-[#00E08A]' : 'bg-red-500/10 border border-red-500/30 text-red-400'
            )}>
              {status === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
              {message}
            </div>
          )}
        </div>
      </div>

      {/* Drafts list */}
      {drafts.length > 0 && (
        <div className="bg-[#11141A] border border-[#202735] rounded-2xl overflow-hidden shadow-2xl">
          <div className="p-4 sm:p-6 border-b border-[#202735]">
            <h3 className="text-lg font-semibold text-white">Saved Drafts</h3>
          </div>
          <div className="divide-y divide-[#202735]">
            {drafts.map((draft) => (
              <div key={draft.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-white/[0.02] transition-colors">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-white font-bold">{draft.pair}</span>
                    <span className={cn(
                      'px-2 py-0.5 rounded text-[10px] font-bold uppercase',
                      draft.direction === 'BUY' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                    )}>
                      {draft.direction}
                    </span>
                    <span className="text-[#8A95A5] text-xs">{draft.strategy} · {draft.ocl}</span>
                  </div>
                  <div className="text-[#5D6B80] text-xs mt-1 font-mono">
                    E {formatPrice(draft.entry, draft.pair)} · SL {formatPrice(draft.sl, draft.pair)} · TPs {(draft.tp_multiples || []).join(', ')}R · Conf {draft.confidence}/100
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => loadDraft(draft)}
                    className="px-3 py-2 rounded-lg text-xs font-bold bg-[#00E08A]/10 text-[#00E08A] border border-[#00E08A]/20 hover:bg-[#00E08A]/20 transition-colors"
                  >
                    Load
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteDraft(draft.id)}
                    className="p-2 rounded-lg text-[#8A95A5] hover:text-red-400 hover:bg-red-500/10 border border-[#202735] hover:border-red-500/30 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
