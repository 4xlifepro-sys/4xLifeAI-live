import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { TrendingDown, TrendingUp } from 'lucide-react';
import { Signal } from '../types';

interface PairPerformance {
  pair: string;
  signals: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPips: number;
}

interface ConfidencePerformance {
  range: string;
  signals: number;
  wins: number;
  losses: number;
  winRate: number;
}

export default function ValidationAnalytics() {
  const [loading, setLoading] = useState(true);
  const [signals, setSignals] = useState<Signal[]>([]);
  
  // Computed fields
  const [winRate, setWinRate] = useState(0);
  const [totalSignals, setTotalSignals] = useState(0);
  const [winningSignals, setWinningSignals] = useState(0);
  const [losingSignals, setLosingSignals] = useState(0);
  const [profitFactor, setProfitFactor] = useState(0);
  const [averageRR, setAverageRR] = useState(0);
  const [totalPips, setTotalPips] = useState(0);
  const [bestPair, setBestPair] = useState('N/A');
  const [worstPair, setWorstPair] = useState('N/A');

  const [pairStats, setPairStats] = useState<PairPerformance[]>([]);
  const [confidenceStats, setConfidenceStats] = useState<ConfidencePerformance[]>([]);

  useEffect(() => {
    async function fetchData() {
      if (!supabase) return;
      const { data } = await supabase.from('signals').select('*').order('timestamp', { ascending: false }).limit(500);
      if (data) setSignals(data as Signal[]);
      setLoading(false);
    }
    fetchData();

    if (supabase) {
      const channel = supabase.channel('signals-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'signals' }, (payload) => {
          if (payload.eventType === 'INSERT') {
            setSignals(prev => [payload.new as Signal, ...prev].slice(0, 500));
          } else if (payload.eventType === 'UPDATE') {
            setSignals(prev => prev.map(s => s.id === payload.new.id ? payload.new as Signal : s));
          }
        })
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, []);

  useEffect(() => {
    let wins = 0;
    let losses = 0;
    let pips_wonTotal = 0;
    let pips_lostTotal = 0;
    
    let grossProfitRR = 0;
    let grossLossRR = 0;
    let totalRRTrades = 0;
    let sumRR = 0;

    const pStats: Record<string, { gen: number, wins: number, losses: number, pips_won: number, pips_lost: number }> = {};
    const cStats = {
      '80-84': { signals: 0, wins: 0, losses: 0 },
      '85-89': { signals: 0, wins: 0, losses: 0 },
      '90-94': { signals: 0, wins: 0, losses: 0 },
      '95-100': { signals: 0, wins: 0, losses: 0 },
    };

    signals.forEach(sig => {
      // Basic counts
      const isWin = sig.result === 'WIN';
      const isLoss = sig.result === 'LOSS';
      const pips_won = sig.pips_won || 0;
      const pips_lost = sig.pips_lost || 0;

      if (!pStats[sig.pair]) pStats[sig.pair] = { gen: 0, wins: 0, losses: 0, pips_won: 0, pips_lost: 0 };
      pStats[sig.pair].gen++;

      if (isWin) {
         wins++;
         pStats[sig.pair].wins++;
      }
      if (isLoss) {
         losses++;
         pStats[sig.pair].losses++;
      }
      
      pStats[sig.pair].pips_won += pips_won;
      pStats[sig.pair].pips_lost += pips_lost;
      pips_wonTotal += pips_won;
      pips_lostTotal += pips_lost;
      
      // Calculate RR approx for avg RR and profit factor
      const risk = Math.abs(sig.entry - sig.sl);
      if (risk > 0 && (isWin || isLoss)) {
          let currRR = 0;
          if (isLoss) currRR = -1;
          else {
             // simplify based on pips if possible, or static 1.5, 3, 5
             // Here we use static TP approximations if result WIN
             currRR = 2; // Approximated average RR for winning trades
             if ((sig as any).tp3_hit) currRR = 5;
             else if ((sig as any).tp2_hit) currRR = 3;
             else if ((sig as any).tp1_hit) currRR = 1.5;
          }
          sumRR += currRR;
          totalRRTrades++;
          if (currRR > 0) grossProfitRR += currRR;
          else grossLossRR += Math.abs(currRR);
      }

      // Confidence sorting
      const conf = sig.aiConfidence || 0;
      if (conf >= 80 && conf < 85) { cStats['80-84'].signals++; if (isWin) cStats['80-84'].wins++; if (isLoss) cStats['80-84'].losses++; }
      else if (conf >= 85 && conf < 90) { cStats['85-89'].signals++; if (isWin) cStats['85-89'].wins++; if (isLoss) cStats['85-89'].losses++; }
      else if (conf >= 90 && conf < 95) { cStats['90-94'].signals++; if (isWin) cStats['90-94'].wins++; if (isLoss) cStats['90-94'].losses++; }
      else if (conf >= 95 && conf <= 100) { cStats['95-100'].signals++; if (isWin) cStats['95-100'].wins++; if (isLoss) cStats['95-100'].losses++; }
    });

    setTotalSignals(signals.length);
    setWinningSignals(wins);
    setLosingSignals(losses);
    setWinRate((wins + losses) > 0 ? (wins / (wins + losses)) * 100 : 0);
    setTotalPips(pips_wonTotal - pips_lostTotal);
    setAverageRR(totalRRTrades > 0 ? sumRR / totalRRTrades : 0);
    setProfitFactor(grossLossRR > 0 ? grossProfitRR / grossLossRR : (grossProfitRR > 0 ? 99.9 : 0));

    const calculatedStats: PairPerformance[] = Object.keys(pStats).map(pair => {
        const st = pStats[pair];
        return {
            pair,
            signals: st.gen,
            wins: st.wins,
            losses: st.losses,
            winRate: (st.wins + st.losses) > 0 ? (st.wins / (st.wins + st.losses)) * 100 : 0,
            totalPips: st.pips_won - st.pips_lost
        };
    }).sort((a,b) => b.totalPips - a.totalPips);

    setPairStats(calculatedStats);
    if (calculatedStats.length > 0) {
        setBestPair(calculatedStats[0].pair);
        setWorstPair(calculatedStats[calculatedStats.length - 1].pair);
    } else {
        setBestPair('N/A');
        setWorstPair('N/A');
    }

    const confArray: ConfidencePerformance[] = [
      { range: '80-84%', ...cStats['80-84'], winRate: (cStats['80-84'].wins + cStats['80-84'].losses) > 0 ? (cStats['80-84'].wins / (cStats['80-84'].wins + cStats['80-84'].losses)) * 100 : 0 },
      { range: '85-89%', ...cStats['85-89'], winRate: (cStats['85-89'].wins + cStats['85-89'].losses) > 0 ? (cStats['85-89'].wins / (cStats['85-89'].wins + cStats['85-89'].losses)) * 100 : 0 },
      { range: '90-94%', ...cStats['90-94'], winRate: (cStats['90-94'].wins + cStats['90-94'].losses) > 0 ? (cStats['90-94'].wins / (cStats['90-94'].wins + cStats['90-94'].losses)) * 100 : 0 },
      { range: '95-100%', ...cStats['95-100'], winRate: (cStats['95-100'].wins + cStats['95-100'].losses) > 0 ? (cStats['95-100'].wins / (cStats['95-100'].wins + cStats['95-100'].losses)) * 100 : 0 },
    ];
    setConfidenceStats(confArray);

  }, [signals]);

  return (
    <div className="flex-1 p-6 overflow-y-auto">
      <div className="max-w-7xl mx-auto space-y-8">

        <div className="flex items-center justify-between mb-4">
            <div>
                <h1 className="text-2xl font-bold tracking-tight mb-2 flex items-center gap-2">
                   Performance Analytics
                   <span className="flex items-center gap-1.5 text-[10px] bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded border border-blue-500/20 uppercase tracking-widest mt-1">
                      Real-Time
                   </span>
                </h1>
                <p className="text-[#8A95A5] text-sm">Actual verified trading performance on real market data.</p>
            </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
            <MetricCard title="Win Rate %" value={(winRate != null ? Number(winRate).toFixed(1) : '--') + '%'} trend={winRate >= 50 ? 'up' : 'down'} />
            <MetricCard title="Total Signals" value={totalSignals.toString()} />
            <MetricCard title="Winning Signals" value={winningSignals.toString()} trend="up" />
            <MetricCard title="Losing Signals" value={losingSignals.toString()} trend="down" />
            <MetricCard title="Profit Factor" value={profitFactor != null ? Number(profitFactor).toFixed(2) : '--'} trend={profitFactor > 1 ? 'up' : 'down'} />
            <MetricCard title="Average RR" value={averageRR != null ? Number(averageRR).toFixed(2) : '--'} trend="up" />
            <MetricCard title="Total Pips" value={totalPips != null ? Number(totalPips).toFixed(1) : '--'} trend={totalPips >= 0 ? 'up' : 'down'} />
            <MetricCard title="Best Pair" value={bestPair} />
            <MetricCard title="Worst Pair" value={worstPair} />
        </div>

        <div className="grid lg:grid-cols-2 gap-8">
            <div className="bg-[#11141A] border border-[#202735] rounded-xl p-5">
                <h2 className="text-lg font-semibold mb-4 text-white">Pair Performance Table</h2>
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm whitespace-nowrap">
                        <thead>
                            <tr className="border-b border-[#202735] text-[#5D6B80]">
                                <th className="pb-3 px-2">Pair</th>
                                <th className="pb-3 px-2 text-center">Signals</th>
                                <th className="pb-3 px-2 text-center">Wins</th>
                                <th className="pb-3 px-2 text-center">Losses</th>
                                <th className="pb-3 px-2 text-center">Win Rate</th>
                                <th className="pb-3 px-2 text-right">Total Pips</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#202735]/50 text-[#8A95A5]">
                            {pairStats.map(s => (
                                <tr key={s.pair} className="hover:bg-white/5 transition-colors">
                                    <td className="py-3 px-2 font-mono text-white">{s.pair}</td>
                                    <td className="py-3 px-2 text-center">{s.signals}</td>
                                    <td className="py-3 px-2 text-center text-emerald-400">{s.wins}</td>
                                    <td className="py-3 px-2 text-center text-red-400">{s.losses}</td>
                                    <td className="py-3 px-2 text-center font-medium">{s.winRate != null ? Number(s.winRate).toFixed(1) : '--'}%</td>
                                    <td className={`py-3 px-2 text-right font-medium ${s.totalPips >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                      {s.totalPips > 0 ? '+' : ''}{s.totalPips != null ? Number(s.totalPips).toFixed(1) : '--'}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="bg-[#11141A] border border-[#202735] rounded-xl p-5">
                <h2 className="text-lg font-semibold mb-4 text-white">Confidence Analytics</h2>
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm whitespace-nowrap">
                        <thead>
                            <tr className="border-b border-[#202735] text-[#5D6B80]">
                                <th className="pb-3 px-2">AI Confidence</th>
                                <th className="pb-3 px-2 text-center">Signals</th>
                                <th className="pb-3 px-2 text-center">Wins</th>
                                <th className="pb-3 px-2 text-center">Losses</th>
                                <th className="pb-3 px-2 text-right">Win Rate</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#202735]/50 text-[#8A95A5]">
                            {confidenceStats.map(c => (
                                <tr key={c.range} className="hover:bg-white/5 transition-colors">
                                    <td className="py-3 px-2 font-mono text-white">{c.range}</td>
                                    <td className="py-3 px-2 text-center">{c.signals}</td>
                                    <td className="py-3 px-2 text-center text-emerald-400">{c.wins}</td>
                                    <td className="py-3 px-2 text-center text-red-400">{c.losses}</td>
                                    <td className="py-3 px-2 text-right font-medium text-white">{c.winRate != null ? Number(c.winRate).toFixed(1) : '--'}%</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ title, value, trend }: { title: string; value: string; trend?: 'up'|'down'|'neutral' }) {
    return (
        <div className="bg-[#11141A] border border-[#202735] rounded-xl p-4 flex flex-col justify-between h-[100px]">
            <span className="text-[#5D6B80] text-xs uppercase tracking-wider font-semibold">{title}</span>
            <div className="flex items-end justify-between">
                <span className="text-2xl font-bold text-white tracking-tight">{value}</span>
                {trend === 'up' && <TrendingUp className="w-4 h-4 text-emerald-400 mb-1" />}
                {trend === 'down' && <TrendingDown className="w-4 h-4 text-red-400 mb-1" />}
            </div>
        </div>
    );
}
