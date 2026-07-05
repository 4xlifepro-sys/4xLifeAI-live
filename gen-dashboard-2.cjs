const fs = require('fs');
const target = 'C:\\Users\\PC\\Documents\\GitHub\\4xLifeAI-live\\src\\pages\\Dashboard.tsx';

const part2 = `
      {/* Stats Row */}
      <div className="max-w-7xl mx-auto px-6 py-4">
        <div className="grid grid-cols-4 gap-3">
          <div className="bg-[#0d1220] border border-[#1a2332] rounded-lg p-4">
            <div className="text-[10px] text-slate-500 font-mono mb-1">ACTIVE SIGNALS</div>
            <div className="text-2xl font-bold text-white">{active.length}</div>
            <div className="text-[10px] text-emerald-400 mt-1">{'>'}0 = live positions</div>
          </div>
          <div className="bg-[#0d1220] border border-[#1a2332] rounded-lg p-4">
            <div className="text-[10px] text-slate-500 font-mono mb-1">TODAY WIN RATE</div>
            <div className="text-2xl font-bold text-white">{(function(){const tc2=closed.filter((s:any)=>s.created_at?.startsWith(new Date().toISOString().split('T')[0]));const tw2=tc2.filter((s:any)=>['WIN','PARTIAL WIN'].includes(s.result)||s.status?.includes('TP')).length;const tl2=tc2.filter((s:any)=>s.result==='LOSS'||s.status==='SL HIT').length;return tw2+tl2>0?Math.round(tw2/(tw2+tl2)*100):0;})()}%</div>
            <div className="text-[10px] text-slate-400 mt-1">based on closed trades</div>
          </div>
          <div className="bg-[#0d1220] border border-[#1a2332] rounded-lg p-4">
            <div className="text-[10px] text-slate-500 font-mono mb-1">MARKET BIAS</div>
            <div className="text-2xl font-bold" style={{color:bullish>bearish?'#10b981':bearish>bullish?'#ef4444':'#94a3b8'}}>{bullish>bearish?'BULLISH':bearish>bullish?'BEARISH':'NEUTRAL'}</div>
            <div className="text-[10px] text-slate-400 mt-1">{bullish}/{total} pairs trending up</div>
          </div>
          <div className="bg-[#0d1220] border border-[#1a2332] rounded-lg p-4">
            <div className="text-[10px] text-slate-500 font-mono mb-1">TOTAL TRADES</div>
            <div className="text-2xl font-bold text-white">{allSig.length}</div>
            <div className="text-[10px] text-slate-400 mt-1">{closed.length} closed, {active.length} active</div>
          </div>
        </div>
      </div>
`;

fs.appendFileSync(target, part2, 'utf8');
console.log('Stats row appended');
