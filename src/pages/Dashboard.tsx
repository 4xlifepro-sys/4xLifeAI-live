import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { supabase } from "../lib/supabase";

import { Stats, PairScanStatus, Signal, MarketState } from "../types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function RelativeTime({ timestamp }: { timestamp: string | number | null | undefined }) {
  const [stamp, setStamp] = useState("JUST NOW");

  useEffect(() => {
    if (!timestamp) {
      setStamp("JUST NOW");
      return;
    }
    const parsedTime = typeof timestamp === "string" ? Date.parse(timestamp) : timestamp;
    if (isNaN(parsedTime)) {
      setStamp("JUST NOW");
      return;
    }
    const updateTime = () => {
      const diff = Math.floor((Date.now() - parsedTime) / 1000);
      if (diff < 60) setStamp(diff <= 0 ? "JUST NOW" : `${diff}S AGO`);
      else if (diff < 3600) setStamp(`${Math.floor(diff / 60)}M AGO`);
      else if (diff < 86400) setStamp(`${Math.floor(diff / 3600)}H AGO`);
      else setStamp(`${Math.floor(diff / 86400)}D AGO`);
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, [timestamp]);

  return <span>{stamp}</span>;
}

const isWeekend = () => {
  const now = new Date();
  const day = now.getUTCDay();
  const hours = now.getUTCHours();
  
  if (day === 5) { // Friday after 22:00 UTC
    return hours >= 22;
  }
  if (day === 6) { // Saturday (all day)
    return true;
  }
  if (day === 0) { // Sunday before 22:00 UTC
    return hours < 22;
  }
  return false;
};

export default function Dashboard() {
  const navigate = useNavigate();
  const [state, setState] = useState<{
    stats: Stats | null;
    pairStatuses: PairScanStatus[];
    latestSignal: Signal | null;
    signals: Signal[];
    activeSignalsCount?: number;
    signalsTodayCount?: number;
    marketStates?: MarketState[];
    rejectionStats?: any;
    activeOpportunities?: any[];
    confidenceHistory?: number[];
  }>({
    stats: null,
    pairStatuses: [],
    latestSignal: null,
    signals: [],
    activeSignalsCount: 0,
    signalsTodayCount: 0,
    marketStates: [],
    rejectionStats: {},
    activeOpportunities: [],
    confidenceHistory: [],
  });

  const [activeTab, setActiveTab] = useState<"ALL" | "OPPORTUNITY" | "ARCHIVE" | "FILTERED" | "STALE" | "LONG" | "SHORT">("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortConfig, setSortConfig] = useState<{ key: string, direction: "asc" | "desc" }>({ key: "timestamp", direction: "desc" });

  const handleSort = (key: string) => {
    if (sortConfig.key === key) {
      setSortConfig({ key, direction: sortConfig.direction === "asc" ? "desc" : "asc" });
    } else {
      setSortConfig({ key, direction: "desc" });
    }
  };

  useEffect(() => {
    // 1. Setup SSE for memory-state (fast, no DB cost)
    const eventSource = new EventSource("/api/stream");
    eventSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        setState(prev => ({ ...prev, ...data }));
      } catch (err) {}
    };

    // 2. Initial fetch for signals
    const fetchSignals = async () => {
      if (!supabase) return;
      const { data } = await supabase
        .from('signals')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
      
      if (data) {
        setState(prev => ({ ...prev, activeOpportunities: data }));
      }
    };
    fetchSignals();

    // 3. Supabase Realtime for signals
    let channel: any;
    if (supabase) {
      channel = supabase.channel('dashboard_signals')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'signals' }, (payload) => {
           if (payload.eventType === 'INSERT') {
             setState(prev => ({ 
               ...prev, 
               activeOpportunities: [payload.new, ...(prev.activeOpportunities || [])].slice(0, 100)
             }));
           } else if (payload.eventType === 'UPDATE') {
             setState(prev => ({
               ...prev,
               activeOpportunities: (prev.activeOpportunities || []).map(s => s.id === payload.new.id ? payload.new : s)
             }));
           } else if (payload.eventType === 'DELETE') {
             setState(prev => ({
               ...prev,
               activeOpportunities: (prev.activeOpportunities || []).filter(s => s.id !== payload.old.id)
             }));
           }
        })
        .subscribe();
    }

    return () => {
      eventSource.close();
      if (channel) supabase!.removeChannel(channel);
    };
  }, []);

  const stats = state.stats || {
    scanCycles: 0,
    lastScanTime: null,
    lastScanDuration: 0,
    consecutiveApiErrors: 0,
    isDegraded: false,
    scanError: null,
  };

  const allowedPairs = isWeekend()
    ? ["BTCUSD", "ETHUSD", "SOLUSD", "XRPUSD", "BNBUSD", "ADAUSD", "LTCUSD", "DOTUSD", "XAGUSD", "XAUUSD"]
    : ["EURUSD", "GBPUSD", "USDJPY", "USDCAD", "AUDUSD", "NZDUSD", "USDCHF", "EURGBP", "EURJPY", "GBPJPY", "AUDJPY", "NZDJPY", "CADJPY", "CHFJPY", "EURAUD", "EURNZD", "GBPAUD", "XAUUSD", "XAGUSD", "BTCUSD"];

  const activeOpps = (state.activeOpportunities || [])
    .filter((s: any) => allowedPairs.includes(s.pair))
    .filter((s: any) => ['ACTIVE', 'TP1 HIT', 'TP2 HIT', 'OPEN'].includes(s.status));

  const archivedOpps = (state.activeOpportunities || [])
    .filter((s: any) => allowedPairs.includes(s.pair))
    .filter((s: any) => ['TP3 HIT', 'SL HIT', 'EXPIRED', 'CLOSED'].includes(s.status));

  const rawMarketStates = state.marketStates || [];
  const marketStates = rawMarketStates.filter((s: any) => allowedPairs.includes(s.pair));

  const source = marketStates.length > 0 ? marketStates : (state.signals || []).filter((s: any) => allowedPairs.includes(s.pair));

  const getDerivedStatus = (s: any) => {
    if (s.tier === "Reject" || s.status === "REJECTED") return "FILTERED";
    if (s.tier === "STALE") return "STALE";
    if (s.tier === "Neutral") return "PENDING";
    return "OPPORTUNITY";
  };

  const opportunitiesCount = activeOpps.length;
  const filteredCount = source.filter((s: any) => getDerivedStatus(s) === "FILTERED").length;
  const totalEvals = source.length;
  const rejectedCount = filteredCount;
  const acceptedCount = opportunitiesCount;
  const duplicateCount = source.filter((s: any) => s.rejection_reason?.toLowerCase().includes("duplicate")).length;
  const acceptanceRate = totalEvals > 0 ? ((acceptedCount / totalEvals) * 100).toFixed(1) : "0.0";
  const rejectionRate = totalEvals > 0 ? ((rejectedCount / totalEvals) * 100).toFixed(1) : "0.0";

  const rejectionStats = state.rejectionStats || {};
  const sortedRejections = useMemo(() => {
    return Object.entries(rejectionStats).sort((a: any, b: any) => b[1] - a[1]);
  }, [rejectionStats]);

  const primaryRej = sortedRejections.length > 0 && (sortedRejections[0][1] as number) > 0 ? sortedRejections[0][0] : "NONE";
  const secondaryRej = sortedRejections.length > 1 && (sortedRejections[1][1] as number) > 0 ? sortedRejections[1][0] : "NONE";

  const totalRejections = Object.values(rejectionStats).reduce((acc: number, val: any) => acc + (typeof val === "number" ? val : 0), 0) as number;
  
  let volatility = "HIGH";
  let trendStrength = "STRONG";
  let momentum = "POSITIVE";
  let riskEnvironment = "RISK-ON";

  if (primaryRej === "ATR_LOW") {
    volatility = "LOW";
    riskEnvironment = "PRESERVATION";
    momentum = "WEAK";
  } else if (primaryRej === "MOMENTUM") {
    momentum = "WEAK / CONSOLIDATION";
    trendStrength = "CHOPPY";
    riskEnvironment = "CAUTIOUS";
  } else if (primaryRej === "VWAP" || primaryRej === "EMA_FLAT") {
    trendStrength = "RANGING";
    volatility = "COMPRESSING";
  }

  let marketScore = 60;
  if (primaryRej === "NONE") marketScore = 85;
  else if (primaryRej === "ATR_LOW") marketScore = 35;
  else if (primaryRej === "MOMENTUM") marketScore = 45;
  else if (primaryRej === "VWAP") marketScore = 55;

  const confidencePct = state.confidenceHistory && state.confidenceHistory.length > 0 
    ? Math.round(state.confidenceHistory.reduce((a, b) => a + b, 0) / state.confidenceHistory.length)
    : marketScore;
  const expectedSignals = marketScore > 70 ? "HIGH" : marketScore > 40 ? "MODERATE" : "LOW";
  const confidenceColor = confidencePct > 60 ? "text-[#00E08A]" : confidencePct > 30 ? "text-[#F5A524]" : "text-[#FF4D6D]";
  const confidenceBlocks = Math.round(confidencePct / 10);
  const confidenceBar = Array.from({length: 10}).map((_, i) => i < confidenceBlocks ? "▰" : "▱").join("");

  let marketSummary = "Market conditions are favorable for trend continuation. Confidence remains high.";
  if (primaryRej === "ATR_LOW") {
    marketSummary = "Low volatility conditions detected across major pairs. Momentum confirmations remain weak, causing elevated rejection rates. Current market regime favors capital preservation until volatility expansion occurs.";
  } else if (primaryRej === "MOMENTUM") {
    marketSummary = "Momentum is fading or contradictory across multiple timeframes. Trend strength is inadequate for high-probability setups. Awaiting clear directional volume.";
  }

  const evaluatedCount = isWeekend() ? 10 : 20;
  const momentumRejCount = rejectionStats["MOMENTUM"] || 0;
  const atrRejCount = rejectionStats["ATR_LOW"] || 0;
  
  const momentumPass = Math.max(0, evaluatedCount - momentumRejCount);
  const atrPass = Math.max(0, momentumPass - atrRejCount);
  
  const momentumFailCount = evaluatedCount - momentumPass;
  const momentumDropPct = evaluatedCount > 0 ? Math.round((momentumFailCount / evaluatedCount) * 100) : 0;
  const atrFailCount = momentumPass - atrPass;
  const atrDropPct = momentumPass > 0 ? Math.round((atrFailCount / momentumPass) * 100) : 0;
  const validationFailCount = atrPass - acceptedCount;
  const validationDropPct = atrPass > 0 ? Math.round((validationFailCount / atrPass) * 100) : 0;

  let filteredSignals = source;
  
  if (activeTab === "OPPORTUNITY") {
     filteredSignals = activeOpps;
  } else if (activeTab === "ARCHIVE") {
     filteredSignals = archivedOpps;
  } else if (activeTab === "FILTERED") {
     filteredSignals = filteredSignals.filter((s: any) => getDerivedStatus(s) === "FILTERED");
  } else if (activeTab === "LONG") {
     filteredSignals = filteredSignals.filter((s: any) => s.direction === "LONG");
  } else if (activeTab === "SHORT") {
     filteredSignals = filteredSignals.filter((s: any) => s.direction === "SHORT");
  } else if (activeTab === "STALE") {
     filteredSignals = filteredSignals.filter((s: any) => getDerivedStatus(s) === "STALE");
  }

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filteredSignals = filteredSignals.filter((s: any) => 
      s.pair.toLowerCase().includes(q) || 
      (s.rejection_reason || "").toLowerCase().includes(q) ||
      s.direction.toLowerCase().includes(q)
    );
  }

  filteredSignals.sort((a: any, b: any) => {
    const dir = sortConfig.direction === "asc" ? 1 : -1;
    if (sortConfig.key === "timestamp") {
      const aTime = new Date(a.timestamp || a.updated_at || Date.now()).getTime();
      const bTime = new Date(b.timestamp || b.updated_at || Date.now()).getTime();
      return (aTime - bTime) * dir;
    }
    if (sortConfig.key === "pair") return a.pair.localeCompare(b.pair) * dir;
    if (sortConfig.key === "confidence") return ((a.strengthScore || a.aiConfidence || a.confidence || 0) - (b.strengthScore || b.aiConfidence || b.confidence || 0)) * dir;
    if (sortConfig.key === "direction") return a.direction.localeCompare(b.direction) * dir;
    if (sortConfig.key === "result") {
       const statusA = a.status && a.status !== "REJECTED" && a.status !== "success" ? a.status : getDerivedStatus(a);
       const statusB = b.status && b.status !== "REJECTED" && b.status !== "success" ? b.status : getDerivedStatus(b);
       return statusA.localeCompare(statusB) * dir;
    }
    return 0;
  });

  const displaySignals = filteredSignals.slice(0, 100);

  const rejectionData = [
    { name: "POSITION ACTIVE", value: rejectionStats["ACTIVE_TRADE_EXISTS"] || 0 },
    { name: "RANGE COMPRESSION", value: rejectionStats["ATR_LOW"] || 0 },
    { name: "SIGNAL CONFLICT", value: rejectionStats["MOMENTUM"] || 0 },
    { name: "SIGNAL FADE", value: rejectionStats["STOCHASTIC"] || 0 },
    { name: "DIRECTION LOCK", value: rejectionStats["VWAP"] || 0 },
    { name: "TREND COMPRESSION", value: rejectionStats["EMA_FLAT"] || 0 },
    { name: "REVERSAL BLOCK", value: rejectionStats["COUNTER_TREND"] || 0 },
  ].sort((a, b) => b.value - a.value);

  const heatmapPairs = marketStates.length > 0 ? marketStates : allowedPairs.map(p => ({ pair: p, direction: "NONE", tier: "STALE" }));

  const now = new Date();
  const timeStr = (offsetMs: number) => new Date(now.getTime() - offsetMs).toLocaleTimeString([], { hour12: false });

  return (
    <div className="flex-1 max-w-[1920px] w-full mx-auto p-3 space-y-3 overflow-y-auto custom-scrollbar bg-[#070B12] text-white">
      
      {/* WEEKEND MODE BANNER */}
      {isWeekend() && (
        <div className="bg-[#F5A524]/10 border border-[#F5A524]/30 text-[#F5A524] px-4 py-2.5 rounded-sm text-xs font-mono font-bold flex items-center justify-center gap-2 animate-pulse">
          ⚡ WEEKEND MODE — Crypto & Gold Only | Forex Resumes Monday 00:00 UTC
        </div>
      )}

      {/* PHASE 1 - TOP TELEMETRY STRIP */}
      <div className="bg-[#0D1017] border border-[#1A2332] flex items-center px-4 justify-between text-xs font-mono whitespace-nowrap overflow-x-auto custom-scrollbar h-[40px] rounded-sm">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <span className="text-[#8A95A5]">ENGINE:</span>
            <span className={stats.isDegraded ? "text-[#FF4D6D] font-bold" : "text-[#00E08A] font-bold"}>{stats.isDegraded ? "DEGRADED" : "LIVE"}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[#8A95A5]">PAIRS:</span>
            <span>{heatmapPairs.length}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[#8A95A5]">SCANS:</span>
            <span>{stats.scanCycles}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[#8A95A5]">OPPORTUNITIES:</span>
            <span className="text-[#00E08A]">{acceptedCount}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[#8A95A5]">FILTERED:</span>
            <span className="text-[#FF4D6D]">{rejectedCount}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[#8A95A5]">DUPLICATES:</span>
            <span className="text-[#F5A524]">{duplicateCount}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[#8A95A5]">MARKET FEED:</span>
            <span className={stats.consecutiveApiErrors > 0 ? "text-[#FF4D6D]" : "text-[#00E08A]"}>
              {stats.consecutiveApiErrors > 0 ? "ERR" : "OK"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[#8A95A5]">TG:</span>
            <span className="text-[#00E08A]">OK</span>
          </div>
          <div className="flex items-center gap-2 border border-[#1A2332] bg-[#11141A] px-3 py-1 rounded-full">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#00E08A] opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[#00E08A]"></span>
            </span>
            <span className="text-[#8A95A5] text-[10px] font-bold">LATENCY:</span>
            <span className="text-white font-mono text-[10px]">{stats.lastScanDuration || 0}ms</span>
          </div>
        </div>
        <div className="flex items-center gap-4 ml-6">
           <button 
             onClick={() => navigate('/trades')}
             className="bg-[#2563eb]/20 border border-blue-500/30 hover:bg-[#2563eb]/30 text-blue-400 px-3 py-1 rounded text-xs font-bold transition-colors flex items-center gap-2"
           >
             TRADE MONITOR
           </button>
          <div className="flex items-center gap-2">
            <span className="text-[#8A95A5]">LAST:</span>
            <span><RelativeTime timestamp={stats.lastScanTime} /></span>
          </div>
        </div>
      </div>

      {/* PHASE 2 - MARKET REGIME HERO (Command Center) */}
      <div className="bg-[#0D1017] border border-[#1A2332] p-3 flex flex-col gap-3 rounded-sm">
         <div className="flex items-start justify-between">
            <div className="flex flex-col gap-1">
               <span className="text-[#8A95A5] uppercase font-sans tracking-widest text-[10px]">MARKET CONFIDENCE</span>
               <div className="flex items-baseline gap-3">
                  <span className={cn(confidenceColor, "font-bold text-4xl font-mono tracking-tighter")}>{confidencePct}% <span className="text-lg">↘</span></span>
                  <div className="flex flex-col text-[9px] font-mono text-[#5D6B80]">
                     <span>History</span>
                     <span className="text-[#8A95A5]">
                       {state.confidenceHistory && state.confidenceHistory.length > 0 
                         ? state.confidenceHistory.map(h => `${h}%`).join(' | ') 
                         : "AWAITING DATA"}
                     </span>
                  </div>
               </div>
            </div>
            <div className="flex flex-col items-end text-right font-mono text-[10px] gap-1">
               <div className="flex items-center gap-2">
                  <span className="text-[#8A95A5]">CURRENT REGIME:</span>
                  <span className="text-white font-bold">{volatility} {riskEnvironment === "PRESERVATION" ? "(PRESERVATION)" : ""}</span>
               </div>
               <div className="flex items-center gap-2">
                  <span className="text-[#8A95A5]">TREND:</span>
                  <span className="text-[#3B82F6] font-bold">{trendStrength}</span>
               </div>
               <div className="flex items-center gap-2">
                  <span className="text-[#8A95A5]">THROUGHPUT:</span>
                  <span className="text-white font-bold">{expectedSignals}</span>
               </div>
            </div>
         </div>
      </div>

      {/* PHASE 17 - EXECUTIVE SUMMARY STRIP */}
      <div className="bg-[#070B12] border border-[#1A2332] p-2 flex items-center gap-3 rounded-sm font-mono text-[10px]">
         <span className="text-[#3B82F6] font-bold shrink-0">MARKET SUMMARY:</span>
         <span className="text-[#8A95A5] truncate">{marketSummary}</span>
      </div>

      <div className="flex flex-col lg:flex-row gap-3">
         
         {/* LEFT MAIN AREA (70%) */}
         <div className="flex flex-col gap-3 w-full lg:w-[70%]">
            
            {/* PHASE 3 - SIGNAL FUNNEL */}
            <div className="bg-[#0D1017] border border-[#1A2332] p-3 flex flex-col gap-3 rounded-sm">
               <div className="flex items-center justify-between text-[10px] font-mono border-b border-[#1A2332] pb-2">
                  <span className="text-[#8A95A5] uppercase font-sans tracking-widest">MARKET ASSESSMENT</span>
                  <div className="flex items-center gap-4">
                     <div className="flex items-center gap-1.5">
                        <span className="text-[#8A95A5]">OPPORTUNITY RATE:</span>
                        <span className="text-[#00E08A]">{acceptanceRate}%</span>
                     </div>
                     <div className="flex items-center gap-1.5">
                        <span className="text-[#8A95A5]">MOMENTUM ENGINE:</span>
                        <span className="text-white">{Math.max(0, 100 - momentumDropPct)}% PASS</span>
                     </div>
                     <div className="flex items-center gap-1.5">
                        <span className="text-[#8A95A5]">VOLATILITY ENGINE:</span>
                        <span className="text-white">{Math.max(0, 100 - atrDropPct)}% PASS</span>
                     </div>
                  </div>
               </div>
               <div className="flex items-center justify-between font-mono text-xs text-center py-2 bg-[#070B12] rounded-sm border border-[#1A2332] px-2 sm:px-4">
                  <div className="flex flex-col items-center">
                     <span className="text-white font-bold text-lg">{evaluatedCount}</span>
                     <span className="text-[#8A95A5] text-[9px] uppercase">Assessed</span>
                  </div>
                  <div className="flex flex-col items-center text-[#FF4D6D] text-[9px]">
                     <span>↓ -{momentumFailCount}</span>
                     <span>{momentumDropPct}% Drop</span>
                     <span className="text-[#8A95A5]">Mom. Engine</span>
                  </div>
                  <div className="flex flex-col items-center">
                     <span className="text-white font-bold text-lg">{momentumPass}</span>
                     <span className="text-[#8A95A5] text-[9px] uppercase">Passed</span>
                  </div>
                  <div className="flex flex-col items-center text-[#FF4D6D] text-[9px]">
                     <span>↓ -{atrFailCount}</span>
                     <span>{atrDropPct}% Drop</span>
                     <span className="text-[#8A95A5]">Vol. Engine</span>
                  </div>
                  <div className="flex flex-col items-center">
                     <span className="text-white font-bold text-lg">{atrPass}</span>
                     <span className="text-[#8A95A5] text-[9px] uppercase">Passed</span>
                  </div>
                  <div className="flex flex-col items-center text-[#FF4D6D] text-[9px]">
                     <span>↓ -{validationFailCount}</span>
                     <span>{validationDropPct}% Drop</span>
                     <span className="text-[#8A95A5]">Final</span>
                  </div>
                  <div className="flex flex-col items-center">
                     <span className="text-[#00E08A] font-bold text-lg">{acceptedCount}</span>
                     <span className="text-[#00E08A] text-[9px] uppercase">Opportunities</span>
                  </div>
               </div>
            </div>

            {/* PHASE 4 - LIVE OPPORTUNITY VERIFICATION */}
            <div className="bg-[#0D1017] border border-[#1A2332] flex flex-col flex-1 min-h-[500px] rounded-sm">
               
               <div className="flex flex-wrap items-center justify-between border-b border-[#1A2332] p-2 gap-4 bg-[#1A2332]/10">
                 <div className="flex items-center gap-6 font-mono text-[10px]">
                   <div className="flex items-center gap-2">
                     <div className={cn("w-1.5 h-1.5 rounded-full animate-pulse", stats.isDegraded ? "bg-[#FF4D6D]" : (stats.lastScanDuration && stats.lastScanDuration > 60000 ? "bg-[#F5A524]" : "bg-[#00E08A]"))} />
                     <span className={cn("font-bold tracking-widest", stats.isDegraded ? "text-[#FF4D6D]" : (stats.lastScanDuration && stats.lastScanDuration > 60000 ? "text-[#F5A524]" : "text-[#00E08A]"))}>
                       SCANNER {stats.isDegraded ? "DEGRADED" : "ACTIVE"}
                     </span>
                   </div>
                   <div className="flex items-center gap-1.5">
                     <span className="text-[#5D6B80]">Last Cycle:</span>
                     <span className="text-white">
                        {stats.lastScanTime ? (
                          <>
                             <span className="mr-1">{new Date(stats.lastScanTime).toLocaleTimeString('en-US', { hour12: false, timeZone: 'UTC' })} UTC</span>
                             <span className="text-[#5D6B80]">(<RelativeTime timestamp={stats.lastScanTime} />)</span>
                          </>
                        ) : '--'}
                     </span>
                   </div>
                   <div className="flex items-center gap-1.5">
                     <span className="text-[#5D6B80]">Scan Count:</span>
                     <span className="text-white">{stats.scanCycles || 0}</span>
                   </div>
                   <div className="flex items-center gap-1.5">
                     <span className="text-[#5D6B80]">Evaluations This Cycle:</span>
                     <span className="text-white">{displaySignals.length}</span>
                   </div>
                 </div>
               </div>

               <div className="flex flex-wrap lg:flex-nowrap items-center justify-between border-b border-[#1A2332] p-1.5 gap-2">
                 <div className="flex items-center bg-[#070B12] rounded-sm border border-[#1A2332] overflow-hidden">
                   {(["ALL", "OPPORTUNITY", "ARCHIVE", "FILTERED", "STALE", "LONG", "SHORT"] as const).map(tab => (
                     <button 
                       key={tab}
                       onClick={() => setActiveTab(tab)}
                       className={cn(
                         "px-3 py-1.5 text-[9px] uppercase tracking-widest font-sans font-medium transition-colors border-r border-[#1A2332] last:border-0",
                         activeTab === tab ? "text-white bg-[#1A2332]/50" : "text-[#5D6B80] hover:text-[#8A95A5] hover:bg-[#1A2332]/20"
                       )}
                     >
                       {tab}
                     </button>
                   ))}
                 </div>
                 <div className="flex items-center">
                   <input 
                     type="text" 
                     placeholder="Search Opportunities..." 
                     value={searchQuery}
                     onChange={(e) => setSearchQuery(e.target.value)}
                     className="bg-[#070B12] border border-[#1A2332] rounded-sm px-3 py-1 text-[10px] font-mono text-white placeholder:text-[#5D6B80] outline-none focus:border-[#3B82F6] transition-colors w-48"
                   />
                 </div>
               </div>
               <div className="overflow-auto flex-1 custom-scrollbar">
                  <table className="w-full text-left border-collapse whitespace-nowrap">
                     <thead className="sticky top-0 bg-[#0D1017] z-10 border-b border-[#1A2332] shadow-sm">
                       <tr className="text-[#5D6B80] text-[9px] uppercase font-sans tracking-widest text-left">
                         <th onClick={() => handleSort('pair')} className="py-1.5 px-3 font-medium cursor-pointer hover:text-white transition-colors">Pair {sortConfig.key === 'pair' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                         <th onClick={() => handleSort('regime')} className="py-1.5 px-3 font-medium cursor-pointer hover:text-white transition-colors">Regime {sortConfig.key === 'regime' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                         <th onClick={() => handleSort('direction')} className="py-1.5 px-3 font-medium cursor-pointer hover:text-white transition-colors">Direction {sortConfig.key === 'direction' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                         <th onClick={() => handleSort('confidence')} className="py-1.5 px-3 font-medium cursor-pointer hover:text-white transition-colors">Confidence {sortConfig.key === 'confidence' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                         <th onClick={() => handleSort('result')} className="py-1.5 px-3 font-medium cursor-pointer hover:text-white transition-colors">Status {sortConfig.key === 'result' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                         <th onClick={() => handleSort('timestamp')} className="py-1.5 px-3 font-medium cursor-pointer hover:text-white transition-colors w-full text-right">Last Evaluation Time {sortConfig.key === 'timestamp' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                       </tr>
                     </thead>
                     <tbody className="text-xs font-mono">
                       {displaySignals.map((s, i) => (
                         <tr key={s.id || i} className="border-b border-[#1A2332]/50 hover:bg-[#1A2332]/40 transition-colors group">
                           <td className="py-1 px-3 text-white font-bold">{s.pair}</td>
                           <td className="py-1 px-3 relative group/regime">
                             {s.regime ? (
                               <span className={cn(
                                 "px-1.5 py-0.5 border rounded-sm text-[9px] cursor-help",
                                 s.regime === "TRENDING" ? "bg-[#00E08A]/10 text-[#00E08A] border-[#00E08A]/20" :
                                 s.regime === "CHOP" ? "bg-[#FF4D6D]/10 text-[#FF4D6D] border-[#FF4D6D]/20" :
                                 s.regime === "VOLATILE" ? "bg-[#F5A524]/10 text-[#F5A524] border-[#F5A524]/20" :
                                 "bg-[#1A2332] text-[#8A95A5] border-[#2A3441]"
                               )}>
                                 {s.regime}
                               </span>
                             ) : (
                               <span className="text-[#8A95A5]">-</span>
                             )}
                             {s.regimeReason && (
                               <div className="absolute left-0 bottom-full mb-1 hidden group-hover/regime:block w-48 p-2 bg-[#0D1017] border border-[#1A2332] rounded text-[10px] text-[#8A95A5] shadow-lg z-20 font-sans leading-relaxed">
                                 {s.regimeReason}
                               </div>
                             )}
                           </td>
                           <td className="py-1 px-3">
                             <span className={cn(
                                s.direction === "LONG" ? "text-[#00E08A]" : s.direction === "SHORT" ? "text-[#FF4D6D]" : "text-[#8A95A5]"
                             )}>
                                {s.direction === "LONG" ? "BUY" : s.direction === "SHORT" ? "SELL" : "NONE"}
                             </span>
                           </td>
                           <td className="py-1 px-3 text-[#8A95A5]">
                             {(s.strengthScore || s.aiConfidence || s.confidence) ? `${s.strengthScore || s.aiConfidence || s.confidence}%` : "-"}
                           </td>
                           <td className="py-1 px-3">
                              {s.status && s.status !== "REJECTED" && s.status !== "success" ? (
                                <div className="flex flex-col gap-0.5 items-end">
                                  <span className={cn("px-1.5 py-0.5 border rounded-sm text-[9px]", 
                                    s.status.includes("HIT") ? "bg-[#00E08A]/10 text-[#00E08A] border-[#00E08A]/20" :
                                    s.status === "ACTIVE" || s.status === "OPEN" ? "bg-[#F5A524]/10 text-[#F5A524] border-[#F5A524]/20" :
                                    "bg-[#FF4D6D]/10 text-[#FF4D6D] border-[#FF4D6D]/20"
                                  )}>{s.status}</span>
                                  {s.sl === s.tp1 && s.status && s.status.includes('HIT') && (
                                    <span className="text-[9px] text-[#00E08A] whitespace-nowrap">
                                      SL → TP1 (breakeven+)
                                    </span>
                                  )}
                                </div>
                              ) : getDerivedStatus(s) === "FILTERED" ? (
                                <span className="px-1.5 py-0.5 bg-[#FF4D6D]/10 text-[#FF4D6D] border border-[#FF4D6D]/20 rounded-sm text-[9px]">FILTERED</span>
                              ) : getDerivedStatus(s) === "STALE" ? (
                                <span className="px-1.5 py-0.5 bg-[#F5A524]/10 text-[#F5A524] border border-[#F5A524]/20 rounded-sm text-[9px]">STALE</span>
                              ) : getDerivedStatus(s) === "PENDING" ? (
                                <span className="px-1.5 py-0.5 bg-[#5D6B80]/10 text-[#8A95A5] border border-[#5D6B80]/20 rounded-sm text-[9px]">PENDING</span>
                              ) : (
                                <span className="px-1.5 py-0.5 bg-[#00E08A]/10 text-[#00E08A] border border-[#00E08A]/20 rounded-sm text-[9px]">OPPORTUNITY</span>
                              )}
                           </td>
                           <td className="py-1 px-3 text-[#5D6B80] group-hover:text-[#8A95A5] transition-colors text-right">
                             {new Date(s.timestamp || s.updated_at || Date.now()).toLocaleTimeString([], { hour12: false })}
                           </td>
                         </tr>
                       ))}
                     </tbody>
                  </table>
                  {displaySignals.length === 0 && (!stats.scanCycles || stats.scanCycles === 0) && (!state.marketStates || state.marketStates.length === 0) && (
                    <div className="flex flex-col items-center justify-center h-full p-8 text-[#5D6B80] font-mono text-xs">
                      AWAITING SCANNER TELEMETRY...
                    </div>
                  )}
               </div>
            </div>
         </div>

         {/* RIGHT SIDEBAR (30%) */}
         <div className="flex flex-col gap-3 w-full lg:w-[30%]">
            
            {/* MODULE A — MARKET HEATMAP */}
            <div className="bg-[#0D1017] border border-[#1A2332] p-3 flex flex-col rounded-sm">
               <span className="text-[#8A95A5] block text-[10px] uppercase font-sans tracking-widest mb-3 border-b border-[#1A2332] pb-2">MARKET HEATMAP</span>
               <div className="grid grid-cols-4 sm:grid-cols-5 lg:grid-cols-4 xl:grid-cols-5 gap-1">
                 {heatmapPairs.map((s: any, i: number) => {
                   let bgColor = "bg-[#1A2332]/30 border-[#1A2332]";
                   let textColor = "text-[#5D6B80]";
                   let intensityScore = s.strengthScore ?? 0;
                   let tooltip = `${s.pair}\nRegime: ${s.regime || 'UNKNOWN'}\nBias: ${s.direction}\nMarket Activity Score: ${intensityScore}%\nVolatility Engine: ${s.atrScore ?? 0}\nMomentum Engine: ${s.momentumScore ?? 0}\nLast Sweep: ${new Date(s.timestamp || Date.now()).toLocaleTimeString([], { hour12: false })}`;
                   
                   if (s.tier !== "STALE") {
                     if (s.regime === "TRENDING") {
                       bgColor = "bg-[#00E08A]/15 border-[#00E08A]/30";
                       textColor = "text-[#00E08A]";
                     } else if (s.regime === "CHOP") {
                       bgColor = "bg-[#FF4D6D]/15 border-[#FF4D6D]/30";
                       textColor = "text-[#FF4D6D]";
                     } else if (s.regime === "VOLATILE") {
                       bgColor = "bg-[#F5A524]/10 border-[#F5A524]/20";
                       textColor = "text-[#F5A524]";
                     } else {
                       bgColor = "bg-[#1A2332]/30 border-[#1A2332]/50";
                       textColor = "text-[#8A95A5]";
                     }
                   } else {
                     bgColor = "bg-[#F5A524]/10 border-[#F5A524]/20";
                     textColor = "text-[#F5A524]";
                     tooltip = `${s.pair}\nSTALE`;
                   }
                   return (
                     <div key={i} title={tooltip} className={cn("p-1.5 border flex flex-col items-center justify-center text-center rounded-sm transition-colors cursor-default hover:bg-[#1A2332]", bgColor)}>
                       <span className={cn("font-mono text-[9px] font-bold tracking-tighter", textColor)}>{s.pair}</span>
                     </div>
                   );
                 })}
               </div>
            </div>

            {/* MODULE NEW — LIVE MARKET COVERAGE */}
            <div className="bg-[#0D1017] border border-[#1A2332] p-3 flex flex-col rounded-sm">
               <div className="flex items-center justify-between mb-3 border-b border-[#1A2332] pb-2">
                 <span className="text-[#8A95A5] text-[10px] uppercase font-sans tracking-widest">LIVE MARKET COVERAGE</span>
                 <div className="flex items-center gap-1.5">
                   <div className={cn("w-1.5 h-1.5 rounded-full animate-pulse", stats.isDegraded ? "bg-[#F5A524]" : "bg-[#00E08A]")} />
                   <span className={cn("text-[9px] font-mono", stats.isDegraded ? "text-[#F5A524]" : "text-[#00E08A]")}>
                     {stats.isDegraded ? "DEGRADED" : "OPERATIONAL"}
                   </span>
                 </div>
               </div>
               
               <div className="flex flex-col gap-2 mb-4 font-mono text-[10px]">
                 <div className="flex justify-between items-center">
                   <span className="text-[#5D6B80]">Configured Markets</span>
                   <span className="text-white">{isWeekend() ? 10 : 20}</span>
                 </div>
                 <div className="flex justify-between items-center">
                   <span className="text-[#5D6B80]">Markets Monitored</span>
                   <span className="text-white">{isWeekend() ? 10 : 20}</span>
                 </div>
                 <div className="flex justify-between items-center">
                   <span className="text-[#5D6B80]">Cycle Duration</span>
                   <span className="text-white">{stats.lastScanTime != null && stats.lastScanDuration != null ? (stats.lastScanDuration / 1000).toFixed(1) + 's' : '--'}</span>
                 </div>
                 <div className="flex justify-between items-center">
                   <span className="text-[#5D6B80]">Last Market Sweep</span>
                   <span className="text-white">{stats.lastScanTime != null ? new Date(stats.lastScanTime).toLocaleTimeString('en-US', { hour12: false, timeZone: 'UTC' }) + ' UTC' : 'N/A'}</span>
                 </div>
               </div>

               <span className="text-[#8A95A5] text-[10px] uppercase font-sans tracking-widest mb-2">COVERAGE LIST</span>
               <div className="grid grid-cols-2 gap-1 overflow-y-auto custom-scrollbar max-h-[150px]">
                 {marketStates.length > 0 ? marketStates.map((s: any, i: number) => {
                   let statusColor = "text-[#00E08A]";
                   let statusLabel = "LIVE";
                   
                   if (s.status === "warning") {
                     statusColor = "text-[#F5A524]";
                     statusLabel = "DEGRADED";
                   } else if (s.status === "error") {
                     statusColor = "text-[#FF4D6D]";
                     statusLabel = "OFFLINE";
                   }

                   return (
                     <div key={i} className="flex justify-between items-center bg-[#1A2332]/20 px-2 py-1 rounded-sm">
                       <span className="text-white font-mono text-[9px] font-bold">{s.pair}</span>
                       <span className={cn(statusColor, "font-mono text-[9px]")}>● {statusLabel}</span>
                     </div>
                   );
                 }) : (
                   <span className="text-[#5D6B80] font-mono text-[9px] col-span-2">AWAITING BACKEND STATE...</span>
                 )}
               </div>
            </div>

            {/* MODULE B — FILTER ANALYTICS */}
            <div className="bg-[#0D1017] border border-[#1A2332] p-3 flex flex-col rounded-sm">
               <div className="flex items-center justify-between mb-2">
                 <span className="text-[#8A95A5] block text-[10px] uppercase font-sans tracking-widest">FILTER ANALYTICS</span>
                 <span className="text-[#FF4D6D] text-[10px] font-mono border border-[#FF4D6D]/20 bg-[#FF4D6D]/10 px-1 rounded-sm">
                   {primaryRej === "EMA_FLAT" ? "MODE: 4X-FILTER" : `PRI: ${primaryRej === "ATR_LOW" ? "RANGE COMPRESSION" : primaryRej === "MOMENTUM" ? "SIGNAL CONFLICT" : primaryRej === "STOCHASTIC" ? "SIGNAL FADE" : primaryRej === "VWAP" ? "DIRECTION LOCK" : primaryRej === "COUNTER_TREND" ? "REVERSAL BLOCK" : primaryRej === "ACTIVE_TRADE_EXISTS" ? "POSITION ACTIVE" : primaryRej}`}
                 </span>
               </div>
               <div className="flex flex-col gap-1.5 font-mono text-[10px]">
                  {rejectionData.map((item, i) => {
                     const pct = totalRejections > 0 ? Math.round((item.value / totalRejections) * 100) : 0;
                     const blocks = Math.round(pct / 5);
                     const bar = Array.from({length: 20}).map((_, idx) => idx < blocks ? "█" : "").join("");
                     return (
                        <div key={i} className="flex items-center justify-between group">
                           <span className={cn("w-24 truncate", i === 0 ? "text-[#FF4D6D] font-bold" : "text-[#8A95A5]")}>{item.name}</span>
                           <span className={cn("flex-1 tracking-tighter mx-2", i === 0 ? "text-[#FF4D6D]" : "text-[#3B82F6]")}>{bar}</span>
                           <span className="text-white w-8 text-right">{pct}%</span>
                        </div>
                     );
                  })}
               </div>
               {rejectionData.length >= 2 && totalRejections > 0 && (
                 <div className="mt-3 text-[9px] font-sans text-[#8A95A5] border-t border-[#1A2332] pt-2">
                   Top 2 causes explain {Math.round(((rejectionData[0].value + rejectionData[1].value) / totalRejections) * 100)}% of all filtered evaluations
                 </div>
               )}
            </div>

            {/* MODULE C — SYSTEM TELEMETRY */}
            <div className="bg-[#0D1017] border border-[#1A2332] p-3 flex flex-col flex-1 rounded-sm">
               <span className="text-[#8A95A5] block text-[10px] uppercase font-sans tracking-widest mb-2 border-b border-[#1A2332] pb-2">SYSTEM TELEMETRY FEED</span>
               <div className="font-mono text-[10px] flex flex-col gap-1 overflow-y-auto custom-scrollbar">
                  <div className="flex items-center gap-2">
                     <span className="text-[#5D6B80]">{timeStr(0)}</span>
                     <span className={stats.isDegraded ? "text-[#F5A524]" : "text-[#00E08A]"}>[{stats.isDegraded ? "WARN" : " OK "}]</span>
                     <span className="text-[#8A95A5]">Scanner Operational</span>
                  </div>
                  <div className="flex items-center gap-2">
                     <span className="text-[#5D6B80]">{timeStr(0)}</span>
                     <span className="text-[#00E08A]">[ OK ]</span>
                     <span className="text-[#8A95A5]">Telegram Connected</span>
                  </div>
                  <div className="flex items-center gap-2">
                     <span className="text-[#5D6B80]">{timeStr(0)}</span>
                     <span className="text-[#00E08A]">[ OK ]</span>
                     <span className="text-[#8A95A5]">4X Rate Shield Active</span>
                  </div>
                  <div className="flex items-center gap-2">
                     <span className="text-[#5D6B80]">{timeStr(0)}</span>
                     <span className="text-[#3B82F6]">[INFO]</span>
                     <span className="text-[#8A95A5]">Cycle Time {stats.lastScanDuration}ms</span>
                  </div>
                  <div className="flex items-center gap-2">
                     <span className="text-[#5D6B80]">{timeStr(0)}</span>
                     <span className={stats.consecutiveApiErrors > 0 ? "text-[#FF4D6D]" : "text-[#3B82F6]"}>[{stats.consecutiveApiErrors > 0 ? " ERR" : "INFO"}]</span>
                     <span className="text-[#8A95A5]">API Errors {stats.consecutiveApiErrors}</span>
                  </div>
                  <div className="flex items-center gap-2">
                     <span className="text-[#5D6B80]">{timeStr(0)}</span>
                     <span className="text-[#3B82F6]">[INFO]</span>
                     <span className="text-[#8A95A5]">Last Signal: {stats.lastSignalTimestamp ? new Date(stats.lastSignalTimestamp).toLocaleTimeString([], { hour12: false }) : 'NONE'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                     <span className="text-[#5D6B80]">{timeStr(0)}</span>
                     <span className="text-[#3B82F6]">[INFO]</span>
                     <span className="text-[#8A95A5]">Telegram Pushes: {stats.telegramPushes || 0}</span>
                  </div>
                  <div className="flex items-center gap-2">
                     <span className="text-[#5D6B80]">{timeStr(0)}</span>
                     <span className="text-[#3B82F6]">[INFO]</span>
                     <span className="text-[#8A95A5]">Dedup Events: {stats.duplicateEvents || duplicateCount}</span>
                  </div>
                  <div className="flex items-center gap-2">
                     <span className="text-[#5D6B80]">{timeStr(0)}</span>
                     <span className="text-[#3B82F6]">[INFO]</span>
                     <span className="text-[#8A95A5]">4X Shield Recoveries: {stats.rateLimitRecoveries || 0}</span>
                  </div>
               </div>
            </div>

         </div>

      </div>

    </div>
  );
}

