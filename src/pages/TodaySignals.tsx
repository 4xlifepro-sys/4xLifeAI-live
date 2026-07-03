import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Search, Copy, CheckCircle2 } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { supabase } from '../lib/supabase';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function TodaySignals() {
  const [signals, setSignals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    const fetchSignals = async () => {
      try {
        const response = await fetch('/api/today-signals');
        if (!response.ok) throw new Error('Failed to fetch today signals');
        const data = await response.json();
        // Filter out rejected signals just to show real opportunities
        setSignals(data.filter((s: any) => s.status !== 'REJECTED'));
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchSignals();
    
    // Supabase Real-time updates
    let channel: any;
    if (supabase) {
      channel = supabase.channel('today_signals_changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'signals' }, (payload) => {
          fetchSignals(); // fast enough to refetch on changes, or could manually merge
        })
        .subscribe();
    }

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  const handleCopy = (signal: any) => {
    const text = `PAIR: ${signal.pair}
DIRECTION: ${signal.direction}
ENTRY: ${signal.entry}
SL: ${signal.sl}
TP1: ${signal.tp1}
TP2: ${signal.tp2}
TP3: ${signal.tp3}
CONFIDENCE: ${signal.aiConfidence ? signal.aiConfidence + '%' : '-'}`;
    
    navigator.clipboard.writeText(text);
    setCopiedId(signal.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const getStatusColor = (status: string) => {
    if (!status) return "bg-gray-500/10 text-gray-500 border-gray-500/20";
    if (status.includes("HIT") || status === "WIN") return "bg-[#00E08A]/10 text-[#00E08A] border-[#00E08A]/20";
    if (status === "ACTIVE" || status === "OPEN") return "bg-[#F5A524]/10 text-[#F5A524] border-[#F5A524]/20";
    if (status === "SL HIT" || status === "LOSS") return "bg-[#FF4D6D]/10 text-[#FF4D6D] border-[#FF4D6D]/20";
    if (status === "EXPIRED" || status === "CLOSED") return "bg-[#8A95A5]/10 text-[#8A95A5] border-[#8A95A5]/20";
    return "bg-[#070B12] text-white border-[#1A2332]";
  };

  const filteredSignals = signals.filter(s => 
    (s.pair || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Today's Signals</h1>
          <p className="text-[#8A95A5] text-sm mt-1">Real-time signals generated today.</p>
        </div>
        
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#5D6B80]" />
          <input 
            type="text"
            placeholder="Search pair (e.g., GBPJPY)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#070B12] border border-[#1A2332] rounded-md py-2 pl-9 pr-4 text-sm text-white placeholder-[#5D6B80] focus:outline-none focus:border-[#00E08A] transition-colors"
          />
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-64 bg-[#0B101A] border border-[#1A2332] rounded-lg animate-pulse" />
          ))}
        </div>
      ) : filteredSignals.length === 0 ? (
        <div className="text-center py-12 bg-[#0B101A] border border-[#1A2332] rounded-lg">
          <p className="text-[#8A95A5]">No signals found for today yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredSignals.map((signal) => (
            <motion.div 
              key={signal.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-[#0B101A] border border-[#1A2332] rounded-lg overflow-hidden flex flex-col"
            >
              <div className="p-4 border-b border-[#1A2332] flex justify-between items-center bg-[#070B12]">
                <div className="flex items-center gap-3">
                  <h3 className="text-lg font-bold text-white tracking-tight">{signal.pair}</h3>
                  <span className={cn(
                    "px-2 py-0.5 rounded text-xs font-medium uppercase",
                    signal.direction === 'LONG' ? "bg-[#00E08A]/10 text-[#00E08A]" : "bg-[#FF4D6D]/10 text-[#FF4D6D]"
                  )}>
                    {signal.direction}
                  </span>
                </div>
                {(() => {
                  const isClosed = signal.status === 'CLOSED' || !signal.is_active;
                  if (!isClosed) {
                    const isBreakeven = signal.sl === signal.tp1 && signal.status && signal.status.includes('HIT');
                    return (
                      <div className="flex flex-col items-end gap-1">
                        <span className={cn("px-2 py-1 rounded text-[10px] font-bold border", getStatusColor(signal.status))}>
                          {signal.status || 'ACTIVE'}
                        </span>
                        {isBreakeven && (
                          <span className="text-[10px] text-[#00E08A] font-medium px-2 py-0.5 rounded border border-[#00E08A]/20 bg-[#00E08A]/10">
                            SL moved to TP1 (breakeven+)
                          </span>
                        )}
                      </div>
                    );
                  }
                  
                  const isWin = signal.result === 'WIN' || signal.result === 'PARTIAL WIN';
                  const isLoss = signal.result === 'LOSS';
                  const isBreakeven = signal.result === 'BREAKEVEN';
                  const isUnknown = !isWin && !isLoss && !isBreakeven;
                  const pips = isWin ? signal.pips_won : (isLoss ? signal.pips_lost : (isBreakeven ? 0 : null));
                  const formattedPips = pips !== null ? Math.abs(pips).toFixed(1) : '';
                  
                  let closedLevel = "Closed";
                  if (isLoss) closedLevel = "Closed at SL";
                  else if (isBreakeven) closedLevel = "Closed at Entry";
                  else if (signal.result === 'PARTIAL WIN') closedLevel = "Closed at SL";
                  else if (isWin) {
                    if (signal.tp3_hit_at) closedLevel = "Closed at TP3";
                    else if (signal.tp2_hit_at) closedLevel = "Closed at SL"; // Win but not TP3 means it hit SL after TP2
                    else closedLevel = "Closed at TP3"; // Fallback
                  }

                  let badgeText = "CLOSED";
                  if (isBreakeven) badgeText = "BREAKEVEN 0.0 pips";
                  else if (isWin) badgeText = `WIN ${formattedPips ? `+${formattedPips} pips` : ''}`;
                  else if (isLoss) badgeText = `LOSS ${formattedPips ? `-${formattedPips} pips` : ''}`;
                  
                  return (
                    <div className="flex flex-col items-end gap-1">
                      <span className={cn(
                        "px-2 py-1 rounded text-[10px] font-bold border",
                        isBreakeven ? "bg-[#8A95A5]/10 text-[#8A95A5] border-[#8A95A5]/20"
                                    : isWin ? "bg-[#00E08A]/10 text-[#00E08A] border-[#00E08A]/20" 
                                    : isLoss ? "bg-[#FF4D6D]/10 text-[#FF4D6D] border-[#FF4D6D]/20"
                                    : "bg-[#8A95A5]/10 text-[#8A95A5] border-[#8A95A5]/20"
                      )}>
                        {badgeText}
                      </span>
                      {isUnknown ? null : <span className="text-[10px] text-[#8A95A5] font-medium">{closedLevel}</span>}
                    </div>
                  );
                })()}
              </div>
              
              <div className="p-4 flex-1 space-y-4">
                <div className="grid grid-cols-2 gap-y-4 gap-x-6 text-sm">
                  <div>
                    <p className="text-[#5D6B80] text-xs font-medium mb-1">Entry</p>
                    <p className="text-white font-mono">{signal.entry}</p>
                  </div>
                  <div>
                    <p className="text-[#5D6B80] text-xs font-medium mb-1">Stop Loss</p>
                    <p className="text-[#FF4D6D] font-mono">{signal.sl}</p>
                  </div>
                  <div>
                    <p className="text-[#5D6B80] text-xs font-medium mb-1">TP1 (1:1)</p>
                    <p className="text-[#00E08A] font-mono">{signal.tp1}</p>
                  </div>
                  <div>
                    <p className="text-[#5D6B80] text-xs font-medium mb-1">TP2 (1:2)</p>
                    <p className="text-[#00E08A] font-mono">{signal.tp2}</p>
                  </div>
                  <div>
                    <p className="text-[#5D6B80] text-xs font-medium mb-1">TP3 (1:3)</p>
                    <p className="text-[#00E08A] font-mono">{signal.tp3}</p>
                  </div>
                  <div>
                    <p className="text-[#5D6B80] text-xs font-medium mb-1">Confidence</p>
                    <p className="text-[#F5A524] font-medium">{signal.aiConfidence ? `${signal.aiConfidence}%` : '-'}</p>
                  </div>
                </div>
                
                {(signal.ai_reason || signal.aiReason) && (
                  <div className="mt-4 p-3 bg-[#1A2332]/50 border border-[#2A3441] rounded-lg">
                    <p className="text-xs font-medium text-[#00E08A] mb-1 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#00E08A] animate-pulse"></span>
                      4xLifeAI Intelligence
                    </p>
                    <p className="text-sm text-[#8A95A5] leading-relaxed">
                      {signal.ai_reason || signal.aiReason}
                    </p>
                  </div>
                )}
              </div>
              
              <div className="p-4 border-t border-[#1A2332] bg-[#070B12] flex items-center justify-between">
                <span className="text-xs text-[#5D6B80]">
                  {signal.timestamp && !isNaN(new Date(signal.timestamp).getTime()) 
                    ? new Date(signal.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC'
                    : 'Time N/A'}
                </span>
                
                <button
                  onClick={() => handleCopy(signal)}
                  className="flex items-center gap-2 text-xs font-medium bg-[#1A2332] hover:bg-[#2A3441] text-white px-3 py-1.5 rounded transition-colors"
                >
                  {copiedId === signal.id ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5 text-[#00E08A]" />
                      <span className="text-[#00E08A]">COPIED</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>COPY SIGNAL</span>
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
