import { randomUUID } from 'node:crypto';
import type { Candle } from '../src/types.js';
import { supabase } from './supabase.js';
import { fetchCandlesForTimeframe } from './live-market-feed.js';
import { analyzeStrategyMarket } from './strategy-engine.js';
import { readStrategyConfig } from './strategy-config.js';

const SCAN_INTERVAL_MS = 60_000;
const CANDLE_REQUEST_GAP_MS = 180;
let workerStarted = false;
let scanInProgress = false;
let lastScanAt: string | null = null;
let lastError: string | null = null;
let interval: NodeJS.Timeout | null = null;

export function getStrategyWorkerState() {
  return { workerStarted, scanInProgress, lastScanAt, lastError, intervalMs: SCAN_INTERVAL_MS };
}

async function collectCandles(pair: string, timeframes: string[]): Promise<Record<string, Candle[]>> {
  const collected: Record<string, Candle[]> = {};
  for (const timeframe of [...new Set(timeframes)]) {
    collected[timeframe] = await fetchCandlesForTimeframe(pair, timeframe) || [];
    await new Promise(resolve => setTimeout(resolve, CANDLE_REQUEST_GAP_MS));
  }
  return collected;
}

async function storeLatestAnalysis(pair: string, analysis: ReturnType<typeof analyzeStrategyMarket>) {
  if (!supabase) return;
  const { error } = await supabase.from('strategy_analysis_logs').upsert({
    symbol: pair,
    analysis,
    strategy_version: analysis.strategyVersion,
    analyzed_at: analysis.analyzedAt,
  }, { onConflict: 'symbol' });
  if (error) console.error(`[StrategyEngine] Could not save ${pair} analysis:`, error.message);
}

async function publishSignal(analysis: ReturnType<typeof analyzeStrategyMarket>, configVersion: number) {
  if (!supabase || !analysis.direction || analysis.entry === null || analysis.stopLoss === null || !analysis.targets.length || analysis.confidence === null) return;
  const { data: existing, error: existingError } = await supabase.from('signals')
    .select('id')
    .eq('pair', analysis.pair)
    .eq('is_active', true)
    .limit(1);
  if (existingError) {
    console.error(`[StrategyEngine] Open-signal check failed for ${analysis.pair}:`, existingError.message);
    return;
  }
  if (existing?.length) return;

  const tier = analysis.confidence >= 75 ? 'A+' : analysis.confidence >= 70 ? 'A' : analysis.confidence >= 65 ? 'B' : 'C';
  const now = new Date().toISOString();
  const { error } = await supabase.from('signals').insert({
    id: randomUUID(),
    pair: analysis.pair,
    direction: analysis.direction,
    bias: analysis.htfBias,
    score: analysis.internalScore,
    confidence: Math.max(1, Math.min(10, Math.round(analysis.confidence / 10))),
    aiConfidence: analysis.confidence,
    tier,
    aiReason: analysis.reason,
    entry: analysis.entry,
    entry_price: analysis.entry,
    sl: analysis.stopLoss,
    original_sl: analysis.stopLoss,
    tp1: analysis.targets[0],
    tp2: analysis.targets[1] ?? null,
    tp3: analysis.targets[2] ?? null,
    created_at: now,
    timestamp: now,
    status: 'LIVE',
    is_active: true,
    strategy_version: String(configVersion),
    main_poi: analysis.mainPoi?.type ?? null,
    main_poi_price: analysis.mainPoi?.price ?? null,
    analysis_reason: analysis.reason,
  });
  if (error) console.error(`[StrategyEngine] Could not publish ${analysis.pair} signal:`, error.message);
  else console.log(`[StrategyEngine] Published ${analysis.pair} ${analysis.direction} at ${analysis.entry}; confidence ${analysis.confidence}/100.`);
}

async function scanEnabledStrategy() {
  if (scanInProgress) return;
  scanInProgress = true;
  lastScanAt = new Date().toISOString();
  lastError = null;
  try {
    const stored = await readStrategyConfig();
    if (!stored.storageReady) {
      lastError = stored.error || 'Strategy storage is unavailable.';
      return;
    }
    const config = stored.config;
    if (!config.active) return;
    if (!supabase) {
      lastError = 'Supabase is not configured.';
      return;
    }
    const timeframes = config.timeframes.filter(item => item.enabled).map(item => item.timeframe);
    for (const pair of config.allowedSymbols) {
      try {
        const candles = await collectCandles(pair, timeframes);
        let analysis = analyzeStrategyMarket(pair, candles, config);
        if ((analysis.state === 'BUY' || analysis.state === 'SELL') && !config.backtestApproved) {
          analysis = {
            ...analysis,
            state: 'WAITING',
            direction: null,
            entry: null,
            stopLoss: null,
            targets: [],
            riskReward: null,
            confidence: null,
            reason: 'Conditions align in this live scan, but signal publication is withheld until historical out-of-sample backtesting and demo forward validation approve this strategy version.',
            warnings: [...analysis.warnings, 'This strategy has not passed the required historical and demo validation gate.'],
          };
        }
        await storeLatestAnalysis(pair, analysis);
        if (analysis.state === 'BUY' || analysis.state === 'SELL') await publishSignal(analysis, config.version);
      } catch (error: any) {
        console.error(`[StrategyEngine] ${pair} scan failed:`, error?.message || error);
      }
    }
  } catch (error: any) {
    lastError = error?.message || 'Unknown automatic strategy scan error.';
    console.error('[StrategyEngine] Scan failed:', lastError);
  } finally {
    scanInProgress = false;
  }
}

export function startStrategyWorker() {
  if (workerStarted) return;
  workerStarted = true;
  if (!process.env.CTRADER_ACCESS_TOKEN || !process.env.CTRADER_ACCOUNT_ID) {
    lastError = 'cTrader live market data credentials are missing.';
    console.warn('[StrategyEngine] Automatic analysis is paused: cTrader live market data is not configured.');
    return;
  }
  if (!supabase) {
    lastError = 'Server Supabase is not configured.';
    console.warn('[StrategyEngine] Automatic analysis is paused: server Supabase is not configured.');
    return;
  }
  void scanEnabledStrategy();
  interval = setInterval(() => void scanEnabledStrategy(), SCAN_INTERVAL_MS);
  interval.unref?.();
  console.log('[StrategyEngine] Automatic strategy worker started; it remains inactive until an Admin activates a validated strategy.');
}

export async function getLatestStrategyAnalyses(symbols?: string[]) {
  if (!supabase) return { analyses: [], error: 'Server Supabase is not configured.' };
  let query = supabase.from('strategy_analysis_logs').select('symbol,analysis,analyzed_at,strategy_version').order('symbol');
  if (symbols?.length) query = query.in('symbol', symbols);
  const { data, error } = await query;
  return error ? { analyses: [], error: error.message } : { analyses: data || [] };
}
