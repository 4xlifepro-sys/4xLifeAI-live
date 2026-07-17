import React, { useState, useRef, useEffect } from 'react';
import { Upload, Scan, TrendingUp, TrendingDown, Minus, AlertTriangle, RotateCcw, Zap, Shield, Eye } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Link } from 'react-router-dom';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface AnalysisResult {
  instrument: string;
  timeframe: string;
  trend: string;
  marketStructure: string;
  support: string;
  resistance: string;
  trade: string;
  entry: string;
  stopLoss: string;
  tp1: string;
  tp2: string;
  tp3: string;
  riskReward: string;
  confidence: number;
  reasoning: string;
  warnings: string;
}

const ANALYSIS_STEPS = [
  'Detecting instrument & timeframe...',
  'Analyzing market structure...',
  'Identifying support & resistance...',
  'Evaluating momentum...',
  'Calculating risk levels...',
  'Generating trade setup...',
  'Finalizing analysis...'
];

export default function ChartAnalyzer() {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string>('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisStep, setAnalysisStep] = useState(0);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string>('');
  const [usage, setUsage] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const savedUsage = localStorage.getItem('4xlifeai_chart_usage');
    const savedDate = localStorage.getItem('4xlifeai_chart_date');
    const today = new Date().toDateString();
    if (savedDate !== today) {
      localStorage.setItem('4xlifeai_chart_date', today);
      localStorage.setItem('4xlifeai_chart_usage', '0');
      setUsage(0);
    } else if (savedUsage) {
      setUsage(parseInt(savedUsage, 10));
    }
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
    reader.onload = (e) => setSelectedImage(e.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent) => { e.preventDefault(); const file = e.dataTransfer.files?.[0]; if (file) processFile(file); };
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); };

  const handleAnalyze = async () => {
    if (!selectedImage) return;
    if (usage >= 3) { setError('Daily limit reached (3/3). Upgrade to Pro for unlimited chart analyses.'); return; }
    setIsAnalyzing(true); setAnalysisStep(0); setResult(null); setError('');
    try {
      let res = await fetch('/api/chart-analyzer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageBase64: selectedImage }) });
      
      // Auto-retry once on 503 (Gemini high demand — temporary)
      if (res.status === 503) {
        setAnalysisStep(analysisStep); // keep spinner going
        await new Promise(r => setTimeout(r, 3000)); // wait 3 seconds
        res = await fetch('/api/chart-analyzer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageBase64: selectedImage }) });
      }
      
      const data = await res.json();
      if (data.success) {
        setResult(data.analysis);
        const newUsage = usage + 1; setUsage(newUsage);
        localStorage.setItem('4xlifeai_chart_usage', newUsage.toString());
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
      default: return { label: 'WAIT', bg: 'bg-amber-500/20', text: 'text-amber-400', border: 'border-amber-500/30', icon: Minus };
    }
  };

  const getConfidenceColor = (c: number) => c >= 85 ? 'text-emerald-400' : c >= 70 ? 'text-teal-400' : c >= 50 ? 'text-amber-400' : 'text-red-400';
  const getConfidenceBg = (c: number) => c >= 85 ? 'bg-emerald-500' : c >= 70 ? 'bg-teal-500' : c >= 50 ? 'bg-amber-500' : 'bg-red-500';
  const getConfidenceLabel = (c: number) => c >= 95 ? 'Exceptional' : c >= 85 ? 'Very Strong' : c >= 70 ? 'Strong' : c >= 50 ? 'Moderate' : 'Weak';
  const getTrendIcon = (trend: string) => {
    switch (trend.toLowerCase()) { case 'bullish': return { icon: TrendingUp, color: 'text-emerald-400' }; case 'bearish': return { icon: TrendingDown, color: 'text-red-400' }; default: return { icon: Minus, color: 'text-amber-400' }; }
  };

  return (
    <div className="flex-1 w-full bg-[#0A0D12] min-h-screen">
      <div className="bg-gradient-to-b from-[#11141A] to-[#0A0D12] border-b border-[#202735] py-8 px-4">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center gap-4 mb-3">
            <div className="w-14 h-14 bg-gradient-to-br from-amber-500/20 to-orange-500/20 border border-amber-500/30 rounded-2xl flex items-center justify-center shadow-[0_0_25px_rgba(245,158,11,0.2)]">
              <Scan className="w-7 h-7 text-amber-400" />
            </div>
            <div>
              <h1 className="text-2xl font-black text-white flex items-center gap-2">Golden Scanning System <span className="text-amber-400 text-lg"></span></h1>
              <p className="text-sm text-[#8A95A5] mt-0.5">AI-powered institutional chart analysis</p>
            </div>
          </div>
          <div className="flex items-center gap-4 text-xs mt-4">
            <span className="flex items-center gap-1.5 text-teal-400 font-medium bg-teal-400/10 px-2 py-0.5 rounded border border-teal-400/20"><span className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse"></span> Gemini 2.5 Flash Active</span>
            <span className="text-[#5D6B80]">•</span>
            <span className="text-[#8A95A5]">Usage: {usage}/3 Free</span>
            <span className="text-[#5D6B80]">•</span>
            <Link to="/plans" className="text-amber-400 hover:text-amber-300 font-medium">Upgrade to Pro → Unlimited</Link>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">
        <div ref={null as any} onDrop={handleDrop} onDragOver={handleDragOver} className={cn("border-2 border-dashed rounded-2xl p-10 text-center transition-all cursor-pointer", selectedImage ? "border-teal-500/30 bg-teal-500/5" : "border-[#202735] bg-[#11141A]/50 hover:border-amber-500/30 hover:bg-amber-500/5")} onClick={() => fileInputRef.current?.click()}>
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageSelect} className="hidden" />
          {selectedImage ? (
            <div className="space-y-4">
              <img src={selectedImage} alt="Selected chart" className="max-h-72 mx-auto rounded-xl border border-[#202735] shadow-2xl" />
              <p className="text-sm text-[#8A95A5]">{selectedFileName}</p>
              <p className="text-xs text-[#5D6B80]">Click or drop to replace</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="w-20 h-20 mx-auto bg-amber-500/10 border border-amber-500/20 rounded-2xl flex items-center justify-center"><Upload className="w-10 h-10 text-amber-400" /></div>
              <div>
                <p className="text-lg font-bold text-white">Drop your chart screenshot here</p>
                <p className="text-sm text-[#8A95A5] mt-1">or click to browse files</p>
                <p className="text-xs text-[#5D6B80] mt-3">Supports PNG, JPG, JPEG • Max 10MB</p>
              </div>
            </div>
          )}
        </div>

        {error && (<div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex items-start gap-3"><AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" /><p className="text-sm text-red-400">{error}</p></div>)}

        <div className="flex items-center gap-3">
          <button onClick={handleAnalyze} disabled={!selectedImage || isAnalyzing || usage >= 3} className={cn("flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl font-bold text-sm tracking-wide transition-all", !selectedImage || isAnalyzing || usage >= 3 ? "bg-[#202735] text-[#5D6B80] cursor-not-allowed" : "bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-black shadow-[0_0_25px_rgba(245,158,11,0.3)]")}>
            {isAnalyzing ? (<><Scan className="w-5 h-5 animate-spin" /> Analyzing...</>) : (<><Zap className="w-5 h-5" /> Analyze Chart</>)}
          </button>
          <button onClick={handleReset} className="px-5 py-3.5 bg-[#202735] hover:bg-[#202735]/80 text-[#8A95A5] hover:text-white rounded-xl transition-all" title="Reset"><RotateCcw className="w-5 h-5" /></button>
        </div>

        {isAnalyzing && (
          <div className="bg-[#11141A] border border-[#202735] rounded-2xl p-8 text-center space-y-6">
            <div className="relative w-20 h-20 mx-auto">
              <div className="absolute inset-0 rounded-full border-4 border-[#202735]"></div>
              <div className="absolute inset-0 rounded-full border-4 border-amber-500 border-t-transparent animate-spin"></div>
              <div className="absolute inset-2 rounded-full border-4 border-orange-500 border-b-transparent animate-spin" style={{ animationDirection: 'reverse', animationDuration: '1.5s' }}></div>
              <Scan className="absolute inset-0 m-auto w-7 h-7 text-amber-400" />
            </div>
            <div>
              <p className="text-white font-bold text-lg">Golden Scanning in Progress</p>
              <p className="text-amber-400 text-sm mt-2 font-medium">{ANALYSIS_STEPS[analysisStep]}</p>
            </div>
            <div className="w-full bg-[#202735] rounded-full h-1.5 max-w-md mx-auto overflow-hidden">
              <div className="h-full bg-gradient-to-r from-amber-500 to-orange-500 rounded-full transition-all duration-1000" style={{ width: `${((analysisStep + 1) / ANALYSIS_STEPS.length) * 100}%` }}></div>
            </div>
          </div>
        )}

        {result && !isAnalyzing && (
          <div ref={resultRef} className="space-y-6">
            <div className={cn("rounded-2xl p-6 border-2 flex items-center justify-between flex-wrap gap-4", getTradeBadge(result.trade).bg, getTradeBadge(result.trade).border)}>
              <div className="flex items-center gap-4">
                {(() => { const BadgeIcon = getTradeBadge(result.trade).icon; return <BadgeIcon className={cn("w-10 h-10", getTradeBadge(result.trade).text)} />; })()}
                <div>
                  <p className="text-xs font-medium uppercase tracking-widest opacity-70">Trade Decision</p>
                  <p className={cn("text-3xl font-black", getTradeBadge(result.trade).text)}>{getTradeBadge(result.trade).label}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xs font-medium uppercase tracking-widest opacity-70">Confidence</p>
                <p className={cn("text-3xl font-black", getConfidenceColor(result.confidence))}>{result.confidence}%</p>
                <p className={cn("text-xs font-medium", getConfidenceColor(result.confidence))}>{getConfidenceLabel(result.confidence)}</p>
              </div>
            </div>

            <div className="w-full bg-[#202735] rounded-full h-2 overflow-hidden">
              <div className={cn("h-full rounded-full transition-all duration-1000", getConfidenceBg(result.confidence))} style={{ width: `${result.confidence}%` }}></div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                { label: 'Instrument', value: result.instrument },
                { label: 'Timeframe', value: result.timeframe },
                { label: 'Trend', value: result.trend },
              ].map((item) => (
                <div key={item.label} className="bg-[#11141A] border border-[#202735] rounded-xl p-4">
                  <p className="text-xs font-medium uppercase tracking-widest text-[#5D6B80] mb-1">{item.label}</p>
                  <p className="text-lg font-bold text-white">{item.value}</p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-[#11141A] border border-[#202735] rounded-xl p-4">
                <p className="text-xs font-medium uppercase tracking-widest text-[#5D6B80] mb-1">Market Structure</p>
                <p className="text-sm text-[#E0E4EA]">{result.marketStructure}</p>
              </div>
              <div className="bg-[#11141A] border border-[#202735] rounded-xl p-4">
                <p className="text-xs font-medium uppercase tracking-widest text-[#5D6B80] mb-1">Support / Resistance</p>
                <p className="text-sm text-[#E0E4EA]">{result.support} / {result.resistance}</p>
              </div>
            </div>

            <div className="bg-[#11141A] border border-[#202735] rounded-2xl p-6 space-y-5">
              <div className="flex items-center gap-3">
                <Shield className="w-5 h-5 text-amber-400" />
                <h2 className="text-lg font-bold text-white">Trade Levels</h2>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {[
                  { label: 'Entry', value: result.entry, color: 'text-white' },
                  { label: 'Stop Loss', value: result.stopLoss, color: 'text-red-400' },
                  { label: 'TP1', value: result.tp1, color: 'text-emerald-400' },
                  { label: 'TP2', value: result.tp2, color: 'text-emerald-400' },
                  { label: 'TP3', value: result.tp3, color: 'text-emerald-400' },
                ].map((level) => (
                  <div key={level.label} className="bg-[#0A0D12] border border-[#202735] rounded-xl p-3 text-center">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-[#5D6B80] mb-1">{level.label}</p>
                    <p className={cn("text-sm font-bold", level.color)}>{level.value}</p>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between pt-3 border-t border-[#202735]">
                <div>
                  <p className="text-xs text-[#5D6B80]">Risk : Reward</p>
                  <p className="text-lg font-bold text-teal-400">{result.riskReward}</p>
                </div>
              </div>
            </div>

            <div className="bg-[#11141A] border border-[#202735] rounded-2xl p-6 space-y-4">
              <h2 className="text-lg font-bold text-white">Reasoning</h2>
              <p className="text-sm text-[#C0C8D4] leading-relaxed">{result.reasoning}</p>
              {result.warnings && result.warnings !== 'None' && result.warnings !== '' && (
                <div className="flex items-start gap-3 bg-amber-500/10 border border-amber-500/20 rounded-xl p-4">
                  <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-bold text-amber-400">Warnings</p>
                    <p className="text-sm text-amber-300/80">{result.warnings}</p>
                  </div>
                </div>
              )}
            </div>

            <div className="bg-gradient-to-br from-amber-500/5 to-orange-500/5 border border-amber-500/20 rounded-2xl p-6 space-y-5">
              <div className="flex items-center gap-3">
                <Zap className="w-5 h-5 text-amber-400" />
                <h2 className="text-lg font-bold text-white">Position Size Calculator</h2>
              </div>
              <div className="bg-[#0A0D12] border border-[#202735] rounded-xl p-4 text-center">
                <p className="text-xs text-[#5D6B80]">Risk Amount = 1% of $1,000</p>
                <p className="text-2xl font-black text-amber-400">$20.00</p>
              </div>
              <p className="text-xs text-[#5D6B80] text-center">This is the maximum you should lose on this single trade if your Stop Loss is hit.</p>
            </div>

            <div className="bg-[#11141A] border border-[#202735] rounded-xl p-4 text-center">
              <p className="text-[10px] text-[#5D6B80] font-mono uppercase tracking-widest">
                4xLifeAI Chart Analyzer is for educational and informational purposes only. All trading involves risk. Past performance does not guarantee future results. Always use proper risk management.
              </p>
            </div>
          </div>
        )}

        {!result && !isAnalyzing && (
          <div className="bg-[#11141A] border border-[#202735] rounded-2xl p-10 text-center space-y-4">
            <Eye className="w-12 h-12 text-[#202735] mx-auto" />
            <p className="text-[#5D6B80] text-sm">Upload a chart to get a full institutional-grade analysis</p>
          </div>
        )}
      </div>
    </div>
  );
}
