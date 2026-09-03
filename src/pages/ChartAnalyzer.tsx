import React, { useState, useRef, useEffect } from 'react';
import { Upload, Scan, TrendingUp, TrendingDown, Minus, AlertTriangle, RotateCcw, Zap, Shield, Sparkles, Newspaper } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface AnalysisResult {
  instrument: string;
  timeframe: string;
  currentPrice?: string;
  chartQuality?: string;
  trend: string;
  marketStructure: string;
  technicalBias?: string;
  support: string;
  resistance: string;
  priceAction?: string;
  indicators?: string[];
  trade: string;
  signal?: string;
  entry: string;
  sl?: string;
  stopLoss: string;
  stopLossBasis?: string;
  stopLossQuality?: string;
  tp1: string;
  tp2: string;
  tp3: string;
  riskReward: string | { tp1: string; tp2: string; tp3: string };
  confidence: number;
  reasoning: string;
  analysisError?: boolean;
  warnings: string;
  newsImpact?: string;
  newsBias?: string;
  newsSummary?: string;
  newsRisk?: string;
  chartDecision?: string;
  newsDecision?: string;
  finalDecision?: string;
  decisionSummary?: string;
  affectedCurrency?: string;
  importantEvent?: string;
  eventStatus?: string;
  actual?: string;
  forecast?: string;
  previous?: string;
  bigMoveRisk?: string;
  fundamentalBias?: string;
  alignment?: string;
  signalSource?: string;
  newsSource?: string;
  newsStatus?: string;
  mainReasons?: string[];
  conflictingSignals?: string;
  invalidation?: string;
  mainRisk?: string;
  newsSources?: Array<{ title: string; url: string }>;
  newsGrounded?: boolean;
  newsCheckedAt?: string;
  volatilityRisk?: string;
  pairRelevance?: string;
  bullishScenario?: string;
  bearishScenario?: string;
  tradingAction?: string;
  eventTiming?: string;
  newsBlockReason?: string;
}

const ANALYSIS_STEPS = [
  'Scanning chart for patterns...',
  'Analyzing price action & structure...',
  'Identifying support & resistance zones...',
  'Evaluating momentum indicators...',
  'Calculating optimal risk levels...',
  'Generating professional trade setup...',
  'Finalizing institutional-grade analysis...'
];

