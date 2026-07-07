import { fetchCandles } from './live-market-feed.js';
import { detectTrendMomentumScannerV5, getPipMultiplier } from './engine2.js';

// Map internal status values to real DB check constraint values
// DB allows: PENDING_APPROVAL, LIVE, TP1_HIT, TP2_HIT, TP3_HIT, STOP_LOSS_HIT, CLOSED, REJECTED_BY_ADMIN
function mapStatus(s: string | undefined): string {
  if (!s) return 'LIVE';
  if (s === 'ACTIVE') return 'LIVE';
  if (s === 'TP1 HIT' || s === 'TP1_HIT') return 'TP1_HIT';
  if (s === 'TP2 HIT' || s === 'TP2_HIT') return 'TP2_HIT';
  if (s === 'TP3 HIT' || s === 'TP3_HIT') return 'TP3_HIT';
  if (s === 'STOP_LOSS_HIT' || s === 'SL HIT') return 'STOP_LOSS_HIT';
  if (s === 'WIN' || s === 'LOSS' || s === 'VOID' || s === 'CANCELLED') return 'CLOSED';
  if (s === 'REJECTED' || s === 'REJECTED_BY_ADMIN') return 'REJECTED_BY_ADMIN';
  if (s === 'LIVE' || s === 'PENDING_APPROVAL') return s;
  return 'LIVE';
}

// Per-pair cooldown: after a signal fires (and closes), wait this many ms before firing again
// Prevents the scanner from re-firing the same setup within seconds
const PAIR_COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 hours cooldown per pair
const MAX_ACTIVE_TRADES = 2;
const MIN_LIVE_SIGNAL_CONFIDENCE = 70;
const OPEN_SIGNAL_STATUSES = ['LIVE', 'TP1_HIT', 'TP2_HIT'];

// EMERGENCY KILL SWITCH - set to true to pause ALL Telegram signals immediately
const TELEGRAM_SIGNALS_DISABLED = process.env.DISABLE_TELEGRAM_SIGNALS === 'true';

export const rejectionStats = {
   ATR_LOW: 0,
   EMA_FLAT: 0,
   MOMENTUM: 0,
   STOCHASTIC: 0,
   VWAP: 0,
   API_ERROR: 0,
   SPIKE: 0,
   COUNTER_TREND: 0,
   NO_PULLBACK: 0,
   STOP_DISTANCE: 0,
   LOW_CONFIDENCE: 0,
   ACTIVE_TRADE_EXISTS: 0
};
import { supabase } from './supabase.js';
import { Signal, Stats, PairScanStatus, MarketState } from '../src/types.js';
import { sendTelegramMessage } from './telegram.js';
import { GoogleGenAI } from "@google/genai";
import fs from 'fs';
import path from 'path';

function getSignalExplainerPrompt(): string {
  try {
    const data = fs.readFileSync(path.join(process.cwd(), 'prompts.json'), 'utf8');
    const prompts = JSON.parse(data);
    return prompts.signal_explainer_prompt;
  } catch (e) {
    return "You are an expert forex trader. Explain this signal to a user in plain English:\nPair: ${signal.pair}\nDirection: ${signal.direction}\nConfidence Score: ${signal.aiConfidence}%\nStatus: ${signal.tier}\nMarket Regime: ${signal.diagnostics?.confidenceBreakdown?.regime === 5 ? 'Trending (Clean)' : 'Chop / Mixed'}\nWhy this triggered:\n- ATR, VWAP, EMA alignments were matched\n- Pullback and stochastic were confirmed\n- Stop Loss is well placed\n\nGive a short, punchy 2-3 sentence explanation of why this trade looks good and what market structure we are following. No fluffy intros. Keep it to the point.";
  }
}

const ai = process.env.GEMINI_API_KEY ? new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
}) : null;

// Simple in-memory cache to prevent duplicate Gemini calls for similar signals
const aiReasonCache = new Map<string, { text: string, timestamp: number }>();

async function generateAiReason(dbId: string, signal: Signal) {
  if (!ai || !supabase) return;
  
  // Gating Logic: Do NOT call AI for rejected or low confidence signals
  if (signal.tier === 'Reject' || signal.status === 'REJECTED') {
      return;
  }
  
  if (signal.aiConfidence < 70) {
      return; // Skip AI generation for weak setups to save quota
  }

  // Cache key based on regime, pair, direction, timeframe
  const regimeStr = signal.diagnostics?.regimeState || 'UNKNOWN';
  const cacheKey = `${regimeStr}_${signal.pair}_${signal.direction}_5M`;
  const cached = aiReasonCache.get(cacheKey);
  
  // Use cache if it's less than 4 hours old
  if (cached && (Date.now() - cached.timestamp) < 4 * 60 * 60 * 1000) {
      updateSignalReason(dbId, signal.id, cached.text);
      return;
  }

  try {
    const template = getSignalExplainerPrompt();
    const regimeLabel = signal.diagnostics?.confidenceBreakdown?.regime === 5 ? 'Trending (Clean)' : 'Chop / Mixed';
    const prompt = template
      .replace(/\${signal\.pair}/g, signal.pair)
      .replace(/\${signal\.direction}/g, signal.direction)
      .replace(/\${signal\.aiConfidence}/g, String(signal.aiConfidence))
      .replace(/\${signal\.tier}/g, signal.tier)
      .replace(/\${signal\.diagnostics\?\.confidenceBreakdown\?\.regime\s*===\s*5\s*\?\s*'Trending\s*\(Clean\)'\s*:\s*'Chop\s*\/\s*Mixed'}/g, regimeLabel);
    
    const response = await ai.models.generateContent({
       model: "gemini-3.5-flash",
       contents: prompt
    });
    
    const text = response.text;
    if (text) {
        aiReasonCache.set(cacheKey, { text, timestamp: Date.now() });
        await updateSignalReason(dbId, signal.id, text);
    }
  } catch(e: any) {
    console.error("Failed to generate AI explanation:", e.message);
    // Fallback behavior if AI fails (e.g. rate limit 429)
    const fallbackText = `Automated ${signal.tier} signal detected for ${signal.pair}. Momentum and trend alignment confirm a ${signal.direction} bias.`;
    aiReasonCache.set(cacheKey, { text: fallbackText, timestamp: Date.now() });
    await updateSignalReason(dbId, signal.id, fallbackText);
  }
}

