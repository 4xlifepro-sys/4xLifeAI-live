import { useEffect, useMemo, useState } from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import {
  SlidersHorizontal, Save, Send, X, Trash2, Loader2, CheckCircle2, AlertTriangle,
  Copy, Check, RotateCcw, History, ChevronDown, ChevronUp, Eye, Newspaper, Upload,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const APPROVED_PAIRS = ['XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'BTCUSD', 'ETHUSD', 'SOLUSD'];
const TIMEFRAMES = ['5M', '15M', '1H', '4H'];
const MARKET_STRUCTURES = ['HH + HL', 'LL + LH', 'Mixed / Unclear'];
const LIQUIDITY_OPTIONS = ['Liquidity Taken', 'Liquidity Not Taken'];
const ASIAN_OPTIONS = ['Asian High Taken', 'Asian Low Taken', 'Neither Taken'];
const STRATEGIES = ['Classic A', 'Classic V'];
const TRADE_TYPES = ['Main Trend', 'Counter Trend'];
const ASIAN_REACTIONS = ['Wick Taken', 'Body Taken', 'Not Taken'];
const CONFIRMATIONS = [
  { key: 'mss', label: 'MSS' },
  { key: 'ocl', label: 'OCL' },
  { key: 'qml', label: 'QML' },
  { key: 'rbs', label: 'RBS' },
  { key: 'sbr', label: 'SBR' },
];
const TP_MULTIPLES = [
  { label: '1R', value: 1 },
  { label: '2.1R', value: 2.1 },
  { label: '3.1R', value: 3.1 },
  { label: '4.1R', value: 4.1 },
  { label: '5R', value: 5 },
  { label: '6R', value: 6 },
];

const PIP_SIZE: Record<string, number> = {
  XAUUSD: 0.1,
  XAGUSD: 0.01,
  EURUSD: 0.0001,
  GBPUSD: 0.0001,
  AUDUSD: 0.0001,
  USDCAD: 0.0001,
  USDJPY: 0.01,
  BTCUSD: 1,
  ETHUSD: 1,
  SOLUSD: 1,
};

interface Draft {
  id: string;
  pair: string;
  timeframe: string;
  direction: 'BUY' | 'SELL';
  market_structure: string;
  liquidity: string;
  asian_high_low: string;
  strategy: string;
  trade_type: string;
  asian_reaction: string;
  confirmation_mss: boolean;
  confirmation_ocl: boolean;
  confirmation_qml: boolean;
  confirmation_rbs: boolean;
  confirmation_sbr: boolean;
  entry: number;
  sl: number;
  sl_mode?: 'price' | 'pips';
  sl_pips?: number;
  tp_multiples: number[];
  confidence: number;
  auto_confidence_breakdown: Record<string, number>;
  auto_reason: string;
  updated_at: string;
}

interface NewsPrediction {
  newsHasEvent: boolean;
  newsEvent: string;
  newsPrediction: 'BUY' | 'SELL' | 'NEUTRAL';
  newsProbability: number;
  newsReason: string;
}

interface HistorySignal {
  id: string;
  pair: string;
  direction: 'BUY' | 'SELL';
  strategy: string;
  entry_price: number;
  sl: number;
  tp1: number;
  tp2: number;
  tp3: number;
  auto_confidence: number;
  status: string;
  created_at: string;
  market_structure: string;
  liquidity: string;
  asian_high_low: string;
  trade_type: string;
  asian_reaction: string;
  confirmation_mss: boolean;
  confirmation_ocl: boolean;
  confirmation_qml: boolean;
  confirmation_rbs: boolean;
  confirmation_sbr: boolean;
  auto_reason: string;
  news_event?: string;
  news_prediction?: string;
  news_probability?: number;
  news_reason?: string;
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

function emptyAnalysis() {
  return {
    pair: 'XAUUSD',
    timeframe: '15M',
    direction: '' as 'BUY' | 'SELL' | '',
    marketStructure: '',
    liquidity: '',
    asianHighLow: '',
    strategy: '',
    tradeType: '',
    asianReaction: '',
    confirmations: { mss: false, ocl: false, qml: false, rbs: false, sbr: false },
    entry: '',
    sl: '',
  };
}

function getPipSize(pair: string): number {
  return PIP_SIZE[pair.toUpperCase()] || 0.0001;
}

function classForToggle(selected: boolean, color: 'green' | 'red' | 'neutral' = 'neutral') {
  if (selected) {
    if (color === 'green') return 'bg-emerald-500/10 border-emerald-500 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.15)]';
    if (color === 'red') return 'bg-red-500/10 border-red-500 text-red-400 shadow-[0_0_15px_rgba(239,68,68,0.15)]';
    return 'bg-[#00E08A]/10 border-[#00E08A] text-[#00E08A] shadow-[0_0_15px_rgba(0,224,138,0.15)]';
  }
  return 'bg-[#0D1017] border-[#202735] text-[#8A95A5] hover:border-white/20 hover:text-white';
}

export default function SignalBuilder() {
  const [analysis, setAnalysis] = useState(emptyAnalysis());
  const [selectedMultiples, setSelectedMultiples] = useState<Set<number>>(new Set([1, 2.1, 3.1, 4.1]));
  const [slMode, setSlMode] = useState<'price' | 'pips'>('price');
  const [slPips, setSlPips] = useState('');
  const [confidence, setConfidence] = useState(0);
  const [breakdown, setBreakdown] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('');
  const [showBreakdown, setShowBreakdown] = useState(true);
  const [activeView, setActiveView] = useState<'builder' | 'history' | 'analyzer'>('builder');

  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [history, setHistory] = useState<HistorySignal[]>([]);
  const [status, setStatus] = useState<'idle' | 'saving' | 'publishing' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [copiedAll, setCopiedAll] = useState(false);

  const [newsEnabled, setNewsEnabled] = useState(false);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsPrediction, setNewsPrediction] = useState<NewsPrediction | null>(null);
  const [newsError, setNewsError] = useState('');

  const [chartFile, setChartFile] = useState<File | null>(null);
  const [chartAnalyzing, setChartAnalyzing] = useState(false);
  const [chartError, setChartError] = useState('');
  const [chartAnalyzed, setChartAnalyzed] = useState(false);

  const { pair, direction, entry, sl } = analysis;
  const numericEntry = Number(entry);
  const numericSlRaw = Number(sl);
  const numericSlPips = Number(slPips);

  const effectiveSl = useMemo(() => {
    if (slMode === 'price') return numericSlRaw;
    if (!Number.isFinite(numericEntry) || !Number.isFinite(numericSlPips) || !direction) return NaN;
    const pipSize = getPipSize(pair);
    if (direction === 'BUY') return numericEntry - numericSlPips * pipSize;
    return numericEntry + numericSlPips * pipSize;
  }, [slMode, numericSlRaw, numericSlPips, numericEntry, direction, pair]);

  const numericSl = effectiveSl;

  const finalConfidence = useMemo(() => {
    let base = confidence;
    if (newsEnabled && newsPrediction?.newsHasEvent) {
      if (newsPrediction.newsPrediction === direction) base += 5;
      else if (newsPrediction.newsPrediction !== 'NEUTRAL') base -= 5;
    }
    return Math.max(0, Math.min(80, base));
  }, [confidence, newsEnabled, newsPrediction, direction]);

  useEffect(() => {
    if (!newsEnabled || !direction || !pair) {
      setNewsPrediction(null);
      setNewsError('');
      return;
    }
    setNewsLoading(true);
    setNewsError('');
    supabase.auth.getSession().then(({ data: { session } }) => {
      fetch('/api/admin/signal-builder/news-predict', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ pair, direction, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
      })
        .then((r) => r.json())
        .then((data) => {
          if (!data.success) throw new Error(data.error || 'News prediction failed');
          setNewsPrediction(data.prediction);
        })
        .catch((e: any) => {
          setNewsError(e.message || 'News prediction failed');
          setNewsPrediction(null);
        })
        .finally(() => setNewsLoading(false));
    });
  }, [newsEnabled, pair, direction]);


  useEffect(() => {
    const payload = buildPayload();
    supabase.auth.getSession().then(({ data: { session } }) => {
      fetch('/api/admin/signal-builder/preview', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify(payload),
      })
        .then((r) => r.json())
        .then((data) => {
          if (data.success) {
            setConfidence(data.confidence);
            setBreakdown(data.breakdown);
            setReason(data.reason);
          }
        })
        .catch(() => {});
    });
  }, [analysis, selectedMultiples]);

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

  const fetchHistory = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/admin/signal-builder/history', {
        headers: { ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
      });
      const data = await res.json();
      if (res.ok && data.success) setHistory(data.signals || []);
    } catch (e) {
      console.error('Failed to load history', e);
    }
  };

  const analyzeChart = async () => {
    if (!chartFile) return;
    setChartAnalyzing(true);
    setChartError('');
    setChartAnalyzed(false);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const formData = new FormData();
      formData.append('image', chartFile);
      formData.append('pair', analysis.pair);
      formData.append('timeframe', analysis.timeframe);
      const res = await fetch('/api/admin/signal-builder/analyze-chart', {
        method: 'POST',
        headers: { ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Chart analysis failed');
      const s = data.suggestion;
      setAnalysis({
        pair: s.pair || analysis.pair,
        timeframe: s.timeframe || analysis.timeframe,
        direction: s.direction || '',
        marketStructure: s.marketStructure || '',
        liquidity: s.liquidity || '',
        asianHighLow: s.asianHighLow || '',
        strategy: s.strategy || '',
        tradeType: s.tradeType || '',
        asianReaction: s.asianReaction || '',
        confirmations: {
          mss: s.confirmations?.includes('MSS') || false,
          ocl: s.confirmations?.includes('OCL') || false,
          qml: s.confirmations?.includes('QML') || false,
          rbs: s.confirmations?.includes('RBS') || false,
          sbr: s.confirmations?.includes('SBR') || false,
        },
        entry: Number.isFinite(s.entry) ? String(s.entry) : '',
        sl: Number.isFinite(s.sl) ? String(s.sl) : '',
      });
      if (s.slMode === 'pips' && Number.isFinite(s.slPips)) {
        setSlMode('pips');
        setSlPips(String(s.slPips));
      } else {
        setSlMode('price');
        setSlPips('');
      }
      if (Array.isArray(s.tpMultiples) && s.tpMultiples.length > 0) {
        setSelectedMultiples(new Set(s.tpMultiples));
      }
      setChartAnalyzed(true);
      setActiveView('builder');
      setMessage('Chart analyzed. Review and edit all fields before publishing.');
      setStatus('success');
      setTimeout(() => setStatus('idle'), 4000);
    } catch (e: any) {
      setChartError(e.message || 'Chart analysis failed');
    } finally {
      setChartAnalyzing(false);
    }
  };

  const updateAnalysis = (patch: Partial<typeof analysis>) => {
    setAnalysis((prev) => ({ ...prev, ...patch }));
  };

  const toggleConfirmation = (key: keyof typeof analysis.confirmations) => {
    setAnalysis((prev) => ({
      ...prev,
      confirmations: { ...prev.confirmations, [key]: !prev.confirmations[key] },
    }));
  };

  const toggleMultiple = (value: number) => {
    setSelectedMultiples((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  };

  const tpPrices = useMemo(() => {
    if (!direction || !Number.isFinite(numericEntry) || !Number.isFinite(numericSl)) return [];
    return TP_MULTIPLES.map((m) => ({ ...m, price: calculateTp(direction, numericEntry, numericSl, m.value) }));
  }, [direction, numericEntry, numericSl]);

  const selectedTps = useMemo(() => {
    return tpPrices.filter((tp) => selectedMultiples.has(tp.value)).sort((a, b) => a.value - b.value);
  }, [tpPrices, selectedMultiples]);

  const validationErrors = useMemo(() => {
    const errors: string[] = [];
    if (!analysis.direction) errors.push('Select BUY or SELL.');
    if (!analysis.marketStructure) errors.push('Select 1H market structure.');
    if (!analysis.liquidity) errors.push('Select liquidity status.');
    if (!analysis.asianHighLow) errors.push('Select Asian High/Low status.');
    if (!analysis.strategy) errors.push('Select Classic A or Classic V.');
    if (!analysis.tradeType) errors.push('Select Main Trend or Counter Trend.');
    if (!analysis.asianReaction) errors.push('Select Asian level reaction.');
    if (!Object.values(analysis.confirmations).some(Boolean)) errors.push('Select at least one 15M confirmation.');
    if (!Number.isFinite(numericEntry) || numericEntry <= 0) errors.push('Enter a valid entry price.');
    if (!Number.isFinite(numericSl) || numericSl <= 0) errors.push('Enter a valid stop loss.');
    if (analysis.direction === 'BUY' && numericSl >= numericEntry) errors.push('BUY SL must be below entry.');
    if (analysis.direction === 'SELL' && numericSl <= numericEntry) errors.push('SELL SL must be above entry.');
    if (selectedMultiples.size === 0) errors.push('Select at least one TP level.');
    return errors;
  }, [analysis, numericEntry, numericSl, selectedMultiples]);

  const buildPayload = () => ({
    pair: analysis.pair,
    timeframe: analysis.timeframe,
    direction: analysis.direction,
    marketStructure: analysis.marketStructure,
    liquidity: analysis.liquidity,
    asianHighLow: analysis.asianHighLow,
    strategy: analysis.strategy,
    tradeType: analysis.tradeType,
    asianReaction: analysis.asianReaction,
    confirmations: analysis.confirmations,
    entry: numericEntry,
    sl: numericSl,
    tpMultiples: Array.from(selectedMultiples),
    confidence: finalConfidence,
    autoReason: reason,
    autoConfidenceBreakdown: breakdown,
    news: newsEnabled && newsPrediction ? {
      newsHasEvent: newsPrediction.newsHasEvent,
      newsEvent: newsPrediction.newsEvent,
      newsPrediction: newsPrediction.newsPrediction,
      newsProbability: newsPrediction.newsProbability,
      newsReason: newsPrediction.newsReason,
    } : undefined,
  });

  const resetForm = () => {
    setAnalysis(emptyAnalysis());
    setSelectedMultiples(new Set([1, 2.1, 3.1, 4.1]));
    setSlMode('price');
    setSlPips('');
    setNewsEnabled(false);
    setNewsPrediction(null);
    setNewsError('');
    setStatus('idle');
    setMessage('');
  };

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
        body: JSON.stringify(buildPayload()),
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
    if (validationErrors.length > 0) {
      setStatus('error');
      setMessage(validationErrors.join(' '));
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
        body: JSON.stringify(buildPayload()),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Publish failed');
      setStatus('success');
      setMessage('Signal published. It is now live in Today Signals and signal history.');
      fetchHistory();
    } catch (e: any) {
      setStatus('error');
      setMessage(e.message || 'Could not publish signal');
    }
  };

  const loadDraft = (draft: Draft) => {
    setAnalysis({
      pair: draft.pair || 'XAUUSD',
      timeframe: draft.timeframe || '15M',
      direction: draft.direction || '',
      marketStructure: draft.market_structure || '',
      liquidity: draft.liquidity || '',
      asianHighLow: draft.asian_high_low || '',
      strategy: draft.strategy || '',
      tradeType: draft.trade_type || '',
      asianReaction: draft.asian_reaction || '',
      confirmations: {
        mss: draft.confirmation_mss,
        ocl: draft.confirmation_ocl,
        qml: draft.confirmation_qml,
        rbs: draft.confirmation_rbs,
        sbr: draft.confirmation_sbr,
      },
      entry: Number.isFinite(draft.entry) ? String(draft.entry) : '',
      sl: Number.isFinite(draft.sl) ? String(draft.sl) : '',
    });
    setSlMode(draft.sl_mode || 'price');
    setSlPips(Number.isFinite(Number(draft.sl_pips)) ? String(draft.sl_pips) : '');
    setSelectedMultiples(new Set((draft.tp_multiples || []).map(Number)));
    setActiveView('builder');
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
      `Entry: ${formatPrice(numericEntry, pair)}`,
      `SL: ${formatPrice(numericSl, pair)}`,
      ...selectedTps.map((tp, i) => `TP${i + 1}: ${formatPrice(tp.price, pair)}`),
      `Confidence: ${finalConfidence}/100`,
      '',
      reason,
    ];
    navigator.clipboard.writeText(lines.join('\n'));
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  };

  const renderToggleGroup = (
    label: string,
    options: string[],
    selected: string,
    onSelect: (v: string) => void,
    color: 'green' | 'red' | 'neutral' = 'neutral',
  ) => (
    <div className="space-y-2">
      <label className="block text-xs font-bold text-[#8A95A5] tracking-wider uppercase">{label}</label>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onSelect(opt)}
            className={cn('px-3 py-3 rounded-xl text-xs sm:text-sm font-bold border transition-all', classForToggle(selected === opt, color))}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );

  const renderBuilder = () => (
    <div className="space-y-6">
      <div className="bg-[#11141A] border border-[#202735] rounded-2xl overflow-hidden shadow-2xl">
        <div className="p-4 sm:p-6 border-b border-[#202735]">
          <h2 className="text-xl font-semibold text-white flex items-center gap-2">
            <SlidersHorizontal className="w-5 h-5 text-[#00E08A]" />
            Signal Builder
          </h2>
          <p className="text-sm text-[#8A95A5] mt-1">
            Record your manual market analysis. Confidence and reason are generated automatically.
          </p>
        </div>

        <div className="p-4 sm:p-6 space-y-8">
          {chartAnalyzed && (
            <div className="rounded-xl p-4 text-sm font-bold flex items-center gap-2 bg-[#00E08A]/10 border border-[#00E08A]/30 text-[#00E08A]">
              <CheckCircle2 className="w-4 h-4" />
              Chart analyzed. Review and edit every field before publishing.
            </div>
          )}

          {/* Basic info */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <label className="block text-xs font-bold text-[#8A95A5] tracking-wider uppercase">Pair</label>
              <select
                value={analysis.pair}
                onChange={(e) => updateAnalysis({ pair: e.target.value })}
                className="w-full bg-[#0D1017] border border-[#202735] rounded-xl p-3 text-white focus:outline-none focus:border-[#00E08A]/50"
              >
                {APPROVED_PAIRS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="block text-xs font-bold text-[#8A95A5] tracking-wider uppercase">Timeframe</label>
              <select
                value={analysis.timeframe}
                onChange={(e) => updateAnalysis({ timeframe: e.target.value })}
                className="w-full bg-[#0D1017] border border-[#202735] rounded-xl p-3 text-white focus:outline-none focus:border-[#00E08A]/50"
              >
                {TIMEFRAMES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="block text-xs font-bold text-[#8A95A5] tracking-wider uppercase">Direction</label>
              <div className="grid grid-cols-2 gap-3">
                {['BUY', 'SELL'].map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => updateAnalysis({ direction: d as 'BUY' | 'SELL' })}
                    className={cn(
                      'px-3 py-3 rounded-xl text-sm font-bold border transition-all',
                      classForToggle(analysis.direction === d, d === 'BUY' ? 'green' : 'red')
                    )}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 1H analysis */}
          <div className="bg-[#0D1017] border border-[#202735] rounded-2xl p-5 space-y-5">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">1H High-Timeframe Analysis</h3>
            {renderToggleGroup('Market Structure', MARKET_STRUCTURES, analysis.marketStructure, (v) => updateAnalysis({ marketStructure: v }))}
            {renderToggleGroup('Liquidity', LIQUIDITY_OPTIONS, analysis.liquidity, (v) => updateAnalysis({ liquidity: v }))}
            {renderToggleGroup('Asian High / Low', ASIAN_OPTIONS, analysis.asianHighLow, (v) => updateAnalysis({ asianHighLow: v }))}
            {renderToggleGroup('Strategy', STRATEGIES, analysis.strategy, (v) => updateAnalysis({ strategy: v }))}
            {renderToggleGroup('Trade Type', TRADE_TYPES, analysis.tradeType, (v) => updateAnalysis({ tradeType: v }))}
            {renderToggleGroup('Asian Level Reaction', ASIAN_REACTIONS, analysis.asianReaction, (v) => updateAnalysis({ asianReaction: v }))}
          </div>

          {/* 15M confirmation */}
          <div className="bg-[#0D1017] border border-[#202735] rounded-2xl p-5 space-y-4">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">15M Confirmation</h3>
            <div className="flex flex-wrap gap-3">
              {CONFIRMATIONS.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => toggleConfirmation(c.key as keyof typeof analysis.confirmations)}
                  className={cn(
                    'px-4 py-3 rounded-xl text-sm font-bold border transition-all',
                    analysis.confirmations[c.key as keyof typeof analysis.confirmations]
                      ? 'bg-[#00E08A]/10 border-[#00E08A] text-[#00E08A] shadow-[0_0_15px_rgba(0,224,138,0.15)]'
                      : 'bg-[#0D1017] border-[#202735] text-[#8A95A5] hover:border-white/20 hover:text-white'
                  )}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          {/* Entry / SL */}
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="block text-xs font-bold text-[#8A95A5] tracking-wider uppercase">Entry</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={analysis.entry}
                  onChange={(e) => updateAnalysis({ entry: e.target.value })}
                  placeholder="0.00000"
                  className="w-full bg-[#0D1017] border border-[#202735] rounded-xl p-3 text-white font-mono focus:outline-none focus:border-[#00E08A]/50"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-bold text-[#8A95A5] tracking-wider uppercase">SL</label>
                  <div className="flex items-center gap-1 bg-[#0D1017] rounded-lg p-0.5 border border-[#202735]">
                    <button
                      type="button"
                      onClick={() => setSlMode('price')}
                      className={cn(
                        'px-2 py-1 rounded text-[10px] font-bold uppercase transition-all',
                        slMode === 'price' ? 'bg-[#00E08A]/10 text-[#00E08A]' : 'text-[#8A95A5] hover:text-white'
                      )}
                    >
                      Price
                    </button>
                    <button
                      type="button"
                      onClick={() => setSlMode('pips')}
                      className={cn(
                        'px-2 py-1 rounded text-[10px] font-bold uppercase transition-all',
                        slMode === 'pips' ? 'bg-[#00E08A]/10 text-[#00E08A]' : 'text-[#8A95A5] hover:text-white'
                      )}
                    >
                      Pips
                    </button>
                  </div>
                </div>
                <input
                  type="text"
                  inputMode="decimal"
                  value={slMode === 'price' ? analysis.sl : slPips}
                  onChange={(e) => {
                    if (slMode === 'price') updateAnalysis({ sl: e.target.value });
                    else setSlPips(e.target.value);
                  }}
                  placeholder={slMode === 'price' ? '0.00000' : '20'}
                  className="w-full bg-[#0D1017] border border-[#202735] rounded-xl p-3 text-white font-mono focus:outline-none focus:border-[#00E08A]/50"
                />
                {slMode === 'pips' && Number.isFinite(numericSl) && (
                  <div className="text-xs text-[#8A95A5]">
                    Computed SL: <span className="text-red-400 font-mono font-bold">{formatPrice(numericSl, pair)}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* TP selector */}
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

          {/* News analysis */}
          <div className="bg-[#0D1017] border border-[#202735] rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Newspaper className={cn('w-4 h-4', newsEnabled ? 'text-[#00E08A]' : 'text-[#8A95A5]')} />
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">News Analysis</h3>
              </div>
              <button
                type="button"
                onClick={() => setNewsEnabled((v) => !v)}
                className={cn(
                  'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                  newsEnabled ? 'bg-[#00E08A]' : 'bg-[#202735]'
                )}
              >
                <span
                  className={cn(
                    'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                    newsEnabled ? 'translate-x-6' : 'translate-x-1'
                  )}
                />
              </button>
            </div>

            <p className="text-xs text-[#8A95A5]">
              When enabled, Gemini checks the Forex Factory calendar for high-impact events affecting this pair and adjusts confidence if the predicted news bias aligns or conflicts with the trade direction.
            </p>

            {newsEnabled && (
              <div className="space-y-3">
                {newsLoading && (
                  <div className="flex items-center gap-2 text-sm text-[#8A95A5]">
                    <Loader2 className="w-4 h-4 animate-spin text-[#00E08A]" />
                    Checking economic calendar...
                  </div>
                )}

                {newsError && !newsLoading && (
                  <div className="rounded-xl p-3 text-xs font-bold flex items-center gap-2 bg-red-500/10 border border-red-500/30 text-red-400">
                    <AlertTriangle className="w-4 h-4" />
                    {newsError}
                  </div>
                )}

                {!newsLoading && newsPrediction?.newsHasEvent && (
                  <div className="bg-[#11141A] rounded-xl p-4 border border-[#202735] space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[#8A95A5]">Upcoming event</span>
                      <span className="text-xs font-bold text-[#F5A524]">{newsPrediction.newsEvent}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[#8A95A5]">News bias</span>
                      <span className={cn(
                        'text-xs font-bold uppercase',
                        newsPrediction.newsPrediction === direction ? 'text-[#00E08A]' : newsPrediction.newsPrediction === 'NEUTRAL' ? 'text-[#8A95A5]' : 'text-red-400'
                      )}>
                        {newsPrediction.newsPrediction} ({newsPrediction.newsProbability}%)
                      </span>
                    </div>
                    <p className="text-xs text-[#8A95A5]">{newsPrediction.newsReason}</p>
                    {direction && newsPrediction.newsPrediction !== 'NEUTRAL' && (
                      <div className={cn(
                        'text-xs font-bold',
                        newsPrediction.newsPrediction === direction ? 'text-[#00E08A]' : 'text-red-400'
                      )}>
                        Confidence {newsPrediction.newsPrediction === direction ? '+5' : '-5'}
                      </div>
                    )}
                  </div>
                )}

                {!newsLoading && newsPrediction && !newsPrediction.newsHasEvent && (
                  <div className="bg-[#11141A] rounded-xl p-4 border border-[#202735] text-xs text-[#8A95A5]">
                    No high-impact events found for this pair in the next 5 days. No confidence adjustment applied.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Confidence + reason */}
          <div className="bg-[#0D1017] border border-[#202735] rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">Automatic Confidence</h3>
              <span className="text-2xl font-black text-[#00E08A]">{finalConfidence}/100</span>
            </div>
            <button
              type="button"
              onClick={() => setShowBreakdown((s) => !s)}
              className="flex items-center gap-1 text-xs font-bold text-[#8A95A5] hover:text-white transition-colors"
            >
              {showBreakdown ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              Confidence breakdown
            </button>
            {showBreakdown && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                {Object.entries(breakdown).map(([k, v]) => (
                  <div key={k} className="flex justify-between bg-[#11141A] rounded-lg px-3 py-2 border border-[#202735]">
                    <span className="text-[#8A95A5]">{k}</span>
                    <span className="text-[#00E08A] font-bold">+{v}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-1">
              <label className="block text-xs font-bold text-[#8A95A5] tracking-wider uppercase">Automatic Reason</label>
              <p className="text-sm text-white leading-relaxed bg-[#11141A] rounded-xl p-4 border border-[#202735]">
                {reason || 'Complete the analysis to generate a reason.'}
              </p>
            </div>
          </div>

          {/* Customer preview */}
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
                <span className="text-[#F5A524] font-mono font-bold">{finalConfidence}/100</span>
              </div>
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
              <p className="text-sm text-[#8A95A5] pt-2 italic">{reason}</p>
              {newsEnabled && newsPrediction?.newsHasEvent && (
                <p className={cn(
                  'text-xs pt-1 italic',
                  newsPrediction.newsPrediction === direction ? 'text-[#00E08A]' : newsPrediction.newsPrediction === 'NEUTRAL' ? 'text-[#8A95A5]' : 'text-red-400'
                )}>
                  {newsPrediction.newsPrediction === direction
                    ? 'News outlook supports this trade direction.'
                    : newsPrediction.newsPrediction === 'NEUTRAL'
                    ? 'News outlook is neutral for this pair.'
                    : 'News outlook conflicts with this trade direction.'}
                </p>
              )}
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
              onClick={copyPreview}
              className="flex-1 flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-[#1A2332] hover:bg-[#2A3441] border border-[#202735] text-white font-bold text-sm transition-all"
            >
              <Eye className="w-4 h-4" />
              Preview
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
              className="flex-1 flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-[#0D1017] hover:bg-white/5 border border-[#202735] text-[#8A95A5] hover:text-white font-bold text-sm transition-all disabled:opacity-50"
            >
              <RotateCcw className="w-4 h-4" />
              Reset
            </button>
            <button
              type="button"
              onClick={() => setActiveView('history')}
              disabled={status === 'saving' || status === 'publishing'}
              className="flex-1 flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-[#0D1017] hover:bg-red-500/10 border border-[#202735] hover:border-red-500/30 text-[#8A95A5] hover:text-red-400 font-bold text-sm transition-all disabled:opacity-50"
            >
              <X className="w-4 h-4" />
              Cancel
            </button>
          </div>

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

      {/* Drafts */}
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
                    <span className="text-[#8A95A5] text-xs">{draft.strategy} · {draft.trade_type}</span>
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

  const renderHistory = () => (
    <div className="space-y-6">
      <div className="bg-[#11141A] border border-[#202735] rounded-2xl overflow-hidden shadow-2xl">
        <div className="p-4 sm:p-6 border-b border-[#202735] flex items-center justify-between">
          <h2 className="text-xl font-semibold text-white flex items-center gap-2">
            <History className="w-5 h-5 text-[#00E08A]" />
            Signal History
          </h2>
          <button
            type="button"
            onClick={() => setActiveView('builder')}
            className="text-xs font-bold text-[#8A95A5] hover:text-white transition-colors"
          >
            ← Back to Builder
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#0D1017] text-[#8A95A5] text-xs uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3">Pair</th>
                <th className="px-4 py-3">Dir</th>
                <th className="px-4 py-3">Strategy</th>
                <th className="px-4 py-3">Entry</th>
                <th className="px-4 py-3">SL</th>
                <th className="px-4 py-3">TPs</th>
                <th className="px-4 py-3">Conf</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#202735]">
              {history.map((s) => (
                <tr key={s.id} className="hover:bg-white/[0.02]">
                  <td className="px-4 py-3 text-white font-bold">{s.pair}</td>
                  <td className="px-4 py-3">
                    <span className={cn(
                      'px-2 py-0.5 rounded text-[10px] font-bold uppercase',
                      s.direction === 'BUY' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                    )}>
                      {s.direction}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[#8A95A5]">{s.strategy}</td>
                  <td className="px-4 py-3 text-white font-mono">{formatPrice(Number(s.entry_price), s.pair)}</td>
                  <td className="px-4 py-3 text-red-400 font-mono">{formatPrice(Number(s.sl), s.pair)}</td>
                  <td className="px-4 py-3 text-[#8A95A5]">
                    {[s.tp1, s.tp2, s.tp3].filter(Boolean).map((tp, i) => (
                      <span key={i} className="inline-block mr-2 text-[#00E08A]">TP{i + 1}: {formatPrice(Number(tp), s.pair)}</span>
                    ))}
                  </td>
                  <td className="px-4 py-3 text-[#F5A524] font-mono">{s.auto_confidence}/100</td>
                  <td className="px-4 py-3 text-[#8A95A5]">{s.status}</td>
                  <td className="px-4 py-3 text-[#5D6B80] text-xs">{new Date(s.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  const renderChartAnalyzer = () => (
    <div className="space-y-6">
      <div className="bg-[#11141A] border border-[#202735] rounded-2xl overflow-hidden shadow-2xl">
        <div className="p-4 sm:p-6 border-b border-[#202735]">
          <h2 className="text-xl font-semibold text-white flex items-center gap-2">
            <Upload className="w-5 h-5 text-[#00E08A]" />
            Gemini Chart Analyzer
          </h2>
          <p className="text-sm text-[#8A95A5] mt-1">
            Upload a chart screenshot. Gemini will read it and pre-fill the Signal Builder analysis for your review.
          </p>
        </div>

        <div className="p-4 sm:p-6 space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <label className="block text-xs font-bold text-[#8A95A5] tracking-wider uppercase">Pair</label>
              <select
                value={analysis.pair}
                onChange={(e) => updateAnalysis({ pair: e.target.value })}
                className="w-full bg-[#0D1017] border border-[#202735] rounded-xl p-3 text-white focus:outline-none focus:border-[#00E08A]/50"
              >
                {APPROVED_PAIRS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="block text-xs font-bold text-[#8A95A5] tracking-wider uppercase">Timeframe</label>
              <select
                value={analysis.timeframe}
                onChange={(e) => updateAnalysis({ timeframe: e.target.value })}
                className="w-full bg-[#0D1017] border border-[#202735] rounded-xl p-3 text-white focus:outline-none focus:border-[#00E08A]/50"
              >
                {TIMEFRAMES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          </div>

          <label className="flex flex-col items-center justify-center w-full h-64 border-2 border-dashed border-[#202735] rounded-2xl cursor-pointer bg-[#0D1017] hover:border-[#00E08A]/50 hover:bg-[#00E08A]/5 transition-all">
            <div className="flex flex-col items-center justify-center pt-5 pb-6 px-4 text-center">
              {chartFile ? (
                <>
                  <CheckCircle2 className="w-10 h-10 text-[#00E08A] mb-3" />
                  <p className="text-sm text-white font-bold">{chartFile.name}</p>
                  <p className="text-xs text-[#8A95A5]">Click or drop to change image</p>
                </>
              ) : (
                <>
                  <Upload className="w-10 h-10 text-[#8A95A5] mb-3" />
                  <p className="text-sm text-white font-bold">Click to upload chart screenshot</p>
                  <p className="text-xs text-[#8A95A5]">PNG, JPG up to 5MB</p>
                </>
              )}
            </div>
            <input
              type="file"
              className="hidden"
              accept="image/png,image/jpeg,image/jpg"
              onChange={(e) => {
                const f = e.target.files?.[0] || null;
                setChartFile(f);
                setChartError('');
              }}
            />
          </label>

          {chartError && (
            <div className="rounded-xl p-4 text-sm font-bold flex items-center gap-2 bg-red-500/10 border border-red-500/30 text-red-400">
              <AlertTriangle className="w-4 h-4" />
              {chartError}
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              onClick={analyzeChart}
              disabled={!chartFile || chartAnalyzing}
              className="flex-[2] flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-[#00E08A] hover:bg-[#00C278] text-[#0A0D12] font-black text-sm uppercase tracking-wider transition-all disabled:opacity-50"
            >
              {chartAnalyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {chartAnalyzing ? 'Analyzing...' : 'Analyze Chart'}
            </button>
            <button
              type="button"
              onClick={() => setActiveView('builder')}
              className="flex-1 flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-[#0D1017] hover:bg-white/5 border border-[#202735] text-[#8A95A5] hover:text-white font-bold text-sm transition-all"
            >
              <X className="w-4 h-4" />
              Back to Manual Builder
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 bg-[#11141A] border border-[#202735] rounded-xl p-2 w-fit">
        <button
          type="button"
          onClick={() => setActiveView('builder')}
          className={cn(
            'px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all',
            activeView === 'builder' ? 'bg-[#00E08A]/10 text-[#00E08A] border border-[#00E08A]/20' : 'text-[#8A95A5] hover:text-white'
          )}
        >
          Builder
        </button>
        <button
          type="button"
          onClick={() => setActiveView('analyzer')}
          className={cn(
            'px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all',
            activeView === 'analyzer' ? 'bg-[#00E08A]/10 text-[#00E08A] border border-[#00E08A]/20' : 'text-[#8A95A5] hover:text-white'
          )}
        >
          Analyze Chart
        </button>
        <button
          type="button"
          onClick={() => setActiveView('history')}
          className={cn(
            'px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all',
            activeView === 'history' ? 'bg-[#00E08A]/10 text-[#00E08A] border border-[#00E08A]/20' : 'text-[#8A95A5] hover:text-white'
          )}
        >
          History
        </button>
      </div>
      {activeView === 'builder' && renderBuilder()}
      {activeView === 'analyzer' && renderChartAnalyzer()}
      {activeView === 'history' && renderHistory()}
    </div>
  );
}
