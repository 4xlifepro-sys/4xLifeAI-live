import { useMemo, useState } from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import {
  ClipboardPaste, Loader2, CheckCircle2, AlertTriangle, Send, Pencil, X, Trash2, ShieldCheck,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type Direction = 'BUY' | 'SELL';
type SignalType = 'BUY' | 'SELL' | 'BUY STOP' | 'SELL STOP';

interface Extraction {
  pair?: string;
  timeframe?: string;
  direction?: Direction;
  signalType?: SignalType;
  entry?: number | string;
  trigger?: string;
  triggerPrice?: number | string;
  sl?: number | string;
  tp1?: number | string;
  tp2?: number | string;
  tp3?: number | string;
  confidence?: number | string;
  trend?: string;
  strategy?: string;
  reason?: string;
  status: string;
}

const STATUSES = ['WAITING FOR TRIGGER', 'ACTIVE', 'TP1 HIT', 'TP2 HIT', 'TP3 HIT', 'SL HIT', 'CANCELLED', 'EXPIRED'];
const DIRECTIONS: SignalType[] = ['BUY', 'SELL', 'BUY STOP', 'SELL STOP'];
const TIMEFRAMES = ['1M', '3M', '5M', '15M', '30M', '1H', '2H', '4H', '1D', '1W'];

function num(v: number | string | undefined): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function displayPrice(v: number | string | undefined): string {
  const n = num(v);
  return n === undefined ? '—' : String(n);
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  return {
    'Content-Type': 'application/json',
    ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
  };
}

export default function CopilotSignal() {
  const [text, setText] = useState('');
  const [extraction, setExtraction] = useState<Extraction | null>(null);
  const [original, setOriginal] = useState<Extraction | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [error, setError] = useState('');
  const [hint, setHint] = useState('');
  const [notice, setNotice] = useState('');
  const [publishedId, setPublishedId] = useState<string | null>(null);

  const update = (patch: Partial<Extraction>) => {
    setExtraction((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const missing = useMemo(() => {
    if (!extraction) return [];
    const list: string[] = [];
    if (!extraction.pair?.trim()) list.push('SYMBOL');
    if (!extraction.timeframe?.trim()) list.push('TIMEFRAME');
    if (!extraction.direction) list.push('DIRECTION');
    if (!extraction.signalType) list.push('SIGNAL TYPE');
    if (!num(extraction.entry)) list.push('ENTRY');
    if (!num(extraction.sl)) list.push('SL');
    if (!num(extraction.tp1)) list.push('TP1');
    const conf = extraction.confidence;
    if (conf === undefined || conf === null || conf === '' || !Number.isFinite(Number(conf))) list.push('CONFIDENCE');
    else if (Number(conf) < 0 || Number(conf) > 80) list.push('CONFIDENCE (must be 0-80)');
    if (!extraction.strategy?.trim()) list.push('STRATEGY');
    if (!STATUSES.includes(extraction.status)) list.push('STATUS');
    if (extraction.status === 'NO TRADE' || extraction.status === 'WAITING') list.push(`TRADE DECISION (Copilot returned ${extraction.status})`);
    if (extraction.direction === 'BUY' && num(extraction.sl) !== undefined && num(extraction.entry) !== undefined && (num(extraction.sl) as number) >= (num(extraction.entry) as number)) list.push('SL (must be below Entry for BUY)');
    if (extraction.direction === 'SELL' && num(extraction.sl) !== undefined && num(extraction.entry) !== undefined && (num(extraction.sl) as number) <= (num(extraction.entry) as number)) list.push('SL (must be above Entry for SELL)');
    return list;
  }, [extraction]);

  const priceModified = useMemo(() => {
    if (!extraction || !original) return false;
    const fields: (keyof Extraction)[] = ['entry', 'sl', 'tp1', 'tp2', 'tp3', 'triggerPrice'];
    return fields.some((f) => {
      const a = num(extraction[f] as number | string | undefined);
      const b = num(original[f] as number | string | undefined);
      return a !== b;
    });
  }, [extraction, original]);

  const analyze = async () => {
    setError('');
    setHint('');
    setNotice('');
    setPublishedId(null);
    if (!text.trim()) {
      setError('Paste the complete Copilot analysis first.');
      return;
    }
    setAnalyzing(true);
    try {
      const res = await fetch('/api/admin/copilot-signal/analyze', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to analyze pasted text.');
        setHint(data.hint || '');
        setExtraction(null);
        setOriginal(null);
        return;
      }
      setExtraction(data.extraction);
      setOriginal(JSON.parse(JSON.stringify(data.extraction)));
      setEditMode(false);
    } catch (e: any) {
      setError(e.message || 'Failed to analyze pasted text.');
    } finally {
      setAnalyzing(false);
    }
  };

  const publish = async () => {
    setError('');
    setHint('');
    setNotice('');
    if (missing.length > 0) {
      setError('SIGNAL INCOMPLETE — missing: ' + missing.join(', '));
      return;
    }
    setPublishing(true);
    try {
      const res = await fetch('/api/admin/copilot-signal/publish', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ extraction, originalText: text }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to publish signal.');
        if (data.missing?.length) setHint('Missing: ' + data.missing.join(', '));
        return;
      }
      setPublishedId(data.signal?.id || null);
      setNotice('Signal published. It is now live for customers on LIVE SIGNALS and saved to SIGNAL HISTORY.');
    } catch (e: any) {
      setError(e.message || 'Failed to publish signal.');
    } finally {
      setPublishing(false);
    }
  };

  const clearAll = () => {
    setText('');
    setExtraction(null);
    setOriginal(null);
    setError('');
    setHint('');
    setNotice('');
    setPublishedId(null);
    setEditMode(false);
  };

  const isBuy = extraction?.direction === 'BUY';
  const directionColor = isBuy ? 'text-[#00E08A]' : 'text-[#FF4D5E]';
  const directionBg = isBuy ? 'bg-[#00E08A]/10 border-[#00E08A]/40' : 'bg-[#FF4D5E]/10 border-[#FF4D5E]/40';
  const confNum = extraction ? Number(extraction.confidence) : NaN;

  const field = (label: string, key: keyof Extraction, placeholder = '', warn = false) => (
    <div className="space-y-2">
      <label className={cn('block text-xs font-bold tracking-wider uppercase', warn ? 'text-[#FFB020]' : 'text-[#8A95A5]')}>{label}</label>
      <input
        type="text"
        value={String(extraction?.[key] ?? '')}
        placeholder={placeholder}
        onChange={(e) => update({ [key]: e.target.value } as Partial<Extraction>)}
        className="w-full bg-[#0D1017] border border-[#202735] rounded-xl p-3 text-white focus:outline-none focus:border-[#00E08A]/50"
      />
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-[#11141A] border border-[#202735] rounded-2xl p-4 sm:p-6 shadow-2xl">
        <h2 className="text-xl font-semibold text-white flex items-center gap-2">
          <ClipboardPaste className="w-5 h-5 text-[#00E08A]" />
          Copilot Signal
        </h2>
        <p className="text-sm text-[#8A95A5] mt-1">
          Paste TradingView Copilot analysis → Review → Publish
        </p>
        <div className="mt-3 flex items-center gap-2 text-xs text-[#8A95A5]">
          <ShieldCheck className="w-4 h-4 text-[#00E08A]" />
          Manual copy-paste only — this page is not connected to TradingView and does not scrape or automate anything.
        </div>
      </div>

      {/* Section 1: Paste */}
      <div className="bg-[#11141A] border border-[#202735] rounded-2xl overflow-hidden shadow-2xl">
        <div className="p-4 sm:p-6 border-b border-[#202735]">
          <h3 className="text-sm font-bold text-white tracking-wider uppercase">Paste Copilot Analysis</h3>
        </div>
        <div className="p-4 sm:p-6 space-y-4">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste the complete TradingView AI Copilot analysis here..."
            rows={10}
            className="w-full bg-[#0D1017] border border-[#202735] rounded-xl p-4 text-sm text-white font-mono focus:outline-none focus:border-[#00E08A]/50 resize-y"
          />
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={analyze}
              disabled={analyzing}
              className="flex-1 px-6 py-4 rounded-xl bg-[#00E08A] text-black font-bold text-sm tracking-wider uppercase hover:bg-[#00E08A]/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <ClipboardPaste className="w-4 h-4" />}
              {analyzing ? 'Analyzing...' : 'Analyze Signal'}
            </button>
            <button
              onClick={clearAll}
              className="px-6 py-4 rounded-xl border border-[#202735] text-[#8A95A5] font-bold text-sm tracking-wider uppercase hover:border-[#FF4D5E]/50 hover:text-[#FF4D5E] flex items-center justify-center gap-2"
            >
              <Trash2 className="w-4 h-4" />
              Clear
            </button>
          </div>
        </div>
      </div>

      {/* Messages */}
      {error && (
        <div className="rounded-xl p-4 text-sm font-bold flex items-start gap-2 bg-[#FF4D5E]/10 border border-[#FF4D5E]/30 text-[#FF4D5E]">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <div>{error}</div>
            {hint && <div className="mt-1 font-normal text-[#FF4D5E]/80">{hint}</div>}
          </div>
        </div>
      )}
      {notice && (
        <div className="rounded-xl p-4 text-sm font-bold flex items-center gap-2 bg-[#00E08A]/10 border border-[#00E08A]/30 text-[#00E08A]">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          {notice}
          {publishedId && <span className="font-mono font-normal text-[#00E08A]/70">({publishedId.slice(0, 8)}...)</span>}
        </div>
      )}

      {/* Section 2: Extracted Signal */}
      {extraction && !editMode && (
        <div className="bg-[#11141A] border border-[#202735] rounded-2xl overflow-hidden shadow-2xl">
          <div className="p-4 sm:p-6 border-b border-[#202735] flex items-center justify-between">
            <h3 className="text-sm font-bold text-white tracking-wider uppercase">Extracted Signal</h3>
            {missing.length > 0 && (
              <span className="text-xs font-bold text-[#FFB020]">SIGNAL INCOMPLETE</span>
            )}
          </div>
          <div className="p-4 sm:p-6">
            <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
              {[
                ['Symbol', extraction.pair || 'MISSING SYMBOL'],
                ['Timeframe', extraction.timeframe || 'MISSING TIMEFRAME'],
                ['Direction', extraction.direction || 'MISSING DIRECTION'],
                ['Signal Type', extraction.signalType || 'MISSING SIGNAL TYPE'],
                ['Entry', extraction.entry ? displayPrice(extraction.entry) : 'MISSING ENTRY'],
                ['Trigger', extraction.trigger || '—'],
                ['SL', extraction.sl ? displayPrice(extraction.sl) : 'MISSING SL'],
                ['TP1', extraction.tp1 ? displayPrice(extraction.tp1) : 'MISSING TP1'],
                ['TP2', extraction.tp2 ? displayPrice(extraction.tp2) : '—'],
                ['TP3', extraction.tp3 ? displayPrice(extraction.tp3) : '—'],
                ['Confidence', Number.isFinite(confNum) && extraction.confidence !== '' ? `${confNum}/80` : 'NOT PROVIDED'],
                ['Trend', extraction.trend || '—'],
                ['Setup', extraction.strategy || '—'],
                ['Status', extraction.status],
              ].map(([label, value]) => {
                const isMissing = String(value).startsWith('MISSING');
                return (
                  <div key={label}>
                    <dt className="text-xs font-bold text-[#8A95A5] tracking-wider uppercase">{label}</dt>
                    <dd className={cn('mt-1 text-sm font-semibold font-mono', isMissing ? 'text-[#FFB020]' : 'text-white')}>
                      {value}
                    </dd>
                  </div>
                );
              })}
            </dl>
            <div className="mt-4 pt-4 border-t border-[#202735]">
              <dt className="text-xs font-bold text-[#8A95A5] tracking-wider uppercase">Reason</dt>
              <dd className="mt-1 text-sm text-[#C8D0DC]">{extraction.reason || '—'}</dd>
            </div>
            {missing.length > 0 && (
              <div className="mt-4 rounded-xl p-4 bg-[#FFB020]/10 border border-[#FFB020]/30">
                <div className="text-sm font-bold text-[#FFB020]">SIGNAL INCOMPLETE</div>
                <div className="mt-1 text-sm text-[#FFB020]/80">Missing: {missing.join(', ')}</div>
                <div className="mt-1 text-xs text-[#8A95A5]">Click EDIT to fill missing fields manually, or paste a more complete analysis.</div>
              </div>
            )}
            {priceModified && (
              <div className="mt-4 rounded-xl p-3 text-sm font-bold bg-[#FFB020]/10 border border-[#FFB020]/30 text-[#FFB020] flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                PRICE MODIFIED BY ADMIN
              </div>
            )}
          </div>
        </div>
      )}

      {/* Edit Mode */}
      {extraction && editMode && (
        <div className="bg-[#11141A] border border-[#202735] rounded-2xl overflow-hidden shadow-2xl">
          <div className="p-4 sm:p-6 border-b border-[#202735]">
            <h3 className="text-sm font-bold text-white tracking-wider uppercase">Edit Signal</h3>
            <p className="text-xs text-[#8A95A5] mt-1">Editing prices away from the Copilot extraction will show a warning.</p>
          </div>
          <div className="p-4 sm:p-6 space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {field('Symbol', 'pair', 'AUDUSD')}
              <div className="space-y-2">
                <label className="block text-xs font-bold text-[#8A95A5] tracking-wider uppercase">Timeframe</label>
                <select
                  value={extraction.timeframe || ''}
                  onChange={(e) => update({ timeframe: e.target.value })}
                  className="w-full bg-[#0D1017] border border-[#202735] rounded-xl p-3 text-white focus:outline-none focus:border-[#00E08A]/50"
                >
                  <option value="">—</option>
                  {TIMEFRAMES.map((tf) => <option key={tf} value={tf}>{tf}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <label className="block text-xs font-bold text-[#8A95A5] tracking-wider uppercase">Signal Type</label>
                <select
                  value={extraction.signalType || ''}
                  onChange={(e) => {
                    const st = e.target.value as SignalType;
                    update({ signalType: st, direction: st.startsWith('BUY') ? 'BUY' : 'SELL' });
                  }}
                  className="w-full bg-[#0D1017] border border-[#202735] rounded-xl p-3 text-white focus:outline-none focus:border-[#00E08A]/50"
                >
                  <option value="">—</option>
                  {DIRECTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              {field('Entry', 'entry', '0.69830', priceModified)}
              {field('Trigger', 'trigger', '5M CLOSE ABOVE 0.69828')}
              {field('SL', 'sl', '0.69785', priceModified)}
              {field('TP1', 'tp1', '0.69872', priceModified)}
              {field('TP2', 'tp2', '0.69928', priceModified)}
              {field('TP3', 'tp3', '')}
              {field('Confidence (0-80)', 'confidence', '76')}
              {field('Trend', 'trend', 'Bullish')}
              {field('Strategy', 'strategy', '5M Confirmed Momentum')}
              <div className="space-y-2">
                <label className="block text-xs font-bold text-[#8A95A5] tracking-wider uppercase">Status</label>
                <select
                  value={extraction.status}
                  onChange={(e) => update({ status: e.target.value })}
                  className="w-full bg-[#0D1017] border border-[#202735] rounded-xl p-3 text-white focus:outline-none focus:border-[#00E08A]/50"
                >
                  {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div className="space-y-2">
              <label className="block text-xs font-bold text-[#8A95A5] tracking-wider uppercase">Reason</label>
              <textarea
                value={extraction.reason || ''}
                onChange={(e) => update({ reason: e.target.value })}
                rows={3}
                className="w-full bg-[#0D1017] border border-[#202735] rounded-xl p-3 text-sm text-white focus:outline-none focus:border-[#00E08A]/50 resize-y"
              />
            </div>
            {priceModified && (
              <div className="rounded-xl p-3 text-sm font-bold bg-[#FFB020]/10 border border-[#FFB020]/30 text-[#FFB020] flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                PRICE MODIFIED BY ADMIN
              </div>
            )}
            <button
              onClick={() => setEditMode(false)}
              className="px-6 py-3 rounded-xl bg-[#00E08A] text-black font-bold text-sm tracking-wider uppercase hover:bg-[#00E08A]/90"
            >
              Done Editing
            </button>
          </div>
        </div>
      )}

      {/* Section 3: Preview + Actions */}
      {extraction && !editMode && (
        <div className="bg-[#11141A] border border-[#202735] rounded-2xl overflow-hidden shadow-2xl">
          <div className="p-4 sm:p-6 border-b border-[#202735]">
            <h3 className="text-sm font-bold text-white tracking-wider uppercase">Signal Preview — what customers will see</h3>
          </div>
          <div className="p-4 sm:p-6 space-y-6">
            <div className="max-w-md mx-auto rounded-2xl border border-[#202735] bg-[#0D1017] p-5 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-lg font-bold text-white font-mono">
                  {extraction.pair || 'MISSING SYMBOL'}{extraction.timeframe ? ` · ${extraction.timeframe}` : ''}
                </span>
              </div>
              <div className={cn('rounded-xl border px-4 py-3 text-center text-xl font-extrabold tracking-wide', directionBg, directionColor)}>
                {extraction.signalType || 'MISSING DIRECTION'}
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <span className="text-[#8A95A5]">Entry</span>
                <span className="text-right text-white font-mono">{displayPrice(extraction.entry)}</span>
                {extraction.trigger && (
                  <>
                    <span className="text-[#8A95A5]">Trigger</span>
                    <span className="text-right text-white font-mono">{extraction.trigger}</span>
                  </>
                )}
                <span className="text-[#8A95A5]">SL</span>
                <span className="text-right text-[#FF4D5E] font-mono">{displayPrice(extraction.sl)}</span>
                <span className="text-[#8A95A5]">TP1</span>
                <span className="text-right text-[#00E08A] font-mono">{displayPrice(extraction.tp1)}</span>
                {num(extraction.tp2) && (
                  <>
                    <span className="text-[#8A95A5]">TP2</span>
                    <span className="text-right text-[#00E08A] font-mono">{displayPrice(extraction.tp2)}</span>
                  </>
                )}
                {num(extraction.tp3) && (
                  <>
                    <span className="text-[#8A95A5]">TP3</span>
                    <span className="text-right text-[#00E08A] font-mono">{displayPrice(extraction.tp3)}</span>
                  </>
                )}
                <span className="text-[#8A95A5]">Confidence</span>
                <span className="text-right text-white font-mono">
                  {Number.isFinite(confNum) && extraction.confidence !== '' ? `${confNum}/80` : 'NOT PROVIDED'}
                </span>
                <span className="text-[#8A95A5]">Strategy</span>
                <span className="text-right text-white">{extraction.strategy || '—'}</span>
                <span className="text-[#8A95A5]">Status</span>
                <span className="text-right text-[#FFB020] font-bold">{extraction.status}</span>
              </div>
              {extraction.reason && (
                <div className="pt-3 border-t border-[#202735]">
                  <span className="text-xs text-[#8A95A5] uppercase tracking-wider font-bold">Reason</span>
                  <p className="mt-1 text-sm text-[#C8D0DC]">{extraction.reason}</p>
                </div>
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={publish}
                disabled={publishing || missing.length > 0}
                className="flex-1 px-6 py-4 rounded-xl bg-[#00E08A] text-black font-bold text-sm tracking-wider uppercase hover:bg-[#00E08A]/90 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {publishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {publishing ? 'Publishing...' : 'Publish Signal'}
              </button>
              <button
                onClick={() => setEditMode(true)}
                className="px-6 py-4 rounded-xl border border-[#202735] text-[#C8D0DC] font-bold text-sm tracking-wider uppercase hover:border-[#00E08A]/50 hover:text-[#00E08A] flex items-center justify-center gap-2"
              >
                <Pencil className="w-4 h-4" />
                Edit
              </button>
              <button
                onClick={clearAll}
                className="px-6 py-4 rounded-xl border border-[#202735] text-[#8A95A5] font-bold text-sm tracking-wider uppercase hover:border-[#FF4D5E]/50 hover:text-[#FF4D5E] flex items-center justify-center gap-2"
              >
                <X className="w-4 h-4" />
                Cancel
              </button>
            </div>
            {missing.length > 0 && (
              <p className="text-xs text-[#8A95A5] text-center">
                Publish is blocked until all required fields are present: {missing.join(', ')}.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
