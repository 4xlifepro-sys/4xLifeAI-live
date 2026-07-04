// Download script - fetches 6 months M5+H4 for all 27 pairs from TwelveData
// Saves to .cache/ as JSON. Run once, then backtest uses cache.
import { TWELVEDATA_API_KEY } from '../config.local.js';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const PAIRS = [
  'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'USDCAD',
  'AUDUSD', 'NZDUSD', 'EURGBP', 'EURJPY', 'GBPJPY',
  'AUDJPY', 'NZDJPY', 'CADJPY', 'CHFJPY', 'EURAUD',
  'EURNZD', 'GBPAUD', 'XAUUSD', 'XAGUSD', 'BTCUSD',
  'ETHUSD', 'SOLUSD', 'XRPUSD', 'BNBUSD', 'ADAUSD',
  'LTCUSD', 'DOTUSD'
];

const MONTHS = 6;

function tdSymbol(p: string) {
  return p.length === 6 ? p.slice(0,3) + '/' + p.slice(3) : p;
}

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function download() {
  const cacheDir = join(process.cwd(), '.cache');
  if (!existsSync(cacheDir)) mkdirSync(cacheDir);

  let totalRequests = 0;
  let failed = 0;
  let done = 0;

  for (const pair of PAIRS) {
    for (const interval of ['4h', '5min']) {
      const symbol = tdSymbol(pair);
      const cacheFile = join(cacheDir, `${pair}_${interval}_${MONTHS}m.json`);

      // Skip if already cached
      if (existsSync(cacheFile)) {
        const existing = JSON.parse(readFileSync(cacheFile, 'utf-8'));
        console.log(`[SKIP] ${pair} ${interval} already cached (${existing.length} candles)`);
        done++;
        continue;
      }

      // Fetch 7-day chunks over 6 months (~26 requests per pair/interval)
      const endDate = new Date();
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - MONTHS);
      const allCandles: any[] = [];
      let current = new Date(startDate);

      while (current < endDate) {
        const chunkEnd = new Date(current);
        chunkEnd.setDate(chunkEnd.getDate() + 7);
        if (chunkEnd > endDate) chunkEnd.setTime(endDate.getTime());

        const url = `https://api.twelvedata.com/time_series?symbol=${symbol}&interval=${interval}&outputsize=5000&start_date=${current.toISOString().split('T')[0]}&end_date=${chunkEnd.toISOString().split('T')[0]}&apikey=${TWELVEDATA_API_KEY}`;

        const res = await fetch(url);
        totalRequests++;

        // Rate limit: pause after every 7 requests
        if (totalRequests % 7 === 0) {
          console.log(`[PAUSE] Request ${totalRequests} - waiting 60s...`);
          await sleep(62000);
        } else {
          await sleep(200);
        }

        const data = await res.json();
        if (data.status === 'error') {
          console.error(`[ERROR] ${pair} ${interval}: ${data.message}`);
          failed++;
          break;
        }

        if (data.values && data.values.length > 0) {
          const candles = data.values.map((v: any) => ({
            timestamp: v.datetime,
            open: parseFloat(v.open),
            high: parseFloat(v.high),
            low: parseFloat(v.low),
            close: parseFloat(v.close),
            volume: parseInt(v.volume || '0')
          }));
          allCandles.unshift(...candles);
        }

        current = chunkEnd;
      }

      if (allCandles.length > 0) {
        writeFileSync(cacheFile, JSON.stringify(allCandles));
        done++;
        console.log(`[OK] ${pair} ${interval}: ${allCandles.length} candles cached`);
      } else {
        failed++;
        console.error(`[FAIL] ${pair} ${interval}: no data`);
      }
    }
  }

  console.log(`\nDone: ${done} pairs cached, ${failed} failed, ${totalRequests} API calls`);
}

download().catch(e => { console.error(e); process.exit(1); });
