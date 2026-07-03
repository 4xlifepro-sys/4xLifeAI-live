import React, { useEffect, useState } from 'react';
import { Shield, Activity, Target, Clock, CheckCircle2, XCircle, TrendingUp, TrendingDown, DollarSign, Database } from 'lucide-react';
import { cn } from '../App';
import { supabase } from '../lib/supabase';

export default function Trades() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = () => {
      fetch('/api/trades')
        .then(res => res.json())
        .then(json => {
          setData(json);
          setLoading(false);
        })
        .catch(err => {
          console.error(err);
          setLoading(false);
        });
    };

    fetchData();

    let channel: any;
    if (supabase) {
       channel = supabase.channel('trades_view_changes')
         .on('postgres_changes', { event: '*', schema: 'public', table: 'signals' }, (payload) => {
             fetchData();
         })
         .subscribe();
    }
    return () => {
       if (channel) supabase.removeChannel(channel);
    };
  }, []);

  if (loading || !data) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }

  const { openTrades, closedTrades, tradeStats, telemetry } = data;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6 w-full">
      <div className="flex items-center justify-between">
         <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
            <Activity className="w-6 h-6 text-blue-500" />
            V5 QUANT CONSOLE
         </h1>
         <div className="flex items-center gap-2 bg-[#11141A] px-3 py-1.5 rounded-full border border-green-500/20">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-xs font-medium text-green-400">TELEMETRY LIVE</span>
         </div>
      </div>

      {/* PERFORMANCE CENTER */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard title="Win Rate" value={`${tradeStats.winRate.toFixed(1)}%`} icon={<CheckCircle2 className="w-5 h-5 text-green-500" />} />
        <StatCard title="Loss Rate" value={`${tradeStats.lossRate.toFixed(1)}%`} icon={<XCircle className="w-5 h-5 text-red-500" />} />
        <StatCard title="Net Pips" value={`${tradeStats.netPips > 0 ? '+' : ''}${tradeStats.netPips.toFixed(1)}`} icon={<TrendingUp className="w-5 h-5 text-blue-500" />} />
        <StatCard title="Profit Factor" value={tradeStats.profitFactor.toFixed(2)} icon={<DollarSign className="w-5 h-5 text-yellow-500" />} />
        <StatCard title="Expectancy" value={`${tradeStats.expectancy.toFixed(2)} pips`} icon={<Target className="w-5 h-5 text-purple-500" />} />
      </div>

      {/* TELEMETRY */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
         <MetricCard title="Telegram Pushes" value={telemetry.telegramPushes} />
         <MetricCard title="Duplicate Blocks" value={telemetry.duplicateEvents} />
         <MetricCard title="API Recoveries" value={telemetry.rateLimitRecoveries} />
         <MetricCard title="Avg Cycle" value={`${(telemetry.averageCycleDuration / 1000).toFixed(1)}s`} />
         <MetricCard title="Uptime" value={formatDuration(0, telemetry.scannerUptime)} />
         <MetricCard title="Last Signal" value={telemetry.lastSignalTimestamp ? new Date(telemetry.lastSignalTimestamp).toLocaleTimeString() : 'N/A'} />
         <MetricCard title="Last Trade" value={telemetry.lastTradeTimestamp ? new Date(telemetry.lastTradeTimestamp).toLocaleTimeString() : 'N/A'} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* TP ANALYTICS */}
        <div className="lg:col-span-1 bg-[#11141A] border border-[#202735] rounded-xl p-6 flex flex-col gap-4">
           <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-2">TP Analytics</h2>
           <div className="space-y-4">
             <TPBar label="TP1 HITS" value={tradeStats.tp1Hits} total={tradeStats.closedTradesCount} color="bg-blue-500" />
             <TPBar label="TP2 HITS" value={tradeStats.tp2Hits} total={tradeStats.closedTradesCount} color="bg-indigo-500" />
             <TPBar label="TP3 HITS" value={tradeStats.tp3Hits} total={tradeStats.closedTradesCount} color="bg-green-500" />
             <TPBar label="SL HITS" value={tradeStats.slHits} total={tradeStats.closedTradesCount} color="bg-red-500" />
           </div>
        </div>

        {/* TRADE MONITOR (Open Trades) */}
        <div className="lg:col-span-2 bg-[#11141A] border border-[#202735] rounded-xl p-6 flex flex-col">
            <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-4 flex items-center gap-2">
               <Shield className="w-4 h-4 text-blue-400" /> Open Trades ({openTrades.length})
            </h2>
            <div className="overflow-x-auto flex-1">
               <table className="w-full text-sm text-left">
                  <thead>
                    <tr className="text-[#8A95A5] border-b border-[#202735]">
                      <th className="pb-3 font-medium">Pair</th>
                      <th className="pb-3 font-medium">Direction</th>
                      <th className="pb-3 font-medium">Entry</th>
                      <th className="pb-3 font-medium">Status</th>
                      <th className="pb-3 font-medium text-right">Time Open</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#202735]">
                     {openTrades.map((t: any) => (
                       <tr key={t.id} className="text-[#E0E4EA]">
                          <td className="py-3 font-medium">{t.pair}</td>
                          <td className="py-3">
                            <span className={cn("px-2 py-1 rounded text-xs font-bold", t.direction === 'LONG' || t.direction === 'BUY' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400')}>
                               {(t.direction === 'LONG' || t.direction === 'BUY') ? 'BUY' : 'SELL'}
                            </span>
                          </td>
                          <td className="py-3 font-mono text-xs">{t.entry}</td>
                          <td className="py-3 flex flex-col items-start gap-1">
                             <span className="text-xs font-medium text-blue-400">{t.status || 'ACTIVE'}</span>
                             {t.sl === t.tp1 && t.status && t.status.includes('HIT') && (
                               <span className="text-[10px] text-[#00E08A] font-medium px-2 py-0.5 rounded border border-[#00E08A]/20 bg-[#00E08A]/10">
                                 SL moved to TP1 (breakeven+)
                               </span>
                             )}
                          </td>
                          <td className="py-3 text-right text-[#8A95A5] font-mono text-xs">
                             {formatDuration(new Date(t.opened_at || t.timestamp || t.created_at).getTime(), Date.now())}
                          </td>
                       </tr>
                     ))}
                     {openTrades.length === 0 && (
                        <tr><td colSpan={5} className="py-8 text-center text-[#5D6B80]">No open trades currently</td></tr>
                     )}
                  </tbody>
               </table>
            </div>
        </div>
      </div>

      {/* TRADE HISTORY */}
      <div className="bg-[#11141A] border border-[#202735] rounded-xl p-6 flex flex-col">
         <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-4 flex items-center gap-2">
            <Clock className="w-4 h-4 text-blue-400" /> Trade History
         </h2>
         <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
               <thead>
                 <tr className="text-[#8A95A5] border-b border-[#202735]">
                   <th className="pb-3 font-medium">Pair</th>
                   <th className="pb-3 font-medium">Direction</th>
                   <th className="pb-3 font-medium">Entry</th>
                   <th className="pb-3 font-medium text-right">Exit</th>
                   <th className="pb-3 font-medium text-center">Outcome</th>
                   <th className="pb-3 font-medium text-right">Pips</th>
                   <th className="pb-3 font-medium text-right">Duration</th>
                   <th className="pb-3 font-medium text-right">Closed</th>
                 </tr>
               </thead>
               <tbody className="divide-y divide-[#202735]">
                  {closedTrades.slice(0, 50).map((t: any) => {
                    const isLong = t.direction === 'LONG' || t.direction === 'BUY';
                    const isWin = t.result === 'WIN' || t.result === 'PARTIAL WIN';
                    const isBreakeven = t.result === 'BREAKEVEN';
                    const pips = isWin ? (t.pips_won || 0) : (isBreakeven ? 0 : -(t.pips_lost || 0));
                    
                    return (
                    <tr key={t.id} className="text-[#E0E4EA]">
                       <td className="py-3 font-medium">{t.pair}</td>
                       <td className="py-3">
                         <span className={cn("px-2 py-1 rounded text-xs font-bold", isLong ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400')}>
                            {isLong ? 'BUY' : 'SELL'}
                         </span>
                       </td>
                       <td className="py-3 font-mono text-xs">{t.entry}</td>
                       <td className="py-3 font-mono text-xs text-right">
                          {t.result === 'LOSS' ? t.sl : (t.result === 'BREAKEVEN' ? t.entry : (t.tp3_hit_at ? t.tp3 : (t.tp2_hit_at ? t.tp2 : (t.tp1_hit_at ? t.tp1 : 'N/A'))))}
                       </td>
                       <td className="py-3 text-center">
                         <span className={cn("px-2 py-1 rounded text-xs font-bold", 
                            t.result === 'WIN' ? 'bg-green-500/10 text-green-400' : 
                             t.result === 'PARTIAL WIN' ? 'bg-blue-500/10 text-blue-400' : 
                             t.result === 'BREAKEVEN' ? 'bg-[#8A95A5]/10 text-[#8A95A5]' : 
                             t.result === 'LOSS' ? 'bg-red-500/10 text-red-400' :
                             'bg-[#8A95A5]/10 text-[#8A95A5]'
                         )}>
                            {t.result || 'CLOSED'}
                         </span>
                       </td>
                       <td className={cn("py-3 text-right font-mono text-xs", pips > 0 ? "text-green-400" : (pips < 0 ? "text-red-400" : "text-[#8A95A5]"))}>
                          {pips > 0 ? '+' : ''}{pips.toFixed(1)}
                       </td>
                       <td className="py-3 text-right text-[#8A95A5] font-mono text-xs">
                          {formatDuration(new Date(t.opened_at || t.timestamp || t.created_at).getTime(), new Date(t.closed_at || t.opened_at || t.timestamp).getTime())}
                       </td>
                       <td className="py-3 text-right text-[#8A95A5] font-mono text-xs">
                          {new Date(t.closed_at || t.opened_at || t.timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                       </td>
                    </tr>
                  )})}
                  {closedTrades.length === 0 && (
                     <tr><td colSpan={7} className="py-8 text-center text-[#5D6B80]">No trade history available</td></tr>
                  )}
               </tbody>
            </table>
         </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, icon }: { title: string, value: string, icon: React.ReactNode }) {
  return (
    <div className="bg-[#11141A] border border-[#202735] rounded-xl p-5 flex flex-col gap-2">
       <div className="flex items-center justify-between">
          <span className="text-[#8A95A5] text-xs font-bold uppercase tracking-wider">{title}</span>
          {icon}
       </div>
       <div className="text-2xl font-bold text-white tracking-tight">{value}</div>
    </div>
  );
}

function MetricCard({ title, value }: { title: string, value: string | number }) {
  return (
    <div className="bg-[#11141A]/50 border border-[#202735]/50 rounded-lg p-3 flex flex-col gap-1">
       <span className="text-[#5D6B80] text-[10px] font-bold uppercase tracking-wider">{title}</span>
       <span className="text-sm font-mono text-white">{value}</span>
    </div>
  );
}

function TPBar({ label, value, total, color }: { label: string, value: number, total: number, color: string }) {
  const percent = total > 0 ? (value / total) * 100 : 0;
  return (
    <div className="flex flex-col gap-1.5">
       <div className="flex justify-between items-center text-xs font-bold">
          <span className="text-[#8A95A5]">{label}</span>
          <span className="text-white">{value} <span className="text-[#5D6B80] ml-1">({percent.toFixed(0)}%)</span></span>
       </div>
       <div className="h-1.5 w-full bg-[#202735] rounded-full overflow-hidden">
          <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${percent}%` }} />
       </div>
    </div>
  );
}

function formatDuration(startMs: number, endMs: number) {
  const diff = Math.max(0, endMs - startMs);
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}
