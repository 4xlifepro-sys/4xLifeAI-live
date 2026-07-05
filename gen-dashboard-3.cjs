const fs = require('fs');
const target = 'C:\\Users\\PC\\Documents\\GitHub\\4xLifeAI-live\\src\\pages\\Dashboard.tsx';

const activeSignals = `
      {/* Active Signals */}
      {active.length > 0 ? (
        <div className="max-w-7xl mx-auto px-6 pb-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[11px] font-bold text-emerald-400 tracking-[0.15em]">ACTIVE TRADES</span>
            <span className="text-[10px] text-slate-500 font-mono bg-[#0d1220] px-2 py-0.5 rounded">{active.length}</span>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {active.map((s:any) => {
              const isLong = s.direction === 'LONG' || s.signal === 'BUY';
              const entry = prices[s.pair] || s.entry || 0;
              const sl = s.sl || 0;
              const tp1 = s.tp1 || 0;
              const tp2 = s.tp2 || 0;
              const tp3 = s.tp3 || 0;
              const risk = Math.abs(entry - sl);
              const rr1 = risk > 0 ? ((isLong ? (tp1 - entry) : (entry - tp1)) / risk).toFixed(1) : '0';
              const rr2 = risk > 0 ? ((isLong ? (tp2 - entry) : (entry - tp2)) / risk).toFixed(1) : '0';
              const rr3 = risk > 0 ? ((isLong ? (tp3 - entry) : (entry - tp3)) / risk).toFixed(1) : '0';
              return (
                <div key={s.id} className={'border rounded-xl p-5 transition-all cursor-pointer hover:scale-[1.01] ' + (isLong ? 'bg-gradient-to-br from-[#0d1a14] to-[#0d1220] border-emerald-500/20' : 'bg-gradient-to-br from-[#1a0d0d] to-[#0d1220] border-red-500/20')} onClick={()=>nav('/trades')}>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <span className="text-xl font-extrabold tracking-tight">{s.pair}</span>
                      <span className={'px-2.5 py-1 rounded-lg text-[10px] font-black tracking-wider ' + (isLong ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/15 text-red-400 border border-red-500/20')}>
                        {isLong ? 'LONG' : 'SHORT'}
                      </span>
                      <span className={'px-2 py-0.5 rounded text-[9px] font-bold ' + (s.status === 'TP1 HIT' ? 'bg-amber-500/15 text-amber-400' : s.status === 'TP2 HIT' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-slate-500/15 text-slate-400')}>
                        {s.status || 'ACTIVE'}
                      </span>
                    </div>
                    <svg className="w-4 h-4 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/></svg>
                  </div>
                  <div className="grid grid-cols-5 gap-2">
                    <div className="bg-[#0a0f18] rounded-lg p-3 border border-[#1a2332]">
                      <div className="text-[8px] text-slate-500 font-mono mb-1">ENTRY</div>
                      <div className="text-sm font-mono font-bold text-white">{fp(entry, s.pair)}</div>
                    </div>
                    <div className="bg-[#0a0f18] rounded-lg p-3 border border-red-500/10">
                      <div className="text-[8px] text-slate-500 font-mono mb-1">STOP LOSS</div>
                      <div className="text-sm font-mono font-bold text-red-400">{fp(sl, s.pair)}</div>
                    </div>
                    <div className="bg-[#0a0f18] rounded-lg p-3 border border-emerald-500/10">
                      <div className="text-[8px] text-slate-500 font-mono mb-1">TP1</div>
                      <div className="text-sm font-mono font-bold text-emerald-400">{fp(tp1, s.pair)}</div>
                      <div className="text-[8px] text-emerald-400/60">1:{rr1}</div>
                    </div>
                    <div className="bg-[#0a0f18] rounded-lg p-3 border border-emerald-500/10">
                      <div className="text-[8px] text-slate-500 font-mono mb-1">TP2</div>
                      <div className="text-sm font-mono font-bold text-emerald-400">{fp(tp2, s.pair)}</div>
                      <div className="text-[8px] text-emerald-400/60">1:{rr2}</div>
                    </div>
                    <div className="bg-[#0a0f18] rounded-lg p-3 border border-emerald-500/10">
                      <div className="text-[8px] text-slate-500 font-mono mb-1">TP3</div>
                      <div className="text-sm font-mono font-bold text-emerald-400">{fp(tp3, s.pair)}</div>
                      <div className="text-[8px] text-emerald-400/60">1:{rr3}</div>
                    </div>
                  </div>
                  {s.reason && (
                    <div className="mt-3 px-3 py-2 bg-[#0a0f18] rounded border border-[#1a2332]">
                      <span className="text-[9px] text-slate-500 font-mono">SETUP: </span>
                      <span className="text-[10px] text-slate-300">{s.reason}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="max-w-7xl mx-auto px-6 pb-4">
          <div className="border border-dashed border-[#1a2332] rounded-xl p-8 text-center">
            <div className="text-sm text-slate-500 font-mono">NO ACTIVE SIGNALS</div>
            <div className="text-[11px] text-slate-600 mt-1">Scanner is monitoring {total} pairs in real-time</div>
          </div>
        </div>
      )}
`;

fs.appendFileSync(target, activeSignals, 'utf8');
console.log('Active signals section appended');
