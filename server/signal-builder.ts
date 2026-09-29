import { randomUUID } from 'crypto';
import { supabase } from './supabase.js';
import { APPROVED_PAIRS, MANUAL_OVERRIDE_PAIRS } from './scanner.js';
import { sendTelegramMessage } from './telegram.js';

export type BuilderDirection = 'BUY' | 'SELL';

export const CONFIDENCE_WEIGHTS = {
  structure: {
    'HH + HL': 18,
    'LL + LH': 18,
    'Mixed / Unclear': 0,
  },
  liquidity: {
    'Liquidity Taken': 12,
    'Liquidity Not Taken': 0,
  },
  asianHighLow: {
    'Asian High Taken': 8,
    'Asian Low Taken': 8,
    'Neither Taken': 0,
  },
  strategy: {
    'Classic A': 8,
    'Classic V': 8,
  },
  tradeType: {
    'Main Trend': 10,
    'Counter Trend': 0,
  },
  asianReaction: {
    'Wick Taken': 3,
    'Body Taken': 5,
    'Not Taken': 0,
  },
  confirmations15m: {
    mss: 10,
    ocl: 5,
    qml: 3,
    rbs: 4,
    sbr: 4,
  },
  confirmations5m: {
    mss: 6,
    ocl: 3,
    qml: 2,
    rbs: 3,
    sbr: 3,
  },
  confirmations1m: {
    mss: 4,
    ocl: 2,
    qml: 1,
    rbs: 2,
    sbr: 2,
  },
} as const;

export interface SignalAnalysis {
  pair: string;
  timeframe: string;
  direction: BuilderDirection;
  marketStructure: 'HH + HL' | 'LL + LH' | 'Mixed / Unclear' | '';
  liquidity: 'Liquidity Taken' | 'Liquidity Not Taken' | '';
  asianHighLow: 'Asian High Taken' | 'Asian Low Taken' | 'Neither Taken' | '';
  strategy: 'Classic A' | 'Classic V' | '';
  tradeType: 'Main Trend' | 'Counter Trend' | '';
  asianReaction: 'Wick Taken' | 'Body Taken' | 'Not Taken' | '';
  confirmations: {
    mss: boolean;
    ocl: boolean;
    qml: boolean;
    rbs: boolean;
    sbr: boolean;
  };
  confirmations5m: {
    mss: boolean;
    ocl: boolean;
    qml: boolean;
    rbs: boolean;
    sbr: boolean;
  };
  confirmations1m: {
    mss: boolean;
    ocl: boolean;
    qml: boolean;
    rbs: boolean;
    sbr: boolean;
  };
  entry: number;
  sl: number;
  tpMultiples: number[];
}

export interface BuiltSignalPayload extends SignalAnalysis {
  confidence: number;
  autoReason: string;
  autoConfidenceBreakdown: Record<string, number>;
  news?: {
    newsHasEvent?: boolean;
    newsEvent?: string;
    newsPrediction?: 'BUY' | 'SELL' | 'NEUTRAL';
    newsProbability?: number;
    newsReason?: string;
  };
}

export interface DraftPayload extends SignalAnalysis {
  slMode?: 'price' | 'pips';
  slPips?: number;
  confidence?: number;
  autoReason?: string;
  autoConfidenceBreakdown?: Record<string, number>;
}

function normalizePair(value: unknown): string {
  const normalized = String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const aliases: Record<string, string> = {
    XAUUSDM: 'XAUUSD',
    GOLD: 'XAUUSD',
    GOLDUSD: 'XAUUSD',
    XAU: 'XAUUSD',
  };
  return aliases[normalized] || normalized;
}

export function calculateBuiltTp(
  direction: BuilderDirection,
  entry: number,
  sl: number,
  r: number,
): number {
  if (direction === 'BUY') return entry + (entry - sl) * r;
  return entry - (sl - entry) * r;
}

function formatNumber(value: number): string {
  return Number(value).toFixed(5);
}

function mapTier(confidence: number): 'Strong' | 'Good' | 'Valid' | 'Reject' {
  if (confidence >= 75) return 'Strong';
  if (confidence >= 70) return 'Good';
  if (confidence >= 65) return 'Valid';
  return 'Reject';
}

