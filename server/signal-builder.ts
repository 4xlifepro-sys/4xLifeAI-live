import { randomUUID } from 'crypto';
import { supabase } from './supabase.js';
import { APPROVED_PAIRS, MANUAL_OVERRIDE_PAIRS } from './scanner.js';
import { sendTelegramMessage } from './telegram.js';

export type BuilderDirection = 'BUY' | 'SELL';

export interface BuiltSignalPayload {
  pair: string;
  strategy: string;
  direction: BuilderDirection;
  ocl: string;
  entry: number;
  sl: number;
  tpMultiples: number[];
  confidence: number;
}

export interface DraftPayload {
  id?: string;
  pair: string;
  strategy: string;
  direction: BuilderDirection;
  ocl: string;
  entry: number;
  sl: number;
  tpMultiples: number[];
  confidence: number;
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
  if (direction === 'BUY') {
    return entry + (entry - sl) * r;
  }
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

export function validateBuiltSignal(payload: BuiltSignalPayload): { ok: boolean; error?: string } {
  const pair = normalizePair(payload.pair);
  if (!APPROVED_PAIRS.includes(pair)) {
    return { ok: false, error: `Invalid or unsupported pair: ${payload.pair}` };
  }
  if (payload.direction !== 'BUY' && payload.direction !== 'SELL') {
    return { ok: false, error: 'Direction must be BUY or SELL' };
  }
  if (!Number.isFinite(payload.entry) || !Number.isFinite(payload.sl)) {
    return { ok: false, error: 'Entry and SL must be valid numbers' };
  }
  if (payload.direction === 'BUY' && payload.sl >= payload.entry) {
    return { ok: false, error: 'BUY stop loss must be below entry' };
  }
  if (payload.direction === 'SELL' && payload.sl <= payload.entry) {
    return { ok: false, error: 'SELL stop loss must be above entry' };
  }
  if (!Array.isArray(payload.tpMultiples) || payload.tpMultiples.length === 0) {
    return { ok: false, error: 'Select at least one TP level' };
  }
  if (payload.tpMultiples.some((m) => !Number.isFinite(m) || m <= 0)) {
    return { ok: false, error: 'All TP multiples must be positive numbers' };
  }
  const confidence = Math.min(80, Math.max(0, Number(payload.confidence) || 0));
  if (confidence <= 0) {
    return { ok: false, error: 'Confidence must be greater than 0' };
  }
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

  // Cancel any existing active signal for this pair
  await supabase
    .from('signals')
    .update({ status: 'CLOSED', is_active: false, closed_at: new Date().toISOString(), result: 'CANCELLED' })
    .eq('pair', pair)
    .in('status', ['LIVE', 'TP1_HIT', 'TP2_HIT'])
    .eq('is_active', true);

  const now = new Date().toISOString();
  const signalPayload: any = {
    id: randomUUID(),
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
    tp4,
    tp5,
    created_at: now,
    status: 'LIVE',
    is_active: true,
    strategy: payload.strategy || null,
    ocl: payload.ocl || null,
    entry_type: 'IMMEDIATE',
    reason: `Manual signal builder — ${payload.strategy || 'No strategy'} / ${payload.ocl || 'No OCL'}`,
  };

  const { data: inserted, error: insertError } = await supabase.from('signals').insert([signalPayload]).select('*').maybeSingle();
  if (insertError) {
    return { ok: false, error: insertError.message };
  }

  const emoji = isLong ? '🟢' : '🔴';
  const tpLines = sortedMultiples.map((r, i) => `TP${i + 1}: ${formatNumber(Number(tps[i]))}`).join('\n');
  const msg = `${emoji} <b>4xFiveAI MANUAL SIGNAL</b>\n\n`
    + `Pair: ${pair}\n`
    + `Signal: ${direction}\n\n`
    + `Entry: ${entry}\n`
    + `SL: ${sl}\n`
    + `${tpLines}\n`
    + `RR: 1:${rr}\n`
    + `Confidence: ${confidence}/100\n\n`
    + `Manual signal builder — ${payload.strategy} / ${payload.ocl}`;

  await sendTelegramMessage(msg, process.env.TELEGRAM_VIP_CHAT_ID || undefined);

  MANUAL_OVERRIDE_PAIRS.add(pair);

  return { ok: true, signal: inserted || signalPayload };
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
  const row: any = {
    admin_email: adminEmail.trim().toLowerCase(),
    pair: normalizePair(payload.pair),
    strategy: payload.strategy || null,
    direction: payload.direction || null,
    ocl: payload.ocl || null,
    entry: Number.isFinite(Number(payload.entry)) ? Number(payload.entry) : null,
    sl: Number.isFinite(Number(payload.sl)) ? Number(payload.sl) : null,
    tp_multiples: Array.isArray(payload.tpMultiples) ? payload.tpMultiples.map((m) => Number(m)) : [],
    confidence: Math.min(80, Math.max(0, Number(payload.confidence) || 0)),
    updated_at: new Date().toISOString(),
  };

  if (payload.id) {
    const { data, error } = await supabase
      .from('signal_drafts')
      .update(row)
      .eq('id', payload.id)
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
