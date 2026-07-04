import fs from 'fs';
const API = '924ebbf5ccc14ca38de8677ced98b61c';

// Major Forex + Metals (highest priority)
const pairs: [string, string][] = [
  ['GBP/USD','GBPUSD'],
  ['USD/CHF','USDCHF'],
  ['USD/CAD','USDCAD'],
  ['AUD/USD','AUDUSD'],
  ['NZD/USD','NZDUSD'],
  ['XAU/USD','XAUUSD'],
  ['XAG/USD','XAGUSD'],
];

async function dl() {
  for (const [sym,pair] of pairs) {
    for (const interval of ['5min','4h']) {
      const url = 'https://api.twelvedata.com/time_series?symbol='+sym+'&interval='+interval+'&outputsize=5000&start_date=2026-01-04&end_date=2026-07-04&apikey='+API+'&format=CSV';
      const r = await fetch(url);
      const text = await r.text();
      if (text.includes('"code":429')) {
        console.log('RATE LIMITED on '+sym+' '+interval);
        await new Promise(r => setTimeout(r, 10000));
        continue;
      }
      const lines = text.trim().split('\n');
      if (lines.length <= 2) {
        console.log('EMPTY/ERROR: '+sym+' '+interval);
        continue;
      }
      const data = lines.slice(1).map(line => {
        const [datetime, open, high, low, close] = line.split(';');
        return { timestamp: datetime.replace(' ','T')+'Z', open: parseFloat(open), high: parseFloat(high), low: parseFloat(low), close: parseFloat(close) };
      });
      fs.writeFileSync('.cache/'+pair+'_'+interval+'_6m.json', JSON.stringify(data));
      console.log('OK '+pair+' '+interval+' ('+data.length+' rows)');
      await new Promise(r => setTimeout(r, 9000));
    }
  }
}
dl();
