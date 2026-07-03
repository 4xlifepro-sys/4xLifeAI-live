import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Activity, ArrowLeft, Loader2, Target, ShieldAlert, Award, AlertTriangle, TrendingUp, TrendingDown, CheckCircle2, Clock } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface Signal {
  id: string;
  pair: string;
  direction: string;
  score: number;
  aiConfidence?: number;
  entry: number;
  sl: number;
  tp1: number;
  tp2: number;
  tp3: number;
  timestamp: string;
  tier: string;
}

export default function Signals() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const filter = searchParams.get('filter') || 'elite';
  
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const filterMap: Record<string, { title: string, tier: string | null, icon: any, color: string, filterByDate?: string }> = {
    all: { title: 'All Signals', tier: null, icon: Activity, color: 'text-white' },
    'strong': { title: 'Strong Signals', tier: 'Strong', icon: Award, color: 'text-purple-400' },
    'good': { title: 'Good Signals', tier: 'Good', icon: Target, color: 'text-blue-400' },
    'valid': { title: 'Valid Signals', tier: 'Valid', icon: TrendingUp, color: 'text-emerald-400' },
    rejected: { title: 'Rejected Signals', tier: 'Reject', icon: ShieldAlert, color: 'text-[#5D6B80]' },
    today: { title: "Today's Signals", tier: null, icon: Clock, color: 'text-blue-400', filterByDate: 'today' }
  };

  const currentView = filterMap[filter.toLowerCase()] || filterMap['all'];
  const Icon = currentView.icon;

  useEffect(() => {
    async function fetchSignals() {
      try {
        let fetchedData: Signal[] = [];
        let useFallback = false;
        
        if (supabase) {
           let query = supabase
             .from('signal_audit_log')
             .select('*')
             .order('generated_at', { ascending: false })
             .limit(100);
             
           if (currentView.tier) {
               query = query.eq('tier', currentView.tier);
           }
           
           if (currentView.filterByDate === 'today') {
               const today = new Date();
               today.setHours(0, 0, 0, 0);
               query = query.gte('generated_at', today.toISOString()).neq('tier', 'Reject');
           }
             
           const { data, error } = await query;
           if (error) {
             useFallback = true;
           } else {
             fetchedData = (data || []).map((d: any) => ({
                 ...d,
                 timestamp: d.generated_at,
                 aiConfidence: d.confidence_score,
                 score: d.confidence_score
             }));
           }
        } else {
           useFallback = true;
        }

        if (useFallback) {
           const res = await fetch('/api/signals');
           if (!res.ok) throw new Error('Failed to fetch signals');
           const data = await res.json();
           fetchedData = data || [];
           if (currentView.tier) {
               fetchedData = fetchedData.filter((s: Signal) => s.tier === currentView.tier);
           }
           if (currentView.filterByDate === 'today') {
               const todayStr = new Date().toDateString();
               fetchedData = fetchedData.filter((s: Signal) => new Date(s.timestamp).toDateString() === todayStr && s.tier !== 'Reject');
           }
        }
        
        setSignals(fetchedData);
      } catch (err: any) {
        setError(err.message || 'Failed to fetch signals');
      } finally {
        setLoading(false);
      }
    }

    fetchSignals();
    let channel: any;
    if (supabase) {
       channel = supabase.channel('signals_view_changes')
         .on('postgres_changes', { event: '*', schema: 'public', table: 'signals' }, (payload) => {
             fetchSignals();
         })
         .subscribe();
    }
    return () => {
       if (channel) supabase.removeChannel(channel);
    };
  }, [filter, currentView.tier]);

  return (
    <div className="flex-1 p-6 overflow-y-auto w-full">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center gap-4 mb-8">
          <button 
            onClick={() => navigate('/dashboard')}
            className="p-2 rounded-lg bg-[#11141A] border border-[#202735] hover:bg-white/5 transition-colors text-[#8A95A5] hover:text-white"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
             <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
               <Icon className={cn("w-6 h-6", currentView.color)} />
               {currentView.title}
             </h1>
             <p className="text-[#8A95A5] text-sm mt-1">Live streaming market data from 4xLifeAI Engine</p>
          </div>
        </div>

        <div className="bg-[#11141A] border border-[#202735] rounded-xl overflow-hidden shadow-lg relative min-h-[400px]">
          {loading && (
            <div className="absolute inset-0 z-10 bg-[#11141A]/80 backdrop-blur-sm flex flex-col items-center justify-center">
               <Loader2 className="w-8 h-8 text-blue-500 animate-spin mb-4" />
               <p className="text-[#8A95A5] font-medium tracking-wide">Loading Signals...</p>
            </div>
          )}

          {error && !loading && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center text-center p-6">
               <ShieldAlert className="w-12 h-12 text-red-500 mb-4 opacity-80" />
               <h3 className="text-white font-bold text-lg mb-2">Failed to load</h3>
               <p className="text-red-400 text-sm max-w-md">{error}</p>
            </div>
          )}

          {(!loading && !error) && (signals.length === 0) && (
             <div className="absolute inset-0 z-10 flex flex-col items-center justify-center text-center p-6 bg-[#11141A]">
                <div className="relative mb-6">
                   <Target className="w-12 h-12 text-blue-500/20" />
                   <div className="absolute inset-0 border-2 border-blue-500/30 rounded-full animate-ping"></div>
                </div>
                <h3 className="text-white font-bold text-lg mb-2">No signals found.</h3>
             </div>
          )}

          <div className="overflow-x-auto w-full">
            <table className="w-full text-left text-sm whitespace-nowrap min-w-[800px]">
              <thead className="bg-[#0A0D12]">
                <tr className="border-b border-[#202735] text-[#5D6B80] uppercase tracking-wider text-xs">
                  <th className="py-4 px-6 font-semibold">Pair</th>
                  <th className="py-4 px-6 font-semibold">Signal</th>
                  <th className="py-4 px-6 font-semibold text-center">Grade</th>
                  <th className="py-4 px-6 font-semibold text-center">Confidence</th>
                  <th className="py-4 px-6 font-semibold text-right">Entry</th>
                  <th className="py-4 px-6 font-semibold text-right text-red-400/80">SL</th>
                  <th className="py-4 px-6 font-semibold text-right text-emerald-400/80">TP1</th>
                  <th className="py-4 px-6 font-semibold text-right">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#202735]/50 text-[#8A95A5]">
                {signals.map((sig) => (
                  <tr key={sig.id} className="hover:bg-white/[0.02] transition-colors group">
                    <td className="py-4 px-6 font-bold text-white font-mono flex items-center gap-2">
                       {sig.pair}
                    </td>
                    <td className="py-4 px-6">
                       <span className={cn(
                          "px-2 py-1 rounded text-xs font-bold uppercase tracking-widest border",
                          sig.direction === 'LONG' ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-red-500/10 text-red-400 border-red-500/20"
                       )}>
                          <span className="flex items-center gap-1">
                             {sig.direction === 'LONG' ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                             {sig.direction}
                          </span>
                       </span>
                    </td>
                    <td className="py-4 px-6 text-center">
                       <span className={cn("font-mono px-2 py-1 rounded",
                         sig.tier === 'Strong' ? "bg-purple-500/10 text-purple-400" :
                         sig.tier === 'Good' ? "bg-emerald-500/10 text-emerald-400" :
                         sig.tier === 'Valid' ? "bg-blue-500/10 text-blue-400" :
                         "bg-[#202735]/50 text-[#5D6B80]"
                       )}>{sig.tier}</span>
                    </td>
                    <td className="py-4 px-6 text-center">
                       {sig.aiConfidence ? (
                         <span className="text-white font-mono">{sig.aiConfidence}%</span>
                       ) : (
                         <span className="text-[#5D6B80]">-</span>
                       )}
                    </td>
                    <td className="py-4 px-6 text-right font-mono text-white opacity-90">
                       {sig.entry != null ? Number(sig.entry).toFixed(5) : '-'}
                    </td>
                    <td className="py-4 px-6 text-right font-mono text-red-400">
                       {sig.sl != null ? Number(sig.sl).toFixed(5) : '-'}
                    </td>
                    <td className="py-4 px-6 text-right font-mono text-emerald-400">
                       {sig.tp1 != null ? Number(sig.tp1).toFixed(5) : '-'}
                    </td>
                    <td className="py-4 px-6 text-right text-[#5D6B80] text-xs">
                       {new Date(sig.timestamp).toLocaleString(undefined, {
                          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit'
                       })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
