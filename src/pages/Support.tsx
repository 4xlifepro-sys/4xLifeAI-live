import React, { useState } from 'react';
import { MessageSquare, HeartHandshake, HelpCircle, Send } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

export default function Support() {
  const { user } = useAuth();
  const [email, setEmail] = useState(user?.email || '');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;

    try {
      const payload: any = { email, subject, message };
      if (user?.id) payload.user_id = user.id;

      const res = await fetch('/api/support', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify(payload)
      });
      
      if (!res.ok) {
        throw new Error("Failed to submit ticket.");
      }
      setSubmitted(true);
      setTimeout(() => {
          setSubject('');
          setMessage('');
          setSubmitted(false);
      }, 3000);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 h-[calc(100vh-64px)] overflow-y-auto">
      {/* Top Pill label */}
      <div className="inline-flex items-center gap-2 px-4 py-2 border border-teal-500/20 bg-teal-500/5 rounded-md text-teal-400 text-sm font-bold tracking-widest uppercase mb-8 shadow-[0_0_15px_rgba(20,184,166,0.1)]">
        <MessageSquare className="w-4 h-4" />
        Traders Desk
      </div>

      <div className="grid lg:grid-cols-2 gap-8 mb-16">
        {/* Left Column: Support Info & FAQ */}
        <div className="bg-[#0D101A] border border-[#202735] rounded-xl p-6 lg:p-8 shadow-2xl relative overflow-hidden flex flex-col h-full">
            <h2 className="text-white font-bold uppercase tracking-wider mb-4 flex items-center gap-2">
                <HeartHandshake className="w-5 h-5 text-teal-400" />
                4xLifeAI Support Center
            </h2>
            <p className="text-[#8A95A5] text-sm leading-relaxed mb-8">
                Have questions regarding risk profiles, prop firm drawdown rules, or how the SMC point analysis calculates sweeps? Open a ticket below and our trading desk analysts will assist you shortly.
            </p>

            <div className="space-y-4 flex-1">
                <div className="border border-[#202735] rounded-lg p-5 bg-[#11141A]">
                    <h3 className="text-teal-400 font-bold text-sm mb-2 font-mono flex items-center gap-2">
                        <HelpCircle className="w-4 h-4" />
                        Q: What is a safe risk size?
                    </h3>
                    <p className="text-[#8A95A5] text-sm font-mono leading-relaxed">
                        For normal trading we recommend 0.5% - 1% risk per trade. For evaluation accounts, restrict risk size to 0.25%.
                    </p>
                </div>
                
                <div className="border border-blue-500/20 rounded-lg p-5 bg-blue-500/5">
                    <h3 className="text-blue-400 font-bold text-sm mb-3 font-mono flex items-center gap-2 uppercase tracking-wider">
                        <Send className="w-4 h-4" />
                        Official Telegram Channels
                    </h3>
                    <div className="space-y-3">
                        <a href="https://t.me/TOFIFX1" target="_blank" rel="noopener noreferrer" className="flex items-center justify-between p-3 rounded bg-[#11141A] border border-[#202735] hover:border-blue-500/50 transition-colors group">
                            <span className="text-[#E0E4EA] text-sm font-medium group-hover:text-white transition-colors">Customer Support (DM)</span>
                            <span className="text-blue-400 text-xs font-mono group-hover:underline">@TOFIFX1</span>
                        </a>
                        <a href="https://t.me/forxlife3" target="_blank" rel="noopener noreferrer" className="flex items-center justify-between p-3 rounded bg-[#11141A] border border-[#202735] hover:border-emerald-500/50 transition-colors group">
                            <span className="text-[#E0E4EA] text-sm font-medium group-hover:text-white transition-colors">Free Signals Channel</span>
                            <span className="text-emerald-400 text-xs font-mono group-hover:underline">@forxlife3</span>
                        </a>
                        <a href="https://t.me/+C70yUdEFuq5hMTk8" target="_blank" rel="noopener noreferrer" className="flex items-center justify-between p-3 rounded bg-[#11141A] border border-[#202735] hover:border-purple-500/50 transition-colors group">
                            <span className="text-[#E0E4EA] text-sm font-medium group-hover:text-white transition-colors">VIP Signals Channel</span>
                            <span className="text-purple-400 text-xs font-mono group-hover:underline">Join VIP</span>
                        </a>
                    </div>
                </div>
            </div>
        </div>

        {/* Right Column: Ticket Form */}
        <div className="bg-[#0D101A] border border-[#202735] rounded-xl p-6 lg:p-8 shadow-2xl relative overflow-hidden flex flex-col h-full">
            <h2 className="text-white font-bold uppercase tracking-wider mb-6 flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-teal-400" />
                Connect With Trading Desk
            </h2>

            <form onSubmit={handleSubmit} className="space-y-6 flex-1 flex flex-col">
                <div>
                    <label className="block text-[#8A95A5] font-mono text-xs mb-2">Your Registered Email</label>
                    <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        className="w-full bg-[#11141A] border border-[#202735] focus:border-teal-500/50 rounded-lg px-4 py-3 text-sm text-white font-mono outline-none transition-colors"
                        placeholder="email@example.com"
                    />
                </div>

                <div>
                    <label className="block text-[#8A95A5] font-mono text-xs mb-2">Subject / Concern</label>
                    <input
                        type="text"
                        value={subject}
                        onChange={(e) => setSubject(e.target.value)}
                        required
                        className="w-full bg-[#11141A] border border-[#202735] focus:border-teal-500/50 rounded-lg px-4 py-3 text-sm text-white font-mono outline-none transition-colors"
                        placeholder="e.g. Prop Firm Rule Checklist / API feed query"
                    />
                </div>

                <div className="flex-1 flex flex-col relative">
                    <label className="block text-[#8A95A5] font-mono text-xs mb-2">Message Description</label>
                    <div className="relative flex-1 flex flex-col">
                        <textarea
                            value={message}
                            onChange={(e) => setMessage(e.target.value)}
                            required
                            className="flex-1 w-full bg-[#11141A] border border-[#202735] focus:border-teal-500/50 rounded-lg px-4 py-3 text-sm text-[#8A95A5] font-mono outline-none resize-none transition-colors min-h-[120px]"
                            placeholder="Detail your request, trade pair, or settings conflict here..."
                        />
                        <div className="absolute right-2 bottom-2 pointer-events-none flex items-center gap-2 opacity-50">
                            <div className="font-mono text-[8px] text-[#5D6B80] tracking-widest uppercase">
                                Metric_Sweep <span className="text-teal-400 ml-1">Stable</span>
                            </div>
                        </div>
                    </div>
                </div>

                <button
                    type="submit"
                    disabled={submitted}
                    className="w-full py-3.5 bg-gradient-to-r from-teal-500 to-blue-600 hover:from-teal-400 hover:to-blue-500 text-white rounded-lg font-bold text-sm tracking-widest uppercase transition-all shadow-[0_0_20px_rgba(20,184,166,0.3)] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                    {submitted ? 'Ticket Submitted' : 'Open Support Ticket'}
                </button>
            </form>
        </div>
      </div>

      {/* Footer Section equivalent */}
      <div className="text-center pt-8 border-t border-[#202735] mt-auto">
        <h4 className="text-[#5D6B80] font-mono text-xs tracking-widest uppercase mb-4">
            4xLifeAI Quantitative Algorithmic Node
        </h4>
        <p className="text-[#5D6B80] text-xs max-w-3xl mx-auto leading-relaxed mb-6">
            Forex trading carries substantial leverage risk. The structural points, bias indicators, and 4xLifeAI Engine-based forecasts do not constitute guaranteed investment advice. All trading targets must be evaluated with strict customized stop parameters.
        </p>
        
        <div className="flex items-center justify-center gap-4 mb-6">
             <div className="font-mono text-[10px] text-[#5D6B80] tracking-widest uppercase">
                 Liq_Resonance <span className="text-teal-400 ml-1 line-through opacity-70">Synced</span>
             </div>
        </div>

        <p className="text-[#5D6B80] text-xs font-mono">
            Powered by 4xLifeAI Intelligence
        </p>
      </div>
    </div>
  );
}