async function updateSignalReason(dbId: string, signalId: string, text: string) {
    if (!supabase) return;
    try {
        await supabase.from('signals')
            .update({ ai_reason: text })
            .eq('id', dbId);
            
        // Also update memory state if present
        const memSignal = scannerState.signals.find(s => s.id === signalId);
        if (memSignal) {
            memSignal.aiReason = text;
        }
        const activeOpp = scannerState.activeOpportunities.find(s => s.id === signalId);
        if (activeOpp) {
            activeOpp.aiReason = text;
        }
    } catch (e) {
        console.error("Failed to update AI reason in DB", e);
    }
}

export const isWeekend = () => {
  const day = new Date().getUTCDay()
  return day === 0 || day === 6
}

export const WEEKEND_PAIRS = ['BTCUSD', 'SOLUSD', 'BNBUSD', 'LTCUSD', 'ETHUSD', 'XAGUSD', 'XAUUSD'];

export const APPROVED_PAIRS = [
  'XAUUSD', 'BTCUSD', 'SOLUSD', 'GBPNZD', 'CADJPY', 'NZDJPY',
  'EURNZD', 'USDCAD', 'XAGUSD', 'LTCUSD', 'ETHUSD', 'GBPAUD',
  'BNBUSD', 'AUDUSD'
];

export const PAIRS = [...APPROVED_PAIRS]; // Initialized, mutable by mode switch

export const latestMarketState = new Map<string, MarketState>(
  APPROVED_PAIRS.map(pair => [
    pair,
    { pair, direction: 'NONE', tier: 'Neutral', timestamp: new Date().toISOString(), strengthScore: 0, momentumScore: 0, atrScore: 0, trendScore: 0 }
  ])
);

export const scannerState = {
  stats: {
    scanCycles: 0,
    lastScanDuration: 0,
    lastScanTime: null as number | null,
    totalAssetsConfigured: PAIRS.length,
    activeAssets: PAIRS.length,
    totalScannedAssets: PAIRS.length,
    telegramPushes: 0,
    duplicateEvents: 0,
    rateLimitRecoveries: 0,
    lastSignalTimestamp: null as string | null,
    lastTradeTimestamp: null as string | null,
    scannerStartTime: Date.now(),
    totalScanDurationMs: 0,
  } as Stats & { totalAssetsConfigured: number; activeAssets: number; totalScannedAssets: number; telegramPushes: number; duplicateEvents: number; rateLimitRecoveries: number; lastSignalTimestamp: string | null; lastTradeTimestamp: string | null; scannerStartTime: number; totalScanDurationMs: number },
  signals: [] as Signal[],
  activeOpportunities: [] as any[],
  confidenceHistory: [] as number[],
  pairStatuses: PAIRS.map(pair => ({
    pair,
    category: getCategory(pair),
    status: 'success',
    lastScanTime: undefined,
  })) as PairScanStatus[]
};

function getCategory(pair: string) {
  if (['BTCUSD', 'ETHUSD', 'SOLUSD', 'XRPUSD', 'BNBUSD', 'ADAUSD', 'LTCUSD', 'DOTUSD'].includes(pair)) return 'Crypto';
  if (['XAUUSD', 'XAGUSD'].includes(pair)) return 'Metals';
  if (['EURUSD', 'GBPUSD', 'AUDUSD', 'NZDUSD', 'USDCAD', 'USDCHF'].includes(pair)) return 'Majors';
  if (['USDJPY', 'EURJPY', 'GBPJPY', 'AUDJPY', 'CHFJPY'].includes(pair)) return 'JPY Crosses';
  return 'Other Crosses';
}

function updatePairStatus(pair: string, status: 'scanning' | 'success' | 'error', message?: string) {
  const p = scannerState.pairStatuses.find(x => x.pair === pair);
  if (p) {
    p.status = status;
    if (status !== 'scanning') p.lastScanTime = new Date().toISOString();
    p.message = message;
  }
}

const htfCache = new Map<string, { data: any, timestamp: number }>();

async function getGlobalActiveTradeCount() {
  const memoryCount = scannerState.signals.filter((signal: any) => OPEN_SIGNAL_STATUSES.includes(signal.status || 'LIVE')).length;
  let dbCount = 0;

  if (supabase) {
    const { count, error } = await supabase
      .from('signals')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true)
      .in('status', OPEN_SIGNAL_STATUSES);

    if (error) {
      console.error('Global active trade count error:', error.message);
    } else {
      dbCount = count || 0;
    }
  }

  return supabase ? dbCount : memoryCount;
}

