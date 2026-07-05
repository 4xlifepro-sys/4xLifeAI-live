const fs = require('fs');
const target = 'C:\\Users\\PC\\Documents\\GitHub\\4xLifeAI-live\\src\\pages\\Dashboard.tsx';

const marketTable = `
      {/* Market Overview */}
      <div className="max-w-7xl mx-auto px-6 pb-6">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[11px] font-bold text-slate-400 tracking-[0.15em]">MARKET OVERVIEW</span>
          <span className="text-[10px] text-slate-600 font-mono">{total} PAIRS</span>
        </div>
        <div className="bg-[#0d1220] border border-[#1a2332] rounded-xl overflow-hidden">
          <div className="grid grid-cols-12 px-4 py-2 bg-[#0a0f18] border-b border-[#1a2332] text-[9px] font-mono text-slate-500 tracking-wider">
            <div className="col-span-3">SYMBOL</div>
            <div className="col-span-3 text-right">PRICE</div>
            <div className="col-span-3 text-right">TREND</div>
            <div className="col-span-3 text-right">STATUS</div>
          </div>
          {APPROVED.map((pair) => {
            const ms = marketStates.find((m:any)=>m.pair===pair);
            const price = prices[pair] || 0;
            const dir = ms?.direction || 'NONE';
            const sig = active.find((a:any)=>a.pair===pair);
            const isLong = sig?.direction==='LONG'||sig?.signal==='BUY';
            return (
              <div key={pair} className={'grid grid-cols-12 px-4 py-3 border-b border-[#1a2332]/50 transition-colors ' + (sig ? (isLong ? 'bg-emerald-500/[0.03]' : 'bg-red-500/[0.03]') : 'hover:bg-[#0a0f18]')} onClick={()=>sig&&nav('/trades')}>
                <div className="col-span-3 flex items-center gap-2">
                  <span className="text-sm font-bold text-white">{pair}</span>
                </div>
                <div className="col-span-3 text-right">
                  <span className="text-sm font-mono font-semibold text-white tabular-nums">{fp(price, pair)}</span>
                </div>
                <div className="col-span-3 text-right flex justify-end items-center">
                  {dir==='LONG'?(
                    <span className="text-[10px] font-bold text-emerald-400">BULLISH</span>
                  ):dir==='SHORT'?(
                    <span className="text-[10px] font-bold text-red-400">BEARISH</span>
                  ):(
                    <span className="text-[10px] text-slate-600">NEUTRAL</span>
                  )}
                </div>
                <div className="col-span-3 text-right flex justify-end items-center">
                  {sig?(
                    <span className={'px-2 py-0.5 rounded text-[9px] font-bold ' + (isLong ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400')}>{sig.status||'ACTIVE'}</span>
                  ):(
                    <span className="text-[10px] text-slate-600">--</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
`;

const closedTrades = `
      {/* Recently Closed */}
      {closed.length > 0 && (
        <div className="max-w-7xl mx-auto px-6 pb-6">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[11px] font-bold text-slate-500 tracking-[0.15em]">RECENTLY CLOSED</span>
          </div>
          <div className="space-y-1.5">
            {closed.slice(0,6).map((s:any) => {
              const result = s.result || (s.status==='TP3 HIT'||s.status==='TP2 HIT'?'WIN':'LOSS');
              const isWin = result==='WIN'||result==='PARTIAL WIN';
              const isLong = s.direction==='LONG'||s.signal==='BUY';
              return (
                <div key={s.id} className="bg-[#0d1220] border border-[#1a2332] rounded-lg px-4 py-3 flex items-center justify-between opacity-70 hover:opacity-100 transition-opacity">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-bold text-white">{s.pair}</span>
                    <span className={'text-[9px] font-bold px-1.5 py-0.5 rounded ' + (isLong ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400')}>{isLong?'LONG':'SHORT'}</span>
                  </div>
                  <div className={'text-xs font-bold ' + (isWin ? 'text-emerald-400' : 'text-red-400')}>{result}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
`;

fs.appendFileSync(target, marketTable + closedTrades, 'utf8');
console.log('Dashboard complete!');
