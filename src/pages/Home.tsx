import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { 
  Shield, 
  BrainCircuit, 
  Activity, 
  ArrowRight, 
  Sparkles, 
  TrendingUp, 
  Sliders, 
  Layers, 
  Zap, 
  ChevronDown, 
  HelpCircle,
  TrendingDown,
  Target,
  Bell
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// Custom interface for live setup previews
interface LiveSetupPreview {
  pair: string;
  direction: 'BUY' | 'SELL';
  entry: number;
  sl: number;
  tp1: number;
  tp2: number;
  tp3: number;
  status: string;
  confidence: number;
  quality: string;
}

export default function Home() {
  const [activeFaq, setActiveFaq] = useState<number | null>(null);

const liveSignalPreviews: LiveSetupPreview[] = [
    {
      pair: "GBPUSD",
      direction: "BUY",
      entry: 1.27420,
      sl: 1.27150,
      tp1: 1.27690,
      tp2: 1.27950,
      tp3: 1.28450,
      status: "TP1 HIT → SL AT ENTRY (BREAKEVEN)",
      confidence: 89,
      quality: "HIGH QUALITY"
    },
    {
      pair: "EURUSD",
      direction: "SELL",
      entry: 1.08550,
      sl: 1.08780,
      tp1: 1.08320,
      tp2: 1.08100,
      tp3: 1.07600,
      status: "ACTIVE",
      confidence: 84,
      quality: "HIGH QUALITY"
    }
  ];

  const faqs = [
    {
      question: "What is the core technology behind 4xFiveAI?",
      answer: "4xFiveAI combines automated multi-timeframe market analysis with high-precision quantitative calculations. It continuously reviews live market structure and filters each setup through proprietary quality, volatility, and risk controls before dispatch."
    },
    {
    question: "Do you use fabricated or historical-only feeds?",
    answer: "No. 4xFiveAI is driven by live market data only. Our quantitative parser scans in real time. If market conditions degrade or liquidity dries up, our hard filters step in to reject low-quality setups to protect capital."
    },
    {
      question: "How does the stop-loss and trade-management system work?",
      answer: "Our engine executes strict, non-discretionary risk management protocols. To maximize your statistical edge: once Target 1 (TP1) is achieved, the Stop Loss is automatically trailed to the original Entry Price (Breakeven). When TP2 hits, the Stop Loss is moved up to protect TP1 profits. TP3 serves as the final take-profit boundary."
    },
    {
      question: "Can I get notifications on my phone?",
      answer: "Yes, fully automated signal alerts are instantly dispatched to our dedicated VIP Telegram Channel. High-conviction setups also undergo asynchronous post-processing AI review to provide context and trade reasoning right inside the app and Telegram channel."
    }
  ];

  return (
    <div className="flex-1 w-full bg-[#0A0D12] text-white relative overflow-hidden">
      {/* Background Ambient Glows */}
      <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-blue-500/10 blur-[130px] rounded-full pointer-events-none -translate-y-1/2"></div>
      <div className="absolute top-[30%] right-10 w-[400px] h-[400px] bg-indigo-500/5 blur-[120px] rounded-full pointer-events-none"></div>
      <div className="absolute bottom-10 left-10 w-[600px] h-[600px] bg-emerald-500/5 blur-[150px] rounded-full pointer-events-none"></div>

      {/* Hero Section */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-16 relative z-10">
        <div className="text-center space-y-8 max-w-4xl mx-auto">
          {/* Badge */}
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-semibold tracking-wider uppercase"
          >
            <Sparkles className="w-3.5 h-3.5 animate-pulse" />
            Premium Live Signal Intelligence
          </motion.div>

          <motion.h1 
            initial={{ opacity: 0, y: 25 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-4xl sm:text-6xl lg:text-7xl font-bold tracking-tight text-white leading-[1.1] font-sans"
          >
            Automated <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-indigo-400 to-teal-400">Market Structure</span> Validation
          </motion.h1>

          <motion.p 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-[#8A95A5] text-lg sm:text-xl max-w-3xl mx-auto leading-relaxed"
          >
            Real-time quantitative scanning across major currency pairs. We track multi-timeframe order block transitions, liquidity sweeps, and fair value gap shifts so you don't have to.
          </motion.p>
          
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="pt-4 flex flex-col sm:flex-row gap-4 justify-center items-center"
          >
            <Link
              to="/dashboard"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-8 py-4 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-xl transition-all shadow-[0_0_25px_rgba(37,99,235,0.4)] hover:shadow-[0_0_35px_rgba(37,99,235,0.6)] font-sans"
            >
              Access Live Signals
              <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              to="/plans"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-8 py-4 text-sm font-semibold text-[#8A95A5] hover:text-white bg-[#11141A] hover:bg-[#161B24] border border-[#202735] hover:border-blue-500/30 rounded-xl transition-all font-sans"
            >
              Explore Tiers & Pricing
            </Link>
          </motion.div>
        </div>
      </section>

      {/* Live Signal Showcase Module */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 relative z-10">
        <motion.div 
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.6 }}
          className="bg-[#0D111A]/80 border border-[#202735] rounded-3xl p-6 sm:p-10 backdrop-blur-md shadow-[0_20px_50px_rgba(0,0,0,0.5)]"
        >
          <div className="flex flex-col lg:flex-row gap-10 items-center">
            {/* Visual description */}
            <div className="flex-1 space-y-6">
              <div className="flex items-center gap-3">
                <span className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
                  <Target className="w-5 h-5" />
                </span>
                <span className="text-emerald-400 font-bold uppercase tracking-widest text-xs">Dynamic Trade Management</span>
              </div>
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-white leading-tight">
                Watch High-Conviction Setups Execute in Real Time
              </h2>
              <p className="text-[#8A95A5] leading-relaxed">
                Our quantitative engine doesn't just broadcast alerts. It actively tracks price feeds, records intermediate milestones, adjusts stop losses dynamically to lock in profits, and notifies your Telegram feed without delay.
              </p>
              
              <div className="space-y-3 pt-2">
                <div className="flex items-start gap-3">
                  <div className="w-5 h-5 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mt-1">
                    <span className="text-[10px] font-bold text-blue-400">1</span>
                  </div>
                  <p className="text-sm text-[#E0E4EA]"><span className="font-semibold text-white">Target 1 Hits:</span> Original Stop Loss instantly climbs to Entry Price for a true 100% risk-free breakeven state.</p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-5 h-5 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mt-1">
                    <span className="text-[10px] font-bold text-blue-400">2</span>
                  </div>
                  <p className="text-sm text-[#E0E4EA]"><span className="font-semibold text-white">Target 2 Hits:</span> Stop Loss moves to lock in full Target 1 gains as partial win insurance.</p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-5 h-5 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mt-1">
                    <span className="text-[10px] font-bold text-blue-400">3</span>
                  </div>
                  <p className="text-sm text-[#E0E4EA]"><span className="font-semibold text-white">Target 3 Hits:</span> The signal closes in full with absolute profit captured.</p>
                </div>
              </div>
            </div>

              {/* Live Scanner Preview Widget */}
            <div className="w-full lg:w-[480px] shrink-0 bg-[#070A10] border border-[#202735] rounded-2xl p-6 relative overflow-hidden shadow-2xl">
              <div className="absolute top-0 right-0 w-24 h-24 bg-blue-500/5 blur-xl rounded-full"></div>
              
              <div className="flex justify-between items-center pb-4 border-b border-[#202735] mb-6">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
                    <span className="text-xs font-semibold text-[#8A95A5] uppercase tracking-wider">Live Engine Preview</span>
                </div>
                <span className="text-[10px] bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded border border-blue-500/20 font-mono">
                  Low Latency Live Feed
                </span>
              </div>

              {/* Signals */}
              <div className="space-y-4">
                {liveSignalPreviews.map((sig, idx) => (
                  <div key={idx} className="bg-[#0E121C] border border-[#202735] rounded-xl p-4 space-y-3 hover:border-blue-500/20 transition-all">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2.5">
                        <span className="font-bold text-base text-white tracking-wide">{sig.pair}</span>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-extrabold ${sig.direction === 'BUY' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                          {sig.direction}
                        </span>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] text-[#8A95A5] font-mono">Confidence</div>
                        <div className="text-xs font-bold text-teal-400">{sig.confidence}%</div>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 py-1.5 border-y border-[#202735]/40 text-center">
                      <div>
                        <div className="text-[9px] text-[#8A95A5] uppercase font-mono">Entry</div>
                        <div className="text-xs font-semibold text-[#E0E4EA] font-mono">{sig.entry.toFixed(5)}</div>
                      </div>
                      <div>
                        <div className="text-[9px] text-[#8A95A5] uppercase font-mono">Risk SL</div>
                        <div className="text-xs font-semibold text-rose-400 font-mono">{sig.sl.toFixed(5)}</div>
                      </div>
                      <div>
                        <div className="text-[9px] text-[#8A95A5] uppercase font-mono">Quality</div>
                        <div className="text-[10px] font-bold text-[#E0E4EA] truncate">{sig.quality}</div>
                      </div>
                    </div>

                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-teal-400"></span>
                        <span className="text-[10px] text-[#8A95A5] font-mono uppercase truncate max-w-[140px]">{sig.status}</span>
                      </div>
                      <div className="flex gap-1.5">
                        <span className="text-[10px] bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded font-mono">TP1</span>
                        <span className="text-[10px] bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded font-mono">TP2</span>
                        <span className="text-[10px] bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded font-mono">TP3</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Live Scanner Stats */}
              <div className="mt-6 pt-5 border-t border-[#202735] grid grid-cols-2 gap-4 text-center">
                <div className="bg-[#0E121C]/50 p-2.5 rounded-lg border border-[#202735]/40">
                  <div className="text-[10px] text-[#8A95A5]">Win Rate Validation</div>
                  <div className="text-lg font-bold text-white mt-0.5">74.2%</div>
                </div>
                <div className="bg-[#0E121C]/50 p-2.5 rounded-lg border border-[#202735]/40">
                  <div className="text-[10px] text-[#8A95A5]">Avg Profit/Loss Ratio</div>
                  <div className="text-lg font-bold text-white mt-0.5">2.4 : 1</div>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </section>

      {/* Value Propositions / Grid */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 relative z-10">
        <div className="text-center space-y-4 mb-20 max-w-2xl mx-auto">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-white font-sans">
            Clean Data. Institutional Precision.
          </h2>
          <p className="text-[#8A95A5] text-base leading-relaxed">
            Eliminating guesswork from structural bias and market context. Our suite is designed to act with zero human emotion.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          <motion.div 
            whileHover={{ y: -5 }}
            transition={{ type: "spring", stiffness: 300 }}
            className="p-8 rounded-2xl bg-[#0D111A] border border-[#202735] hover:border-blue-500/20 transition-all shadow-lg"
          >
            <div className="w-12 h-12 bg-blue-500/10 rounded-xl flex items-center justify-center mb-6">
              <Activity className="w-6 h-6 text-blue-400" />
            </div>
            <h3 className="text-xl font-bold text-white mb-3 font-sans">Uncompromised Live Feeds</h3>
            <p className="text-[#8A95A5] leading-relaxed text-sm">
              Fed exclusively by genuine high-liquidity market candles. We never trade on laggy, fabricated, or synthetic price quotes. When liquidity drops below secure thresholds, the system safely rests.
            </p>
          </motion.div>

          <motion.div 
            whileHover={{ y: -5 }}
            transition={{ type: "spring", stiffness: 300 }}
            className="p-8 rounded-2xl bg-[#0D111A] border border-[#202735] hover:border-indigo-500/20 transition-all shadow-lg"
          >
            <div className="w-12 h-12 bg-indigo-500/10 rounded-xl flex items-center justify-center mb-6">
              <Shield className="w-6 h-6 text-indigo-400" />
            </div>
            <h3 className="text-xl font-bold text-white mb-3 font-sans">Strict Technical Adherence</h3>
            <p className="text-[#8A95A5] leading-relaxed text-sm">
              Our code tracks 4H Directional Bias, requires verified structural pullbacks, and enforces a meticulous 5M Break of Structure (BOS) entry confirmation. There are no discretionary overrides.
            </p>
          </motion.div>

          <motion.div 
            whileHover={{ y: -5 }}
            transition={{ type: "spring", stiffness: 300 }}
            className="p-8 rounded-2xl bg-[#0D111A] border border-[#202735] hover:border-teal-500/20 transition-all shadow-lg"
          >
            <div className="w-12 h-12 bg-teal-500/10 rounded-xl flex items-center justify-center mb-6">
              <BrainCircuit className="w-6 h-6 text-teal-400" />
            </div>
            <h3 className="text-xl font-bold text-white mb-3 font-sans">Post-Process AI Review</h3>
            <p className="text-[#8A95A5] leading-relaxed text-sm">
              Qualified trades are asynchronously sent to the 4x Engine AI pipeline for contextual macro validation. This ensures high-conviction setups feature rich explanations while execution speed is completely uncompromised.
            </p>
          </motion.div>
        </div>
      </section>

      {/* High-Performance Pipeline Flow */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 relative z-10 border-t border-[#202735]/40">
        <div className="text-center space-y-4 mb-16 max-w-2xl mx-auto">
          <span className="text-xs font-bold uppercase tracking-widest text-blue-400 px-3 py-1 bg-blue-500/10 rounded-full border border-blue-500/20">The Processing Cycle</span>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-white font-sans">The 4xFiveAI Signal Lifecycle</h2>
          <p className="text-[#8A95A5] text-sm">
            Every potential market setup is strictly validated in a four-stage execution sequence.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="bg-[#0D111A]/60 border border-[#202735] p-6 rounded-2xl relative">
            <div className="text-xs font-bold text-blue-500 uppercase tracking-widest mb-3">Stage 1</div>
            <h4 className="text-lg font-bold text-white mb-2">Ingestion & Sync</h4>
            <p className="text-xs text-[#8A95A5] leading-relaxed">
              Real-time synchronization of institutional OHLC candle ticks directly into our parsing array.
            </p>
          </div>

          <div className="bg-[#0D111A]/60 border border-[#202735] p-6 rounded-2xl relative">
            <div className="text-xs font-bold text-blue-500 uppercase tracking-widest mb-3">Stage 2</div>
            <h4 className="text-lg font-bold text-white mb-2">Structure Mapping</h4>
            <p className="text-xs text-[#8A95A5] leading-relaxed">
              Detects key High-Timeframe (HTF) trends, locating institutional mitigation points and local supply/demand buffers.
            </p>
          </div>

          <div className="bg-[#0D111A]/60 border border-[#202735] p-6 rounded-2xl relative">
            <div className="text-xs font-bold text-blue-500 uppercase tracking-widest mb-3">Stage 3</div>
            <h4 className="text-lg font-bold text-white mb-2">Chop Filter Gating</h4>
            <p className="text-xs text-[#8A95A5] leading-relaxed">
              Instantly discards erratic price consolidation (chop), low-volume periods, and extreme volatility spikes to protect capital.
            </p>
          </div>

          <div className="bg-[#0D111A]/60 border border-[#202735] p-6 rounded-2xl relative">
            <div className="text-xs font-bold text-blue-500 uppercase tracking-widest mb-3">Stage 4</div>
            <h4 className="text-lg font-bold text-white mb-2">Instant Dispatch</h4>
            <p className="text-xs text-[#8A95A5] leading-relaxed">
              Fires the confirmed signal hash immediately via SSE web-sockets and direct, automated VIP Telegram Alerts.
            </p>
          </div>
        </div>
      </section>

      {/* Frequently Asked Questions */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-20 relative z-10 border-t border-[#202735]/40">
        <div className="text-center space-y-4 mb-14">
          <h2 className="text-3xl font-bold tracking-tight text-white font-sans">Frequently Asked Questions</h2>
          <p className="text-[#8A95A5] text-sm">Everything you need to know about the 4xFiveAI signal engine.</p>
        </div>

        <div className="space-y-4">
          {faqs.map((faq, idx) => (
            <div 
              key={idx} 
              className="border border-[#202735] rounded-xl bg-[#0D111A]/50 overflow-hidden transition-all duration-300"
            >
              <button
                onClick={() => setActiveFaq(activeFaq === idx ? null : idx)}
                className="w-full flex justify-between items-center p-5 text-left font-semibold text-white hover:bg-[#111624] transition-colors focus:outline-none"
              >
                <span className="pr-4 text-base font-sans">{faq.question}</span>
                <ChevronDown 
                  className={`w-5 h-5 text-[#8A95A5] shrink-0 transition-transform duration-300 ${activeFaq === idx ? 'rotate-180 text-blue-400' : ''}`} 
                />
              </button>
              
              <AnimatePresence initial={false}>
                {activeFaq === idx && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25, ease: 'easeInOut' }}
                  >
                    <div className="p-5 pt-0 text-[#8A95A5] text-sm leading-relaxed border-t border-[#202735]/40 bg-[#070A10]/40">
                      {faq.answer}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </section>

      {/* Premium Banner CTA */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-24 relative z-10">
        <div className="bg-gradient-to-r from-blue-600/30 via-indigo-600/25 to-teal-500/10 border border-blue-500/30 rounded-3xl p-8 sm:p-14 text-center space-y-6 relative overflow-hidden shadow-2xl">
          <div className="absolute top-0 right-0 w-64 h-64 bg-teal-400/5 blur-3xl rounded-full"></div>
          <div className="absolute bottom-0 left-0 w-64 h-64 bg-blue-500/5 blur-3xl rounded-full"></div>
          
          <h2 className="text-3xl sm:text-5xl font-bold tracking-tight text-white font-sans max-w-2xl mx-auto leading-tight">
            Ready to Upgrade Your Analytical Edge?
          </h2>
          <p className="text-[#C5CDD9] text-base sm:text-lg max-w-2xl mx-auto leading-relaxed">
            Gain full elite access to our premium signal filters, automated Telegram VIP alerts, and institutional trade validation tools.
          </p>
          <div className="pt-4 flex flex-col sm:flex-row gap-4 justify-center items-center">
            <Link
              to="/plans"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-8 py-4 text-sm font-bold text-white bg-blue-600 hover:bg-blue-500 rounded-xl transition-all shadow-lg font-sans"
            >
              Get Premium Access Now
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