export default function ChartAnalyzer() {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string>('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisStep, setAnalysisStep] = useState(0);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string>('');
  const [usage, setUsage] = useState(0);
  const [isPro, setIsPro] = useState(false);
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const checkUserStatus = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        
        if (user?.email) {
          const { data: sessionData } = await supabase.auth.getSession();
          const accessToken = sessionData.session?.access_token;
          if (accessToken) {
            const subscriptionRes = await fetch('/api/auth/subscription', {
              headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            if (subscriptionRes.ok) {
              const subscription = await subscriptionRes.json();
              setIsPro(subscription?.isPro === true);
            }
          }

          const usageKey = `4xlifeai_usage_${user.email}`;
          const dateKey = `4xlifeai_date_${user.email}`;
          
          const savedUsage = localStorage.getItem(usageKey);
          const savedDate = localStorage.getItem(dateKey);
          const today = new Date().toDateString();

          if (savedDate !== today) {
            localStorage.setItem(dateKey, today);
            localStorage.setItem(usageKey, '0');
            setUsage(0);
          } else if (savedUsage) {
            setUsage(parseInt(savedUsage, 10));
          }
        }
      } catch (e) {
        console.error('Failed to check status:', e);
      }
    };
    
    checkUserStatus();
  }, []);

  useEffect(() => {
    if (isAnalyzing) {
      const interval = setInterval(() => {
        setAnalysisStep(prev => {
          if (prev >= ANALYSIS_STEPS.length - 1) { clearInterval(interval); return prev; }
          return prev + 1;
        });
      }, 1200);
      return () => clearInterval(interval);
    }
  }, [isAnalyzing]);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const processFile = (file: File) => {
    if (!file.type.startsWith('image/')) { setError('Please upload an image file (PNG, JPG, JPEG)'); return; }
    if (file.size > 10 * 1024 * 1024) { setError('Image must be under 10MB'); return; }
    setError(''); setResult(null); setSelectedFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const source = e.target?.result as string;
      const image = new Image();
      image.onload = () => {
        const maxDimension = 1600;
        const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext('2d');
        if (!context) {
          setSelectedImage(source);
          return;
        }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        setSelectedImage(canvas.toDataURL('image/jpeg', 0.82));
      };
      image.onerror = () => setSelectedImage(source);
      image.src = source;
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent) => { e.preventDefault(); const file = e.dataTransfer.files?.[0]; if (file) processFile(file); };
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); };

  const handleAnalyze = async () => {
    if (!selectedImage) return;
    if (isPro) {
      if (usage >= 30) { setError('Daily Pro limit reached (30/30). Reset at UTC 00:00.'); return; }
    } else {
      if (usage >= 4) { setError('Daily free limit reached (4/4). Upgrade to Pro for 30 daily analyses!'); return; }
    }
    setIsAnalyzing(true); setAnalysisStep(0); setResult(null); setError('');
    try {
      const session = await supabase.auth.getSession();
      const accessToken = session.data.session?.access_token;
      const res = await fetch('/api/chart-analyzer', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
        },
        body: JSON.stringify({
          imageBase64: selectedImage,
        })
      });
      
      const data = await res.json();
      const returnedAnalysis = data.analysis;
      const isStaleFallback = returnedAnalysis?.analysisError === true ||
        (Number(returnedAnalysis?.confidence) === 0 &&
          String(returnedAnalysis?.instrument || '').toLowerCase().includes('not visible') &&
          String(returnedAnalysis?.marketStructure || '').toLowerCase().includes('could not be verified'));
      if (data.success && returnedAnalysis && !isStaleFallback) {
        setResult(returnedAnalysis);
        const newUsage = usage + 1; 
        setUsage(newUsage);
        
        const { data: { user } } = await supabase.auth.getUser();
        if (user?.email) {
          localStorage.setItem(`4xlifeai_usage_${user.email}`, newUsage.toString());
        }
        
        setTimeout(() => { resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 300);
      } else {
        const errMsg = data.error || 'The chart analysis response was invalid. Please try again.';
        if (errMsg.includes('high demand') || errMsg.includes('UNAVAILABLE') || errMsg.includes('429')) {
          setError('The AI is temporarily busy. Please wait 30 seconds and try again.');
        } else {
          setError(errMsg || 'Failed to analyze chart. Please try again.');
        }
      }
    } catch (e: any) { setError('Network error. Please check your connection and try again.'); }
    finally { setIsAnalyzing(false); }
  };

  const handleReset = () => { setSelectedImage(null); setSelectedFileName(''); setResult(null); setError(''); setAnalysisStep(0); if (fileInputRef.current) fileInputRef.current.value = ''; };

  const getTradeBadge = (trade: string) => {
    switch (trade.toUpperCase()) {
      case 'BUY': return { label: 'BUY', bg: 'bg-emerald-500/20', text: 'text-emerald-400', border: 'border-emerald-500/30', icon: TrendingUp };
      case 'SELL': return { label: 'SELL', bg: 'bg-red-500/20', text: 'text-red-400', border: 'border-red-500/30', icon: TrendingDown };
      default: return { label: 'WAIT', bg: 'bg-blue-500/20', text: 'text-blue-300', border: 'border-blue-500/30', icon: Minus };
    }
  };

  const getTrendColor = (trend: string) => {
    const upper = trend.toUpperCase();
    if (upper.includes('BULL')) return 'text-emerald-400';
    if (upper.includes('BEAR')) return 'text-red-400';
    return 'text-blue-400';
  };

  const getConfidenceColor = (c: number) => c >= 85 ? 'text-emerald-400' : c >= 70 ? 'text-cyan-400' : c >= 50 ? 'text-blue-400' : 'text-red-400';
  const getConfidenceBg = (c: number) => c >= 85 ? 'bg-emerald-500' : c >= 70 ? 'bg-cyan-500' : c >= 50 ? 'bg-blue-500' : 'bg-red-500';
  const getConfidenceLabel = (c: number) => c >= 95 ? 'Exceptional' : c >= 85 ? 'Very Strong' : c >= 70 ? 'Strong' : c >= 50 ? 'Moderate' : 'Weak';

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedValue(text);
      setTimeout(() => setCopiedValue(null), 2000);
    });
  };

  const notProvided = 'Not visible / not provided';
  const normalizeDecision = (value: unknown): 'BUY' | 'SELL' | 'WAIT' => {
    const decision = String(value || '').toUpperCase();
    return decision === 'BUY' || decision === 'SELL' ? decision : 'WAIT';
  };
  const customerNewsValue = (value: unknown, fallback = notProvided) => {
    const text = String(value || '').trim();
    return text && !['UNKNOWN', 'UNVERIFIED'].includes(text.toUpperCase()) ? text : fallback;
  };
  const displayDecision = normalizeDecision(result?.finalDecision || result?.signal || result?.trade);
  const analysisReasoning = result?.reasoning || 'Not visible / not provided';
  const chartDirection = normalizeDecision(result?.chartDecision || result?.trade);
  const hasNews = Boolean(
    result && [result.importantEvent, result.newsSummary, result.affectedCurrency, result.actual, result.forecast]
      .some((v) => {
        const t = String(v || '').trim();
        return t && t !== notProvided && !['UNKNOWN', 'UNVERIFIED'].includes(t.toUpperCase());
      })
  );
  const plainReason = (() => {
    if (!result) return '';
    if (result.decisionSummary) return result.decisionSummary;
    if (result.mainReasons && result.mainReasons.length > 0) return result.mainReasons[0];
    return result.reasoning || '';
  })();
  const whatToDo = displayDecision === 'BUY'
    ? 'You may look for a BUY entry at the price below. Always use the Stop Loss shown.'
    : displayDecision === 'SELL'
      ? 'You may look for a SELL entry at the price below. Always use the Stop Loss shown.'
      : 'Do not open a trade now. Wait for a clearer setup and scan again later.';

  return (
    <div className="flex-1 w-full min-w-0 overflow-x-hidden bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 min-h-screen">
      {/* Premium Gradient Background */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 right-1/3 w-96 h-96 bg-cyan-500/20 rounded-full blur-3xl opacity-20"></div>
        <div className="absolute bottom-1/3 left-1/4 w-80 h-80 bg-blue-500/20 rounded-full blur-3xl opacity-20"></div>
      </div>

      {/* Header — compact */}
      <div className="relative bg-gradient-to-b from-slate-800/80 to-slate-900/40 border-b border-cyan-500/20 backdrop-blur-md py-3 px-4 sticky top-0 z-40">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-cyan-400/30 to-blue-500/30 border border-cyan-400/50 rounded-xl flex items-center justify-center shadow-[0_0_20px_rgba(34,211,238,0.25)]">
              <Sparkles className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <h1 className="text-lg font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-400 leading-tight">
                Chart Scanner
              </h1>
              <p className="text-[11px] text-slate-500 leading-tight">AI price-action analysis</p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs flex-wrap">
            <span className="flex items-center gap-1.5 text-cyan-400 font-semibold bg-cyan-500/10 px-2.5 py-1 rounded-lg border border-cyan-400/30">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse"></span> Live
            </span>
            <span className="text-slate-400 font-medium">{isPro ? `${usage}/30 Pro` : `${usage}/4 Free`}</span>
            {!isPro && (
              <Link to="/plans" className="text-cyan-400 hover:text-cyan-300 font-semibold transition-colors">
                Upgrade ✨
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="relative max-w-6xl mx-auto px-4 py-5 space-y-4">
        {/* Upload Area */}
        <div 
          onDrop={handleDrop} 
          onDragOver={handleDragOver} 
          className={cn(
            "border-2 border-dashed rounded-3xl text-center transition-all cursor-pointer backdrop-blur-sm",
            result ? "p-4" : "p-12",
            selectedImage 
              ? "border-cyan-400/50 bg-cyan-500/10 shadow-[0_0_30px_rgba(34,211,238,0.2)]" 
              : "border-blue-500/30 bg-blue-500/5 hover:border-cyan-400/40 hover:bg-cyan-500/8 hover:shadow-[0_0_25px_rgba(34,211,238,0.15)]"
          )} 
          onClick={() => fileInputRef.current?.click()}
        >
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageSelect} className="hidden" />
          {selectedImage ? (
            result ? (
              <div className="flex items-center justify-center gap-2 text-slate-400">
                <Upload className="w-4 h-4 text-cyan-400" />
                <span className="text-sm font-medium">Analyze another chart</span>
              </div>
            ) : (
              <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <img src={selectedImage} alt="Selected chart" className="max-h-96 max-w-full h-auto mx-auto rounded-2xl border border-cyan-400/30 shadow-2xl" />
                <p className="text-sm text-slate-400 font-medium">{selectedFileName}</p>
                <p className="text-xs text-slate-600">Click or drop to replace</p>
              </div>
            )
          ) : (
            <div className="space-y-4">
              <div className="w-20 h-20 mx-auto bg-gradient-to-br from-cyan-500/20 to-blue-500/20 border border-cyan-400/40 rounded-2xl flex items-center justify-center">
                <Upload className="w-10 h-10 text-cyan-400" />
              </div>
              <div>
                <p className="text-lg font-bold text-white">Drop your trading chart here</p>
                <p className="text-sm text-slate-400 mt-1">or click to select a file</p>
                <p className="text-xs text-slate-600 mt-3">PNG, JPG, JPEG • Max 10MB • TradingView, MT4, MT5 supported</p>
              </div>
            </div>
          )}
        </div>

        {/* Error Alert */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-4 flex items-start gap-3 backdrop-blur-sm">
            <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <p className="text-sm text-red-300">{error}</p>
          </div>
        )}

        {/* Daily Limit Warning */}
        {usage >= 4 && !isPro && !error && !result && (
          <div className="bg-gradient-to-r from-blue-500/10 to-cyan-500/10 border border-blue-500/30 rounded-2xl p-6 text-center backdrop-blur-sm">
            <Shield className="w-6 h-6 text-cyan-400 mx-auto mb-3" />
            <h3 className="text-lg font-bold text-cyan-300 mb-2">Daily Analysis Limit Reached</h3>
            <p className="text-sm text-slate-400 mb-4">Upgrade to Pro for 30 daily analyses and priority support.</p>
            <Link to="/plans" className="inline-flex items-center gap-2 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-400 hover:to-blue-400 text-white font-bold px-6 py-2.5 rounded-xl text-sm transition-all shadow-lg hover:shadow-xl">
              <Zap className="w-4 h-4" />
              Upgrade to Pro
            </Link>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center gap-3">
          <button 
            onClick={handleAnalyze} 
            disabled={!selectedImage || isAnalyzing || (isPro ? usage >= 30 : usage >= 4)} 
            className={cn(
              "flex-1 flex items-center justify-center gap-2 py-4 rounded-xl font-bold text-sm tracking-wide transition-all",
              !selectedImage || isAnalyzing || (isPro ? usage >= 30 : usage >= 4) 
                ? "bg-slate-700 text-slate-500 cursor-not-allowed" 
                : "bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-400 hover:to-blue-400 text-white shadow-[0_0_30px_rgba(34,211,238,0.4)] hover:shadow-[0_0_40px_rgba(34,211,238,0.5)]"
            )}
          >
            {isAnalyzing ? (
              <><Scan className="w-5 h-5 animate-spin" /> Analyzing Chart...</>
            ) : (
              <><Sparkles className="w-5 h-5" /> Analyze Now</>
            )}
          </button>
          <button 
            onClick={handleReset} 
            className="px-6 py-4 bg-slate-700/60 hover:bg-slate-600 text-slate-300 hover:text-white rounded-xl transition-all border border-slate-600/50" 
            title="Reset"
          >
            <RotateCcw className="w-5 h-5" />
          </button>
        </div>

        {/* Analyzing State */}
        {isAnalyzing && (
          <div className="bg-slate-800/60 border border-cyan-500/20 rounded-3xl p-12 text-center space-y-8 backdrop-blur-sm">
            <div className="relative w-24 h-24 mx-auto">
              <div className="absolute inset-0 rounded-full border-4 border-slate-700"></div>
              <div className="absolute inset-0 rounded-full border-4 border-cyan-400 border-t-transparent animate-spin shadow-[0_0_20px_rgba(34,211,238,0.5)]"></div>
              <div className="absolute inset-2 rounded-full border-4 border-blue-500 border-b-transparent animate-spin" style={{ animationDirection: 'reverse', animationDuration: '1.5s' }}></div>
              <Scan className="absolute inset-0 m-auto w-8 h-8 text-cyan-400" />
            </div>
            <div>
              <p className="text-white font-bold text-xl">Professional Analysis in Progress</p>
              <p className="text-cyan-300 text-sm mt-2 font-medium">{ANALYSIS_STEPS[analysisStep]}</p>
            </div>
            <div className="w-full bg-slate-700/50 rounded-full h-2 max-w-md mx-auto overflow-hidden">
              <div className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 rounded-full transition-all duration-1000 shadow-lg" style={{ width: `${((analysisStep + 1) / ANALYSIS_STEPS.length) * 100}%` }}></div>
            </div>
          </div>
        )}

        {/* Results */}
        {result && !isAnalyzing && (
          <div ref={resultRef} className="space-y-5">

            {/* SINGLE CLEAN SIGNAL CARD */}
            <div className="relative overflow-hidden rounded-2xl border border-slate-700/60 bg-slate-900/70 backdrop-blur-sm">
              <div className={cn("absolute left-0 top-0 bottom-0 w-1.5",
                displayDecision === 'BUY' ? 'bg-emerald-400' : displayDecision === 'SELL' ? 'bg-red-400' : 'bg-slate-500'
              )}></div>

              <div className="p-5 sm:p-6 space-y-5">
                {/* header: pair + direction + quality */}
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-3">
                    <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">{result.instrument || 'Signal'}</h2>
                    <span className={cn(
                      "px-2.5 py-1 rounded-md text-xs font-black uppercase tracking-wider border",
                      getTradeBadge(displayDecision).bg,
                      getTradeBadge(displayDecision).border,
                      getTradeBadge(displayDecision).text
                    )}>
                      {displayDecision === 'BUY' ? 'BUY / LONG' : displayDecision === 'SELL' ? 'SELL / SHORT' : 'WAIT'}
                    </span>
                  </div>
                  <span className={cn("text-xs font-bold uppercase tracking-wider", getConfidenceColor(result.confidence))}>
                    {result.confidence}% {getConfidenceLabel(result.confidence)}
                  </span>
                </div>

                {/* reason */}
                {plainReason && (
                  <p className="text-sm text-slate-300 leading-relaxed">{plainReason}</p>
                )}

                {/* price boxes OR wait */}
                {displayDecision !== 'WAIT' ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {[
                      { label: 'Entry Price', value: result.entry || notProvided, color: 'text-white' },
                      { label: 'Stop Loss', value: result.stopLoss || notProvided, color: 'text-red-400' },
                      { label: 'TP1 Target', value: result.tp1 || notProvided, color: 'text-emerald-400' },
                      { label: 'TP2 Target', value: result.tp2 || notProvided, color: 'text-emerald-400' },
                      { label: 'TP3 Target', value: result.tp3 || notProvided, color: 'text-emerald-400' },
                    ].map((box) => (
                      <button
                        key={box.label}
                        onClick={() => copyToClipboard(String(box.value))}
                        className="relative text-left rounded-xl border border-slate-700/50 bg-slate-800/40 p-4 transition-colors hover:border-cyan-400/40 hover:bg-slate-800/70 group"
                        title={`Click to copy ${box.label}`}
                      >
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">{box.label}</p>
                        <p className={cn("text-lg font-black font-mono tabular-nums", box.color)}>{String(box.value)}</p>
                        <span className="absolute top-3 right-3 text-xs text-slate-600 group-hover:text-cyan-400 transition-colors">
                          {copiedValue === box.value ? '✓' : '⧉'}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
                    <p className="text-sm font-bold text-amber-300">No trade now — wait for a clearer setup and scan again later.</p>
                  </div>
                )}

                <p className="text-[11px] text-slate-500">Not financial advice · trade at your own risk · risk max 1% per trade.</p>
              </div>
            </div>
          </div>
        )}

        {/* Empty State */}
        {!result && !isAnalyzing && (
          <div className="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-12 text-center space-y-4 backdrop-blur-sm">
            <Scan className="w-16 h-16 text-slate-600 mx-auto opacity-50" />
            <p className="text-slate-400 text-sm font-medium">Upload a chart to receive professional, institutional-grade trading analysis</p>
            <p className="text-slate-600 text-xs">Supported: TradingView • MT4 • MT5 • CTrader • Any broker platform</p>
          </div>
        )}
      </div>
    </div>
  );
}
