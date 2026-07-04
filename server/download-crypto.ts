import fs from 'fs';
const API = '924ebbf5ccc14ca38de8677ced98b61c';
const pairs: [string, string][] = [['BTC/USD','BTCUSD'],['ETH/USD','ETHUSD'],['SOL/USD','SOLUSD'],['XRP/USD','XRPUSD'],['ADA/USD','ADAUSD'],['LTC/USD','LTCUSD'],['BNB/USD','BNBUSD'],['DOGE/USD','DOGEUSD']];
async function dl() {
  for (const [sym,pair] of pairs) {
    for (const interval of ['5min','4h']) {
      const url = 'https://api.twelvedata.com/time_series?symbol='+sym+'&interval='+interval+'&outputsize=5000&start_date=2026-01-04&end_date=2026-07-04&apikey='+API+'&format=CSV';
      const r = await fetch(url);
      const text = await r.text();
      if (text.includes('"code":429')) { console.log('RATE LIMITED on '+sym+' '+interval); break; }
      fs.writeFileSync('.cache/'+pair+'_'+interval+'_6m.csv', text);
      const lines = text.split('\n').length;
      console.log('OK '+pair+' '+interval+' ('+lines+' rows)');
      await new Promise(r => setTimeout(r, 9000));
    }
  }
}
dl();
