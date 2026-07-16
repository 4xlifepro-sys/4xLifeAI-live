import fs from 'fs';
const API = '924ebbf5ccc14ca38de8677ced98b61c';

// 10 NEW crypto pairs (in addition to the existing 8 already cached)
const pairs: [string, string][] = [
  ['DOT/USD','DOTUSD'], ['LINK/USD','LINKUSD'], ['AVAX/USD','AVAXUSD'],
  ['MATIC/USD','MATICUSD'], ['ATOM/USD','ATOMUSD'], ['UNI/USD','UNIUSD'],
  ['XLM/USD','XLMUSD'], ['TRX/USD','TRXUSD'], ['ETC/USD','ETCUSD'],
  ['NEAR/USD','NEARUSD'],
];

async function sleep(ms:number){return new Promise(r=>setTimeout(r,ms));}

async function dl() {
  if(!fs.existsSync('.cache')) fs.mkdirSync('.cache');
  for (const [sym,pair] of pairs) {
    for (const interval of ['4h','5min']) {
      const url = `https://api.twelvedata.com/time_series?symbol=${sym}&interval=${interval}&outputsize=5000&start_date=2026-01-04&end_date=2026-07-04&apikey=${API}`;
      try {
        const r = await fetch(url);
        const data:any = await r.json();
        if (data.status==='error' || data.code===429) { console.log(`FAIL ${pair} ${interval}: ${data.message||data.code}`); await sleep(9000); continue; }
        if (!data.values || !data.values.length) { console.log(`EMPTY ${pair} ${interval}`); await sleep(9000); continue; }
        const candles = data.values.map((v:any)=>({timestamp:v.datetime,open:+v.open,high:+v.high,low:+v.low,close:+v.close,volume:parseInt(v.volume||'0')}));
        candles.reverse(); // TwelveData returns newest-first
        fs.writeFileSync(`.cache/${pair}_${interval}_6m.json`, JSON.stringify(candles));
        console.log(`OK ${pair} ${interval} (${candles.length} candles)`);
      } catch(e:any){ console.log(`ERR ${pair} ${interval}: ${e.message}`); }
      await sleep(9000); // free tier: ~8 req/min
    }
  }
  console.log('Done downloading 10 new crypto pairs.');
}
dl();
