// Extends XAUUSD/XAGUSD 5min cache from the truncated ~17-day single-shot fetch
// to a full 6-month chunked fetch (7-day chunks, same approach as download-data.ts).
// The old cache files were overwritten by a single outputsize=5000 call that
// silently truncated to the most recent ~17 days. This script properly chunks
// requests so the full 6-month range is captured, matching forex pairs.
import { TWELVEDATA_API_KEY } from '../config.local.js';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const PAIRS = ['XAUUSD', 'XAGUSD'];
const MONTHS = 6;

function tdSymbol(p: string) {
  return p.slice(0, 3) + '/' + p.slice(3);
}

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function download() {
  const cacheDir = join(process.cwd(), '.cache');
  if (!existsSync(cacheDir)) mkdirSync(cacheDir);

  let totalRequests = 0;

  for (const pair of PAIRS) {
    for (const interval of ['5min']) {
      const symbol = tdSymbol(pair);
      const cacheFile = join(cacheDir, `${pair}_${interval}_${MONTHS}m.json`);

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

        if (totalRequests % 7 === 0) {
          console.log(`[PAUSE] Request ${totalRequests} - waiting 60s...`);
          await sleep(62000);
        } else {
          await sleep(1500);
        }

        const data = await res.json();
        if (data.status === 'error') {
          console.error(`[ERROR] ${pair} ${interval} chunk ${current.toISOString().split('T')[0]}: ${data.message}`);
          current = chunkEnd;
          continue;
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

      // de-dup by timestamp in case chunk boundaries overlap
      const seen = new Set<string>();
      const dedup = allCandles.filter(c => {
        if (seen.has(c.timestamp)) return false;
        seen.add(c.timestamp);
        return true;
      });

      if (dedup.length > 0) {
        writeFileSync(cacheFile, JSON.stringify(dedup));
        console.log(`[OK] ${pair} ${interval}: ${dedup.length} candles cached (was 5000 truncated)`);
      } else {
        console.error(`[FAIL] ${pair} ${interval}: no data`);
      }
    }
  }

  console.log(`\nDone. Total API requests: ${totalRequests}`);
}

download().catch(e => { console.error(e); process.exit(1); });
