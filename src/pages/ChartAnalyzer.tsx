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
  tp1: string;
  tp2: string;
  tp3: string;
  riskReward: string | { tp1: string; tp2: string; tp3: string };
  confidence: number;
  reasoning: string;
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
  mainReasons?: string[];
  conflictingSignals?: string;
  invalidation?: string;
  mainRisk?: string;
  newsSources?: Array<{ title: string; url: string }>;
  newsGrounded?: boolean;
  newsCheckedAt?: string;
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
      if (data.success) {
        setResult(data.analysis);
        const newUsage = usage + 1; 
        setUsage(newUsage);
        
        const { data: { user } } = await supabase.auth.getUser();
        if (user?.email) {
          localStorage.setItem(`4xlifeai_usage_${user.email}`, newUsage.toString());
        }
        
        setTimeout(() => { resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 300);
      } else {
        const errMsg = data.error || '';
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

  const displayDecision = String(result?.finalDecision || result?.signal || result?.trade || 'WAIT').toUpperCase();
  const riskRewardValues = result && typeof result.riskReward === 'object'
    ? result.riskReward
    : { tp1: result?.riskReward || 'Not visible / not provided', tp2: result?.riskReward || 'Not visible / not provided', tp3: result?.riskReward || 'Not visible / not provided' };
  const notProvided = 'Not visible / not provided';

  return (
    <div className="flex-1 w-full min-w-0 overflow-x-hidden bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 min-h-screen">
      {/* Premium Gradient Background */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 right-1/3 w-96 h-96 bg-cyan-500/20 rounded-full blur-3xl opacity-20"></div>
        <div className="absolute bottom-1/3 left-1/4 w-80 h-80 bg-blue-500/20 rounded-full blur-3xl opacity-20"></div>
      </div>

      {/* Header */}
      <div className="relative bg-gradient-to-b from-slate-800/80 to-slate-900/40 border-b border-cyan-500/20 backdrop-blur-md py-8 px-4 sticky top-0 z-40">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center gap-4 mb-3">
            <div className="w-14 h-14 bg-gradient-to-br from-cyan-400/30 to-blue-500/30 border border-cyan-400/50 rounded-2xl flex items-center justify-center shadow-[0_0_30px_rgba(34,211,238,0.3)]">
              <Sparkles className="w-7 h-7 text-cyan-400" />
            </div>
            <div>
              <h1 className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-400">
                Professional Chart Scanner
              </h1>
              <p className="text-sm text-slate-400 mt-0.5">Real-time institutional-grade price action analysis</p>
            </div>
          </div>
          <div className="flex items-center gap-4 text-xs mt-4 flex-wrap">
            <span className="flex items-center gap-1.5 text-cyan-400 font-semibold bg-cyan-500/10 px-3 py-1 rounded-lg border border-cyan-400/30">
              <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></span> 4xLifeAI Engine
            </span>
            <span className="text-slate-600">•</span>
            <span className="text-slate-400 font-medium">{isPro ? `${usage}/30 Pro Daily` : `${usage}/4 Free Daily`}</span>
            {!isPro && (
              <>
                <span className="text-slate-600">•</span>
                <Link to="/plans" className="text-cyan-400 hover:text-cyan-300 font-semibold transition-colors">
                  Upgrade Pro → 30 Daily ✨
                </Link>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="relative max-w-6xl mx-auto px-4 py-8 space-y-8">
        {/* Upload Area */}
        <div 
          onDrop={handleDrop} 
          onDragOver={handleDragOver} 
          className={cn(
            "border-2 border-dashed rounded-3xl p-12 text-center transition-all cursor-pointer backdrop-blur-sm",
            selectedImage 
              ? "border-cyan-400/50 bg-cyan-500/10 shadow-[0_0_30px_rgba(34,211,238,0.2)]" 
              : "border-blue-500/30 bg-blue-500/5 hover:border-cyan-400/40 hover:bg-cyan-500/8 hover:shadow-[0_0_25px_rgba(34,211,238,0.15)]"
          )} 
          onClick={() => fileInputRef.current?.click()}
        >
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageSelect} className="hidden" />
          {selectedImage ? (
            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <img src={selectedImage} alt="Selected chart" className="max-h-96 max-w-full h-auto mx-auto rounded-2xl border border-cyan-400/30 shadow-2xl" />
              <p className="text-sm text-slate-400 font-medium">{selectedFileName}</p>
              <p className="text-xs text-slate-600">Click or drop to replace</p>
            </div>
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
          <div ref={resultRef} className="space-y-6">
            {/* Trade Decision Card */}
            <div className={cn(
              "rounded-2xl p-8 border-2 flex items-center justify-between flex-wrap gap-6 backdrop-blur-sm",
              getTradeBadge(displayDecision).bg,
              getTradeBadge(displayDecision).border
            )}>
              <div className="flex items-center gap-4">
                {(() => { 
                  const BadgeIcon = getTradeBadge(displayDecision).icon;
                  return <BadgeIcon className={cn("w-12 h-12", getTradeBadge(displayDecision).text)} />;
                })()}
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Final Signal</p>
                  <p className={cn("text-4xl font-black", getTradeBadge(displayDecision).text)}>
                    {getTradeBadge(displayDecision).label}
                  </p>
                  <p className="text-sm text-slate-300 mt-2">
                    {displayDecision === 'BUY'
                      ? 'Possible buy setup — confirm your own risk plan.'
                      : displayDecision === 'SELL'
                        ? 'Possible sell setup — confirm your own risk plan.'
                        : 'No trade now — wait for the stated confirmation.'}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Confidence Score</p>
                <p className={cn("text-4xl font-black", getConfidenceColor(result.confidence))}>
                  {result.confidence}%
                </p>
                <p className={cn("text-xs font-semibold mt-1", getConfidenceColor(result.confidence))}>
                  {getConfidenceLabel(result.confidence)}
                </p>
              </div>
            </div>

            {/* Confidence Bar */}
            <div className="w-full bg-slate-700/50 rounded-full h-2.5 overflow-hidden border border-slate-600/50">
              <div className={cn("h-full rounded-full transition-all duration-1000 shadow-lg", getConfidenceBg(result.confidence))} style={{ width: `${result.confidence}%` }}></div>
            </div>

            {/* Quick Info Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                { label: 'Instrument', value: result.instrument, icon: '📊', color: 'text-cyan-300' },
                { label: 'Timeframe', value: result.timeframe, icon: '⏱️', color: 'text-cyan-300' },
                { label: 'Trend Direction', value: result.trend, icon: '📈', color: getTrendColor(result.trend) },
                { label: 'Technical Bias', value: result.technicalBias || 'Not visible / not provided', icon: '🧭', color: getTrendColor(result.technicalBias || '') },
                { label: 'Current Price', value: result.currentPrice || 'Not visible / not provided', icon: '💲', color: 'text-cyan-300' },
                { label: 'Chart Quality', value: result.chartQuality || 'Not visible / not provided', icon: '🔎', color: result.chartQuality?.toUpperCase() === 'SUFFICIENT' ? 'text-emerald-400' : 'text-amber-300' },
              ].map((item) => (
                <div key={item.label} className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4 backdrop-blur-sm hover:border-cyan-400/30 transition-colors">
                  <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">{item.label}</p>
                  <p className={cn("text-lg font-bold", item.color)}>{item.value}</p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-5 backdrop-blur-sm">
                <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-3">Price Action</p>
                <p className="text-sm text-slate-200 leading-relaxed">{result.priceAction || 'Not visible / not provided'}</p>
              </div>
              <div className="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-5 backdrop-blur-sm">
                <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-3">Visible Indicators</p>
                <p className="text-sm text-slate-200 leading-relaxed">
                  {result.indicators?.length ? result.indicators.join(' • ') : 'Not visible / not provided'}
                </p>
              </div>
            </div>

            <div className="bg-slate-800/60 border border-amber-500/30 rounded-2xl p-6 space-y-5 backdrop-blur-sm">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3">
                  <Newspaper className="w-5 h-5 text-amber-300" />
                  <div>
                    <h2 className="text-lg font-bold text-white">Economic Calendar Context</h2>
                    <p className="text-xs text-slate-500 mt-1">
                      Uses only data supplied by the application{result.newsCheckedAt ? ` • ${result.newsCheckedAt} UTC` : ''}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs uppercase tracking-wider text-slate-500">Impact</span>
                  <span className={cn(
                    "px-3 py-1 rounded-lg border text-xs font-bold",
                    result.newsImpact?.toUpperCase() === 'POSITIVE'
                      ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                      : result.newsImpact?.toUpperCase() === 'NEGATIVE'
                        ? 'bg-red-500/15 border-red-500/30 text-red-300'
                        : ['HIGH', 'EXTREME'].includes(result.newsImpact?.toUpperCase() || '')
                          ? 'bg-orange-500/15 border-orange-500/30 text-orange-300'
                        : 'bg-amber-500/15 border-amber-500/30 text-amber-300'
                  )}>
                    {result.newsImpact || 'UNKNOWN'}
                  </span>
                  <span className="px-3 py-1 rounded-lg border border-slate-600/50 bg-slate-700/40 text-xs font-bold text-slate-300">
                    {result.newsBias || 'UNKNOWN'} BIAS
                  </span>
                </div>
              </div>
                <p className="text-sm text-slate-200 leading-relaxed">
                {result.newsSummary || 'No economic-calendar data was supplied for this scan.'}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  { label: 'Affected Currency', value: result.affectedCurrency },
                  { label: 'Important Event', value: result.importantEvent },
                  { label: 'Event Status', value: result.eventStatus },
                  { label: 'Actual / Forecast / Previous', value: `${result.actual || 'Not provided'} / ${result.forecast || 'Not provided'} / ${result.previous || 'Not provided'}` },
                  { label: 'Big-Move Risk', value: result.bigMoveRisk },
                ].map((item) => (
                  <div key={item.label} className="rounded-xl border border-slate-700/50 bg-slate-900/40 p-3">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">{item.label}</p>
                    <p className="text-sm text-slate-200 break-words">{item.value || 'Not visible / not provided'}</p>
                  </div>
                ))}
              </div>
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4">
                <p className="text-xs font-bold uppercase tracking-wider text-amber-300 mb-1">News Risk</p>
                <p className="text-sm text-amber-100/80">{result.newsRisk || 'No calendar risk was supplied. Do not assume current news conditions.'}</p>
              </div>
            </div>

            <div className="bg-slate-800/60 border border-cyan-500/30 rounded-2xl p-6 space-y-5 backdrop-blur-sm">
              <div>
                <h2 className="text-lg font-bold text-white">Confluence Decision</h2>
                <p className="text-xs text-slate-500 mt-1">
                  Technical structure and supplied calendar data are checked together.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {[
                  { label: 'Chart Only', value: result.chartDecision || result.trade },
                  { label: 'News Filter', value: result.newsDecision || 'UNVERIFIED' },
                  { label: 'Final Decision', value: displayDecision },
                ].map((item) => (
                  <div key={item.label} className="rounded-xl border border-slate-700/50 bg-slate-900/40 p-4">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">{item.label}</p>
                    <p className={cn(
                      "text-sm font-black",
                      item.value?.toUpperCase().includes('BUY') ? 'text-emerald-400' :
                        item.value?.toUpperCase().includes('SELL') || item.value?.toUpperCase().includes('CONFLICT') ? 'text-red-400' :
                          'text-amber-300'
                    )}>
                      {item.value || 'WAIT'}
                    </p>
                  </div>
                ))}
              </div>
              <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 p-4">
                <p className="text-xs font-bold uppercase tracking-wider text-cyan-300 mb-1">Decision Summary</p>
                <p className="text-sm text-cyan-50/80">
                  {result.decisionSummary || 'The final decision combines chart structure and current news.'}
                </p>
              </div>
              {result.chartDecision?.toUpperCase() === 'WAIT' && (
                <p className="text-xs font-semibold text-blue-300">
                  The chart itself is WAIT because price is ranging or the setup is unclear.
                </p>
              )}
              {result.newsDecision?.toUpperCase() === 'UNVERIFIED' && (
                <p className="text-xs font-semibold text-amber-300">
                  No calendar data was supplied for this scan. The safe result is WAIT.
                </p>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {[
                  { label: 'Fundamental Bias', value: result.fundamentalBias },
                  { label: 'Alignment', value: result.alignment },
                  { label: 'Conflicting Signals', value: result.conflictingSignals },
                ].map((item) => (
                  <div key={item.label} className="rounded-xl border border-slate-700/50 bg-slate-900/40 p-4">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">{item.label}</p>
                    <p className="text-sm text-slate-200 break-words">{item.value || 'Not visible / not provided'}</p>
                  </div>
                ))}
              </div>
              {result.mainReasons && result.mainReasons.length > 0 && (
                <div className="rounded-xl border border-slate-700/50 bg-slate-900/40 p-4">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Main Reasons</p>
                  <ol className="list-decimal list-inside space-y-1 text-sm text-slate-200">
                    {result.mainReasons.slice(0, 3).map((reason, index) => (
                      <li key={`${index}-${reason}`}>{reason}</li>
                    ))}
                  </ol>
                </div>
              )}
            </div>

            {/* Market Structure & Support/Resistance */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-5 backdrop-blur-sm">
                <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-3">Market Structure</p>
                <p className="text-sm text-slate-200 leading-relaxed">{result.marketStructure}</p>
              </div>
              <div className="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-5 backdrop-blur-sm">
                <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-3">Support / Resistance Levels</p>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-slate-500">Support</p>
                    <p className="text-lg font-bold text-emerald-400 break-words">{result.support}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl text-slate-600">—</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-slate-500">Resistance</p>
                    <p className="text-lg font-bold text-red-400 break-words">{result.resistance}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Trade Levels */}
            <div className="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-6 space-y-5 backdrop-blur-sm">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <Shield className="w-5 h-5 text-cyan-400" />
                  <h2 className="text-lg font-bold text-white">Trade Levels</h2>
                </div>
                
                {/* ACTION BADGE - Shows BUY/SELL/WAIT prominently */}
                <div className={cn(
                  "px-6 py-3 rounded-xl font-bold text-lg flex items-center gap-2",
                  displayDecision === 'BUY'
                    ? 'bg-emerald-500/20 border border-emerald-500/50 text-emerald-400' 
                    : displayDecision === 'SELL'
                      ? 'bg-red-500/20 border border-red-500/50 text-red-400'
                      : 'bg-blue-500/20 border border-blue-500/50 text-blue-300'
                )}>
                  {displayDecision === 'BUY' && '↗️ BUY'}
                  {displayDecision === 'SELL' && '↘️ SELL'}
                  {displayDecision === 'WAIT' && '⏸️ WAIT'}
                </div>
              </div>

              {/* Use these prices to [BUY/SELL] */}
              <p className="text-xs text-slate-500 font-medium">
                {displayDecision === 'BUY' && '🔼 Possible BUY setup — confirm before entering'}
                {displayDecision === 'SELL' && '🔽 Possible SELL setup — confirm before entering'}
                {displayDecision === 'WAIT' && '⏸️ WAIT — do NOT trade until confirmation'}
              </p>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                {[
                  { label: 'Entry', value: result.entry || notProvided, color: 'text-white', bg: 'bg-slate-700/50' },
                  { label: 'Stop Loss', value: result.stopLoss || notProvided, color: 'text-red-400', bg: 'bg-red-500/10' },
                  { label: 'TP1', value: result.tp1 || notProvided, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
                  { label: 'TP2', value: result.tp2 || notProvided, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
                  { label: 'TP3', value: result.tp3 || notProvided, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
                ].map((level) => (
                  <button
                    key={level.label}
                    onClick={() => copyToClipboard(String(level.value))}
                    className={cn("border border-slate-600/50 rounded-xl p-3 text-center transition-all hover:border-cyan-400/50 hover:shadow-lg group relative", level.bg)}
                    title={`Click to copy ${level.label}`}
                  >
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">{level.label}</p>
                    <p className={cn("text-sm font-bold break-words", level.color)}>{String(level.value)}</p>
                    <div className="absolute -top-8 left-1/2 transform -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity text-xs bg-slate-700 text-cyan-300 px-2 py-1 rounded whitespace-nowrap pointer-events-none">
                      {copiedValue === level.value ? '✓ Copied!' : 'Click to copy'}
                    </div>
                  </button>
                ))}
              </div>
              <div className="flex items-center justify-between pt-4 border-t border-slate-700/50">
                <div>
                  <p className="text-xs text-slate-500 font-medium">Risk : Reward Ratio</p>
                  <div className="grid grid-cols-3 gap-2 mt-2">
                    {[
                      { label: 'TP1', value: riskRewardValues.tp1 },
                      { label: 'TP2', value: riskRewardValues.tp2 },
                      { label: 'TP3', value: riskRewardValues.tp3 },
                    ].map((target) => (
                      <div key={target.label} className="rounded-lg bg-slate-900/40 border border-slate-700/50 p-2">
                        <p className="text-[10px] uppercase tracking-wider text-slate-500">{target.label}</p>
                        <p className="text-sm font-bold text-cyan-400 break-words">{String(target.value)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Reasoning & Warnings */}
            <div className="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-6 space-y-5 backdrop-blur-sm">
              <h2 className="text-lg font-bold text-white">Analysis Reasoning</h2>
              <p className="text-sm text-slate-300 leading-relaxed">{result.reasoning}</p>
              {result.invalidation && (
                <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4">
                  <p className="text-xs font-bold uppercase tracking-wider text-red-300 mb-1">Invalidation</p>
                  <p className="text-sm text-red-100/80">{result.invalidation}</p>
                </div>
              )}
              {result.mainRisk && (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4">
                  <p className="text-xs font-bold uppercase tracking-wider text-amber-300 mb-1">Main Risk</p>
                  <p className="text-sm text-amber-100/80">{result.mainRisk}</p>
                </div>
              )}
              {result.warnings && result.warnings !== 'None' && result.warnings !== '' && (
                <div className="flex items-start gap-4 bg-blue-500/10 border border-blue-500/30 rounded-xl p-4 mt-4">
                  <AlertTriangle className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-bold text-blue-300">⚠️ Important Warnings</p>
                    <p className="text-sm text-blue-200/80 mt-1">{result.warnings}</p>
                  </div>
                </div>
              )}
            </div>

            {/* Position Size Calculator */}
            <div className="bg-gradient-to-br from-cyan-500/10 to-blue-500/10 border border-cyan-500/30 rounded-2xl p-6 space-y-5 backdrop-blur-sm">
              <div className="flex items-center gap-3">
                <Zap className="w-5 h-5 text-cyan-400" />
                <h2 className="text-lg font-bold text-white">Position Size Calculator</h2>
              </div>
              <div className="bg-slate-800/60 border border-cyan-500/20 rounded-xl p-6 text-center">
                <p className="text-xs text-slate-500 font-medium">Risk Amount = 1% of $1,000</p>
                <p className="text-3xl font-black text-cyan-400 mt-2">$10.00</p>
                <p className="text-xs text-slate-500 mt-2">Maximum loss if Stop Loss is hit</p>
              </div>
            </div>

            {/* Comprehensive Disclaimer & Market Warning */}
            <div className="space-y-4">
              {/* Kill Zone Warning */}
              <div className="bg-orange-500/15 border border-orange-500/40 rounded-xl p-5 space-y-3">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-orange-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-bold text-orange-300">⚡ High Volatility Kill Zone</p>
                    <p className="text-sm text-orange-200/80 mt-1">
                      🔴 <strong>London Session (08:00-17:00 UTC)</strong> & <strong>New York Session (13:00-22:00 UTC)</strong> experience extreme volatility and rapid price movements. 
                      Use TIGHTER stops and smaller positions during these windows. Many traders get stopped out in the kill zone — trade with caution.
                    </p>
                  </div>
                </div>
              </div>

              {/* Legal Disclaimer */}
              <div className="bg-slate-800/60 border border-slate-700/40 rounded-xl p-5 space-y-3">
                <p className="text-xs font-bold text-slate-300 uppercase tracking-wider">📋 Important Disclaimers</p>
                <div className="space-y-2 text-xs text-slate-400 leading-relaxed">
                  <p>
                    <strong>🚫 Not Financial Advice:</strong> 4xLifeAI Chart Analyzer is an educational tool only. Nothing here constitutes financial advice, investment advice, or a recommendation to buy/sell. Always consult a licensed financial advisor before trading.
                  </p>
                  <p>
                    <strong>📊 Probability, Not Certainty:</strong> All trading is based on <strong>probabilities, not predictions</strong>. No analysis tool (manual or AI) can predict exact market movements. Past performance does not guarantee future results.
                  </p>
                  <p>
                    <strong>⚠️ Full Risk Disclosure:</strong> Trading and investing involve substantial risk of loss, including potential loss of principal. You could lose your entire investment. Only trade what you can afford to lose.
                  </p>
                  <p>
                    <strong>💡 Recommended:</strong> For the BEST results, use <strong>4xFiveAI Automated Signal Engine</strong> (Dashboard → Today's Signals) which generates institutional-grade signals 24/7. Auto-signals outperform manual analysis.
                  </p>
                </div>
              </div>

              {/* Simple Footer Disclaimer */}
              <div className="bg-slate-800/40 border border-slate-700/30 rounded-xl p-4 text-center">
                <p className="text-[11px] text-slate-500 font-mono uppercase tracking-wider">
                  ⚠️ Chart Analysis Tool • Educational Purpose • Not Financial Advice • Trade at Your Own Risk
                </p>
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
