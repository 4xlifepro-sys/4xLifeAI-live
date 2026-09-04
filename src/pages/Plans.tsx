import React, { useState, useEffect } from 'react';
import { Shield, Check, Copy, Wallet, ArrowRight, Sparkles, Clock, Info } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useDialog } from '../components/ConfirmDialog';
import { QRCodeSVG } from 'qrcode.react';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Public receive-only wallet fallbacks (mirror server /api/config defaults)
const DEFAULT_WALLETS = {
  trc20: 'TN3zCR5gACd16f7iDJH97GMB7mKRg3opXe',
  bep20: '0xa061175dd8cd00a87ae55d29a3fc7c31f8cb476a'
};

export default function Plans() {
  const dialog = useDialog();
  const { user } = useAuth();
  const [isPremium, setIsPremium] = useState(false);
  const [showUpgradeForm, setShowUpgradeForm] = useState(false);
  const [network, setNetwork] = useState('TRC20');
  const [txid, setTxid] = useState('');
  const [paymentStatus, setPaymentStatus] = useState<string | null>(null);
  const [copied, setCopied] = useState('');
  const [wallets, setWallets] = useState(DEFAULT_WALLETS);
  
  const [dbPlans, setDbPlans] = useState<any[]>([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [plansError, setPlansError] = useState<string | null>(null);

  const visiblePlans = React.useMemo(() => {
    const proFromDb = dbPlans.find((plan) => String(plan.name || '').toLowerCase() === 'premium')
      || dbPlans.find((plan) => String(plan.name || '').toLowerCase() === 'pro');
    const freeFromDb = dbPlans.find((plan) => String(plan.name || '').toLowerCase() === 'free')
      || dbPlans.find((plan) => String(plan.name || '').toLowerCase() === 'starter');

    const freePlan = freeFromDb || {
      id: 'free',
      name: 'Free',
      price: 0,
      original_price: null,
      billing_period: '/month',
      is_popular: false,
      features: ['Limited signals', 'Basic alerts'],
    };

    const proPlan = proFromDb
      ? {
          ...proFromDb,
          name: 'Pro',
          is_popular: true,
          features: proFromDb.features?.length
            ? proFromDb.features
            : ['Unlimited signals', 'Priority alerts', 'All pairs', 'AI Coach access'],
        }
      : {
          id: 'pro',
          name: 'Pro',
          price: 20,
          original_price: 30,
          billing_period: '/month',
          is_popular: true,
          features: ['Unlimited signals', 'Priority alerts', 'All pairs', 'AI Coach access'],
        };

    return [freePlan, proPlan];
  }, [dbPlans]);

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
    
    const checkStatus = async () => {
       const { data: sessionData } = await supabase.auth.getSession();
       const accessToken = sessionData.session?.access_token;
       if (accessToken) {
         const subscriptionRes = await fetch('/api/auth/subscription', {
           headers: { 'Authorization': `Bearer ${accessToken}` }
         });
         if (subscriptionRes.ok) {
           const subscription = await subscriptionRes.json();
           setIsPremium(subscription?.isPro === true);
         }

         const res = await fetch(`/api/payments/${encodeURIComponent(user.email || '')}/status`, {
          headers: { 'Authorization': `Bearer ${accessToken}` }
         });
         const payment = res.ok ? await res.json() : null;
         if (payment?.status === 'PENDING') {
            setPaymentStatus('PENDING');
         }
       }
    };
    checkStatus();

    fetch('/api/config')
      .then(res => res.json())
      .then(data => {
        setWallets({
          trc20: data?.USDT_TRC20_ADDRESS || DEFAULT_WALLETS.trc20,
          bep20: data?.USDT_BEP20_ADDRESS || DEFAULT_WALLETS.bep20
        });
      })
      .catch(() => setWallets(DEFAULT_WALLETS));
  }, [user]);

  const handleCopy = async (text: string, type: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch {}
      document.body.removeChild(ta);
    }
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
        body: JSON.stringify({ email: user.email, network, txid, plan: 'PRO', amount_usd: 20, credits: 25 })
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
            Access premium automated market scanning, instant alerts, and trade-management tools.<br/>
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
          ) : visiblePlans.map((plan) => (
            <div key={plan.id} className={cn(
               "rounded-3xl p-5 sm:p-8 flex flex-col relative overflow-hidden",
              plan.is_popular 
                ? "bg-[#0D101A] border-2 border-teal-500/30 shadow-[0_0_40px_rgba(20,184,166,0.1)]" 
                : "bg-[#0D101A] border border-[#202735]"
            )}>
               <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-6">
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
                  <span className="px-3 py-1 bg-[#202735] text-[#8A95A5] rounded-full text-xs font-semibold uppercase tracking-wider">Free</span>
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
                      ? "Explore the core intelligence of algorithmic market analysis absolutely free." 
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
                    {String(plan.name).toLowerCase() === 'free' ? (
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
                  <div className="bg-[#11141A] p-4 rounded-xl border border-[#EB0029]/40">
                    <div className="flex items-center gap-3 mb-3">
                      <img src="/icons/trx.svg" alt="TRX" className="w-8 h-8" />
                      <div>
                        <div className="text-sm font-bold text-white">TRX <span className="text-[#8A95A5] font-medium">Tron (TRC20)</span></div>
                        <div className="text-[11px] text-[#ff4d5e] font-semibold tracking-wide">USDT · TRC-20 NETWORK</div>
                      </div>
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <code
                        onClick={() => handleCopy(wallets.trc20, 'trc20')}
                        className="text-white font-mono text-xs break-all select-all cursor-pointer hover:text-teal-300 transition-colors min-w-0 flex-1"
                        title="Tap to copy"
                      >
                        {wallets.trc20}
                      </code>
                      <div className="bg-white p-2 rounded-lg shrink-0" title="Scan to pay (TRC-20)">
                        <QRCodeSVG value={wallets.trc20} size={96} level="H" imageSettings={{ src: '/icons/usdt.svg', width: 22, height: 22, excavate: true }} />
                      </div>
                    </div>
                    <button
                      onClick={() => handleCopy(wallets.trc20, 'trc20')}
                      className="mt-3 w-full py-2 rounded-lg border border-[#202735] hover:border-teal-500/50 text-xs font-bold uppercase tracking-widest text-[#8A95A5] hover:text-teal-300 transition-colors flex items-center justify-center gap-2"
                    >
                      {copied === 'trc20'
                        ? <><Check className="w-4 h-4 text-emerald-400" /> <span className="text-emerald-400">Copied!</span></>
                        : <><Copy className="w-4 h-4" /> Copy Address</>}
                    </button>
                  </div>

                  <div className="bg-[#11141A] p-4 rounded-xl border border-[#F3BA2F]/40">
                    <div className="flex items-center gap-3 mb-3">
                      <img src="/icons/bnb.svg" alt="BSC" className="w-8 h-8" />
                      <div>
                        <div className="text-sm font-bold text-white">BSC <span className="text-[#8A95A5] font-medium">BNB Smart Chain (BEP20)</span></div>
                        <div className="text-[11px] text-[#F3BA2F] font-semibold tracking-wide">USDT · BEP-20 NETWORK</div>
                      </div>
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <code
                        onClick={() => handleCopy(wallets.bep20, 'bep20')}
                        className="text-white font-mono text-xs break-all select-all cursor-pointer hover:text-teal-300 transition-colors min-w-0 flex-1"
                        title="Tap to copy"
                      >
                        {wallets.bep20}
                      </code>
                      <div className="bg-white p-2 rounded-lg shrink-0" title="Scan to pay (BEP-20)">
                        <QRCodeSVG value={wallets.bep20} size={96} level="H" imageSettings={{ src: '/icons/usdt.svg', width: 22, height: 22, excavate: true }} />
                      </div>
                    </div>
                    <button
                      onClick={() => handleCopy(wallets.bep20, 'bep20')}
                      className="mt-3 w-full py-2 rounded-lg border border-[#202735] hover:border-teal-500/50 text-xs font-bold uppercase tracking-widest text-[#8A95A5] hover:text-teal-300 transition-colors flex items-center justify-center gap-2"
                    >
                      {copied === 'bep20'
                        ? <><Check className="w-4 h-4 text-emerald-400" /> <span className="text-emerald-400">Copied!</span></>
                        : <><Copy className="w-4 h-4" /> Copy Address</>}
                    </button>
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
          ))}
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
