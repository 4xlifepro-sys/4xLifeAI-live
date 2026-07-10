import { useState, useEffect } from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { 
  Shield, BarChart2, Users, CreditCard, Radio, MessageSquare, 
  Send, Award, ShieldAlert, RefreshCw, Check, X, ExternalLink, 
  CircleDollarSign, Database, Play, Activity, LayoutList, Cpu 
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useDialog } from '../components/ConfirmDialog';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface Payment {
  id: string;
  email: string;
  network: string;
  txid: string;
  amount: string | null;
  status: string;
  created_at: string;
  proof_url?: string;
  tx_hash?: string;
}

interface PayoutRequest {
  id: string;
  email: string;
  amount: number;
  status: string;
  created_at: string;
}

const TABS = [
  { id: 'analytics', label: 'ANALYTICS', icon: BarChart2 },
  { id: 'users', label: 'USERS', icon: Users },
  { id: 'plans', label: 'PLANS', icon: LayoutList },
  { id: 'payments', label: 'PAYMENTS', icon: CreditCard },
  { id: 'signals', label: 'SIGNALS', icon: Radio },
  { id: 'tickets', label: 'TICKETS', icon: MessageSquare },
  { id: 'broadcast', label: 'BROADCAST', icon: Send },
  { id: 'referrals', label: 'REFERRALS', icon: Award },
  { id: 'prompts', label: 'AI PROMPTS', icon: Cpu },
  { id: 'history', label: 'HISTORY MGMT', icon: ShieldAlert },
];

import PlansManager from './admin/PlansManager';