export function calculateConfidence(analysis: SignalAnalysis): {
  score: number;
  breakdown: Record<string, number>;
} {
  const b = CONFIDENCE_WEIGHTS;
  const breakdown: Record<string, number> = {};

  breakdown['Market structure'] = b.structure[analysis.marketStructure as keyof typeof b.structure] || 0;
  breakdown['Liquidity'] = b.liquidity[analysis.liquidity as keyof typeof b.liquidity] || 0;
  breakdown['Asian level'] = b.asianHighLow[analysis.asianHighLow as keyof typeof b.asianHighLow] || 0;
  breakdown['Strategy/setup'] = b.strategy[analysis.strategy as keyof typeof b.strategy] || 0;
  breakdown['Trend alignment'] = b.tradeType[analysis.tradeType as keyof typeof b.tradeType] || 0;
  breakdown['Asian reaction'] = b.asianReaction[analysis.asianReaction as keyof typeof b.asianReaction] || 0;

  const conf = analysis.confirmations;
  breakdown['15M MSS'] = conf.mss ? b.confirmations15m.mss : 0;
  breakdown['15M OCL'] = conf.ocl ? b.confirmations15m.ocl : 0;
  breakdown['15M QML'] = conf.qml ? b.confirmations15m.qml : 0;
  breakdown['15M RBS'] = conf.rbs ? b.confirmations15m.rbs : 0;
  breakdown['15M SBR'] = conf.sbr ? b.confirmations15m.sbr : 0;

  const conf5m = analysis.confirmations5m || {};
  breakdown['5M MSS'] = conf5m.mss ? b.confirmations5m.mss : 0;
  breakdown['5M OCL'] = conf5m.ocl ? b.confirmations5m.ocl : 0;
  breakdown['5M QML'] = conf5m.qml ? b.confirmations5m.qml : 0;
  breakdown['5M RBS'] = conf5m.rbs ? b.confirmations5m.rbs : 0;
  breakdown['5M SBR'] = conf5m.sbr ? b.confirmations5m.sbr : 0;

  const conf1m = analysis.confirmations1m || {};
  breakdown['1M MSS'] = conf1m.mss ? b.confirmations1m.mss : 0;
  breakdown['1M OCL'] = conf1m.ocl ? b.confirmations1m.ocl : 0;
  breakdown['1M QML'] = conf1m.qml ? b.confirmations1m.qml : 0;
  breakdown['1M RBS'] = conf1m.rbs ? b.confirmations1m.rbs : 0;
  breakdown['1M SBR'] = conf1m.sbr ? b.confirmations1m.sbr : 0;

  // Counter-trend setups cap base structure/liquidity contribution unless strong confirmation
  let score = Object.values(breakdown).reduce((sum, v) => sum + v, 0);
  if (analysis.tradeType === 'Counter Trend') {
    const confirmationSum = breakdown['15M MSS'] + breakdown['15M OCL'] + breakdown['15M QML'] + breakdown['15M RBS'] + breakdown['15M SBR']
      + breakdown['5M MSS'] + breakdown['5M OCL'] + breakdown['5M QML'] + breakdown['5M RBS'] + breakdown['5M SBR']
      + breakdown['1M MSS'] + breakdown['1M OCL'] + breakdown['1M QML'] + breakdown['1M RBS'] + breakdown['1M SBR'];
    if (confirmationSum < 12) {
      score = Math.min(score, 55);
    }
  }

  score = Math.max(0, Math.min(80, score));
  return { score, breakdown };
}

