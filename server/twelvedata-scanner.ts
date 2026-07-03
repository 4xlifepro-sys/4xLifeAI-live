import { Candle } from '../src/types.js';
import { connect, TrendbarPeriod } from 'ctrader-ts';

const htfCache: Record<string, {data: Candle[], timestamp: number}> = {};
const HTF_CACHE_TTL = 60 * 60 * 1000; // 1 hour
let ctClient: any = null;
let connectingPromise: Promise<any> | null = null;

function getPeriod(interval: '1min' | '5min' | '15min' | '4h') {
  if (interval === '1min') return TrendbarPeriod.M1;
  if (interval === '5min') return TrendbarPeriod.M5;
  if (interval === '15min') return TrendbarPeriod.M15;
  return TrendbarPeriod.H4;
}

function toCandle(bar: any): Candle | null {
  const open = Number(bar.open ?? bar.openPrice ?? bar.deltaOpen ?? 0);
  const high = Number(bar.high ?? bar.highPrice ?? 0);
  const low = Number(bar.low ?? bar.lowPrice ?? 0);
  const close = Number(bar.close ?? bar.closePrice ?? bar.deltaClose ?? 0);

  if (![open, high, low, close].every(Number.isFinite)) {
    return null;
  }

  const timestampCandidate =
    bar.timestamp ??
    bar.time ??
    (typeof bar.utcTimestampInMinutes === 'number' ? bar.utcTimestampInMinutes * 60000 : null);

  const parsedTimestamp = typeof timestampCandidate === 'number'
    ? new Date(timestampCandidate)
    : new Date(timestampCandidate ? String(timestampCandidate) : Date.now());

  return {
    timestamp: parsedTimestamp.toISOString(),
    open,
    high,
    low,
    close
  };
}

async function getClient() {
  if (ctClient) return ctClient;
  if (connectingPromise) return connectingPromise;

  const accountId = Number(process.env.CTRADER_ACCOUNT_ID);
  const accessToken = process.env.CTRADER_ACCESS_TOKEN;
  const environment = (process.env.CTRADER_ENVIRONMENT || 'demo') as any;

  if (!accountId || !accessToken) {
    throw new Error('Live market feed credentials missing');
  }

  connectingPromise = connect({
    environment,
    accountId,
    accessToken
  }).then(client => {
    ctClient = client;
    console.log(`[MarketFeed] Connected (${environment})`);
    return client;
  }).finally(() => {
    connectingPromise = null;
  });

  return connectingPromise;
}

export async function fetchCandles(pair: string, interval: '1min' | '5min' | '15min' | '4h'): Promise<Candle[] | null> {
  if (interval === '4h' && htfCache[pair] && (Date.now() - htfCache[pair].timestamp < HTF_CACHE_TTL)) {
      return htfCache[pair].data;
  }

  try {
    const client = await getClient();
    const symbols = await client.getSymbols();
    const symbol = symbols.find((item: any) => item.symbolName === pair || item.name === pair || item.symbol === pair);
    const symbolId = symbol?.symbolId ?? pair;

    const result = await client.raw.market.getTrendbars({
      symbolId,
      period: getPeriod(interval),
      count: 100
    });

    const bars = Array.isArray(result) ? result : result?.trendbars || [];
    if (!bars.length) return null;

    const fetchedCandles = bars
      .map(toCandle)
      .filter((bar): bar is Candle => Boolean(bar));
    
    if (interval === '4h' && fetchedCandles.length > 0) {
        htfCache[pair] = { data: fetchedCandles, timestamp: Date.now() };
    }
    
    return fetchedCandles;
  } catch (error: any) {
    if (!error?.message?.includes('terminated')) {
      console.error(`Live market feed error (${pair}):`, error.message || error);
    }
    return null;
  }
}