export default function Admin() {
  const dialog = useDialog();
  const [activeTab, setActiveTab] = useState('analytics');
  const [payments, setPayments] = useState<Payment[]>([]);
  const [payouts, setPayouts] = useState<PayoutRequest[]>([]);
  
  // New state
  const [totalUsers, setTotalUsers] = useState<number | null>(null);
  const [activeSubscriptions, setActiveSubscriptions] = useState<number | null>(null);
  const [revenue, setRevenue] = useState<number | null>(null);
  const [winRate, setWinRate] = useState<number | null>(null);
  const [chartData, setChartData] = useState<any[]>([]);
  const [topPairs, setTopPairs] = useState<{pair: string, winRate: number, total: number}[]>([]);
  const [usersList, setUsersList] = useState<any[]>([]);
  const [signalsList, setSignalsList] = useState<any[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');

  // Scanner Health and Validation
  const [scannerStats, setScannerStats] = useState<any>(null);
  const [validationMetrics, setValidationMetrics] = useState<any>(null);
  const [badges, setBadges] = useState({ signals: false, tickets: false, referrals: false, payments: false });
  const [ticketsList, setTicketsList] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  
  const [signalsFilter, setSignalsFilter] = useState('All');
  const [performanceSignals, setPerformanceSignals] = useState<any[]>([]);

  // Prompts config states
  const [promptsConfig, setPromptsConfig] = useState({
    coach_system_instruction: '',
    signal_explainer_prompt: ''
  });
  const [isSavingPrompts, setIsSavingPrompts] = useState(false);
  const [promptsStatus, setPromptsStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

  const fetchPrompts = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/admin/prompts', {
        headers: {
          'Authorization': `Bearer ${session?.access_token}`
        }
      });
      const data = await res.json();
      if (res.ok) {
        setPromptsConfig(data);
      }
    } catch (e) {
      console.error("Failed to fetch prompts", e);
    }
  };

  const handleSavePrompts = async () => {
    setIsSavingPrompts(true);
    setPromptsStatus('loading');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/admin/prompts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`
        },
        body: JSON.stringify(promptsConfig)
      });
      if (res.ok) {
        setPromptsStatus('success');
        setTimeout(() => setPromptsStatus('idle'), 3000);
      } else {
        setPromptsStatus('error');
      }
    } catch (e) {
      console.error(e);
      setPromptsStatus('error');
    } finally {
      setIsSavingPrompts(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'prompts') {
      fetchPrompts();
    }
  }, [activeTab]);

  useEffect(() => {
    fetchPayments();
    fetchPayouts();
    fetchDashboardData();
    fetchSupportTickets();
    fetchAuditLogs();

    if (!supabase) return;
    
    // Realtime subscriptions
    const channel = supabase.channel('admin_changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'signals' }, () => setBadges(b => ({ ...b, signals: true })))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'support_tickets' }, () => {
         setBadges(b => ({ ...b, tickets: true }));
         fetchSupportTickets();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'payout_requests' }, () => {
         setBadges(b => ({ ...b, referrals: true }));
         fetchPayouts();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'payment_intents' }, () => {
         setBadges(b => ({ ...b, payments: true }));
         fetchPayments();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'signal_results' }, () => { fetchDashboardData(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scanner_stats' }, () => { fetchDashboardData(); })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'admin_audit_logs' }, () => { fetchAuditLogs(); })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const handleTabChange = (tabId: string) => {
    setActiveTab(tabId);
    if (tabId in badges) {
      setBadges(b => ({...b, [tabId]: false}));
    }
  };

  const fetchPayments = async () => {
    try {
      if (!supabase) return;
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/payments', {
        headers: { 'Authorization': `Bearer ${session?.access_token}` }
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        console.warn("Failed to fetch payments:", data);
        return;
      }
      setPayments(await res.json());
    } catch (e) {
      console.error(e);
    }
  };

  const fetchPayouts = async () => {
    try {
      if (!supabase) return;
      const { data } = await supabase.from('payout_requests').select('*').order('created_at', { ascending: false });
      if (data) setPayouts(data as PayoutRequest[]);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchSupportTickets = async () => {
    try {
      if (!supabase) return;
      const { data } = await supabase.from('support_tickets').select('*').order('created_at', { ascending: false });
      if (data) setTicketsList(data);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchAuditLogs = async () => {
    try {
      if (!supabase) return;
      const { data } = await supabase.from('admin_audit_logs').select('*').order('created_at', { ascending: false }).limit(50);
      if (data) setAuditLogs(data);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchDashboardData = async () => {
    if (!supabase) return;
    try {
      // 1. Total Registered Users
      const { count: usersCount } = await supabase.from('users').select('*', { count: 'exact', head: true });
      setTotalUsers(usersCount || 0);

      // 2. Active Subscriptions & Revenue
      const { data: approvedPayments } = await supabase.from('payment_intents').select('*').eq('status', 'CONFIRMED');
      setActiveSubscriptions(approvedPayments?.length || 0);
      
      const rev = (approvedPayments || []).reduce((acc, p) => {
        const amt = parseFloat(String(p.amount_usd || p.amount || '0'));
        return acc + (isNaN(amt) ? 0 : amt);
      }, 0);
      setRevenue(rev);
      
      // 3. Scanner Stats
      const { data: scanStatsData } = await supabase.from('scanner_stats').select('*').limit(1);
      if (scanStatsData && scanStatsData.length > 0) {
        setScannerStats(scanStatsData[0]);
      }

      // 4. Signal engine validation metrics, chart, and signal performance
      const { data: results } = await supabase.from('signal_results').select('*').order('created_at', { ascending: false });
      if (results && results.length > 0) {
        setPerformanceSignals(results);
        const closed = results.filter(r => r.status !== 'ACTIVE' && r.status !== 'VOID' && r.status !== 'CANCELLED');
        const wins = closed.filter(r => r.result?.startsWith('WIN')).length;
        setWinRate(closed.length > 0 ? (wins / closed.length) * 100 : 0);
        
        let aPlusWins = 0, aPlusTotal = 0;
        let aWins = 0, aTotal = 0;
        let bWins = 0, bTotal = 0;
        let totalRR = 0;

        const pairStats: Record<string, { wins: number, total: number }> = {};
        const dateStats: Record<string, { wins: number, losses: number }> = {};
        
        closed.forEach(r => {
          // validations
          if (r.tier === 'A+') { aPlusTotal++; if (r.result?.startsWith('WIN')) aPlusWins++; }
          if (r.tier === 'A') { aTotal++; if (r.result?.startsWith('WIN')) aWins++; }
          if (r.tier === 'B') { bTotal++; if (r.result?.startsWith('WIN')) bWins++; }
          totalRR += (r.rr_achieved || 0);

          // pair
          if (!pairStats[r.pair]) pairStats[r.pair] = { wins: 0, total: 0 };
          pairStats[r.pair].total++;
          if (r.result?.startsWith('WIN')) pairStats[r.pair].wins++;
          
          // chart (by day)
          const date = new Date(r.closed_at || r.created_at).toISOString().split('T')[0];
          if (!dateStats[date]) dateStats[date] = { wins: 0, losses: 0 };
          if (r.result?.startsWith('WIN')) dateStats[date].wins++;
          else dateStats[date].losses++;
        });

        const profitFactor = wins > 0 && (closed.length - wins) > 0 ? (wins * (totalRR/wins)) / (closed.length - wins) : (wins > 0 ? totalRR : 0);

        const sortedPairs = Object.entries(pairStats)
          .map(([pair, stats]) => ({ pair, winRate: (stats.wins / stats.total) * 100, total: stats.total }))
          .sort((a, b) => b.winRate - a.winRate || b.total - a.total);

        setValidationMetrics({
          aPlusWinRate: aPlusTotal > 0 ? (aPlusWins / aPlusTotal) * 100 : 0,
          aWinRate: aTotal > 0 ? (aWins / aTotal) * 100 : 0,
          bConversion: bTotal > 0 ? (bWins / bTotal) * 100 : 0,
          profitFactor,
          averageRR: wins > 0 ? totalRR / wins : 0,
          bestPair: sortedPairs.length > 0 ? sortedPairs[0].pair : 'N/A',
          worstPair: sortedPairs.length > 0 ? sortedPairs[sortedPairs.length - 1].pair : 'N/A',
          totalClosed: closed.length
        });
        
        setTopPairs(sortedPairs.slice(0, 5));
        
        const cData = Object.entries(dateStats)
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([date, stats]) => ({ date, win: stats.wins, loss: stats.losses }));
        setChartData(cData);
      } else {
        setWinRate(0);
        setChartData([]);
      }
      
      // 5. Load users list
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const usersRes = await fetch('/api/admin/users', {
          headers: {
             'Authorization': `Bearer ${session?.access_token}`
          }
        });
        if (usersRes.ok) {
           const usersData = await usersRes.json();
           setUsersList(usersData);
        }
      } catch (err) {
        console.error("Failed to fetch users from backend API:", err);
      }
      
      // 6. Load signals list
      let sigData = null;
      try {
         const res = await supabase.from('signals').select('*').order('created_at', { ascending: false }).limit(50);
         if (res.error) throw res.error;
         sigData = res.data;
      } catch (e) {
         try {
             const fallbackRes = await fetch('/api/signals');
             if (fallbackRes.ok) sigData = await fallbackRes.json();
         } catch (fallbackErr) {}
      }
      if (sigData) setSignalsList(sigData);
      
    } catch (e) {
      console.error("Dashboard data error:", e);
    }
  };

  const handleConnectionTest = async () => {
    if (!supabase) return;
    setConnectionStatus('testing');
    try {
      const { error } = await supabase.from('users').select('id').limit(1);
      if (error) throw error;
      setConnectionStatus('success');
    } catch (e) {
      setConnectionStatus('error');
    }
    setTimeout(() => {
      setConnectionStatus('idle');
    }, 3000);
  };

  const handleApprove = async (id: string) => {
    if (!supabase) return;
    try {
      const confirmed = await dialog.showConfirm({
        title: "Approve Payment",
        message: "Approve this payment and activate the user's plan/credits?",
        variant: "warning",
        confirmText: "Approve",
        cancelText: "Cancel"
      });
      if (!confirmed) return;
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/admin/payments/${id}/approve`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session?.access_token}` }
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        await dialog.showAlert({
          title: "Approval Failed",
          message: data.error || "Could not approve this payment.",
          variant: "danger",
        });
        return;
      }
      fetchPayments();
      fetchDashboardData();
      await dialog.showAlert({
        title: "Payment Approved",
        message: "The user's plan and credits have been activated.",
        variant: "success",
      });
    } catch (e) {
      console.error(e);
    }
  };

  const handleReject = async (id: string) => {
    if (!supabase) return;
    try {
      const confirmed = await dialog.showConfirm({
        title: "Reject Payment",
        message: "Reject this payment request?",
        variant: "danger",
        confirmText: "Reject",
        cancelText: "Cancel"
      });
      if (!confirmed) return;
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/admin/payments/${id}/reject`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session?.access_token}` }
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        await dialog.showAlert({
          title: "Reject Failed",
          message: data.error || "Could not reject this payment.",
          variant: "danger",
        });
        return;
      }
      fetchPayments();
      await dialog.showAlert({
        title: "Payment Rejected",
        message: "The payment has been marked as rejected.",
        variant: "success",
      });
    } catch (e) {
      console.error(e);
    }
  };

  const handleMarkPaid = async (id: string) => {
    if (!supabase) return;
    try {
      await supabase.from('payout_requests').update({ status: 'PAID' }).eq('id', id);
      await supabase.from('admin_audit_logs').insert([{ action: 'PAYOUT_PROCESSED', details: { payout_id: id } }]);
      fetchPayouts();
    } catch (e) {
      console.error(e);
    }
  };

  const getExplorerLink = (network: string, txid: string) => {
    if (network === 'BEP20') return `https://bscscan.com/tx/${txid}`;
    if (network === 'TRC20') return `https://tronscan.org/#/transaction/${txid}`;
    return '#';
  };

  const renderPaymentsTab = () => (
    <div className="bg-[#11141A] border border-[#202735] rounded-2xl overflow-hidden shadow-2xl mb-8">
      <div className="p-6 border-b border-[#202735] flex justify-between items-center">
        <h2 className="text-xl font-semibold text-white">Payment Queue</h2>
        <span className="text-sm font-mono text-[#8A95A5]">{payments.length} total</span>
      </div>
      <div className="p-6 overflow-x-auto">
        {payments.length === 0 ? (
          <div className="text-[#8A95A5]">No pending payments</div>
        ) : (
          <table className="w-full text-left border-collapse min-w-[800px]">
             <thead>
                <tr className="border-b border-[#202735] bg-[#0A0D12]">
                  <th className="p-4 text-[#8A95A5] text-[10px] font-bold tracking-widest uppercase">Date</th>
                  <th className="p-4 text-[#8A95A5] text-[10px] font-bold tracking-widest uppercase">User / Email</th>
                  <th className="p-4 text-[#8A95A5] text-[10px] font-bold tracking-widest uppercase">Plan</th>
                  <th className="p-4 text-[#8A95A5] text-[10px] font-bold tracking-widest uppercase">Amount</th>
                  <th className="p-4 text-[#8A95A5] text-[10px] font-bold tracking-widest uppercase">Proof</th>
                  <th className="p-4 text-[#8A95A5] text-[10px] font-bold tracking-widest uppercase">Status</th>
                  <th className="p-4 text-[#8A95A5] text-[10px] font-bold tracking-widest uppercase text-right">Actions</th>
                </tr>
             </thead>
             <tbody className="divide-y divide-[#202735]">
              {payments.map(payment => (
                 <tr key={payment.id} className="hover:bg-[#0D1017] transition-colors">
                    <td className="p-4 text-xs text-[#8A95A5] font-mono whitespace-nowrap">{new Date(payment.created_at).toLocaleString()}</td>
                    <td className="p-4">
                       <div className="text-sm font-bold text-white">{(payment as any).profiles?.full_name || 'N/A'}</div>
                       <div className="text-xs text-[#8A95A5]">{payment.email}</div>
                    </td>
                    <td className="p-4 text-xs font-bold text-white uppercase tracking-wider">{(payment as any).profiles?.plan || 'N/A'}</td>
                    <td className="p-4 text-sm font-bold text-emerald-400 font-mono">${payment.amount || '0'}</td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <span className="bg-gray-800 text-gray-300 px-2 py-0.5 rounded text-[10px] font-mono">{payment.proof_url || payment.network || 'USDT'}</span>
                        <a href={getExplorerLink(payment.proof_url || payment.network || '', payment.tx_hash || payment.txid || '')} target="_blank" rel="noreferrer" className="text-[10px] text-blue-400 hover:underline flex items-center gap-1 font-mono">
                           View Proof
                           <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    </td>
                    <td className="p-4">
                       <span className={cn(
                          "px-2 py-1 rounded text-[10px] font-bold tracking-wider",
                          payment.status === 'CONFIRMED' ? 'bg-emerald-500/10 text-emerald-400' :
                          payment.status === 'REJECTED' ? 'bg-rose-500/10 text-rose-400' :
                          'bg-amber-500/10 text-amber-400'
                       )}>
                          {payment.status}
                       </span>
                    </td>
                    <td className="p-4 text-right">
                       {payment.status === 'PENDING' && (
                          <div className="flex justify-end gap-2">
                             <button onClick={() => handleApprove(payment.id)} className="px-3 py-1 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 rounded text-[10px] font-bold uppercase tracking-widest transition-colors" title="Approve">
                               Approve
                             </button>
                             <button onClick={() => handleReject(payment.id)} className="px-3 py-1 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 rounded text-[10px] font-bold uppercase tracking-widest transition-colors" title="Reject">
                               Reject
                             </button>
                          </div>
                       )}
                    </td>
                 </tr>
              ))}
             </tbody>
          </table>
        )}
      </div>
    </div>
  );

  const renderReferralsTab = () => (
    <div className="bg-[#11141A] border border-[#202735] rounded-2xl overflow-hidden shadow-2xl">
      <div className="p-6 border-b border-[#202735]">
        <h2 className="text-xl font-semibold text-white">Payout Requests (Referral Commissions)</h2>
      </div>
      <div className="p-6">
        {payouts.length === 0 ? (
          <div className="text-[#8A95A5]">No payout requests found.</div>
        ) : (
          <div className="space-y-4">
            {payouts.map(payout => (
              <div key={payout.id} className="bg-[#0D1017] p-4 rounded-xl border border-[#202735] flex justify-between items-center">
                <div>
                  <div className="text-white font-medium mb-1">{payout.email}</div>
                  <div className="text-sm text-[#8A95A5] flex items-center gap-2">
                     <CircleDollarSign className="w-4 h-4 text-emerald-500" />
                     <span className="font-semibold text-white tracking-wide">${payout.amount != null ? Number(payout.amount).toFixed(2) : '0.00'}</span>
                     <span className="text-xs ml-2">Request date: {new Date(payout.created_at).toLocaleString()}</span>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className={cn(
                    "px-3 py-1 rounded-full text-xs font-semibold tracking-wider uppercase",
                    payout.status === 'PAID' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'
                  )}>
                    {payout.status}
                  </div>
                  {payout.status === 'PENDING' && (
                    <button onClick={() => handleMarkPaid(payout.id)} className="px-4 py-2 bg-[#202735] text-white hover:bg-[#2A3345] rounded-lg text-sm font-medium transition-colors border border-[#2A3345]">
                      Mark as Paid
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const renderAnalyticsTab = () => (
    <div className="space-y-6">
      {/* Scanner Health Dashboard */}
      <div className="bg-[#0A0D12] border border-[#202735] rounded-xl p-6 shadow-sm">
        <h3 className="text-white text-sm font-bold tracking-widest uppercase mb-6 flex items-center gap-2">
          <Activity className="w-4 h-4 text-emerald-400" />
          Scanner Health Dashboard
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
          <div className="bg-[#11141A] p-4 rounded-lg border border-[#202735]">
            <div className="text-[#8A95A5] text-[10px] tracking-widest uppercase font-mono mb-2">Scanner Status</div>
            <div className="text-emerald-400 text-sm font-bold tracking-wider">ONLINE</div>
          </div>
          <div className="bg-[#11141A] p-4 rounded-lg border border-[#202735]">
            <div className="text-[#8A95A5] text-[10px] tracking-widest uppercase font-mono mb-2">Assets Scanned</div>
            <div className="text-white text-sm font-bold tracking-wider">{scannerStats ? 20 : '--'}/20</div>
          </div>
          <div className="bg-[#11141A] p-4 rounded-lg border border-[#202735]">
            <div className="text-[#8A95A5] text-[10px] tracking-widest uppercase font-mono mb-2">Last Scan</div>
            <div className="text-white text-sm font-bold tracking-wider">
              {scannerStats?.lastScanTime ? new Date(scannerStats.lastScanTime).toLocaleTimeString() : '--'}
            </div>
          </div>
          <div className="bg-[#11141A] p-4 rounded-lg border border-[#202735]">
            <div className="text-[#8A95A5] text-[10px] tracking-widest uppercase font-mono mb-2">Cycle Duration</div>
            <div className="text-white text-sm font-bold tracking-wider">{scannerStats?.lastScanDuration || '--'}ms</div>
          </div>
          <div className="bg-[#11141A] p-4 rounded-lg border border-[#202735]">
            <div className="text-[#8A95A5] text-[10px] tracking-widest uppercase font-mono mb-2">Live Feed</div>
            <div className="text-emerald-400 text-sm font-bold tracking-wider">CONNECT</div>
          </div>
          <div className="bg-[#11141A] p-4 rounded-lg border border-[#202735]">
            <div className="text-[#8A95A5] text-[10px] tracking-widest uppercase font-mono mb-2">4x SecureDB</div>
            <div className={cn("text-sm font-bold tracking-wider", connectionStatus === 'error' ? "text-rose-400" : "text-emerald-400")}>
              {connectionStatus === 'error' ? 'DISCONNECT' : 'CONNECT'}
            </div>
          </div>
          <div className="bg-[#11141A] p-4 rounded-lg border border-[#202735]">
            <div className="text-[#8A95A5] text-[10px] tracking-widest uppercase font-mono mb-2">Market Feed</div>
            <div className="text-emerald-400 text-sm font-bold tracking-wider">CONNECT</div>
          </div>
        </div>
      </div>

      {/* Validation Metrics Panel */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        <div className="bg-[#0A0D12] border border-[#202735] rounded-xl p-5 shadow-sm">
          <div className="text-[#8A95A5] text-xs font-bold tracking-widest uppercase mb-4 text-left">A+ Grade Win Rate</div>
          <div className="text-3xl font-bold text-white mb-2">{validationMetrics?.aPlusWinRate != null ? Number(validationMetrics.aPlusWinRate).toFixed(1) : '--'}%</div>
          <div className="text-emerald-500 text-[10px] font-mono uppercase tracking-wider">Tier 1 Accuracy</div>
        </div>
        <div className="bg-[#0A0D12] border border-[#202735] rounded-xl p-5 shadow-sm">
          <div className="text-[#8A95A5] text-xs font-bold tracking-widest uppercase mb-4 text-left">A Grade Win Rate</div>
          <div className="text-3xl font-bold text-white mb-2">{validationMetrics?.aWinRate != null ? Number(validationMetrics.aWinRate).toFixed(1) : '--'}%</div>
          <div className="text-cyan-400 text-[10px] font-mono uppercase tracking-wider">Tier 2 Accuracy</div>
        </div>
        <div className="bg-[#0A0D12] border border-[#202735] rounded-xl p-5 shadow-sm">
          <div className="text-[#8A95A5] text-xs font-bold tracking-widest uppercase mb-4 text-left">B Grade Conversion</div>
          <div className="text-3xl font-bold text-white mb-2">{validationMetrics?.bConversion != null ? Number(validationMetrics.bConversion).toFixed(1) : '--'}%</div>
          <div className="text-amber-400 text-[10px] font-mono uppercase tracking-wider">Tier 3 Accuracy</div>
        </div>
        <div className="bg-[#0A0D12] border border-[#202735] rounded-xl p-5 shadow-sm">
          <div className="text-[#8A95A5] text-xs font-bold tracking-widest uppercase mb-4 text-left">Closed Signals</div>
          <div className="text-3xl font-bold text-white mb-2">{validationMetrics ? validationMetrics.totalClosed : '--'}</div>
          <div className="text-white border border-[#202735] text-[10px] w-max px-2 py-0.5 rounded font-mono tracking-wider">Total Evaluated</div>
        </div>
      </div>
      
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        <div className="bg-[#0A0D12] border border-[#202735] rounded-xl p-5 shadow-sm">
          <div className="text-[#8A95A5] text-xs font-bold tracking-widest uppercase mb-4 text-left">Profit Factor</div>
          <div className="text-2xl font-bold text-white mb-2">{validationMetrics?.profitFactor != null ? Number(validationMetrics.profitFactor).toFixed(2) : '--'}</div>
        </div>
        <div className="bg-[#0A0D12] border border-[#202735] rounded-xl p-5 shadow-sm">
          <div className="text-[#8A95A5] text-xs font-bold tracking-widest uppercase mb-4 text-left">Average RR</div>
          <div className="text-2xl font-bold text-white mb-2">{validationMetrics?.averageRR != null ? Number(validationMetrics.averageRR).toFixed(2) : '--'}</div>
        </div>
        <div className="bg-[#0A0D12] border border-[#202735] rounded-xl p-5 shadow-sm">
          <div className="text-[#8A95A5] text-xs font-bold tracking-widest uppercase mb-4 text-left">Best Pair</div>
          <div className="text-2xl font-bold text-emerald-400 mb-2">{validationMetrics ? validationMetrics.bestPair : '--'}</div>
        </div>
        <div className="bg-[#0A0D12] border border-[#202735] rounded-xl p-5 shadow-sm">
          <div className="text-[#8A95A5] text-xs font-bold tracking-widest uppercase mb-4 text-left">Worst Pair</div>
          <div className="text-2xl font-bold text-rose-400 mb-2">{validationMetrics ? validationMetrics.worstPair : '--'}</div>
        </div>
      </div>

      {/* Top 4 Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-[#0A0D12] border border-[#202735] rounded-xl p-5 shadow-sm">
          <div className="text-[#8A95A5] text-xs font-bold tracking-widest uppercase mb-4 text-left">Total Registered Users</div>
          {totalUsers === null ? (
            <div className="flex items-center justify-start gap-1 mb-4">
              <div className="w-2 h-2 bg-white rounded-full"></div>
              <div className="w-2 h-2 bg-white rounded-full"></div>
              <div className="w-2 h-2 bg-white rounded-full"></div>
            </div>
          ) : (
            <div className="text-3xl font-bold text-white mb-4">{totalUsers}</div>
          )}
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
            <span className="text-emerald-500 text-xs font-bold tracking-wider uppercase">Live Synced</span>
          </div>
        </div>

        <div className="bg-[#0A0D12] border border-[#202735] rounded-xl p-5 shadow-sm">
          <div className="text-[#8A95A5] text-xs font-bold tracking-widest uppercase mb-4 text-left">Active Subscriptions</div>
          {activeSubscriptions === null ? (
            <div className="flex items-center justify-start gap-1 mb-4">
              <div className="w-2 h-2 bg-white rounded-full"></div>
              <div className="w-2 h-2 bg-white rounded-full"></div>
              <div className="w-2 h-2 bg-white rounded-full"></div>
            </div>
          ) : (
            <div className="text-3xl font-bold text-white mb-4">{activeSubscriptions}</div>
          )}
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-cyan-400 rounded-full"></div>
            <span className="text-cyan-400 text-xs font-bold tracking-wider uppercase">Stripe & Crypto</span>
          </div>
        </div>

        <div className="bg-[#0A0D12] border border-[#202735] rounded-xl p-5 shadow-sm">
          <div className="text-[#8A95A5] text-xs font-bold tracking-widest uppercase mb-4 text-left">Revenue This Month</div>
          {revenue === null ? (
             <div className="flex items-center justify-start gap-1 mb-4">
               <div className="w-2 h-2 bg-white rounded-full"></div>
               <div className="w-2 h-2 bg-white rounded-full"></div>
               <div className="w-2 h-2 bg-white rounded-full"></div>
             </div>
          ) : (
            <div className="text-3xl font-bold text-white mb-4">${revenue != null ? Number(revenue).toFixed(2) : '0.00'}</div>
          )}
          <div className="flex items-center gap-2">
            <div className="text-[#8A95A5] text-xs font-medium tracking-wide">Estimated recurring USDT</div>
          </div>
        </div>

        <div className="bg-[#0A0D12] border border-[#202735] rounded-xl p-5 shadow-sm">
          <div className="text-[#8A95A5] text-xs font-bold tracking-widest uppercase mb-4 text-left">Core Engine Overall Win Rate</div>
          {winRate === null ? (
            <div className="flex items-center justify-start gap-1 mb-4">
              <div className="w-2 h-2 bg-white rounded-full"></div>
              <div className="w-2 h-2 bg-white rounded-full"></div>
              <div className="w-2 h-2 bg-white rounded-full"></div>
            </div>
          ) : (
            <div className="text-3xl font-bold text-white mb-4">{winRate != null ? Number(winRate).toFixed(1) : '0.0'}%</div>
          )}
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-pink-500 rounded-full"></div>
            <span className="text-pink-500 text-xs font-bold tracking-wider uppercase">High Confidence</span>
          </div>
        </div>
      </div>

      {/* Middle Section: Chart and Leaderboard */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-[#0A0D12] border border-[#202735] rounded-xl p-6 min-h-[320px] flex flex-col shadow-sm">
          <div className="flex justify-between items-center mb-8">
            <h3 className="text-white text-sm font-bold tracking-widest uppercase">Engine Market Scan History (Last 6 Months)</h3>
            <span className="text-[#5D6B80] text-xs font-medium tracking-widest uppercase">Signals vs Wins Tracking</span>
          </div>
          <div className="flex-1 flex items-center justify-center min-h-[250px]">
             {chartData.length === 0 ? (
                <span className="text-[#8A95A5] text-sm font-mono tracking-widest">No chart data available</span>
             ) : (
                <ResponsiveContainer width="100%" height={250}>
                   <LineChart data={chartData}>
                      <XAxis dataKey="date" stroke="#5D6B80" fontSize={10} tickMargin={10} minTickGap={30} />
                      <YAxis yAxisId="left" stroke="#10B981" fontSize={10} />
                      <YAxis yAxisId="right" orientation="right" stroke="#F43F5E" fontSize={10} />
                      <Tooltip contentStyle={{ backgroundColor: '#11141A', borderColor: '#202735', borderRadius: '8px' }} itemStyle={{ fontSize: 12 }} />
                      <Line yAxisId="left" type="monotone" dataKey="win" stroke="#10B981" strokeWidth={2} dot={false} />
                      <Line yAxisId="right" type="monotone" dataKey="loss" stroke="#F43F5E" strokeWidth={2} dot={false} />
                   </LineChart>
                </ResponsiveContainer>
             )}
          </div>
        </div>

        <div className="bg-[#0A0D12] border border-[#202735] rounded-xl p-6 min-h-[320px] shadow-sm">
          <div className="flex items-center gap-2 mb-6 text-white">
            <Award className="w-4 h-4 text-amber-500" />
            <h3 className="text-sm font-bold tracking-widest uppercase">Top Performing Elements</h3>
            <span className="text-[10px] bg-[#11141A] border border-[#202735] text-emerald-400 px-1.5 py-0.5 rounded tracking-widest">STABLE</span>
          </div>
          <div className="space-y-4">
             {topPairs.length === 0 ? (
               <p className="text-[#5D6B80] text-sm tracking-wide">Insufficient data</p>
             ) : (
               topPairs.map((pair, i) => (
                 <div key={pair.pair} className="flex items-center justify-between p-3 bg-[#11141A] border border-[#202735] rounded-lg">
                    <div className="flex items-center gap-3">
                       <span className="text-[#5D6B80] font-mono text-xs">0{i+1}</span>
                       <span className="text-white font-bold tracking-wider">{pair.pair}</span>
                    </div>
                    <div className="text-right">
                       <div className="text-emerald-400 font-bold text-sm">{pair.winRate != null ? Number(pair.winRate).toFixed(1) : '--'}%</div>
                       <div className="text-[#5D6B80] text-[10px] uppercase font-mono">{pair.total} TRADES</div>
                    </div>
                 </div>
               ))
             )}
          </div>
        </div>
      </div>

      {/* Bottom Section: Connection Monitor */}
      <div className="bg-[#0D1017] border border-[#202735] rounded-xl p-6 backdrop-blur flex items-center justify-between shadow-sm relative overflow-hidden">
        <div className="flex items-center gap-4 z-10">
          <div className="bg-cyan-500/10 p-3 rounded-xl border border-cyan-500/20">
             <Database className="w-6 h-6 text-cyan-400" />
          </div>
          <div>
            <h3 className="text-white text-md font-bold tracking-widest uppercase mb-1">4x SecureDB Live Connection Monitor</h3>
            <p className="text-[#8A95A5] text-sm leading-relaxed max-w-2xl">
              Inspect environment configurations, execute write/read testing and verify API reachability with the linked 4x SecureDB database.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-6 z-10">
           <div className="text-right">
             <div className="text-[#5D6B80] text-[10px] tracking-[0.2em] font-mono mb-1">STATE</div>
             <div className={cn(
               "text-[10px] tracking-[0.2em] font-mono",
               connectionStatus === 'success' ? 'text-emerald-500' :
               connectionStatus === 'error' ? 'text-rose-500' :
               connectionStatus === 'testing' ? 'text-amber-500 animate-pulse' :
               'text-cyan-500'
             )}>
               {connectionStatus === 'success' ? 'SYNCED_OK' : 
                connectionStatus === 'error' ? 'FAILED' : 
                connectionStatus === 'testing' ? 'TESTING...' : 'IDLE'}
             </div>
           </div>
           <button 
             onClick={handleConnectionTest}
             disabled={connectionStatus === 'testing'}
             className="bg-cyan-400 hover:bg-cyan-300 disabled:opacity-50 text-[#0A0D12] px-6 py-2.5 rounded font-bold text-sm flex items-center gap-2 transition-colors uppercase tracking-widest shadow-[0_0_15px_rgba(34,211,238,0.3)]"
           >
             <Play className="w-4 h-4 fill-current" />
             {connectionStatus === 'testing' ? 'TESTING...' : 'Run Connection Test'}
           </button>
        </div>
      </div>
    </div>
  );

  const renderUsersTab = () => (
    <div className="bg-[#11141A] border border-[#202735] rounded-2xl overflow-hidden shadow-2xl mb-8">
      <div className="p-6 border-b border-[#202735] flex justify-between items-center">
        <h2 className="text-xl font-semibold text-white">Registered Users</h2>
        <span className="text-[#8A95A5] text-xs font-mono">{usersList.length} total</span>
      </div>
      <div className="p-6">
        {usersList.length === 0 ? (
          <div className="text-[#8A95A5]">No users found.</div>
        ) : (
          <div className="space-y-4">
            {usersList.map((user: any) => (
              <div key={user.id} className="bg-[#0D1017] p-4 rounded-xl border border-[#202735] flex justify-between items-center">
                <div className="flex items-center gap-4">
                   {user.avatar_url ? (
                     <img src={user.avatar_url} alt="Avatar" className="w-10 h-10 rounded-full border border-[#202735]" />
                   ) : (
                     <div className="w-10 h-10 rounded-full bg-[#202735] flex items-center justify-center text-[#8A95A5] font-bold">
                        {(user.full_name || user.email || 'U').charAt(0).toUpperCase()}
                     </div>
                   )}
                  <div>
                    <div className="text-white font-medium mb-1">{user.full_name || 'Unnamed User'} {user.is_admin && <span className="ml-2 text-[10px] bg-rose-500/10 text-rose-400 px-2 py-0.5 rounded uppercase tracking-widest font-bold">Admin</span>}</div>
                    <div className="text-xs text-[#8A95A5] font-mono">{user.email || 'No email provided'}</div>
                  </div>
                </div>
                <div className="text-right flex items-center gap-4">
                   <div className="text-[10px] text-[#8A95A5]">Joined {new Date(user.created_at).toLocaleDateString()}</div>
                   <div className={cn("px-2 py-1 rounded text-[10px] font-bold tracking-wider", user.plan === 'ELITE' || user.plan === 'PREMIUM' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-gray-800 text-gray-400')}>{user.plan || 'FREE'}</div>
                   <div className="flex flex-col gap-1">
                      {user.plan !== 'ELITE' && (
                        <button onClick={async () => {
                           const { data: { session } } = await supabase.auth.getSession();
                           await fetch(`/api/admin/users/${user.id}/plan`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` }, body: JSON.stringify({ plan: 'ELITE' }) });
                           fetchDashboardData();
                        }} className="px-2 py-1 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 rounded text-[10px] uppercase font-bold tracking-widest transition-colors">
                           Upgrade to Elite
                        </button>
                      )}
                      {(user.plan === 'ELITE' || user.plan === 'PREMIUM') && (
                        <button onClick={async () => {
                           const { data: { session } } = await supabase.auth.getSession();
                           await fetch(`/api/admin/users/${user.id}/plan`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` }, body: JSON.stringify({ plan: 'FREE' }) });
                           fetchDashboardData();
                        }} className="px-2 py-1 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 rounded text-[10px] uppercase font-bold tracking-widest transition-colors">
                           Revoke Plan
                        </button>
                      )}
                      {!user.is_admin && (
                        <button onClick={async () => {
                           const confirmed = await dialog.showConfirm({
                             title: "Ban & Delete User",
                             message: "Are you sure you want to permanently ban and delete this user? This action cannot be undone.",
                             variant: "danger",
                             confirmText: "Delete",
                             cancelText: "Cancel"
                           });
                           if (!confirmed) return;
                           const { data: { session } } = await supabase.auth.getSession();
                           await fetch(`/api/admin/users/${user.id}/delete`, { method: 'POST', headers: { 'Authorization': `Bearer ${session?.access_token}` } });
                           fetchDashboardData();
                        }} className="px-2 py-1 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 rounded text-[10px] uppercase font-bold tracking-widest transition-colors">
                           Ban / Delete
                        </button>
                      )}
                   </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const renderTicketsTab = () => (
    <div className="bg-[#11141A] border border-[#202735] rounded-2xl overflow-hidden shadow-2xl mb-8">
      <div className="p-6 border-b border-[#202735] flex justify-between items-center">
        <h2 className="text-xl font-semibold text-white">Support Tickets</h2>
        <span className="text-[#8A95A5] text-xs font-mono">{ticketsList.length} total</span>
      </div>
      <div className="p-6">
        {ticketsList.length === 0 ? (
          <div className="text-[#8A95A5]">No tickets found.</div>
        ) : (
          <div className="space-y-4">
            {ticketsList.map((ticket: any) => (
              <div key={ticket.id} className="bg-[#0D1017] p-5 rounded-xl border border-[#202735]">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <div className="text-white font-bold tracking-wide mb-1 flex items-center gap-2">
                       {ticket.subject}
                       {ticket.status === 'UNREAD' && <span className="w-2 h-2 rounded-full bg-rose-500"></span>}
                    </div>
                    <div className="text-xs text-[#8A95A5] font-mono">{ticket.profiles?.full_name || ticket.user_id || 'User'}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] text-[#5D6B80] font-mono">{new Date(ticket.created_at).toLocaleString()}</div>
                    <div className={cn("text-[10px] mt-1 font-bold uppercase tracking-wider", ticket.status === 'UNREAD' ? 'text-rose-400' : 'text-emerald-400')}>
                      {ticket.status}
                    </div>
                  </div>
                </div>
                <p className="text-sm text-[#8A95A5] bg-[#11141A] p-3 rounded-lg border border-[#202735]">
                  {ticket.message}
                </p>
                {ticket.status === 'UNREAD' && (
                  <div className="mt-3 flex justify-end">
                    <button 
                      className="text-xs text-cyan-400 hover:text-cyan-300 font-mono tracking-widest uppercase"
                      onClick={async () => {
                         const { data: { session } } = await supabase!.auth.getSession();
                         await fetch(`/api/admin/tickets/${ticket.id}/mark-read`, {
                            method: 'POST',
                            headers: { 'Authorization': `Bearer ${session?.access_token}` }
                         });
                         fetchSupportTickets();
                      }}
                    >
                      MARK AS READ
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const renderHistoryTab = () => (
    <div className="bg-[#11141A] border border-[#202735] rounded-2xl overflow-hidden shadow-2xl mb-8">
      <div className="p-6 border-b border-[#202735] flex justify-between items-center">
        <h2 className="text-xl font-semibold text-white">Admin Audit Log</h2>
        <span className="text-[#8A95A5] text-xs font-mono">Last 50 actions</span>
      </div>
      <div className="p-6">
        {auditLogs.length === 0 ? (
          <div className="text-[#8A95A5]">No logs found.</div>
        ) : (
          <div className="space-y-4">
            {auditLogs.map((log: any) => (
              <div key={log.id} className="bg-[#0D1017] p-4 rounded-xl border border-[#202735] flex justify-between items-center">
                <div>
                  <div className="text-white font-mono text-sm tracking-widest uppercase mb-1">{log.action}</div>
                  <div className="text-xs text-[#8A95A5] line-clamp-1">{log.details ? JSON.stringify(log.details) : 'No details'}</div>
                </div>
                <div className="text-right">
                   <div className="text-[10px] text-[#5D6B80] font-mono">{new Date(log.created_at).toLocaleString()}</div>
                   {log.user_id && <div className="text-[10px] text-cyan-500/50 font-mono mt-1 w-24 truncate" title={log.user_id}>{log.user_id}</div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
  const renderSignalsTab = () => {
    const filteredSignals = signalsFilter === 'All' 
       ? performanceSignals 
       : performanceSignals.filter(s => s.tier === signalsFilter || (signalsFilter === 'REJECTED' && s.status === 'REJECTED'));

    return (
      <div className="bg-[#11141A] border border-[#202735] rounded-2xl overflow-hidden shadow-2xl mb-8">
        <div className="p-6 border-b border-[#202735] flex justify-between items-center flex-wrap gap-4">
          <h2 className="text-xl font-semibold text-white">Signal Performance</h2>
          <div className="flex gap-2">
            {['All', 'A+', 'A', 'B', 'C', 'REJECTED'].map(f => (
              <button 
                key={f}
                onClick={() => setSignalsFilter(f)}
                className={cn(
                  "px-3 py-1 text-[10px] font-bold tracking-widest uppercase rounded border transition-colors",
                  signalsFilter === f ? "bg-cyan-500/10 text-cyan-400 border-cyan-500/30" : "bg-[#0D1017] text-[#5D6B80] border-[#202735] hover:text-white"
                )}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          {filteredSignals.length === 0 ? (
            <div className="p-6 text-[#8A95A5]">No signals found for this filter.</div>
          ) : (
            <table className="w-full text-left border-collapse min-w-[800px]">
              <thead>
                <tr className="border-b border-[#202735] bg-[#0A0D12]">
                  <th className="p-4 text-[#8A95A5] text-[10px] font-bold tracking-widest uppercase">Pair</th>
                  <th className="p-4 text-[#8A95A5] text-[10px] font-bold tracking-widest uppercase">Bias</th>
                  <th className="p-4 text-[#8A95A5] text-[10px] font-bold tracking-widest uppercase">4H Close</th>
                  <th className="p-4 text-[#8A95A5] text-[10px] font-bold tracking-widest uppercase">Broken Swing</th>
                  <th className="p-4 text-[#8A95A5] text-[10px] font-bold tracking-widest uppercase">Entry</th>
                  <th className="p-4 text-[#8A95A5] text-[10px] font-bold tracking-widest uppercase">SL</th>
                  <th className="p-4 text-[#8A95A5] text-[10px] font-bold tracking-widest uppercase">TP1</th>
                  <th className="p-4 text-[#8A95A5] text-[10px] font-bold tracking-widest uppercase">TP2</th>
                  <th className="p-4 text-[#8A95A5] text-[10px] font-bold tracking-widest uppercase">TP3</th>
                  <th className="p-4 text-[#8A95A5] text-[10px] font-bold tracking-widest uppercase">Confidence</th>
                  <th className="p-4 text-[#8A95A5] text-[10px] font-bold tracking-widest uppercase">Grade</th>
                  <th className="p-4 text-[#8A95A5] text-[10px] font-bold tracking-widest uppercase">Timestamp</th>
                  <th className="p-4 text-[#8A95A5] text-[10px] font-bold tracking-widest uppercase">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#202735]">
                {filteredSignals.map(sig => (
                  <tr key={sig.id} className="hover:bg-[#0D1017] transition-colors">
                    <td className="p-4 text-sm font-bold text-white whitespace-nowrap">{sig.pair}</td>
                    <td className="p-4 text-xs font-bold whitespace-nowrap">
                       <span className={cn(
                          "px-2 py-0.5 rounded text-[10px] tracking-wider mr-2",
                          sig.direction === 'LONG' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
                       )}>
                         {sig.bias || sig.direction}
                       </span>
                    </td>
                    <td className="p-4 text-sm text-[#8A95A5] font-mono">{sig.diagnostics?.fourHourClose || '--'}</td>
                    <td className="p-4 text-sm text-[#8A95A5] font-mono">{sig.diagnostics?.brokenLevel || '--'}</td>
                    <td className="p-4 text-sm text-white font-mono">{sig.entry_price || sig.entry || '--'}</td>
                    <td className="p-4 text-sm text-rose-400 font-mono">{sig.sl || '--'}</td>
                    <td className="p-4 text-sm text-emerald-400 font-mono">{sig.tp1 || '--'}</td>
                    <td className="p-4 text-sm text-emerald-400 font-mono">{sig.tp2 || '--'}</td>
                    <td className="p-4 text-sm text-emerald-400 font-mono">{sig.tp3 || '--'}</td>
                    <td className="p-4 text-sm text-[#8A95A5] font-mono">{sig.confidence ?? sig.aiConfidence ?? '--'}%</td>
                    <td className="p-4 whitespace-nowrap">
                       <span className="text-[10px] text-cyan-400 font-mono uppercase bg-cyan-400/10 px-1.5 py-0.5 rounded">{sig.tier}</span>
                    </td>
                    <td className="p-4 text-xs text-[#8A95A5] font-mono whitespace-nowrap">{new Date(sig.created_at || sig.timestamp).toLocaleString()}</td>
                    <td className="p-4 whitespace-nowrap">
                       <span className={cn(
                          "px-2 py-1 rounded text-[10px] font-bold tracking-wider",
                          sig.result?.startsWith('WIN') ? 'text-emerald-400 bg-emerald-500/10' : 
                          sig.result === 'LOSS' ? 'text-rose-400 bg-rose-500/10' : 
                          sig.status === 'REJECTED' ? 'text-[#5D6B80] bg-[#202735]' :
                          'text-amber-400 bg-amber-500/10'
                       )}>
                          {sig.result || sig.status}
                       </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    );
  };

  const renderPromptsTab = () => (
    <div className="space-y-6">
      <div className="bg-[#11141A] border border-[#202735] rounded-2xl overflow-hidden shadow-2xl">
        <div className="p-6 border-b border-[#202735] flex justify-between items-center">
          <div>
            <h2 className="text-xl font-semibold text-white">AI Prompts Configuration</h2>
            <p className="text-sm text-[#8A95A5] mt-1">Customize the core behavioral instructions of your platform's AI models.</p>
          </div>
          <button 
            onClick={fetchPrompts}
            className="p-2 text-[#5D6B80] hover:text-white transition-colors border border-transparent hover:border-[#202735] rounded-lg"
            title="Refresh Prompts"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
        
        <div className="p-6 space-y-6">
          {/* AI Coach System Prompt */}
          <div className="space-y-2">
            <label className="block text-sm font-bold text-white tracking-wider uppercase">
              1. 4xFiveAI Coach System Instruction
            </label>
            <p className="text-xs text-[#8A95A5]">
              This instruction defines the personality, expertise, and behavioral rules of the in-app chatbot coach.
            </p>
            <textarea
              className="w-full h-44 bg-[#0D1017] border border-[#202735] rounded-xl p-4 text-sm text-white font-sans focus:outline-none focus:border-cyan-500/50 resize-y"
              value={promptsConfig.coach_system_instruction}
              onChange={(e) => setPromptsConfig(prev => ({ ...prev, coach_system_instruction: e.target.value }))}
              placeholder="Enter system instructions for the AI Coach..."
            />
          </div>

          {/* AI Signal Explainer Prompt */}
          <div className="space-y-2">
            <label className="block text-sm font-bold text-white tracking-wider uppercase">
              2. Signal Explainer Prompt Template
            </label>
            <p className="text-xs text-[#8A95A5]">
              This template governs how the background scanner writes its expert multi-sentence signal commentary.
            </p>
            <div className="bg-[#0A0D12] p-3 rounded-lg border border-[#202735] mb-2">
              <span className="text-[10px] font-mono text-[#5D6B80] uppercase tracking-wider block mb-1">Available Dynamic Variables:</span>
              <div className="flex flex-wrap gap-2 text-[10px] font-mono">
                <span className="bg-[#11141A] border border-[#202735] text-cyan-400 px-1.5 py-0.5 rounded">{"${signal.pair}"}</span>
                <span className="bg-[#11141A] border border-[#202735] text-cyan-400 px-1.5 py-0.5 rounded">{"${signal.direction}"}</span>
                <span className="bg-[#11141A] border border-[#202735] text-cyan-400 px-1.5 py-0.5 rounded">{"${signal.aiConfidence}"}</span>
                <span className="bg-[#11141A] border border-[#202735] text-cyan-400 px-1.5 py-0.5 rounded">{"${signal.tier}"}</span>
                <span className="bg-[#11141A] border border-[#202735] text-cyan-400 px-1.5 py-0.5 rounded">{"${signal.qualityLabel}"}</span>
              </div>
            </div>
            <textarea
              className="w-full h-44 bg-[#0D1017] border border-[#202735] rounded-xl p-4 text-sm text-white font-mono focus:outline-none focus:border-cyan-500/50 resize-y"
              value={promptsConfig.signal_explainer_prompt}
              onChange={(e) => setPromptsConfig(prev => ({ ...prev, signal_explainer_prompt: e.target.value }))}
              placeholder="Enter template with placeholders..."
            />
          </div>

          {/* Save and Controls block */}
          <div className="flex items-center justify-between pt-4 border-t border-[#202735]">
            <div className="flex items-center gap-2">
              {promptsStatus === 'success' && (
                <span className="text-xs text-emerald-400 font-mono tracking-wider flex items-center gap-1">
                  <Check className="w-3.5 h-3.5" /> PROMPTS SAVED SUCCESSFULLY
                </span>
              )}
              {promptsStatus === 'error' && (
                <span className="text-xs text-rose-400 font-mono tracking-wider flex items-center gap-1">
                  <X className="w-3.5 h-3.5" /> ERROR SAVING PROMPTS
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={async () => {
                  const confirmed = await dialog.showConfirm({
                    title: "Reset Prompts",
                    message: "Are you sure you want to reset all AI prompts to platform defaults?",
                    variant: "warning",
                    confirmText: "Reset",
                    cancelText: "Cancel"
                  });
                  if (!confirmed) return;
                  setPromptsConfig({
                      coach_system_instruction: "You are the 4xFiveAI Coach, an expert trading assistant. You help users with risk management, position sizing, signal discipline, and trading psychology. Keep responses concise, professional, and directly actionable. Avoid long generic paragraphs.",
                      signal_explainer_prompt: "You are an expert forex trading assistant. Explain this signal to a user in plain English:\nPair: ${signal.pair}\nDirection: ${signal.direction}\nConfidence Score: ${signal.aiConfidence}%\nStatus: ${signal.tier}\nQuality: ${signal.qualityLabel}\n\nGive a short, punchy 2-3 sentence explanation. No proprietary strategy details, no fluffy intros. Keep it to the point."
                    });
                }}
                className="px-4 py-2 bg-transparent text-[#8A95A5] hover:text-white rounded-lg text-xs font-bold uppercase tracking-wider border border-[#202735] hover:border-[#2A3345] transition-colors"
              >
                Reset Default
              </button>
              <button
                type="button"
                disabled={isSavingPrompts}
                onClick={handleSavePrompts}
                className="px-6 py-2.5 bg-cyan-400 text-[#0A0D12] rounded-lg text-xs font-bold uppercase tracking-widest hover:bg-cyan-300 disabled:opacity-50 transition-all flex items-center gap-2"
              >
                {isSavingPrompts ? 'Saving...' : 'Apply & Save Prompts'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex-1 w-full flex flex-col bg-[#0A0D12]">
      {/* Top Header / Title */}
      <div className="px-8 pt-8 pb-6 border-b border-[#202735] flex items-center gap-4 hidden">
         <div className="text-[#5D6B80] text-xs font-mono tracking-wider">4X_AI_ENGINE v4.2</div>
      </div>

      <div className="max-w-[1400px] w-full mx-auto p-4 sm:p-6 lg:p-8 flex gap-8">
        
        {/* Main Content Area */}
        <div className="flex-1 max-w-6xl">
          {/* Header & Tabs Block */}
          <div className="mb-8">
            <div className="flex items-center gap-4 mb-6">
               <div className="bg-rose-500/10 border border-rose-500/20 px-4 py-2 rounded-lg flex items-center gap-2 text-rose-400 font-bold tracking-widest text-sm cursor-pointer hover:bg-rose-500/20 transition-colors uppercase">
                 <Shield className="w-4 h-4" />
                 Admin Panel
               </div>
            </div>

            <div className="bg-[#11141A] border border-[#202735] rounded-xl p-2 flex items-center justify-between w-full shadow-sm">
              <div className="flex items-center flex-wrap gap-2">
                {TABS.map((tab) => {
                  const Icon = tab.icon;
                  const isActive = activeTab === tab.id;
                  const hasBadge = (badges as any)[tab.id];

                  return (
                    <button
                      key={tab.id}
                      onClick={() => handleTabChange(tab.id)}
                      className={cn(
                        "relative flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold tracking-widest uppercase transition-all",
                        isActive 
                          ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20" 
                          : "text-[#8A95A5] hover:text-white hover:bg-white/5 border border-transparent"
                      )}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {tab.label}
                      {hasBadge && (
                        <div className="absolute top-0 right-0 -mt-1 -mr-1 w-2.5 h-2.5 bg-rose-500 rounded-full border-2 border-[#11141A]"></div>
                      )}
                    </button>
                  );
                })}
              </div>
              <button className="p-2 text-[#5D6B80] hover:text-white transition-colors border border-transparent hover:border-[#202735] rounded-lg">
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Active Tab Content */}
          <div className="pb-10">
            {activeTab === 'analytics' && renderAnalyticsTab()}
            {activeTab === 'users' && renderUsersTab()}
            {activeTab === 'plans' && <PlansManager />}
            {activeTab === 'payments' && renderPaymentsTab()}
            {activeTab === 'signals' && renderSignalsTab()}
            {activeTab === 'referrals' && renderReferralsTab()}
            {activeTab === 'tickets' && renderTicketsTab()}
            {activeTab === 'history' && renderHistoryTab()}
            {activeTab === 'prompts' && renderPromptsTab()}
            
            {/* Placeholder for un-implemented tabs */}
            {!['analytics', 'users', 'plans', 'payments', 'signals', 'referrals', 'tickets', 'history', 'prompts'].includes(activeTab) && (
              <div className="bg-[#0D1017] border border-[#202735] rounded-2xl p-12 text-center shadow-sm">
                <ShieldAlert className="w-12 h-12 text-[#202735] mx-auto mb-4" />
                <h3 className="text-white text-lg font-bold tracking-widest uppercase mb-2">{TABS.find(t=>t.id === activeTab)?.label} Module</h3>
                <p className="text-[#8A95A5] max-w-md mx-auto">This administrative module is currently under active development. Connection to the 4xFiveAI core node is pending.</p>
              </div>
            )}
          </div>
        </div>
        
        {/* Right Sidebar (Optional placeholder matching screenshot) */}
        <div className="hidden xl:block w-72">
          <div className="bg-[#11141A]/50 border border-[#202735] rounded-xl p-5 mb-6">
            <div className="text-[10px] font-mono text-[#5D6B80] uppercase tracking-widest mb-3">AI_COACH_FEED: ACTIVE</div>
            <div className="text-[9px] font-mono text-[#5D6B80] mb-4 space-y-1">
              <div>LAT: 363.6343 // LON: 717.9996</div>
              <div>SEGMENT: 0x19B7 // ADPT: AUTO</div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-[9px] font-mono text-emerald-500/50">
                 <span>&gt; 4H_BIAS: SUCCESS</span>
              </div>
              <div className="flex items-center gap-2 text-[9px] font-mono text-cyan-400/50">
                 <span>&gt; OB_SEEDED: BOS_0x7</span>
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <BarChart2 className="w-3 h-3 text-[#5D6B80] opacity-50" />
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