export function generateReason(analysis: SignalAnalysis): string {
  const parts: string[] = [];

  if (analysis.marketStructure === 'HH + HL') parts.push('1H structure is bullish.');
  else if (analysis.marketStructure === 'LL + LH') parts.push('1H structure is bearish.');
  else if (analysis.marketStructure === 'Mixed / Unclear') parts.push('1H structure is mixed.');

  if (analysis.liquidity === 'Liquidity Taken') parts.push('Liquidity has been taken.');
  else if (analysis.liquidity === 'Liquidity Not Taken') parts.push('Liquidity has not been taken.');

  if (analysis.asianHighLow === 'Asian High Taken') parts.push('Asian High was taken.');
  else if (analysis.asianHighLow === 'Asian Low Taken') parts.push('Asian Low was taken.');
  else if (analysis.asianHighLow === 'Neither Taken') parts.push('No Asian High/Low has been taken.');

  if (analysis.strategy === 'Classic A') parts.push('Classic A setup identified.');
  else if (analysis.strategy === 'Classic V') parts.push('Classic V setup identified.');

  if (analysis.tradeType === 'Main Trend') parts.push('The setup follows the main trend.');
  else if (analysis.tradeType === 'Counter Trend') parts.push('The setup is counter-trend and requires stronger confirmation.');

  if (analysis.asianReaction === 'Wick Taken') parts.push('The Asian level was taken by wick.');
  else if (analysis.asianReaction === 'Body Taken') parts.push('The Asian level was taken by body.');

  const conf = analysis.confirmations;
  const confParts15m: string[] = [];
  if (conf.mss) confParts15m.push('MSS');
  if (conf.ocl) confParts15m.push('OCL');
  if (conf.qml) confParts15m.push('QML');
  if (conf.rbs) confParts15m.push('RBS');
  if (conf.sbr) confParts15m.push('SBR');

  if (confParts15m.length === 1) parts.push(`15M ${confParts15m[0]} confirms the setup.`);
  else if (confParts15m.length > 1) parts.push(`15M ${confParts15m.slice(0, -1).join(', ')} and ${confParts15m[confParts15m.length - 1]} confirm the setup.`);

  const conf5m = analysis.confirmations5m || {};
  const confParts5m: string[] = [];
  if (conf5m.mss) confParts5m.push('MSS');
  if (conf5m.ocl) confParts5m.push('OCL');
  if (conf5m.qml) confParts5m.push('QML');
  if (conf5m.rbs) confParts5m.push('RBS');
  if (conf5m.sbr) confParts5m.push('SBR');

  if (confParts5m.length === 1) parts.push(`5M ${confParts5m[0]} adds confirmation.`);
  else if (confParts5m.length > 1) parts.push(`5M ${confParts5m.slice(0, -1).join(', ')} and ${confParts5m[confParts5m.length - 1]} add confirmation.`);

  const conf1m = analysis.confirmations1m || {};
  const confParts1m: string[] = [];
  if (conf1m.mss) confParts1m.push('MSS');
  if (conf1m.ocl) confParts1m.push('OCL');
  if (conf1m.qml) confParts1m.push('QML');
  if (conf1m.rbs) confParts1m.push('RBS');
  if (conf1m.sbr) confParts1m.push('SBR');

  if (confParts1m.length === 1) parts.push(`1M ${confParts1m[0]} adds confirmation.`);
  else if (confParts1m.length > 1) parts.push(`1M ${confParts1m.slice(0, -1).join(', ')} and ${confParts1m[confParts1m.length - 1]} add confirmation.`);

  const firstSentenceParts = parts.slice(0, 3).join(' ').trim();
  const secondSentenceParts = parts.slice(3, 5).join(' ').trim();
  const thirdSentenceParts = parts.slice(5).join(' ').trim();

  const sentences = [firstSentenceParts, secondSentenceParts, thirdSentenceParts].filter(Boolean);
  return sentences.join(' ') || 'Manual signal pending further confirmation.';
}

