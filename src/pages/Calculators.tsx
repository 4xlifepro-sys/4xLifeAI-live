import { useState, useEffect } from 'react';
import { Calculator, DollarSign, TrendingUp, RotateCcw, ArrowRight, AlertTriangle, Info } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type TabType = 'position' | 'margin' | 'pip';

const CURRENCY_PAIRS = [
  'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'NZDUSD', 'USDCAD',
  'XAUUSD', 'XAGUSD', 'BTCUSD', 'ETHUSD', 'BNBUSD', 'SOLUSD'
];

interface CalculationResult {
  moneyRisk: number;
  units: number;
  lots: number;
  pipValue: number;
  margin: number;
}

export default function Calculators() {
  const [activeTab, setActiveTab] = useState<TabType>('position');
  const [pair, setPair] = useState('EURUSD');
  const [accountSize, setAccountSize] = useState<string>('1000');
  const [riskPercent, setRiskPercent] = useState<string>('1');
  const [stopLossPips, setStopLossPips] = useState<string>('20');
  const [entryPrice, setEntryPrice] = useState<string>('1.08500');
  const [leverage, setLeverage] = useState<string>('100');
  const [result, setResult] = useState<CalculationResult | null>(null);
  const [error, setError] = useState('');

  const formatNumber = (num: number, decimals = 2) => {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    }).format(num);
  };

  const getPipValue = (symbol: string): number => {
    const pipValues: Record<string, number> = {
      'EURUSD': 0.0001, 'GBPUSD': 0.0001, 'AUDUSD': 0.0001, 'NZDUSD': 0.0001,
      'USDCHF': 0.0001, 'USDCAD': 0.0001,
      'USDJPY': 0.01, 'EURJPY': 0.01, 'GBPJPY': 0.01, 'AUDJPY': 0.01,
      'XAUUSD': 0.01, 'XAGUSD': 0.001,
      'BTCUSD': 1, 'ETHUSD': 0.01, 'BNBUSD': 0.01, 'SOLUSD': 0.01
    };
    return pipValues[symbol] || 0.0001;
  };

  const getPointValuePerLot = (symbol: string): number => {
    // Approximate pip value in USD per 1 standard lot
    const values: Record<string, number> = {
      'EURUSD': 10, 'GBPUSD': 10, 'AUDUSD': 10, 'NZDUSD': 10,
      'USDCHF': 11, 'USDCAD': 7.4, 'USDJPY': 6.7,
      'XAUUSD': 1, 'XAGUSD': 5,
      'BTCUSD': 1, 'ETHUSD': 0.1, 'BNBUSD': 0.1, 'SOLUSD': 0.01
    };
    return values[symbol] || 10;
  };

  const calculatePosition = () => {
    setError('');
    const account = parseFloat(accountSize);
    const risk = parseFloat(riskPercent);
    const slPips = parseFloat(stopLossPips);
    const entry = parseFloat(entryPrice);
    const lev = parseFloat(leverage);

    if (!account || account <= 0) { setError('Account size must be greater than 0'); return; }
    if (!risk || risk <= 0) { setError('Risk % must be greater than 0'); return; }
    if (!slPips || slPips <= 0) { setError('Stop loss pips must be greater than 0'); return; }

    const moneyRisk = account * (risk / 100);
    const pipValuePerLot = getPointValuePerLot(pair);
    const totalSLValue = slPips * pipValuePerLot;
    const lots = moneyRisk / totalSLValue;
    const units = lots * 100000;
    const pipValue = pipValuePerLot * lots;
    const margin = entry ? (units * entry) / lev : 0;

    setResult({ moneyRisk, units, lots, pipValue, margin });
  };

  const calculatePipValue = () => {
    setError('');
    const lots = parseFloat(stopLossPips) || 1; // Reuse field for lots in pip calc
    const pipVal = getPointValuePerLot(pair) * lots;
    const units = lots * 100000;
    setResult({ moneyRisk: 0, units, lots, pipValue: pipVal, margin: 0 });
  };

  const calculateMargin = () => {
    setError('');
    const lots = parseFloat(stopLossPips) || 1; // Reuse field for lots in margin calc
    const entry = parseFloat(entryPrice);
    const lev = parseFloat(leverage);
    if (!entry || entry <= 0) { setError('Entry price required for margin calculation'); return; }
    if (!lev || lev <= 0) { setError('Leverage required'); return; }
    const units = lots * 100000;
    const margin = (units * entry) / lev;
    const pipVal = getPointValuePerLot(pair) * lots;
    setResult({ moneyRisk: 0, units, lots, pipValue: pipVal, margin });
  };

  const handleCalculate = () => {
    if (activeTab === 'position') calculatePosition();
    else if (activeTab === 'pip') calculatePipValue();
    else calculateMargin();
  };

  const handleReset = () => {
    setAccountSize('1000');
    setRiskPercent('1');
    setStopLossPips('20');
    setEntryPrice('1.08500');
    setLeverage('100');
    setResult(null);
    setError('');
  };

  useEffect(() => {
    setResult(null);
    setError('');
  }, [activeTab, pair]);

  const tabs = [
    { id: 'position', label: 'Position Size', icon: Calculator },
    { id: 'margin', label: 'Margin', icon: DollarSign },
    { id: 'pip', label: 'Pip Value', icon: TrendingUp },
  ];

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_12%_0%,rgba(0,209,255,0.10),transparent_28%),radial-gradient(circle_at_86%_10%,rgba(34,197,94,0.08),transparent_26%),linear-gradient(180deg,#05080d_0%,#070b12_42%,#030509_100%)] text-[#E0E4EA] py-8 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-cyan-500/20 to-blue-500/20 border border-cyan-500/30">
            <Calculator className="w-4 h-4 text-cyan-400" />
            <span className="text-xs font-bold text-cyan-400 uppercase tracking-wider">Trading Tools</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-black text-white">
            Trading <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-400">Calculators</span>
          </h1>
          <p className="text-sm text-slate-400 max-w-md mx-auto">
            Professional position sizing, margin, and pip value calculators for disciplined risk management.
          </p>
        </div>

        {/* Main Card */}
        <div className="bg-[#11141A]/80 backdrop-blur-xl border border-[#202735] rounded-3xl overflow-hidden shadow-2xl shadow-cyan-500/5">
          {/* Tabs */}
          <div className="flex border-b border-[#202735]">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as TabType)}
                className={cn(
                  "flex-1 flex items-center justify-center gap-2 px-4 py-4 text-sm font-bold transition-all",
                  activeTab === tab.id
                    ? "bg-gradient-to-r from-cyan-600/20 to-blue-600/20 text-cyan-400 border-b-2 border-cyan-400"
                    : "text-slate-400 hover:text-white hover:bg-white/5"
                )}
              >
                <tab.icon className="w-4 h-4" />
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            ))}
          </div>

          {/* Inputs */}
          <div className="p-6 space-y-5">
            {/* Pair Selector */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Currency Pair</label>
              <select
                value={pair}
                onChange={(e) => setPair(e.target.value)}
                className="w-full bg-[#0A0D12] border border-[#202735] rounded-xl px-4 py-3 text-white font-semibold focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30 transition-all"
              >
                {CURRENCY_PAIRS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>

            {activeTab === 'position' && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Account Size ($)</label>
                    <input
                      type="number"
                      value={accountSize}
                      onChange={(e) => setAccountSize(e.target.value)}
                      className="w-full bg-[#0A0D12] border border-[#202735] rounded-xl px-4 py-3 text-white font-semibold focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30 transition-all"
                      placeholder="1000"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Risk (%)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={riskPercent}
                      onChange={(e) => setRiskPercent(e.target.value)}
                      className="w-full bg-[#0A0D12] border border-[#202735] rounded-xl px-4 py-3 text-white font-semibold focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30 transition-all"
                      placeholder="1"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Stop Loss (pips)</label>
                  <input
                    type="number"
                    value={stopLossPips}
                    onChange={(e) => setStopLossPips(e.target.value)}
                    className="w-full bg-[#0A0D12] border border-[#202735] rounded-xl px-4 py-3 text-white font-semibold focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30 transition-all"
                    placeholder="20"
                  />
                </div>
              </>
            )}

            {activeTab === 'margin' && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Lots</label>
                    <input
                      type="number"
                      step="0.01"
                      value={stopLossPips}
                      onChange={(e) => setStopLossPips(e.target.value)}
                      className="w-full bg-[#0A0D12] border border-[#202735] rounded-xl px-4 py-3 text-white font-semibold focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30 transition-all"
                      placeholder="1"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Leverage</label>
                    <input
                      type="number"
                      value={leverage}
                      onChange={(e) => setLeverage(e.target.value)}
                      className="w-full bg-[#0A0D12] border border-[#202735] rounded-xl px-4 py-3 text-white font-semibold focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30 transition-all"
                      placeholder="100"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Entry Price</label>
                  <input
                    type="number"
                    step="0.00001"
                    value={entryPrice}
                    onChange={(e) => setEntryPrice(e.target.value)}
                    className="w-full bg-[#0A0D12] border border-[#202735] rounded-xl px-4 py-3 text-white font-semibold focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30 transition-all"
                    placeholder="1.08500"
                  />
                </div>
              </>
            )}

            {activeTab === 'pip' && (
              <>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Trade Size (Lots)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={stopLossPips}
                    onChange={(e) => setStopLossPips(e.target.value)}
                    className="w-full bg-[#0A0D12] border border-[#202735] rounded-xl px-4 py-3 text-white font-semibold focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30 transition-all"
                    placeholder="1"
                  />
                </div>
              </>
            )}

            {error && (
              <div className="flex items-center gap-2 text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-xl p-3">
                <AlertTriangle className="w-4 h-4" />
                {error}
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-3 pt-2">
              <button
                onClick={handleCalculate}
                className="flex-1 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold py-4 rounded-xl shadow-[0_0_25px_rgba(6,182,212,0.3)] transition-all flex items-center justify-center gap-2"
              >
                Calculate <ArrowRight className="w-4 h-4" />
              </button>
              <button
                onClick={handleReset}
                className="px-5 py-4 bg-slate-700/50 hover:bg-slate-700 text-slate-300 font-semibold rounded-xl border border-slate-600/50 transition-all"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Results */}
          {result && (
            <div className="border-t border-[#202735] bg-gradient-to-br from-emerald-500/10 to-cyan-500/10 p-6 space-y-5">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-sm font-bold text-emerald-400 uppercase tracking-wider">Results</span>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {activeTab === 'position' && (
                  <>
                    <div className="bg-[#0A0D12]/70 border border-emerald-500/20 rounded-xl p-4 text-center">
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Money Risk</p>
                      <p className="text-xl font-black text-emerald-400">${formatNumber(result.moneyRisk)}</p>
                    </div>
                    <div className="bg-[#0A0D12]/70 border border-cyan-500/20 rounded-xl p-4 text-center">
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Position Size</p>
                      <p className="text-xl font-black text-cyan-400">{formatNumber(result.lots, 2)} lots</p>
                    </div>
                    <div className="bg-[#0A0D12]/70 border border-blue-500/20 rounded-xl p-4 text-center">
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Units</p>
                      <p className="text-lg font-black text-blue-400">{formatNumber(result.units, 0)}</p>
                    </div>
                    <div className="bg-[#0A0D12]/70 border border-purple-500/20 rounded-xl p-4 text-center">
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Pip Value</p>
                      <p className="text-lg font-black text-purple-400">${formatNumber(result.pipValue)}</p>
                    </div>
                  </>
                )}

                {activeTab === 'margin' && (
                  <>
                    <div className="col-span-2 bg-[#0A0D12]/70 border border-orange-500/20 rounded-xl p-4 text-center">
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Required Margin</p>
                      <p className="text-2xl font-black text-orange-400">${formatNumber(result.margin)}</p>
                    </div>
                    <div className="bg-[#0A0D12]/70 border border-cyan-500/20 rounded-xl p-4 text-center">
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Position Size</p>
                      <p className="text-xl font-black text-cyan-400">{formatNumber(result.lots, 2)} lots</p>
                    </div>
                    <div className="bg-[#0A0D12]/70 border border-purple-500/20 rounded-xl p-4 text-center">
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Pip Value</p>
                      <p className="text-lg font-black text-purple-400">${formatNumber(result.pipValue)}</p>
                    </div>
                  </>
                )}

                {activeTab === 'pip' && (
                  <>
                    <div className="col-span-2 bg-[#0A0D12]/70 border border-emerald-500/20 rounded-xl p-4 text-center">
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Pip Value</p>
                      <p className="text-2xl font-black text-emerald-400">${formatNumber(result.pipValue)} / pip</p>
                    </div>
                    <div className="bg-[#0A0D12]/70 border border-cyan-500/20 rounded-xl p-4 text-center">
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Position Size</p>
                      <p className="text-xl font-black text-cyan-400">{formatNumber(result.lots, 2)} lots</p>
                    </div>
                    <div className="bg-[#0A0D12]/70 border border-blue-500/20 rounded-xl p-4 text-center">
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Units</p>
                      <p className="text-lg font-black text-blue-400">{formatNumber(result.units, 0)}</p>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Info Cards */}
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="bg-[#11141A]/60 border border-[#202735] rounded-2xl p-5">
            <div className="flex items-center gap-3 mb-3">
              <Info className="w-5 h-5 text-cyan-400" />
              <h3 className="font-bold text-white">Risk Management</h3>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Professional traders risk 1-2% per trade. Use this calculator to ensure your position size matches your risk tolerance before entering any trade.
            </p>
          </div>
          <div className="bg-[#11141A]/60 border border-[#202735] rounded-2xl p-5">
            <div className="flex items-center gap-3 mb-3">
              <TrendingUp className="w-5 h-5 text-emerald-400" />
              <h3 className="font-bold text-white">Best Used With</h3>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Combine with 4xFiveAI signals. Copy the Entry/SL from Today's Signals into this calculator to get the exact lot size for your account.
            </p>
          </div>
        </div>

        {/* Disclaimer */}
        <div className="bg-slate-800/40 border border-slate-700/30 rounded-xl p-4 text-center">
          <p className="text-[11px] text-slate-500 font-mono uppercase tracking-wider">
            ⚠️ For Educational Use Only • Not Financial Advice • Calculations Are Approximate
          </p>
        </div>
      </div>
    </div>
  );
}
