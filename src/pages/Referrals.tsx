import { useState, useEffect } from 'react';
import { Gift, Link2, Copy, Send, Users, CircleDollarSign, CheckCircle2, History, Percent, Sparkles } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { useAuth } from '../context/AuthContext';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface PayoutRequest {
  id: string;
  email: string;
  amount: number;
  status: string;
  created_at: string;
}

export default function Referrals() {
  const [copied, setCopied] = useState(false);
  const referralCode = '4xlife.ai/ref/trader_99x';
  const { session } = useAuth();
  
  const [balance, setBalance] = useState(0);
  const [paidReferrals, setPaidReferrals] = useState(0);
  const [payouts, setPayouts] = useState<PayoutRequest[]>([]);
  const [claiming, setClaiming] = useState(false);

  useEffect(() => {
    if (session) {
      fetchReferrals();
    }
  }, [session]);

  const fetchReferrals = async () => {
    if (!session) return;
    try {
      const res = await fetch('/api/referrals', {
        headers: {
          'Authorization': `Bearer ${session.access_token}`
        }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setBalance(data.balance);
      setPaidReferrals(data.paid_referrals);
      setPayouts(data.payouts);
    } catch (e) {
      console.error(e);
    }
  };

  const handleClaim = async () => {
    if (balance <= 0 || !session) return;
    setClaiming(true);
    try {
      const res = await fetch('/api/referrals/claim', { 
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`
        }
      });
      if (res.ok) {
        await fetchReferrals();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setClaiming(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(`https://${referralCode}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleTelegramShare = () => {
    const text = "Get 3 free days of premium 4xLifeAI signals when you use my link!";
    const url = `https://t.me/share/url?url=https://${referralCode}&text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
  };

  return (
    <div className="flex-1 w-full relative overflow-hidden bg-[#0A0D12]">
      {/* Background ambient glow */}
      <div className="absolute top-0 right-1/4 w-[600px] h-[600px] bg-teal-500/5 blur-[120px] rounded-full pointer-events-none -translate-y-1/2"></div>
      
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16 relative z-10 space-y-8">
        
        {/* Top Pill label */}
        <div className="inline-flex items-center gap-2 px-4 py-2 border border-teal-500/20 bg-teal-500/5 rounded-full text-teal-400 text-sm font-bold tracking-widest uppercase mb-4 shadow-[0_0_15px_rgba(20,184,166,0.1)]">
            <Percent className="w-4 h-4" />
            Referral Ecosystem
        </div>

        {/* Hero Banner Grid Box format */}
        <div className="relative bg-[#0D101A] border border-[#202735] rounded-2xl p-8 md:p-12 overflow-hidden shadow-2xl">
            {/* Background Icon */}
            <Gift className="w-[300px] h-[300px] text-[#111620] absolute -right-12 top-1/2 -translate-y-1/2 pointer-events-none" />
            
            <div className="relative z-10 w-full max-w-3xl">
                <div className="inline-flex items-center gap-2 px-3 py-1 bg-teal-500/10 text-teal-400 rounded-full text-xs font-bold tracking-widest uppercase mb-6">
                    <Sparkles className="w-3.5 h-3.5" />
                    4xLifeAI Referral Campaign
                </div>
                <h1 className="text-3xl md:text-4xl font-bold text-white mb-4 tracking-tight">Invite Friends & Earn 10% Cash Commission</h1>
                <p className="text-[#8A95A5] text-lg leading-relaxed mb-1">
                    Help grow the 4xLifeAI Smart Money Concepts (SMC) quantitative trading circle! When your friends sign up via your unique invitation code and upgrade to Premium, you receive a <span className="text-teal-400 font-semibold">10% cash commission ($2.50)</span> paid directly in USDT.
                </p>
                <p className="text-[#5D6B80] text-sm">
                    They also get a 3-day free Premium trial upon email verification!
                </p>
            </div>
        </div>

        {/* Link Section */}
        <div className="space-y-4 pt-4">
            <div className="flex flex-col md:flex-row md:justify-between md:items-end gap-2">
                <div>
                    <h3 className="text-white font-bold uppercase tracking-wider text-sm mb-1">Your Personal Referral Link</h3>
                    <p className="text-[#8A95A5] text-sm">Share this unique URL. Our validation node captures cookies instantly to attribute any signup records back directly to your account.</p>
                </div>
                <div className="font-mono text-[10px] text-[#5D6B80] tracking-widest uppercase mb-1">
                    Metric_Sweep <span className="text-teal-400 ml-1">Stable</span>
                </div>
            </div>
            
            <div className="flex flex-col sm:flex-row bg-[#0D101A] border border-[#202735] rounded-xl p-2 sm:items-center shadow-lg gap-2 sm:gap-0">
                <div className="hidden sm:block pl-4 pr-2">
                    <Link2 className="w-5 h-5 text-[#8A95A5]" />
                </div>
                <input 
                    type="text" 
                    readOnly 
                    value={`https://${referralCode}`}
                    className="flex-1 bg-transparent border-none text-teal-100 px-4 sm:px-2 py-3 sm:py-0 focus:ring-0 font-medium font-mono text-sm outline-none selection:bg-teal-500/30 w-full"
                />
                <button 
                    onClick={handleCopy}
                    className="px-6 py-3.5 bg-teal-500 hover:bg-teal-400 text-[#052E26] rounded-lg font-bold text-sm tracking-widest uppercase transition-colors flex items-center justify-center gap-2 shadow-[0_0_15px_rgba(20,184,166,0.3)] min-w-max"
                >
                    {copied ? <CheckCircle2 className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    Copy Invite Link
                </button>
            </div>
        </div>

        {/* Stats Grid */}
        <div className="grid md:grid-cols-3 gap-6 pt-4">
            <div className="bg-[#0D101A] border border-[#202735] p-6 rounded-xl relative overflow-hidden">
                <div className="flex items-center gap-2 text-[#8A95A5] font-bold text-xs tracking-widest uppercase mb-4">
                    <Users className="w-4 h-4" /> Paid Referrals
                </div>
                <div className="text-3xl font-bold text-white mb-1">{paidReferrals}</div>
                <div className="text-xs text-[#5D6B80]">Active Premium Subscriptions</div>
            </div>

            <div className="bg-[#0D101A] border border-[#202735] p-6 rounded-xl relative overflow-hidden">
                <div className="flex items-center gap-2 text-teal-400 font-bold text-xs tracking-widest uppercase mb-4">
                    <CircleDollarSign className="w-4 h-4" /> Commission Balance
                </div>
                <div className="text-3xl font-bold text-teal-400 mb-1">${balance != null ? Number(balance).toFixed(2) : '0.00'}</div>
                <div className="text-xs text-[#5D6B80]">Ready to claim in USDT</div>
            </div>
            
            <div className="bg-[#0D101A] border border-[#202735] p-6 rounded-xl relative flex flex-col justify-center">
                <button 
                    onClick={handleClaim} 
                    disabled={balance <= 0 || claiming}
                    className="w-full py-3.5 bg-transparent border border-teal-500/50 hover:bg-teal-500/10 text-teal-400 rounded-lg font-bold text-sm tracking-widest uppercase transition-colors disabled:opacity-30 disabled:border-[#202735] disabled:text-[#8A95A5] disabled:hover:bg-transparent"
                >
                    {claiming ? 'Requesting...' : 'Claim Payout'}
                </button>
                <div className="text-center text-[10px] text-[#5D6B80] tracking-widest uppercase mt-4">
                    Liq_Resonance <span className="line-through">Synced</span>
                </div>
            </div>
        </div>

        {/* Target History */}
        <div className="space-y-4 pt-4">
            <h3 className="text-white font-bold uppercase tracking-wider text-sm">Your Referred Traders List (Payout History)</h3>
            <div className="bg-[#0D101A] border border-[#202735] rounded-xl overflow-hidden min-h-[200px] shadow-lg">
                <div className="relative border-b border-[#202735] border-dashed">
                     <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex items-center justify-center pointer-events-none">
                         <span className="bg-[#0D101A] px-2 text-[10px] text-[#5D6B80] tracking-widest uppercase">Liq_Resonance ——— Synced</span>
                     </div>
                     <div className="py-4"></div>
                </div>

                {payouts.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-[200px] text-[#5D6B80]">
                        <Users className="w-8 h-8 mb-4 opacity-50" />
                        <p className="text-xs font-mono uppercase tracking-widest text-[#8A95A5]">No payouts requested yet.</p>
                        <p className="text-xs opacity-75 mt-2">Share your link above to build your trading circle!</p>
                    </div>
                ) : (
                    <div className="divide-y divide-[#202735]">
                         <div className="grid grid-cols-3 px-6 py-3 bg-[#111520] text-[10px] font-bold tracking-widest text-[#5D6B80] uppercase">
                             <div>Request Date</div>
                             <div>Amount Requested</div>
                             <div className="text-right">Node Status</div>
                         </div>
                         {payouts.map(p => (
                             <div key={p.id} className="grid grid-cols-3 px-6 py-4 items-center text-sm">
                                 <div className="text-[#8A95A5] font-mono text-xs">{new Date(p.created_at).toLocaleDateString()}</div>
                                 <div className="text-white font-medium">${p.amount != null ? Number(p.amount).toFixed(2) : '0.00'}</div>
                                 <div className="text-right">
                                     <span className={cn(
                                         "text-[10px] font-bold tracking-widest uppercase px-3 py-1 rounded-full",
                                         p.status === 'PAID' ? "bg-teal-500/10 text-teal-400 border border-teal-500/20" : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                                     )}>
                                         {p.status}
                                     </span>
                                 </div>
                             </div>
                         ))}
                    </div>
                )}
            </div>
        </div>

      </div>
    </div>
  );
}