export function validateBuiltSignal(payload: BuiltSignalPayload): { ok: boolean; error?: string } {
  const pair = normalizePair(payload.pair);
  if (!APPROVED_PAIRS.includes(pair)) return { ok: false, error: `Invalid or unsupported pair: ${payload.pair}` };
  if (payload.direction !== 'BUY' && payload.direction !== 'SELL') return { ok: false, error: 'Direction must be BUY or SELL' };
  if (!payload.timeframe?.trim()) return { ok: false, error: 'Timeframe is required' };
  if (!payload.marketStructure) return { ok: false, error: 'Select 1H market structure' };
  if (!payload.liquidity) return { ok: false, error: 'Select liquidity status' };
  if (!payload.asianHighLow) return { ok: false, error: 'Select Asian High/Low status' };
  if (!payload.strategy) return { ok: false, error: 'Select a strategy' };
  if (!payload.tradeType) return { ok: false, error: 'Select trade type' };
  if (!payload.asianReaction) return { ok: false, error: 'Select Asian level reaction' };
  if (!payload.confirmations || (!payload.confirmations.mss && !payload.confirmations.ocl && !payload.confirmations.qml && !payload.confirmations.rbs && !payload.confirmations.sbr
    && !payload.confirmations5m?.mss && !payload.confirmations5m?.ocl && !payload.confirmations5m?.qml && !payload.confirmations5m?.rbs && !payload.confirmations5m?.sbr
    && !payload.confirmations1m?.mss && !payload.confirmations1m?.ocl && !payload.confirmations1m?.qml && !payload.confirmations1m?.rbs && !payload.confirmations1m?.sbr)) {
    return { ok: false, error: 'Select at least one 15M, 5M, or 1M confirmation' };
  }
  if (!Number.isFinite(payload.entry) || !Number.isFinite(payload.sl)) return { ok: false, error: 'Entry and SL must be valid numbers' };
  if (payload.direction === 'BUY' && payload.sl >= payload.entry) return { ok: false, error: 'BUY stop loss must be below entry' };
  if (payload.direction === 'SELL' && payload.sl <= payload.entry) return { ok: false, error: 'SELL stop loss must be above entry' };
  if (!Array.isArray(payload.tpMultiples) || payload.tpMultiples.length === 0) return { ok: false, error: 'Select at least one TP level' };
  const confidence = Math.min(80, Math.max(0, Number(payload.confidence) || 0));
  if (confidence <= 0) return { ok: false, error: 'Confidence must be greater than 0' };
  return { ok: true };
}

export async function publishBuiltSignal(
  payload: BuiltSignalPayload,
  adminEmail?: string,
): Promise<{ ok: boolean; error?: string; signal?: any }> {
  if (!supabase) return { ok: false, error: 'Supabase not available' };

  const validation = validateBuiltSignal(payload);
  if (!validation.ok) return { ok: false, error: validation.error };

  const pair = normalizePair(payload.pair);
  const direction = payload.direction;
  const entry = Number(payload.entry);
  const sl = Number(payload.sl);
  const confidence = Math.min(80, Math.max(0, Number(payload.confidence) || 0));

  const sortedMultiples = [...payload.tpMultiples].filter((m) => Number.isFinite(m) && m > 0).sort((a, b) => a - b);
  const tps = sortedMultiples.map((r) => calculateBuiltTp(direction, entry, sl, r));
  const [tp1, tp2, tp3, tp4, tp5] = [...tps, null, null, null, null, null];

  const isLong = direction === 'BUY';
  const risk = Math.abs(entry - sl);
  const rr = risk > 0 && tp1 != null ? (Math.abs(Number(tp1) - entry) / risk).toFixed(1) : '0.0';

  await supabase
    .from('signals')
    .update({ status: 'CLOSED', is_active: false, closed_at: new Date().toISOString(), result: 'CANCELLED' })
    .eq('pair', pair)
    .in('status', ['LIVE', 'TP1_HIT', 'TP2_HIT'])
    .eq('is_active', true);

  const conf = payload.confirmations;
  const now = new Date().toISOString();
  const signalPayload: any = {
    pair,
    direction,
    bias: isLong ? 'BULLISH' : 'BEARISH',
    score: confidence,
    tier: mapTier(confidence),
    confidence: Math.min(10, Math.max(1, Math.round(confidence / 10))),
    entry_price: entry,
    sl,
    original_sl: sl,
    tp1,
    tp2,
    tp3,
    created_at: now,
    status: 'LIVE',
    is_active: true,
    result: null,
    pips_won: null,
    pips_lost: null,
  };

  const { data: inserted, error: insertError } = await supabase.from('signals').insert([signalPayload]).select('*').maybeSingle();
  if (insertError) return { ok: false, error: insertError.message };

  const emoji = isLong ? '🟢' : '🔴';
  const tpLines = sortedMultiples.map((r, i) => `TP${i + 1}: ${formatNumber(Number(tps[i]))}`).join('\n');
  const msg = `${emoji} <b>4xFiveAI SIGNAL</b>\n\n`
    + `Pair: ${pair}\n`
    + `Signal: ${direction}\n\n`
    + `Entry: ${entry}\n`
    + `SL: ${sl}\n`
    + `${tpLines}\n`
    + `Confidence: ${confidence}/100\n\n`
    + `${signalPayload.reason}`;

  await sendTelegramMessage(msg, process.env.TELEGRAM_VIP_CHAT_ID || undefined);
  MANUAL_OVERRIDE_PAIRS.add(pair);

  return { ok: true, signal: inserted || signalPayload };
}

