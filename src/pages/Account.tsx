import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { User, CreditCard, Bell, Shield, Check, Settings2, Copy, Wallet, ArrowRight, X } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { useDialog } from '../components/ConfirmDialog';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function Account() {
  const dialog = useDialog();
  const { user } = useAuth();
  const [isPremium, setIsPremium] = useState(false);
  const [telegramAlerts, setTelegramAlerts] = useState(true);
  const [eliteOnly, setEliteOnly] = useState(false);
  
  const [showUpgradeForm, setShowUpgradeForm] = useState(false);
  const [network, setNetwork] = useState('TRC20');
  const [txid, setTxid] = useState('');
  const [paymentStatus, setPaymentStatus] = useState<string | null>(null);
  const [copied, setCopied] = useState('');
  const [wallets, setWallets] = useState({ trc20: '', bep20: '' });

  const userEmail = user?.email || '';
  const userName = user?.user_metadata?.full_name || 'Trader';

  useEffect(() => {
    if (!user) return;
    
    // Check if user has a premium plan
    const checkStatus = async () => {
       const { data: userRecord } = await supabase.from('users').select('plan, credits').eq('email', user.email).single();
       if (userRecord?.plan === 'PRO' || (userRecord?.credits || 0) > 0) {
          setIsPremium(true);
       }
       
       // Check for pending payments
       const { data: payment } = await supabase.from('payments').select('status').eq('email', user.email).order('created_at', { ascending: false }).limit(1).single();
       if (payment) {
          setPaymentStatus(payment.status);
       }
    };
    checkStatus();

    // Fetch config
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
      if (!user) return;
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
        body: JSON.stringify({ email: user.email, network, txid, plan: 'ELITE', amount_usd: 50, credits: 100 })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.error(data);
        await dialog.showAlert({
          title: "Payment Error",
          message: data.error || "Failed to submit payment details. Please try again.",
          variant: "danger",
        });
        return;
      }
      setPaymentStatus('PENDING');
      setShowUpgradeForm(false);
      setTxid('');
      await dialog.showAlert({
        title: "Payment Submitted",
        message: "Your payment has been submitted for review.",
        variant: "success",
      });
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="flex-1 max-w-3xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight mb-2">Account Settings</h1>
          <p className="text-[#8A95A5]">Manage your subscription and signal preferences.</p>
        </div>

        <div className="bg-[#11141A] border border-[#202735] rounded-2xl overflow-hidden shadow-2xl">
           <div className="p-6 sm:p-8 flex items-start gap-6 border-b border-[#202735]">
              <div className="w-16 h-16 bg-blue-600/20 text-blue-500 rounded-full flex items-center justify-center shrink-0">
                <User className="w-8 h-8" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">{userName}</h2>
                <div className="text-sm text-[#8A95A5] mt-1">{userEmail}</div>
                <div className="mt-3 flex items-center gap-3">
                  <span className={cn(
                    "px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider",
                    isPremium ? "bg-purple-500/20 text-purple-400 border border-purple-500/20" : "bg-gray-800 text-gray-300 border border-gray-700"
                  )}>
                    {isPremium ? 'Premium Tier' : 'Free Tier'}
                  </span>
                  <span className="text-sm text-[#8A95A5]">
                    {isPremium ? 'Renews on Oct 12, 2026' : 'Basic access'}
                  </span>
                </div>
              </div>
           </div>

           <div className="p-6 sm:p-8 bg-[#0D1017]">
              <div className="flex justify-between items-center">
                 <div>
                   <h3 className="text-lg font-semibold text-white mb-1">
                     {isPremium ? 'Manage Subscription' : 'Upgrade to Premium'}
                   </h3>
                   <p className="text-sm text-[#8A95A5]">
                     {isPremium 
                        ? "You are currently on the Premium plan." 
                        : paymentStatus === 'PENDING' 
                        ? "Payment pending verification. This takes up to 10 minutes to 3 hours."
                        : "Unlock A+ Signals and Telegram delivery via our Plans page."
                     }
                   </p>
                 </div>
                 <div>
                   {isPremium ? (
                     <Link to="/support" className="px-5 py-2 bg-[#202735] text-white hover:bg-[#2A3345] rounded-lg font-medium text-sm transition-all shadow-sm flex items-center justify-center">
                       Contact Support
                     </Link>
                   ) : paymentStatus === 'PENDING' ? (
                     <div className="px-4 py-2 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-lg font-medium text-sm">
                       Verification in progress
                     </div>
                   ) : (
                     <a href="/plans" className="px-5 py-2 bg-blue-600 text-white hover:bg-blue-500 rounded-lg font-medium text-sm transition-all shadow-md shadow-blue-900/20 flex items-center gap-2">
                       <Shield className="w-4 h-4" /> View Plans
                     </a>
                   )}
                 </div>
              </div>
           </div>
        </div>

        <div className="bg-[#11141A] border border-[#202735] rounded-2xl overflow-hidden shadow-2xl">
          <div className="p-6 sm:p-8 border-b border-[#202735]">
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
              <Settings2 className="w-5 h-5 text-blue-400" />
              Signal Preferences
            </h3>
          </div>
          
          <div className="divide-y divide-[#202735]">
            <div className="p-6 sm:p-8 flex items-center justify-between">
              <div className="flex gap-4">
                 <div className="mt-1 w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0">
                   <Bell className="w-5 h-5 text-blue-400" />
                 </div>
                 <div>
                   <h4 className="text-base font-medium text-white mb-1">Telegram Alerts</h4>
                   <p className="text-sm text-[#8A95A5]">Receive instant push notifications for new signals via Telegram.</p>
                 </div>
              </div>
              <button 
                onClick={() => setTelegramAlerts(!telegramAlerts)}
                className={cn(
                  "relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 focus:ring-offset-[#0A0D12]",
                  telegramAlerts ? "bg-blue-600" : "bg-gray-700"
                )}
              >
                <span className={cn(
                  "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                  telegramAlerts ? "translate-x-5" : "translate-x-0"
                )} />
              </button>
            </div>

            <div className="p-6 sm:p-8 flex items-center justify-between">
              <div className="flex gap-4">
                 <div className="mt-1 w-10 h-10 rounded-full bg-purple-500/10 flex items-center justify-center shrink-0">
                   <Shield className="w-5 h-5 text-purple-400" />
                 </div>
                 <div>
                   <h4 className="text-base font-medium text-white mb-1">A+ Signals Only</h4>
                   <p className="text-sm text-[#8A95A5]">Filter out lower tier signals. Only receive AI-Validated A+ setups.</p>
                 </div>
              </div>
              <button 
                onClick={() => setEliteOnly(!eliteOnly)}
                className={cn(
                  "relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-purple-600 focus:ring-offset-2 focus:ring-offset-[#0A0D12]",
                  eliteOnly ? "bg-purple-600" : "bg-gray-700"
                )}
              >
                <span className={cn(
                  "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                  eliteOnly ? "translate-x-5" : "translate-x-0"
                )} />
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