export async function startScanner() {
  console.log("Starting 24/7 4xLifeAI Scanner...");

  if (supabase) {
    try {
      console.log("Initializing stats from Supabase historical data...");
      
      const getCount = async (filter?: (query: any) => any) => {
        let query = supabase!.from('signals').select('*', { count: 'exact', head: true });
        if (filter) query = filter(query);
        const { count, error } = await query;
        if (error) {
            console.log(`Fallback for signal count (schema mismatch?): returning 0`);
            return 0;
        }
        return count || 0;
      };

      // stats removed
      console.log(`Initialized database stats connection.`);
    } catch (e: any) {
      console.warn("Failed to query", JSON.stringify(e));
    }
  }
  
  // Sequential queue to strictly prevent API overlapping and 429 Rate Limits
  const baseDelayMs = 8000;
  const validationCooldownMs = 4000;

  let currentIndex = 0;
  
  // Health tracking
  scannerState.stats.isDegraded = false;
  scannerState.stats.consecutiveApiErrors = 0;

  async function runNextCycle() {
    // Health Monitor check for stalled cycles
    if (scannerState.stats.lastScanTime && Date.now() - scannerState.stats.lastScanTime > 10 * 60 * 1000) {
       scannerState.stats.isDegraded = true;
       console.error("Health Monitor: Scanner stalled for > 10 mins! Status DEGRADED.");
    }

    const STALE_THRESHOLD = 10 * 60 * 1000;
    const now = Date.now();
    for (const [p, state] of latestMarketState.entries()) {
        if (now - new Date(state.timestamp).getTime() > STALE_THRESHOLD) {
            state.tier = 'STALE';
        }
    }

    const hasPairsChanged = PAIRS.length !== APPROVED_PAIRS.length || !PAIRS.every((val, i) => val === APPROVED_PAIRS[i]);
    if (hasPairsChanged) {
      PAIRS.splice(0, PAIRS.length, ...APPROVED_PAIRS);
      currentIndex = 0;
    }

    if (currentIndex === 0) {
      scannerState.stats.mode = isWeekend() ? 'crypto' : 'forex';
      
      scannerState.stats.totalAssetsConfigured = APPROVED_PAIRS.length;
      scannerState.stats.activeAssets = PAIRS.length;
      scannerState.stats.totalScannedAssets = PAIRS.length;
    }

    const startTime = Date.now();
    const pair = PAIRS[currentIndex];

    // On weekends, skip forex pairs to save API credits and reduce latency
    const isCryptoOrMetal = ['BTCUSD', 'ETHUSD', 'SOLUSD', 'XRPUSD', 'BNBUSD', 'ADAUSD', 'LTCUSD', 'DOTUSD', 'XAUUSD', 'XAGUSD'].includes(pair);
    if (isWeekend() && !isCryptoOrMetal) {
       currentIndex++;
       if (currentIndex >= PAIRS.length) {
         currentIndex = 0;
         scannerState.stats.scanCycles++;
         scannerState.stats.lastScanDuration = Date.now() - (scannerState.stats.lastScanTime || startTime);
         scannerState.stats.totalScanDurationMs += scannerState.stats.lastScanDuration;
         scannerState.stats.lastScanTime = Date.now();
       }
       setTimeout(runNextCycle, 50);
       return;
    }

    updatePairStatus(pair, 'scanning');
    
    try {
      if (!process.env.CTRADER_ACCESS_TOKEN || !process.env.CTRADER_ACCOUNT_ID) {
        throw new Error('Live market feed unavailable � retrying next cycle');
      }

      // We now need 4h and 5min candles (with 4H caching)
      let htf = null;
      const cachedHtf = htfCache.get(pair);
      
      // Cache valid for 4 hours (4 * 60 * 60 * 1000 ms)
      if (cachedHtf && (Date.now() - cachedHtf.timestamp < 4 * 60 * 60 * 1000)) {
         htf = cachedHtf.data;
      } else {
         htf = await fetchCandles(pair, '4h');
         if (htf) htfCache.set(pair, { data: htf, timestamp: Date.now() });
         // Delay slightly between API calls to protect the live feed ONLY if we made a 4H request
         await new Promise(r => setTimeout(r, 1500));
      }
      
      let setupPromise = fetchCandles(pair, '5min');
      let activeSignalsPromise: any = null;
      
      if (supabase) {
          activeSignalsPromise = supabase
            .from('signals')
            .select('*')
            .eq('pair', pair)
            .eq('is_active', true)
            .in('status', ['LIVE', 'TP1_HIT', 'TP2_HIT']) as any;
      }
      
      const [setup, supabaseResponse] = await Promise.all([setupPromise, activeSignalsPromise]);
      
      const entryTf = setup; // Compatibility for now

      if (!htf || !setup) {
         throw new Error('Live market feed unavailable � retrying next cycle');
      }

      // ==== 4xLifeAI REAL-TIME TP/SL TRACKING ====
      if (supabase) {
        try {
          const activeSignals = supabaseResponse?.data;
          const fetchSignalsError = supabaseResponse?.error;

          if (fetchSignalsError) {
            console.error("Supabase active signals fetch error:", fetchSignalsError.message);
          }

          if (activeSignals && activeSignals.length > 0) {
            for (const s of activeSignals) {
              const trackingStartTime = s.tp2_hit_at || s.tp1_hit_at || s.created_at || s.timestamp || 0;
              const openedAt = new Date(trackingStartTime).getTime();
              const trackingCandles = entryTf.filter((candle: any) => new Date(candle.timestamp).getTime() > openedAt);
              let currentPrice = trackingCandles[trackingCandles.length - 1];
              if (!currentPrice || !Number.isFinite(Number(currentPrice.close))) {
                 continue;
              }

              const pipMult = getPipMultiplier(pair);
              const calculatePips = (price1: number, price2: number) => {
                 return Math.abs(price1 - price2) / pipMult;
              };
          
              const sEntry = s.entry_price || s.entry || 0;
              let isHit = false;
              let finalClose = false;
              let hitLevel = '';
              let hitPrice = 0;
              let rawPips = 0;
              const currentStatus = s.tp2_hit_at ? 'TP2_HIT' : s.tp1_hit_at ? 'TP1_HIT' : (s.status || 'LIVE');
              let newStatus = currentStatus;
              let tpRecordStr = '';
          
              const isLong = s.direction === 'LONG' || s.direction === 'BUY' || s.signal === 'BUY';

              const firstEventCandle = trackingCandles.find((candle: any) => {
                 const close = Number(candle.close);
                 if (!Number.isFinite(close)) return false;
                 let trailingSL = s.sl;
                 if (currentStatus === 'TP2_HIT') trailingSL = s.tp1;
                 else if (currentStatus === 'TP1_HIT') trailingSL = sEntry;

                 if (isLong) {
                    return close <= trailingSL
                       || (close >= s.tp3 && currentStatus !== 'TP3_HIT')
                       || (close >= s.tp2 && !['TP2_HIT', 'TP3_HIT'].includes(currentStatus))
                       || (close >= s.tp1 && currentStatus === 'LIVE');
                 }

                 return close >= trailingSL
                    || (close <= s.tp3 && currentStatus !== 'TP3_HIT')
                    || (close <= s.tp2 && !['TP2_HIT', 'TP3_HIT'].includes(currentStatus))
                    || (close <= s.tp1 && currentStatus === 'LIVE');
              });

              if (firstEventCandle) {
                 currentPrice = firstEventCandle;
              }

              // Determine current effective SL based on trailing logic
              let effectiveSL = s.sl;
              if (currentStatus === 'TP2_HIT') {
                  effectiveSL = s.tp1;
              } else if (currentStatus === 'TP1_HIT') {
                  effectiveSL = sEntry;
              }

              if (isLong) {
                 if (currentPrice.close <= effectiveSL) {
                    isHit = true; finalClose = true;
                    hitLevel = 'SL'; hitPrice = effectiveSL; newStatus = 'STOP_LOSS_HIT';
                    rawPips = calculatePips(sEntry, effectiveSL);
                 } else if (currentPrice.close >= s.tp3 && currentStatus !== 'TP3_HIT') {
                    isHit = true; finalClose = true;
                    hitLevel = 'TP3'; hitPrice = s.tp3; newStatus = 'TP3_HIT'; tpRecordStr = 'tp3_hit_at';
                    rawPips = calculatePips(s.tp3, sEntry);
                 } else if (currentPrice.close >= s.tp2 && !['TP2_HIT', 'TP3_HIT'].includes(currentStatus)) {
                    isHit = true; finalClose = false;
                    hitLevel = 'TP2'; hitPrice = s.tp2; newStatus = 'TP2_HIT'; tpRecordStr = 'tp2_hit_at';
                    rawPips = calculatePips(s.tp2, sEntry);
                 } else if (currentPrice.close >= s.tp1 && currentStatus === 'LIVE') {
                    isHit = true; finalClose = false;
                    hitLevel = 'TP1'; hitPrice = s.tp1; newStatus = 'TP1_HIT'; tpRecordStr = 'tp1_hit_at';
                    rawPips = calculatePips(s.tp1, sEntry);
                 }
              } else { 
                 if (currentPrice.close >= effectiveSL) {
                    isHit = true; finalClose = true;
                    hitLevel = 'SL'; hitPrice = effectiveSL; newStatus = 'STOP_LOSS_HIT';
                    rawPips = calculatePips(sEntry, effectiveSL);
                 } else if (currentPrice.close <= s.tp3 && currentStatus !== 'TP3_HIT') {
                    isHit = true; finalClose = true;
                    hitLevel = 'TP3'; hitPrice = s.tp3; newStatus = 'TP3_HIT'; tpRecordStr = 'tp3_hit_at';
                    rawPips = calculatePips(sEntry, s.tp3);
                 } else if (currentPrice.close <= s.tp2 && !['TP2_HIT', 'TP3_HIT'].includes(currentStatus)) {
                    isHit = true; finalClose = false;
                    hitLevel = 'TP2'; hitPrice = s.tp2; newStatus = 'TP2_HIT'; tpRecordStr = 'tp2_hit_at';
                    rawPips = calculatePips(sEntry, s.tp2);
                 } else if (currentPrice.close <= s.tp1 && currentStatus === 'LIVE') {
                    isHit = true; finalClose = false;
                    hitLevel = 'TP1'; hitPrice = s.tp1; newStatus = 'TP1_HIT'; tpRecordStr = 'tp1_hit_at';
                    rawPips = calculatePips(sEntry, s.tp1);
                 }
              }
          
              if (isHit) {
                 const dt = new Date();
                 const closedAt = dt.toISOString();
                 
                 let finalResult = 'LOSS';
                 if (finalClose) {
                     if (hitLevel === 'TP3') finalResult = 'WIN';
                     else if (hitLevel === 'SL') {
                         if (currentStatus === 'TP2_HIT') {
                             finalResult = 'PARTIAL WIN';
                             rawPips = calculatePips(s.tp2, sEntry);
                         } else if (currentStatus === 'TP1_HIT') {
                             finalResult = 'PARTIAL WIN';
                             rawPips = calculatePips(s.tp1, sEntry);
                         }
                         else finalResult = 'LOSS';
                     }
                 } else {
                     finalResult = 'OPEN';
                 }
                 
                 let headerEmoji = '🎯';
                let titleText = `4xFiveAI — ${hitLevel} HIT`;
                 let statusLine = '';
                 if (hitLevel === 'SL') {
                     if (finalResult === 'PARTIAL WIN') {
                         headerEmoji = '✅';
                        titleText = s.status === 'TP2_HIT' ? '4xFiveAI — TP2 SECURED' : '4xFiveAI — TP1 SECURED';
                     } else if (finalResult === 'BREAKEVEN') {
                         headerEmoji = '🛡️';
                        titleText = '4xFiveAI — STOPPED AT BREAKEVEN';
                     } else {
                         headerEmoji = '🛑';
                        titleText = '4xFiveAI — STOP LOSS HIT';
                     }
                     statusLine = '\n\nStatus: TRADE CLOSED';
                 } else if (hitLevel === 'TP2') {
                     headerEmoji = '🚀';
                 } else if (hitLevel === 'TP3') {
                     headerEmoji = '🏆';
                    titleText = '4xFiveAI — FULL TARGET REACHED';
                     statusLine = '\n\nStatus: TRADE CLOSED';
                 }

                 const isWinOutcome = finalResult === 'WIN' || finalResult === 'PARTIAL WIN' || (hitLevel !== 'SL' && finalResult !== 'BREAKEVEN');
                 const isBreakevenOutcome = finalResult === 'BREAKEVEN';
                 const resultEmoji = isWinOutcome ? '✅' : (isBreakevenOutcome ? '🛡️' : '❌');
                 const sign = isWinOutcome ? '+' : (isBreakevenOutcome ? '' : '-');
                 const pipStr = isBreakevenOutcome ? '0.0' : Math.abs(rawPips).toFixed(1);
                 
                 const directionStr = isLong ? 'BUY' : 'SELL';
                 const hitMsg = `${headerEmoji} <b>${titleText}</b>\n\n`
                 + `Pair: ${pair}\n`
                 + `Signal: ${directionStr}\n\n`
                 + `Entry: ${sEntry}\n\n`
                 + `${hitLevel}: ${hitPrice}\n\n`
                 + `Result: ${sign}${pipStr} pips ${resultEmoji}${statusLine}\n\n`
                 + `Timestamp: ${dt.toUTCString()}`;
                 
                 console.log(`[OUTCOME TRACKER] ${pair} ${hitLevel} HIT @ ${closedAt}`);
                 if (!TELEGRAM_SIGNALS_DISABLED) sendTelegramMessage(hitMsg); else console.log('[KILL SWITCH] Telegram hit msg BLOCKED');
                 
                 if (finalClose) {
                     scannerState.stats.lastTradeTimestamp = closedAt;
                     
                     // Trade Summary Alert
                     const openedAtDt = new Date(s.timestamp || s.created_at || sEntry); // roughly
                     const durationMs = dt.getTime() - openedAtDt.getTime();
                     const hours = Math.floor(durationMs / (1000 * 60 * 60));
                     const mins = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
                     
                     const tp1Status = (hitLevel === 'TP3' || hitLevel === 'TP2' || s.status === 'TP1_HIT' || s.status === 'TP2_HIT' || hitLevel === 'TP1') ? 'HIT ✅' : 'MISSED ❌';
                     const tp2Status = (hitLevel === 'TP3' || hitLevel === 'TP2' || s.status === 'TP2_HIT') ? 'HIT ✅' : 'MISSED ❌';
                     const tp3Status = (hitLevel === 'TP3') ? 'HIT ✅' : 'MISSED ❌';
                     
                     const isWin = finalResult === 'WIN' || finalResult === 'PARTIAL WIN';
                     const isBreakeven = finalResult === 'BREAKEVEN';
                     const totalPips = isWin ? `+${pipStr}` : (isBreakeven ? `0.0` : `-${pipStr}`);
                     const summaryEmoji = isWin ? '🟢' : (isBreakeven ? '🛡️' : '🔴');
                     
                     const riskPips = calculatePips(sEntry, s.sl) || 1; // avoid / 0
                     const rrRatio = (rawPips / riskPips).toFixed(1);
                     const riskRewardStr = isWin ? `1:${rrRatio}` : (isBreakeven ? '0:0' : `-1:1`);
                     
                    const summaryMsg = `📊 <b>4xFiveAI — TRADE SUMMARY</b>\n\n`
                     + `Pair: ${pair}\n`
                     + `Direction: ${directionStr}\n`
                     + `Entry: ${sEntry}\n`
                     + `Exit: ${hitPrice}\n\n`
                     + `TP1: ${tp1Status}\n`
                     + `TP2: ${tp2Status}\n`
                     + `TP3: ${tp3Status}\n\n`
                     + `Profit: ${totalPips} pips\n`
                     + `Risk Reward: ${riskRewardStr}\n`
                     + `Duration: ${hours}h ${mins}m\n`
                     + `Outcome: ${finalResult} ${summaryEmoji}\n\n`
                     + `Timestamp: ${dt.toUTCString()}`;
                     
                     if (!TELEGRAM_SIGNALS_DISABLED) sendTelegramMessage(summaryMsg); else console.log('[KILL SWITCH] Telegram summary msg BLOCKED');
                 }
                 
                 // Payload construction for Supabase update
                 const updatePayload: any = { status: mapStatus(newStatus) };
                 if (hitLevel === 'SL' && finalResult === 'PARTIAL WIN') {
                    updatePayload.status = mapStatus('CLOSED');
                 }
                 if (tpRecordStr) {
                    updatePayload[tpRecordStr] = closedAt;
                 }
                 if (hitLevel === 'TP3') {
                     if (s.status !== 'TP2_HIT' && s.status !== 'TP1_HIT') updatePayload['tp1_hit_at'] = closedAt;
                     if (s.status !== 'TP2_HIT') updatePayload['tp2_hit_at'] = closedAt;
                 } else if (hitLevel === 'TP2') {
                     if (s.status !== 'TP1_HIT') updatePayload['tp1_hit_at'] = closedAt;
                 }
                 
                 // Update Trailing SL in DB
                 if (!finalClose) {
                     if (hitLevel === 'TP1') {
                         updatePayload.sl = sEntry;
                     } else if (hitLevel === 'TP2') {
                         updatePayload.sl = s.tp1;
                     }
                 }
                 
                 if (finalClose) {
                    updatePayload.is_active = false;
                    updatePayload.closed_at = closedAt;
                    updatePayload.result = finalResult;
                    if (finalResult === 'WIN' || finalResult === 'PARTIAL WIN') {
                       updatePayload.pips_won = rawPips;
                    } else if (finalResult === 'BREAKEVEN') {
                       updatePayload.pips_won = 0;
                       updatePayload.pips_lost = 0;
                    } else {
                       updatePayload.pips_lost = rawPips;
                    }
                 }
                 
                 const updatePromises: any[] = [];
                 
                 updatePromises.push(
                     supabase.from('signals').update(updatePayload).eq('id', s.id).then(({error}) => {
                         if (error) {
                             if (error.message.includes('Could not find') || error.message.includes('schema cache')) {
                                 const safePayload = { ...updatePayload };
                                 delete safePayload['tp1_hit_at'];
                                 delete safePayload['tp2_hit_at'];
                                 delete safePayload['tp3_hit_at'];
                                 if (tpRecordStr) delete safePayload[tpRecordStr];
                                 delete safePayload.closed_at;
                                 
                                 supabase.from('signals').update(safePayload).eq('id', s.id).then(({error: safeErr}) => {
                                     if (safeErr) console.error("Safe update for signals failed:", safeErr.message);
                                 });
                             } else {
                                 console.error("Failed to update signals table:", error.message);
                             }
                         }
                     })
                 );
                 
                 await Promise.all(updatePromises);
              }
            }
          }
        } catch(trackerError: any) {
          if (!trackerError?.message?.includes('terminated')) {
             console.error("Tracker Error:", trackerError);
          }
        }
      }
      // ===========================================

      const { signal, scores, regime, regimeReason } = detectTrendMomentumScannerV5(pair, htf, setup, entryTf);
      
      let finalSignal = signal;

      if (finalSignal && finalSignal.tier !== 'Reject') {
        const globalActiveTradeCount = await getGlobalActiveTradeCount();
        if (globalActiveTradeCount >= MAX_ACTIVE_TRADES) {
          console.log(`MAX_ACTIVE_TRADES_BLOCKED: ${globalActiveTradeCount}/${MAX_ACTIVE_TRADES} active trades already open`);
          finalSignal.tier = 'Reject';
          finalSignal.status = 'REJECTED';
          finalSignal.aiReason = 'MAX_ACTIVE_TRADES_REACHED';
          finalSignal.rejection_reason = 'MAX_ACTIVE_TRADES_REACHED';
          rejectionStats.ACTIVE_TRADE_EXISTS++;
          if (finalSignal.diagnostics) {
            finalSignal.diagnostics.confidenceBreakdown = 'MAX_ACTIVE_TRADES_REACHED';
          }
        } else if (finalSignal.aiConfidence < MIN_LIVE_SIGNAL_CONFIDENCE) {
          console.log(`LOW_CONFIDENCE_BLOCKED: ${pair} ${finalSignal.aiConfidence}% below ${MIN_LIVE_SIGNAL_CONFIDENCE}% live threshold`);
          finalSignal.tier = 'Reject';
          finalSignal.status = 'REJECTED';
          finalSignal.aiReason = 'LOW_CONFIDENCE_FOR_LIVE_SLOT';
          finalSignal.rejection_reason = 'LOW_CONFIDENCE_FOR_LIVE_SLOT';
          rejectionStats.LOW_CONFIDENCE++;
          if (finalSignal.diagnostics) {
            finalSignal.diagnostics.confidenceBreakdown = 'LOW_CONFIDENCE_FOR_LIVE_SLOT';
          }
        }
      }

      if (finalSignal && finalSignal.tier !== 'Reject' && supabase) {
        try {
          const { data: activePairTrades, error: activeTradesErr } = await supabase
            .from('signals')
            .select('id')
            .eq('pair', pair)
            .in('status', OPEN_SIGNAL_STATUSES)
            .limit(1);
            
          if (!activeTradesErr && activePairTrades && activePairTrades.length > 0) {
            console.log(`DUPLICATE_PAIR_BLOCKED: Active trade exists for ${pair}`);
            finalSignal.tier = 'Reject';
            finalSignal.status = 'REJECTED';
            finalSignal.aiReason = 'ACTIVE_TRADE_EXISTS';
            finalSignal.rejection_reason = 'ACTIVE_TRADE_EXISTS';
            rejectionStats.ACTIVE_TRADE_EXISTS++;
            if (finalSignal.diagnostics) {
               finalSignal.diagnostics.confidenceBreakdown = 'ACTIVE_TRADE_EXISTS';
            }
          }
        } catch(e) {
          console.error("Duplicate trade check error:", e);
        }
      }

      latestMarketState.set(pair, {
        pair: pair,
        direction: finalSignal ? finalSignal.direction : 'NONE',
        tier: finalSignal ? finalSignal.tier : 'Neutral',
        timestamp: finalSignal ? finalSignal.timestamp : new Date().toISOString(),
        strengthScore: scores?.strengthScore ?? 0,
        momentumScore: scores?.momentumScore ?? 0,
        atrScore: scores?.atrScore ?? 0,
        trendScore: scores?.trendScore ?? 0,
        regime: regime,
        regimeReason: regimeReason,
        rejectionReason: finalSignal ? (finalSignal.rejection_reason || finalSignal.aiReason || '') : (regimeReason || 'NO_SIGNAL')
      });

      if (finalSignal) {
        const signal = finalSignal;

        // Check per-pair cooldown: prevent re-firing same pair within cooldown window
        // Check BOTH in-memory array (fast, catches same-instance duplicates) AND
        // Supabase (survives restarts, catches cross-instance duplicates)
        let cooldownTriggered = false;
        
        // 1. In-memory check
        const recentInMemory = scannerState.signals.find(s => 
          s.pair === pair && 
          s.tier !== 'Reject' && 
          (Date.now() - new Date(s.timestamp).getTime()) < PAIR_COOLDOWN_MS
        );
        
        if (recentInMemory) {
          cooldownTriggered = true;
          console.log(`COOLDOWN_BLOCKED (memory): ${pair} fired within last ${PAIR_COOLDOWN_MS / 60000}m`);
        }
        
        // 2. Database check (for cross-restart protection)
        if (!cooldownTriggered && signal.tier !== 'Reject' && supabase) {
          const cooldownAgo = new Date(Date.now() - PAIR_COOLDOWN_MS).toISOString();
          const { data: recentSignals, error: cooldownErr } = await supabase
            .from('signals')
            .select('id')
            .eq('pair', pair)
            .in('status', ['LIVE', 'TP1_HIT', 'TP2_HIT'])
            .gte('created_at', cooldownAgo)
            .limit(1);
          if (cooldownErr) {
            console.error("Cooldown DB check error:", cooldownErr.message);
          }
          if (recentSignals && recentSignals.length > 0) {
            cooldownTriggered = true;
            console.log(`COOLDOWN_BLOCKED (db): ${pair} fired within last ${PAIR_COOLDOWN_MS / 60000}m`);
          }
        }
        
        if (cooldownTriggered) {
          signal.tier = 'Reject';
          signal.aiReason = 'COOLDOWN_ACTIVE';
          signal.status = 'REJECTED';
          rejectionStats.ACTIVE_TRADE_EXISTS++;
        }

        // Persistent deduplication: check Supabase to avoid cross-restart duplicate alerts/audit spam
        let isDuplicate = false;
        
        // 0. Active trade check
        const activeTrade = scannerState.activeOpportunities.find(o => o.pair === signal.pair && ['LIVE', 'TP1_HIT', 'TP2_HIT', 'ACTIVE', 'TP1 HIT', 'TP2 HIT'].includes(o.status));
        if (activeTrade && signal.tier !== 'Reject') {
            signal.tier = 'Reject';
            signal.aiReason = 'REJECT_ACTIVE_TRADE_EXISTS';
            signal.status = 'REJECTED';
            rejectionStats.ACTIVE_TRADE_EXISTS++;
            isDuplicate = true; 
        }
        
        const dbDirection = signal.direction === 'LONG' ? 'BUY' : signal.direction === 'SHORT' ? 'SELL' : signal.direction;

        // 1. In-memory exact ID match (catches same UUID within scan cycle)
        const memoryDuplicate = scannerState.signals.find(s => s.id === signal.id);
        
        // 2. In-memory fingerprint match (catches same setup even with different UUID)
        const setupHash = `${pair}:${signal.direction}:${Math.round(signal.entry * 100000)}:${Math.round(signal.sl * 100000)}`;
        const memoryFingerprint = scannerState.signals.find(s => {
          if (s.pair !== pair || s.direction !== signal.direction) return false;
          if (s.tier === 'Reject') return false;
          const age = Date.now() - new Date(s.timestamp).getTime();
          if (age > PAIR_COOLDOWN_MS) return false;
          const sHash = `${s.pair}:${s.direction}:${Math.round(s.entry * 100000)}:${Math.round(s.sl * 100000)}`;
          return sHash === setupHash;
        });
        
        if (!isDuplicate && (memoryDuplicate || memoryFingerprint)) {
             isDuplicate = true;
             if (memoryFingerprint) console.log(`DUPLICATE_BLOCKED (memory fingerprint): ${pair} ${signal.direction} @ ${signal.entry}`);
        } else if (!isDuplicate && supabase) {
           // Fingerprint dedup: check signals table for same pair+direction+entry+sl within cooldown window
           const dedupAgo = new Date(Date.now() - PAIR_COOLDOWN_MS).toISOString();
           const { data: dedupMatch, error: dedupErr } = await supabase
             .from('signals')
             .select('id')
             .eq('pair', pair)
             .eq('direction', dbDirection)
             .eq('entry_price', signal.entry)
             .eq('sl', signal.sl)
             .gte('created_at', dedupAgo)
             .limit(1);
           if (dedupErr) {
             console.error("Dedup DB check error:", dedupErr.message);
           }
           if (dedupMatch && dedupMatch.length > 0) {
              isDuplicate = true;
              console.log(`DUPLICATE_BLOCKED (db fingerprint): ${pair} ${signal.direction} @ ${signal.entry}`);
           }
        }

        if (isDuplicate) {
            scannerState.stats.duplicateEvents++;
        }

        if (signal.tier === 'Reject') {
          console.log(`REJECTED - ${pair} - ${signal.aiReason || signal.rejection_reason || regimeReason || 'unknown reason'}`);
        } else {
          console.log(`[SCAN] ${pair} - ${signal.direction} - ${signal.tier} - ${signal.aiConfidence}%`);
        }

        if (!isDuplicate) {
          // Update confidence history
          scannerState.confidenceHistory.unshift(signal.aiConfidence);
          if (scannerState.confidenceHistory.length > 4) {
             scannerState.confidenceHistory.pop();
          }

          if (signal.tier !== 'Reject') {
             scannerState.signals.unshift(signal);
             if (scannerState.signals.length > 100) scannerState.signals.pop();
             scannerState.stats.lastSignalTimestamp = signal.timestamp;
          }

          // Save Signal to public.signals for Active trades
          if (supabase && signal.tier !== 'Reject') {
            // Map internal values to match DB check constraints
            const dbStatus = mapStatus(signal.status);

            const insertPayload: any = {
              pair: signal.pair,
              direction: dbDirection,
              bias: signal.bias,
              score: signal.score,
              // constraint requires 1-10 integer scale; precise 0-100% preserved in 'score'
              confidence: Math.min(10, Math.max(1, Math.round(signal.aiConfidence / 10))),
              tier: signal.tier,
              entry_price: signal.entry,
              sl: signal.sl,
              original_sl: signal.sl,
              tp1: signal.tp1,
              tp2: signal.tp2,
              tp3: signal.tp3,
              created_at: signal.timestamp,
              status: dbStatus,
              is_active: signal.is_active !== undefined ? signal.is_active : true,
              result: signal.result || null,
              pips_won: signal.pips_won || null,
              pips_lost: signal.pips_lost || null
            };

            try {
              const { data, error } = await supabase.from('signals').insert([insertPayload]) as any;
              if (error) {
                  console.error("Supabase signals insert error:", error.message);
              } else if (data) {
                  const dbId = data[0]?.id;
                  console.log(`[DB INSERT] ${signal.pair} ${dbDirection} @ ${signal.entry} → id: ${dbId}`);
                  if (dbId) generateAiReason(String(dbId), signal);
              }
            } catch (insertErr: any) {
              console.error("Supabase signals insert threw:", insertErr.message);
            }
          }

          if (signal.tier !== 'Reject') {
             const risk = (Math.abs(signal.entry - signal.sl) / getPipMultiplier(signal.pair)).toFixed(1);
             
             const dt = new Date(signal.timestamp).toUTCString();
             
             const signalDirectionStr = dbDirection === 'BUY' ? 'BUY' : 'SELL';
             const modeStr = scannerState.stats.mode === 'crypto' ? ' (CRYPTO MODE)' : '';
             
             const msgOut = `🚨 <b>4xFiveAI SIGNAL${modeStr}</b>\n\n`
             + `<b>Pair:</b> ${signal.pair}\n`
             + `<b>Signal:</b> ${signalDirectionStr}\n`
             + `<b>Setup:</b> Premium signal\n\n`
             + `<b>Entry:</b> ${signal.entry}\n`
             + `<b>SL:</b> ${signal.sl} (${risk} pips)\n`
             + `<b>TP1:</b> ${signal.tp1} (1:1)\n`
             + `<b>TP2:</b> ${signal.tp2} (1:2)\n`
             + `<b>TP3:</b> ${signal.tp3} (1:3)\n\n`
             + `<b>Confidence:</b> ${signal.aiConfidence}% (${signal.tier})\n`
             + `<b>Timestamp:</b> ${dt}`;
             
             if (!scannerState.stats.isDegraded) {
              if (TELEGRAM_SIGNALS_DISABLED) {
                console.log(`[KILL SWITCH] Telegram signal BLOCKED for ${signal.pair}`);
              } else {
                sendTelegramMessage(msgOut);
                scannerState.stats.telegramPushes++;
              }
             } else {
               console.warn("Skipped Telegram alert because Scanner is DEGRADED.");
             }
          }
        }
      }

      scannerState.stats.consecutiveApiErrors = 0; // Reset error streak
      if (scannerState.stats.isDegraded) {
         scannerState.stats.isDegraded = false;
         scannerState.stats.rateLimitRecoveries++;
         console.log("Health Monitor: Scanner recovered. Status OPERATIONAL.");
      }

      updatePairStatus(pair, 'success');
    } catch (e: any) {
      updatePairStatus(pair, 'error', e.message);
      latestMarketState.set(pair, {
        pair: pair,
        direction: 'NONE',
        tier: 'STALE',
        timestamp: new Date().toISOString(),
        strengthScore: 0,
        momentumScore: 0,
        atrScore: 0,
        trendScore: 0,
        regime: 'UNKNOWN',
        regimeReason: 'Stale / API Error',
        rejectionReason: e.message || 'API_ERROR'
      });
      if (e.message.includes('unavailable') || e.message.includes('Rate limit')) {
         scannerState.stats.consecutiveApiErrors = (scannerState.stats.consecutiveApiErrors || 0) + 1;
         if (scannerState.stats.consecutiveApiErrors >= 3) {
            scannerState.stats.isDegraded = true;
            console.error("Health Monitor: 3+ consecutive errors! Status DEGRADED.");
         }
      }
    }
    
    currentIndex++;
    if (currentIndex >= PAIRS.length) {
      currentIndex = 0;
      scannerState.stats.scanCycles++;
      scannerState.stats.lastScanDuration = Date.now() - (scannerState.stats.lastScanTime || startTime);
      scannerState.stats.totalScanDurationMs += scannerState.stats.lastScanDuration;
      scannerState.stats.lastScanTime = Date.now();

      console.log("\n================ DIAGNOSTIC REPORT ================\n");
      console.log(`Total Assets Scanned: ${scannerState.stats.totalScannedAssets}\n`);

    }

    // Schedule the next execution sequentially
    setTimeout(runNextCycle, baseDelayMs);
  }

  // Start the queue
  runNextCycle();
}