export async function listAdminSignals(limit = 100) {
  if (!supabase) return { ok: false, error: 'Supabase not available', signals: [] };
  const { data, error } = await supabase
    .from('signals')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return { ok: false, error: error.message, signals: [] };
  return { ok: true, signals: data || [] };
}

export async function listDrafts(adminEmail: string) {
  if (!supabase) return { ok: false, error: 'Supabase not available', drafts: [] };
  const { data, error } = await supabase
    .from('signal_drafts')
    .select('*')
    .ilike('admin_email', adminEmail.trim())
    .order('updated_at', { ascending: false });
  if (error) return { ok: false, error: error.message, drafts: [] };
  return { ok: true, drafts: data || [] };
}

export async function saveDraft(adminEmail: string, payload: DraftPayload) {
  if (!supabase) return { ok: false, error: 'Supabase not available' };
  const conf = payload.confirmations || { mss: false, ocl: false, qml: false, rbs: false, sbr: false };
  const conf5m = payload.confirmations5m || { mss: false, ocl: false, qml: false, rbs: false, sbr: false };
  const conf1m = payload.confirmations1m || { mss: false, ocl: false, qml: false, rbs: false, sbr: false };
  const { score, breakdown } = calculateConfidence(payload as SignalAnalysis);
  const reason = generateReason(payload as SignalAnalysis);

  const row: any = {
    admin_email: adminEmail.trim().toLowerCase(),
    pair: normalizePair(payload.pair),
    strategy: payload.strategy || null,
    direction: payload.direction || null,
    ocl: null,
    entry: Number.isFinite(Number(payload.entry)) ? Number(payload.entry) : null,
    sl: Number.isFinite(Number(payload.sl)) ? Number(payload.sl) : null,
    sl_mode: payload.slMode || null,
    sl_pips: Number.isFinite(Number(payload.slPips)) ? Number(payload.slPips) : null,
    tp_multiples: Array.isArray(payload.tpMultiples) ? payload.tpMultiples.map((m) => Number(m)) : [],
    confidence: score,
    timeframe: payload.timeframe || null,
    market_structure: payload.marketStructure || null,
    liquidity: payload.liquidity || null,
    asian_high_low: payload.asianHighLow || null,
    trade_type: payload.tradeType || null,
    asian_reaction: payload.asianReaction || null,
    confirmation_mss: conf.mss,
    confirmation_ocl: conf.ocl,
    confirmation_qml: conf.qml,
    confirmation_rbs: conf.rbs,
    confirmation_sbr: conf.sbr,
    confirmation_5m_mss: conf5m.mss,
    confirmation_5m_ocl: conf5m.ocl,
    confirmation_5m_qml: conf5m.qml,
    confirmation_5m_rbs: conf5m.rbs,
    confirmation_5m_sbr: conf5m.sbr,
    confirmation_1m_mss: conf1m.mss,
    confirmation_1m_ocl: conf1m.ocl,
    confirmation_1m_qml: conf1m.qml,
    confirmation_1m_rbs: conf1m.rbs,
    confirmation_1m_sbr: conf1m.sbr,
    auto_confidence: score,
    auto_confidence_breakdown: breakdown,
    auto_reason: reason,
    updated_at: new Date().toISOString(),
  };

  if ((payload as any).id) {
    const { data, error } = await supabase
      .from('signal_drafts')
      .update(row)
      .eq('id', (payload as any).id)
      .eq('admin_email', adminEmail.trim().toLowerCase())
      .select('*')
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    return { ok: true, draft: data };
  }

  const { data, error } = await supabase.from('signal_drafts').insert([row]).select('*').maybeSingle();
  if (error) return { ok: false, error: error.message };
  return { ok: true, draft: data };
}

export async function deleteDraft(id: string, adminEmail: string) {
  if (!supabase) return { ok: false, error: 'Supabase not available' };
  const { error } = await supabase
    .from('signal_drafts')
    .delete()
    .eq('id', id)
    .eq('admin_email', adminEmail.trim().toLowerCase());
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
