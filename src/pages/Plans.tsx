import React, { useState, useEffect } from 'react';
import { Shield, Check, Copy, Wallet, ArrowRight, Sparkles, Clock, Info } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useDialog } from '../components/ConfirmDialog';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function Plans() {
  const dialog = useDialog();
  const { user } = useAuth();
  const [isPremium, setIsPremium] = useState(false);
  const [showUpgradeForm, setShowUpgradeForm] = useState(false);
  const [network, setNetwork] = useState('TRC20');
  const [txid, setTxid] = useState('');
  const [paymentStatus, setPaymentStatus] = useState<string | null>(null);
  const [copied, setCopied] = useState('');
  const [wallets, setWallets] = useState({ trc20: '', bep20: '' });
  
  const [dbPlans, setDbPlans] = useState<any[]>([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [plansError, setPlansError] = useState<string | null>(null);

  useEffect(() => {
    // Fetch plans from DB
    const fetchPlans = async () => {
      setPlansLoading(true);
      const { data, error } = await supabase.from('plans').select('*').order('created_at', { ascending: true });
      if (error) {
        console.error("Error fetching plans:", error);
        setPlansError(error.message);
      } else if (data) {
        setDbPlans(data);
      }
      setPlansLoading(false);
    };
    fetchPlans();

    if (!user) return;
    
    // Check if user has an elite/premium plan
    const checkStatus = async () => {
       const { data: userRecord } = await supabase.from('users').select('plan_status, credits').eq('email', user.email).single();
       if (userRecord?.plan_status === 'PREMIUM' || userRecord?.plan_status === 'ELITE' || (userRecord?.credits || 0) > 0) {
          setIsPremium(true);
       }
       
       // Check for pending payments
       const { data: sessionData } = await supabase.auth.getSession();
       const accessToken = sessionData.session?.access_token;
       if (accessToken) {
         const res = await fetch(`/api/payments/${encodeURIComponent(user.email || '')}/status`, {
          headers: { 'Authorization': `Bearer ${accessToken}` }
         });
         const payment = res.ok ? await res.json() : null;
         if (payment?.status === 'PENDING') {
            setPaymentStatus('PENDING');
         } else if (payment?.status === 'CONFIRMED') {
            setIsPremium(true);
         }
       }
    };
    checkStatus();

    fetch('/api/config')
      .then(res => res.json())
      .then(data => {
        if (data.USDT_TRC20_ADDRESS) {
          setWallets({
            trc20: data.USDT_TRC20_ADDRESS,
            bep20: data.USDT_BEP20_ADDRESS
          });
        }
      })
      .catch(console.error);
  }, [user]);

  const handleCopy = (text: string, type: string) => {
    navigator.clipboard.writeText(text);
    setCopied(type);
    setTimeout(() => setCopied(''), 2000);
  };

  const handleSubmitProof = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!txid) return;
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) {
        await dialog.showAlert({
          title: "Session Expired",
          message: "Please log out and log back in, then submit your payment again.",
          variant: "warning",
        });
        return;
      }

      const res = await fetch('/api/payments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({ email: user.email, network, txid, plan: 'PREMIUM', amount_usd: 20, credits: 25 })
      });
      const data = await res.json();
      if (!res.ok) {
         console.error(data);
         await dialog.showAlert({
           title: "Payment Error",
           message: data.error || "Failed to submit payment. Please try again.",
           variant: "danger",
         });
         return;
      }
      setPaymentStatus('PENDING');
      setShowUpgradeForm(false);
      setTxid('');
      await dialog.showAlert({
        title: "Payment Submitted",
        message: "Your payment has been submitted for review. We will activate your account within 24 hours.",
        variant: "success",
      });
    } catch (err) {
      console.error(err);
      await dialog.showAlert({
        title: "Payment Error",
        message: "Failed to submit payment. Please try again.",
        variant: "danger",
      });
    }
  };

  return (
    <div className="flex-1 w-full relative overflow-hidden bg-[#0A0D12]">
      {/* Background ambient glow matching screenshot */}
      <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-teal-500/10 blur-[120px] rounded-full pointer-events-none -translate-y-1/2"></div>
      
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16 relative z-10">
        
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-teal-500/10 border border-teal-500/20 text-teal-400 text-xs font-semibold tracking-wide uppercase mb-6">
            <Sparkles className="w-4 h-4" />
            Special Summer Discount Active
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-white mb-6 tracking-tight">Supercharge Your trading</h1>
          <p className="text-[#8A95A5] text-lg max-w-2xl mx-auto leading-relaxed">
            Access the industry's most advanced automated Smart Money Concepts (SMC) scanning suite.<br/>
            Achieve full-edge consistency.
          </p>
        </div>

        {/* Pricing Cards */}
        <div className="grid md:grid-cols-2 gap-8 mb-12">
          
          {plansLoading ? (
            <div className="col-span-2 text-center text-[#8A95A5] py-12">Loading plans...</div>
          ) : plansError ? (
            <div className="col-span-2 text-center text-rose-400 py-12 bg-rose-500/10 rounded-xl border border-rose-500/20">
              <p className="font-bold mb-2">Error loading plans</p>
              <p className="text-sm">{plansError}</p>
            </div>
          ) : dbPlans.length > 0 ? dbPlans.map((plan) => (
            <div key={plan.id} className={cn(
              "rounded-3xl p-8 flex flex-col relative overflow-hidden",
              plan.is_popular 
                ? "bg-[#0D101A] border-2 border-teal-500/30 shadow-[0_0_40px_rgba(20,184,166,0.1)]" 
                : "bg-[#0D101A] border border-[#202735]"
            )}>
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  {plan.name} {plan.is_popular && <span className="text-amber-500">🔥</span>}
                </h2>
                {plan.is_popular ? (
                  <span className="px-3 py-1 bg-teal-500/10 border border-teal-500/20 text-teal-400 rounded-full text-xs font-semibold uppercase tracking-wider relative">
                    Most Popular
                    <span className="absolute -top-1 -right-1 flex h-3 w-3">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-teal-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-teal-500"></span>
                    </span>
                  </span>
                ) : (
                  <span className="px-3 py-1 bg-[#202735] text-[#8A95A5] rounded-full text-xs font-semibold uppercase tracking-wider">Starter</span>
                )}
              </div>
              
              {!plan.is_popular || !showUpgradeForm ? (
                <>
                  <div className="mb-6">
                    <div className="flex items-end gap-2">
                      <span className="text-5xl font-bold text-white">{plan.price}</span>
                      {plan.original_price && <span className="text-[#8A95A5] line-through text-lg mb-1">{plan.original_price}</span>}
                      {plan.billing_period && <span className="text-[#8A95A5] mb-2">{plan.billing_period}</span>}
                    </div>
                  </div>
                  <p className="text-[#8A95A5] mb-8 text-sm leading-relaxed">
                    {plan.name === 'Free' 
                      ? "Explore the core intelligence of algorithmic SMC market analysis absolutely free." 
                      : "Unlock complete premium analytical scanners, instant notifications, and institutional elite execution templates."}
                  </p>
                  <ul className="space-y-4 mb-auto text-[#E0E4EA]">
                    {plan.features.map((feature: string, idx: number) => (
                      <li key={idx} className="flex items-center gap-3">
                        <div className="w-5 h-5 rounded-full bg-teal-500/20 flex items-center justify-center shrink-0">
                          <Check className="w-3.5 h-3.5 text-teal-400" />
                        </div>
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                  
                  <div className="mt-10">
                    {plan.name === 'Free' ? (
                      <button disabled className="w-full py-4 rounded-xl bg-[#1A2235] text-[#8A95A5] font-bold text-sm tracking-widest uppercase cursor-not-allowed">
                        {isPremium ? "Available" : "Free Account Logged"}
                      </button>
                    ) : isPremium ? (
                      <button disabled className="w-full py-4 rounded-xl bg-teal-500/10 text-teal-400 border border-teal-500/20 font-bold text-sm tracking-widest uppercase shadow-[0_0_15px_rgba(20,184,166,0.2)]">
                        Your Current Plan
                      </button>
                    ) : paymentStatus === 'PENDING' ? (
                       <button disabled className="w-full py-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 font-bold text-sm tracking-widest uppercase">
                         Payment Pending
                       </button>
                    ) : (
                      <button onClick={() => setShowUpgradeForm(true)} className="w-full py-4 rounded-xl bg-teal-500 hover:bg-teal-400 text-[#052e26] font-bold text-sm tracking-widest uppercase transition-all shadow-[0_0_20px_rgba(20,184,166,0.3)]">
                        Upgrade Now
                      </button>
                    )}
                  </div>
                </>
              ) : (
                // Payment Form Flow for Premium
                <div className="animate-in fade-in zoom-in-95 duration-300 flex flex-col h-full">
                <button onClick={() => setShowUpgradeForm(false)} className="text-sm text-[#8A95A5] hover:text-white mb-4 self-start">
                  &larr; Back to plan details
                </button>
                <h4 className="text-white font-semibold mb-4 flex items-center gap-2">
                  <Wallet className="w-5 h-5 text-teal-400" />
                  Select Network and Send Payment
                </h4>
                
                <div className="grid gap-4 mb-6">
                  <div className="bg-[#11141A] p-4 rounded-xl border border-[#202735]">
                    <div className="text-sm text-[#8A95A5] mb-2 font-medium">USDT (TRC-20)</div>
                    <div className="flex items-center justify-between gap-2">
                      <code className="text-white font-mono text-xs truncate select-all">{wallets.trc20 || "Loading..."}</code>
                      <button onClick={() => handleCopy(wallets.trc20, 'trc20')} disabled={!wallets.trc20} className="p-2 hover:bg-[#202735] rounded-lg transition-colors group disabled:opacity-50">
                        {copied === 'trc20' ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-[#8A95A5] group-hover:text-white" />}
                      </button>
                    </div>
                  </div>
                  
                  <div className="bg-[#11141A] p-4 rounded-xl border border-[#202735]">
                    <div className="text-sm text-[#8A95A5] mb-2 font-medium">USDT (BEP-20)</div>
                    <div className="flex items-center justify-between gap-2">
                      <code className="text-white font-mono text-xs truncate select-all">{wallets.bep20 || "Loading..."}</code>
                      <button onClick={() => handleCopy(wallets.bep20, 'bep20')} disabled={!wallets.bep20} className="p-2 hover:bg-[#202735] rounded-lg transition-colors group disabled:opacity-50">
                        {copied === 'bep20' ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-[#8A95A5] group-hover:text-white" />}
                      </button>
                    </div>
                  </div>
                </div>

                <form onSubmit={handleSubmitProof} className="mt-auto">
                  <div className="grid gap-4 mb-6">
                    <div>
                      <label className="block text-sm font-medium text-[#8A95A5] mb-1">Network Used</label>
                      <select 
                        value={network}
                        onChange={(e) => setNetwork(e.target.value)}
                        className="w-full bg-[#0D1017] border border-[#202735] rounded-lg px-4 py-3 text-white outline-none focus:border-teal-500 transition-colors"
                      >
                        <option value="TRC20">USDT TRC-20 (Tron)</option>
                        <option value="BEP20">USDT BEP-20 (BSC)</option>
                      </select>
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-[#8A95A5] mb-1">Transaction Hash (TXID)</label>
                      <input 
                        type="text" 
                        required
                        value={txid}
                        onChange={(e) => setTxid(e.target.value)}
                        placeholder="Paste transaction hash..."
                        className="w-full bg-[#0D1017] border border-[#202735] rounded-lg px-4 py-3 text-white outline-none focus:border-teal-500 transition-colors font-mono text-sm"
                      />
                    </div>
                  </div>
                  
                  <button type="submit" className="w-full py-4 bg-teal-500 hover:bg-teal-400 text-[#052e26] rounded-xl font-bold tracking-widest uppercase transition-colors flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(20,184,166,0.2)]">
                     Submit Verification
                     <ArrowRight className="w-4 h-4" />
                  </button>
                </form>
              </div>
            )}
          </div>
          )) : (
            <div className="col-span-2 text-center text-[#8A95A5] py-12">No plans configured yet.</div>
          )}
        </div>

        {/* Global info notice */}
        <div className="max-w-4xl mx-auto bg-[#0D101A] border border-[#202735] rounded-2xl p-5 flex items-start gap-4">
          <div className="mt-0.5">
            <Info className="w-5 h-5 text-teal-500" />
          </div>
          <p className="text-sm text-[#8A95A5] leading-relaxed">
            Submitting crypto subscription renewals is protected by blockchain tx verification. Payments will be credited as soon as our validation nodes fetch the transactions (~10 minutes to 3 hours maximum).
          </p>
        </div>

      </div>
    </div>
  );
}
