import { fetchCandles } from './live-market-feed.js';
import { detectTrendMomentumScannerV5, getPipMultiplier } from './engine2.js';

// Per-pair cooldown: after a signal fires (and closes), wait this many ms before firing again
// Prevents the scanner from re-firing the same setup within seconds
const PAIR_COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 hours cooldown per pair
const pairCooldowns = new Map<string, number>(); // pair -> timestamp when it last fired
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

export const WEEKEND_PAIRS = ['BTCUSD', 'XAGUSD', 'XAUUSD'];

export const APPROVED_PAIRS = [
  'EURUSD', 'USDJPY', 'USDCAD', 'NZDUSD', 'EURJPY', 'GBPJPY',
  'XAUUSD', 'XAGUSD', 'BTCUSD', 'ETHUSD'
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
            .in('status', ['ACTIVE', 'TP1 HIT', 'TP2 HIT'])
            .or('result.is.null,result.eq.OPEN') as any;
      }
      
      const [setup, supabaseResponse] = await Promise.all([setupPromise, activeSignalsPromise]);
      
      const entryTf = setup; // Compatibility for now

      if (!htf || !setup) {
         throw new Error('Live market feed unavailable � retrying next cycle');
      }

      // ==== 4xLifeAI REAL-TIME TP/SL TRACKING ====
      if (supabase) {
        try {
          const currentPrice = entryTf[entryTf.length - 1]; 
          
          const activeSignals = supabaseResponse?.data;
          const fetchSignalsError = supabaseResponse?.error;

          if (fetchSignalsError) {
            console.error("Supabase active signals fetch error:", fetchSignalsError.message);
          }

          if (activeSignals && activeSignals.length > 0) {
            for (const s of activeSignals) {
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
              let newStatus = s.status || 'ACTIVE';
              let tpRecordStr = '';
          
              const isLong = s.direction === 'LONG' || s.signal === 'BUY';

              // Determine current effective SL based on trailing logic
              let effectiveSL = s.sl;
              if (s.status === 'TP2 HIT') {
                  effectiveSL = s.tp1;
              } else if (s.status === 'TP1 HIT') {
                  effectiveSL = sEntry;
              }

              if (isLong) {
                 if (currentPrice.low <= effectiveSL) {
                    isHit = true; finalClose = true;
                    hitLevel = 'SL'; hitPrice = effectiveSL; newStatus = 'CLOSED';
                    rawPips = calculatePips(sEntry, effectiveSL);
                 } else if (currentPrice.high >= s.tp3 && s.status !== 'TP3 HIT') {
                    isHit = true; finalClose = true;
                    hitLevel = 'TP3'; hitPrice = s.tp3; newStatus = 'CLOSED'; tpRecordStr = 'tp3_hit_at';
                    rawPips = calculatePips(s.tp3, sEntry);
                 } else if (currentPrice.high >= s.tp2 && !['TP2 HIT', 'TP3 HIT'].includes(s.status)) {
                    isHit = true; finalClose = false;
                    hitLevel = 'TP2'; hitPrice = s.tp2; newStatus = 'TP2 HIT'; tpRecordStr = 'tp2_hit_at';
                    rawPips = calculatePips(s.tp2, sEntry);
                 } else if (currentPrice.high >= s.tp1 && s.status === 'ACTIVE') {
                    isHit = true; finalClose = false;
                    hitLevel = 'TP1'; hitPrice = s.tp1; newStatus = 'TP1 HIT'; tpRecordStr = 'tp1_hit_at';
                    rawPips = calculatePips(s.tp1, sEntry);
                 }
              } else { 
                 if (currentPrice.high >= effectiveSL) {
                    isHit = true; finalClose = true;
                    hitLevel = 'SL'; hitPrice = effectiveSL; newStatus = 'CLOSED';
                    rawPips = calculatePips(sEntry, effectiveSL);
                 } else if (currentPrice.low <= s.tp3 && s.status !== 'TP3 HIT') {
                    isHit = true; finalClose = true;
                    hitLevel = 'TP3'; hitPrice = s.tp3; newStatus = 'CLOSED'; tpRecordStr = 'tp3_hit_at';
                    rawPips = calculatePips(sEntry, s.tp3);
                 } else if (currentPrice.low <= s.tp2 && !['TP2 HIT', 'TP3 HIT'].includes(s.status)) {
                    isHit = true; finalClose = false;
                    hitLevel = 'TP2'; hitPrice = s.tp2; newStatus = 'TP2 HIT'; tpRecordStr = 'tp2_hit_at';
                    rawPips = calculatePips(sEntry, s.tp2);
                 } else if (currentPrice.low <= s.tp1 && s.status === 'ACTIVE') {
                    isHit = true; finalClose = false;
                    hitLevel = 'TP1'; hitPrice = s.tp1; newStatus = 'TP1 HIT'; tpRecordStr = 'tp1_hit_at';
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
                         if (s.status === 'TP2 HIT') finalResult = 'TP2 HIT';
                         else if (s.status === 'TP1 HIT') finalResult = 'TP1 HIT';
                         else finalResult = 'LOSS';
                     }
                 } else {
                     finalResult = 'OPEN';
                 }
                 
                 let headerEmoji = '🎯';
                 let titleText = `4XLIFEAI — ${hitLevel} HIT`;
                 let statusLine = '';
                 if (hitLevel === 'SL') {
                     if (finalResult === 'TP2 HIT') {
                         headerEmoji = '✅';
                         titleText = '4XLIFEAI — BREAKEVEN+ LOCKED IN';
                     } else if (finalResult === 'BREAKEVEN') {
                         headerEmoji = '🛡️';
                         titleText = '4XLIFEAI — STOPPED AT BREAKEVEN';
                     } else {
                         headerEmoji = '🛑';
                         titleText = '4XLIFEAI — STOP LOSS HIT';
                     }
                     statusLine = '\n\nStatus: TRADE CLOSED';
                 } else if (hitLevel === 'TP2') {
                     headerEmoji = '🚀';
                 } else if (hitLevel === 'TP3') {
                     headerEmoji = '🏆';
                     titleText = '4XLIFEAI — FULL TARGET REACHED';
                     statusLine = '\n\nStatus: TRADE CLOSED';
                 }

                 const isWinOutcome = finalResult === 'WIN' || finalResult === 'TP2 HIT' || (hitLevel !== 'SL' && finalResult !== 'BREAKEVEN');
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
                 sendTelegramMessage(hitMsg);
                 
                 if (finalClose) {
                     scannerState.stats.lastTradeTimestamp = closedAt;
                     
                     // Trade Summary Alert
                     const openedAtDt = new Date(s.timestamp || s.created_at || sEntry); // roughly
                     const durationMs = dt.getTime() - openedAtDt.getTime();
                     const hours = Math.floor(durationMs / (1000 * 60 * 60));
                     const mins = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
                     
                     const tp1Status = (hitLevel === 'TP3' || hitLevel === 'TP2' || s.status === 'TP1 HIT' || s.status === 'TP2 HIT' || hitLevel === 'TP1') ? 'HIT ✅' : 'MISSED ❌';
                     const tp2Status = (hitLevel === 'TP3' || hitLevel === 'TP2' || s.status === 'TP2 HIT') ? 'HIT ✅' : 'MISSED ❌';
                     const tp3Status = (hitLevel === 'TP3') ? 'HIT ✅' : 'MISSED ❌';
                     
                     const isWin = finalResult === 'WIN' || finalResult === 'TP2 HIT' || finalResult === 'TP1 HIT';
                     const isBreakeven = finalResult === 'BREAKEVEN';
                     const totalPips = isWin ? `+${pipStr}` : (isBreakeven ? `0.0` : `-${pipStr}`);
                     const summaryEmoji = isWin ? '🟢' : (isBreakeven ? '🛡️' : '🔴');
                     
                     const riskPips = calculatePips(sEntry, s.sl) || 1; // avoid / 0
                     const rrRatio = (rawPips / riskPips).toFixed(1);
                     const riskRewardStr = isWin ? `1:${rrRatio}` : (isBreakeven ? '0:0' : `-1:1`);
                     
                     const summaryMsg = `📊 <b>4XLIFEAI — TRADE SUMMARY</b>\n\n`
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
                     
                     sendTelegramMessage(summaryMsg);
                 }
                 
                 // Payload construction for Supabase update
                 const updatePayload: any = { status: newStatus };
                 if (tpRecordStr) {
                    updatePayload[tpRecordStr] = closedAt;
                 }
                 if (hitLevel === 'TP3') {
                     if (s.status !== 'TP2 HIT' && s.status !== 'TP1 HIT') updatePayload['tp1_hit_at'] = closedAt;
                     if (s.status !== 'TP2 HIT') updatePayload['tp2_hit_at'] = closedAt;
                 } else if (hitLevel === 'TP2') {
                     if (s.status !== 'TP1 HIT') updatePayload['tp1_hit_at'] = closedAt;
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
                    if (finalResult === 'WIN' || finalResult === 'TP2 HIT') {
                       updatePayload.pips_won = rawPips;
                    } else {
                       updatePayload.pips_lost = rawPips;
                    }
                    
                    // Send notification about trade close
                    if (supabase) {
                        const { data: allUsers } = await supabase
                            .from('profiles')
                            .select('email')
                            .eq('plan_status', 'active')
                            .neq('email', null);
                        
                        if (allUsers && allUsers.length > 0) {
                            const isWin = finalResult === 'WIN' || finalResult === 'TP2 HIT' || finalResult === 'TP1 HIT';
                            const closeMsg = `${s.pair} trade closed\nResult: ${finalResult}\n${isWin ? '✅' : '❌'} ${isWin ? '+' : '-'}${pipStr} pips\nEntry: ${sEntry} | Exit: ${hitPrice}`;
                            
                            for (const u of allUsers) {
                                await supabase.from('notifications').insert([{
                                    user_id: u.id,
                                    email: u.email,
                                    title: `Trade Closed: ${s.pair}`,
                                    message: closeMsg,
                                    type: isWin ? 'success' : 'warning',
                                    is_read: false,
                                    created_at: closedAt
                                }]);
                            }
                        }
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
                 
                 updatePromises.push(
                     supabase.from('trades').update(updatePayload).eq('id', s.id).then(({error}) => {
                         if (error && !error.message.includes('Could not find')) {
                             console.error("Failed to update trades table:", error.message);
                         }
                     })
                 );

                 updatePromises.push(
                     supabase.from('active_opportunities').update(updatePayload).eq('id', s.id).then(({error}) => {
                         if (error && !error.message.includes('Could not find')) {
                             console.error("Failed to update active_opportunities table:", error.message);
                         }
                     })
                 );

                 // Insert into trade_events
                 const eventsToInsert = [{
                    trade_id: s.id,
                    event_type: hitLevel + '_HIT',
                    price: hitPrice,
                    pips: rawPips
                 }];
                 if (finalClose) {
                    eventsToInsert.push({
                        trade_id: s.id,
                        event_type: 'CLOSED',
                        price: hitPrice,
                        pips: rawPips
                    });
                 }
                 updatePromises.push(
                     supabase.from('trade_events').insert(eventsToInsert).then(({error}) => {
                         if (error && !error.message.includes('Could not find') && !error.message.includes('schema cache')) {
                             console.error("trade_events insert error:", error.message);
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

      if (finalSignal && finalSignal.tier !== 'Reject' && supabase) {
        try {
          const { data: activePairTrades, error: activeTradesErr } = await supabase
            .from('trades')
            .select('id')
            .eq('pair', pair)
            .in('status', ['ACTIVE', 'TP1 HIT', 'TP2 HIT', 'OPEN'])
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

        // Check per-pair cooldown via Supabase: prevent re-firing same pair within cooldown window
        // This survives server restarts unlike the in-memory Map
        if (signal.tier !== 'Reject' && supabase) {
          const cooldownAgo = new Date(Date.now() - PAIR_COOLDOWN_MS).toISOString();
          const { data: recentSignals } = await supabase
            .from('signals')
            .select('id, timestamp')
            .eq('pair', pair)
            .in('status', ['ACTIVE', 'TP1 HIT', 'TP2 HIT'])
            .gte('timestamp', cooldownAgo)
            .limit(1);
          if (recentSignals && recentSignals.length > 0) {
            console.log(`COOLDOWN_BLOCKED: ${pair} fired within last ${PAIR_COOLDOWN_MS / 60000}m`);
            signal.tier = 'Reject';
            signal.aiReason = 'COOLDOWN_ACTIVE';
            signal.status = 'REJECTED';
            rejectionStats.ACTIVE_TRADE_EXISTS++;
          }
        }

        // Persistent deduplication: check Supabase to avoid cross-restart duplicate alerts/audit spam
        let isDuplicate = false;
        
        // 0. Active trade check
        const activeTrade = scannerState.activeOpportunities.find(o => o.pair === signal.pair && ['ACTIVE', 'TP1 HIT', 'TP2 HIT'].includes(o.status));
        if (activeTrade && signal.tier !== 'Reject') {
            signal.tier = 'Reject';
            signal.aiReason = 'REJECT_ACTIVE_TRADE_EXISTS';
            signal.status = 'REJECTED';
            rejectionStats.ACTIVE_TRADE_EXISTS++;
            isDuplicate = true; 
        }
        
        // 1. In-memory exact ID match
        const memoryDuplicate = scannerState.signals.find(s => s.id === signal.id);
        
        if (!isDuplicate && memoryDuplicate) {
             isDuplicate = true;
        } else if (!isDuplicate && supabase) {
           const { data } = await supabase
             .from('signal_audit_log')
             .select('id')
             .eq('id', signal.id)
             .limit(1);
             
           if (data && data.length > 0) {
              isDuplicate = true;
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

          // Persistent audit log for all GENUINELY NEW signals (VALID and REJECTED)
          if (supabase) {
             supabase.from('signal_audit_log').insert([{
                 id: signal.id,
                 pair: signal.pair,
                 status: signal.tier === 'Reject' ? 'REJECTED' : 'ACTIVE',
                 tier: signal.tier,
                 direction: signal.direction,
                 entry: signal.entry,
                 sl: signal.sl,
                 tp1: signal.tp1,
                 tp2: signal.tp2,
                 tp3: signal.tp3,
                 raw_4h_open: signal.diagnostics?.raw_4h?.open,
                 raw_4h_close: signal.diagnostics?.raw_4h?.close,
                 raw_4h_start_time: signal.diagnostics?.raw_4h?.start_time,
                 raw_5m_open: signal.diagnostics?.raw_5m_bos?.open,
                 raw_5m_close: signal.diagnostics?.raw_5m_bos?.close,
                 raw_5m_start_time: signal.diagnostics?.raw_5m_bos?.start_time,
                 pullback_high: signal.diagnostics?.pullbackHigh,
                 pullback_low: signal.diagnostics?.pullbackLow,
                 confidence_score: signal.aiConfidence,
                 confidence_breakdown: signal.diagnostics?.confidenceBreakdown,
                 rejection_reason: signal.tier === 'Reject' ? signal.aiReason : null,
                 generated_at: signal.timestamp,
                 created_at: signal.timestamp,
                 filtered_at: signal.tier === 'Reject' ? signal.timestamp : null,
                 evaluated_at: signal.timestamp,
                 status_changed_at: signal.timestamp,
                 momentum_score: scores?.momentumScore ?? null,
                 volatility_score: scores?.atrScore ?? null,
                 final_score: scores?.strengthScore ?? null
             }]).then(({error}) => {
                 if (error && !error.message.includes('Could not find')) {
                     console.error("Audit log error:", error.message);
                 } else if (!error) {
                     console.log("Audit log INSERTED successfully for", signal.pair, signal.status);
                 }
             });
          }
          if (signal.tier !== 'Reject') {
             // Set per-pair cooldown to prevent re-firing same setup within window
             pairCooldowns.set(pair, Date.now());
             scannerState.signals.unshift(signal);
             if (scannerState.signals.length > 100) scannerState.signals.pop();
             scannerState.stats.lastSignalTimestamp = signal.timestamp;
          }

          // Save Signal to public.signals for Active trades
          if (supabase && signal.tier !== 'Reject') {
            const insertPayload: any = {
              id: signal.id,
              pair: signal.pair,
              direction: signal.direction,
              bias: signal.bias,
              score: signal.score,
              confidence: signal.aiConfidence,
              tier: signal.tier,
              entry_price: signal.entry,
              sl: signal.sl,
              original_sl: signal.sl,
              tp1: signal.tp1,
              tp2: signal.tp2,
              tp3: signal.tp3,
              created_at: signal.timestamp,
              status: signal.status,
              is_active: signal.is_active,
              result: signal.result,
              pips_won: signal.pips_won,
              pips_lost: signal.pips_lost
            };
            
            supabase.from('signals').insert([insertPayload]).select('id').single().then(async ({data, error}) => {
               if (error) {
                   if (error.message.includes('Could not find') || error.message.includes('schema cache')) {
                       delete insertPayload.original_sl;
                       const retryResult = await supabase.from('signals').insert([insertPayload]).select('id').single();
                       if (retryResult.data && retryResult.data.id) {
                           generateAiReason(retryResult.data.id, signal);
                       }
                   } else {
                       console.error("Supabase signals insert error:", error.message);
                   }
               } else if (data && data.id) {
                   generateAiReason(data.id, signal);
                   
                   // Send notifications to all active users
                   const { data: allUsers } = await supabase
                       .from('profiles')
                       .select('email')
                       .eq('plan_status', 'active')
                       .neq('email', null);
                   
                   if (allUsers && allUsers.length > 0) {
                       const signalMsg = `New ${signal.direction} signal for ${signal.pair}\nEntry: ${signal.entry}\nSL: ${signal.sl}\nTP1: ${signal.tp1} | TP2: ${signal.tp2} | TP3: ${signal.tp3}\nConfidence: ${signal.confidence}%\n\nAct now!`;
                       
                       for (const u of allUsers) {
                           await supabase.from('notifications').insert([{
                               user_id: u.id,
                               email: u.email,
                               title: `New Signal: ${signal.pair}`,
                               message: signalMsg,
                               type: 'signal',
                               is_read: false,
                               created_at: new Date().toISOString()
                           }]);
                       }
                   }
               }
            });
          }

          if (supabase && signal.tier !== 'Reject') {
            const tradePayload: any = {
              id: signal.id,
              pair: signal.pair,
              direction: signal.direction,
              entry: signal.entry,
              sl: signal.sl,
              original_sl: signal.sl,
              tp1: signal.tp1,
              tp2: signal.tp2,
              tp3: signal.tp3,
              confidence: signal.aiConfidence,
              grade: signal.tier,
              status: signal.status,
              opened_at: signal.timestamp,
              is_active: signal.is_active
            };
            
            supabase.from('trades').insert([tradePayload]).then(async ({error}) => {
                 if (error) {
                     if (error.message.includes('Could not find') || error.message.includes('schema cache')) {
                         delete tradePayload.original_sl;
                         await supabase.from('trades').insert([tradePayload]);
                     } else {
                         console.error("Supabase trades insert error:", error.message);
                     }
                 }
            });
          }

          if (supabase && signal.tier !== 'Reject') {
            supabase.from('active_opportunities').upsert([{
              id: signal.id,
              pair: signal.pair,
              direction: signal.direction,
              entry: signal.entry,
              sl: signal.sl,
              tp1: signal.tp1,
              tp2: signal.tp2,
              tp3: signal.tp3,
              confidence: signal.aiConfidence,
              status: signal.status,
              updated_at: signal.timestamp
            }]).then(({error}) => {
               if (error && !error.message.includes('Could not find') && !error.message.includes('schema cache')) {
                   console.error("Supabase active_opportunities upsert error:", error.message);
               }
            });
          }

          // Save Signal Diagnostics to validation table
          if (supabase && signal.diagnostics) {
            supabase.from('signal_results').insert([{
              id: signal.id,
              pair: signal.pair,
              direction: signal.direction,
              tier: signal.tier,
              score: signal.score,
              entry: signal.entry,
              sl: signal.sl,
              tp1: signal.tp1,
              tp2: signal.tp2,
              tp3: signal.tp3,
              result: 'PENDING',
              created_at: signal.timestamp
            }]).then(({error}) => {
               if (error && !error.message.includes('Could not find')) {
                   console.error("Supabase signal_results insert error:", error.message);
               }
            });
          }

          if (signal.tier !== 'Reject') {
             const risk = (Math.abs(signal.entry - signal.sl) / getPipMultiplier(signal.pair)).toFixed(1);
             
             const dt = new Date(signal.timestamp).toUTCString();
             
             const biasStr = signal.direction === 'LONG' ? 'BUY' : 'SELL';
             const modeStr = scannerState.stats.mode === 'crypto' ? ' (WEEKEND CRYPTO MODE)' : '';
             const regimeStr = signal.diagnostics?.regimeState || 'Trending';
             
             const msgOut = `🚨 <b>4XLIFEAI SIGNAL${modeStr}</b>\n\n`
             + `<b>Pair:</b> ${signal.pair}\n`
             + `<b>Signal:</b> ${signal.direction === 'LONG' ? 'BUY' : 'SELL'}\n`
             + `<b>Regime:</b> ${regimeStr}\n\n`
             + `<b>Entry:</b> ${signal.entry}\n`
             + `<b>SL:</b> ${signal.sl} (${risk} pips)\n`
             + `<b>TP1:</b> ${signal.tp1} (1:1)\n`
             + `<b>TP2:</b> ${signal.tp2} (1:2)\n`
             + `<b>TP3:</b> ${signal.tp3} (1:3)\n\n`
             + `<b>Confidence:</b> ${signal.aiConfidence}% (${signal.tier})\n`
             + `<b>Timestamp:</b> ${dt}`;
             
             if (!scannerState.stats.isDegraded) {
               sendTelegramMessage(msgOut);
               scannerState.stats.telegramPushes++;
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

      // Optional: Persist global stats to Supabase
      if (supabase) {
        supabase.from('scanner_stats').upsert([{ id: 1, ...scannerState.stats }]).then(({error}) => {
           if (error) {
             if (error.message.includes('Could not find') || error.message.includes('schema cache')) {
               console.warn("Supabase: Schema not found or cache stale. Please run the SQL in supabase-schema.sql and reload.");
             } else {
               console.error("Supabase stats upsert error:", error.message);
             }
           }
        });
      }
    }

    // Schedule the next execution sequentially
    setTimeout(runNextCycle, baseDelayMs);
  }

  // Start the queue
  runNextCycle();
}
