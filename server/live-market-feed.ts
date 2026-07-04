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

function decodePrice(value: any, digits: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return NaN;
  if (n === 0) return 0;
  return n / Math.pow(10, digits);
}

function decodeTrendbar(bar: any, _digits: number): { timestamp: string; open: number; high: number; low: number; close: number } | null {
  // cTrader trendbars are scaled by a fixed factor of 100000 across all symbols.
  // Verified empirically against live BTCUSD, ETHUSD, SOLUSD, XAUUSD, XAGUSD, FX pairs.
  const SCALE = 100000;

  const low = Number(bar.low ?? bar.lowPrice) / SCALE;

  const deltaOpen  = Number(bar.deltaOpen  ?? 0) / SCALE;
  const deltaHigh  = Number(bar.deltaHigh  ?? 0) / SCALE;
  const deltaClose = Number(bar.deltaClose ?? 0) / SCALE;

  let open  = Number.isFinite(deltaOpen)  ? low + deltaOpen  : low;
  let high  = Number.isFinite(deltaHigh)  ? low + deltaHigh  : low;
  const close = Number.isFinite(deltaClose) ? low + deltaClose : low;

  if (Number.isFinite(Number(bar.open)) || Number.isFinite(Number(bar.openPrice))) {
    open = Number(bar.open ?? bar.openPrice) / SCALE;
  }
  if (Number.isFinite(Number(bar.high)) || Number.isFinite(Number(bar.highPrice))) {
    high = Number(bar.high ?? bar.highPrice) / SCALE;
  }

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

function toCandle(bar: any): Candle | null {
  const digits = Number(bar.digits ?? 5);
  return decodeTrendbar(bar, digits);
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

export async function getLatestPrice(pair: string): Promise<{ pair: string; price: number | null; digits: number | null; timestamp: number; raw?: any; error?: string }> {
  const result: { pair: string; price: number | null; digits: number | null; timestamp: number; raw?: any; error?: string } = {
    pair,
    price: null,
    digits: null,
    timestamp: Date.now()
  };

  try {
    const client = await getClient();
    const symbols = await client.getSymbols();
    const symbol = symbols.find((item: any) => item.symbolName === pair || item.name === pair || item.symbol === pair);
    if (!symbol) {
      result.error = 'symbol_not_found';
      return result;
    }
    const symbolId = symbol.symbolId;
    const trendbarResp = await client.raw.market.getTrendbars({
      symbolId,
      period: TrendbarPeriod.M1,
      count: 2
    });
    const bars = Array.isArray(trendbarResp) ? trendbarResp : trendbarResp?.trendbars || [];
    if (!bars.length) {
      result.error = 'no_trendbars';
      return result;
    }
    const last = bars[bars.length - 1];
    const full = await client.getSymbolInfo(pair).catch(() => null);
    const digits = Number(full?.digits ?? 5);
    result.digits = digits;
    result.raw = { last, full: { symbolId: full?.symbolId, digits: full?.digits, name: full?.symbolName } };
    const decoded = decodeTrendbar(last, digits);
    if (decoded && Number.isFinite(decoded.close)) {
      result.price = decoded.close;
    } else {
      result.error = 'invalid_close';
    }
    return result;
  } catch (error: any) {
    result.error = error?.message || 'unknown';
    return result;
  }
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
    const digits = Number(symbol?.digits ?? 5);

    const result = await client.raw.market.getTrendbars({
      symbolId,
      period: getPeriod(interval),
      count: 100
    });

    const bars = Array.isArray(result) ? result : result?.trendbars || [];
    if (!bars.length) return null;

    const fetchedCandles = bars
      .map((bar: any) => decodeTrendbar(bar, digits))
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
