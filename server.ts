import 'dotenv/config';
import express from "express";
import {
  publishBuiltSignal,
  listDrafts,
  saveDraft,
  deleteDraft,
  listAdminSignals,
  calculateConfidence,
  generateReason,
} from "./server/signal-builder.js";
import { predictNewsFromCalendar } from "./server/news-prediction.js";
import { analyzeChartWithGemini } from "./server/gemini-chart-analyzer.js";
import { extractCopilotSignal, validateCopilotSignal } from "./server/copilot-signal-parser.js";
import multer from "multer";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { startScanner, scannerState, latestMarketState, rejectionStats } from "./server/scanner.js";
import { fetchCandlesForTimeframe } from './server/live-market-feed.js';
import { analyzeStrategyMarket, DEFAULT_STRATEGY_CONFIG, validateStrategyConfig } from './server/strategy-engine.js';
import { activateStrategyPreset, createStrategyPreset, listStrategyPresets, readStrategyConfig, writeStrategyConfig } from './server/strategy-config.js';
import { getLatestStrategyAnalyses, getStrategyWorkerState, startStrategyWorker } from './server/strategy-worker.js';
import { startSessionMessaging, sendSessionUpdate } from "./server/sessionMessaging.js";
import { supabase } from './server/supabase.js';
import { formatFreeTpHitMessage, sendTelegramMessage, sendTelegramOutcomeToVipAndFree, sendTelegramToVipAndFree } from './server/telegram.js';

import { randomUUID } from 'crypto';
import { GoogleGenAI } from "@google/genai";

const adminAlertCooldown = new Map<string, number>();
let notificationsTableAvailable = true;

// ---- Forex Factory economic calendar (free public feed, no API key) ----
type FFEvent = {
  title: string;
  country: string; // currency code e.g. USD
  date: string;
  time?: string;
  impact: string;  // Low | Medium | High | Holiday
  forecast: string;
  previous: string;
  actual?: string;
};

type ChartImage = { mimeType: 'image/png' | 'image/jpeg' | 'image/webp'; data: string };

function parseChartImage(value: unknown): ChartImage | null {
  const match = String(value || '').match(/^data:(image\/(?:png|jpe?g|webp));base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) return null;
  const mimeType = match[1].toLowerCase().replace('image/jpg', 'image/jpeg') as ChartImage['mimeType'];
  return { mimeType, data: match[2] };
}

function normalizeVisibleTimeframe(value: unknown): string | null {
  const label = String(value || '').toUpperCase().trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  const bareMinuteMatch = label.match(/^(1|2|3|5|10|15|20|30|45|60)$/);
  if (bareMinuteMatch) return `${Number(bareMinuteMatch[1])}M`;
  const minuteMatch = label.match(/^(\d{1,2})\s*(?:M|MIN|MINS|MINUTE|MINUTES)$/) || label.match(/^M\s*(\d{1,2})$/);
  if (minuteMatch && [1, 2, 3, 4, 5, 10, 15, 20, 30, 45, 60].includes(Number(minuteMatch[1]))) return `${Number(minuteMatch[1])}M`;
  const hourMatch = label.match(/^(\d{1,2})\s*(?:H|HR|HRS|HOUR|HOURS)$/) || label.match(/^H\s*(\d{1,2})$/);
  if (hourMatch && [1, 2, 3, 4, 6, 8, 12].includes(Number(hourMatch[1]))) return `${Number(hourMatch[1])}H`;
  const dayMatch = label.match(/^(\d{1,2})\s*(?:D|DAY|DAYS)$/) || label.match(/^D\s*(\d{1,2})$/);
  if (dayMatch && [1, 2, 3].includes(Number(dayMatch[1]))) return `${Number(dayMatch[1])}D`;
  const weekMatch = label.match(/^(\d{1,2})\s*(?:W|WK|WEEK|WEEKS)$/) || label.match(/^W\s*(\d{1,2})$/);
  if (weekMatch && Number(weekMatch[1]) === 1) return '1W';
  const monthMatch = label.match(/^(\d{1,2})\s*(?:MO|MONTH|MONTHS)$/) || label.match(/^MO\s*(\d{1,2})$/);
  if (monthMatch && Number(monthMatch[1]) === 1) return '1MO';
  return null;
}

function normalizeAnalysisTimeframes(value: unknown): { image1: string | null; image2: string | null } {
  const [first = '', second = ''] = String(value || '').split(/\s*(?:\/|,|;|\band\b|&)\s*/i);
  return {
    image1: normalizeVisibleTimeframe(first),
    image2: normalizeVisibleTimeframe(second),
  };
}

function sanitizeUnverifiedTimeframes(value: unknown, verifiedTimeframes: Set<string>): string {
  const pattern = /\b(?:(\d{1,2})\s*-?\s*(?:M|MIN(?:UTE)?S?|H|HR|HRS|HOUR|HOURS|D|DAY|DAYS|W|WK|WEEK|WEEKS|MO|MONTH|MONTHS)|([MHDW])\s*(\d{1,2}))\b/gi;
  const sentences = String(value || '').split(/(?<=[.!?])\s+/);
  return sentences.filter((sentence) => {
    const mentionsRelativeTimeframe = /\b(?:higher|lower|larger|smaller)\s+time ?frames?\b|\b(?:HTF|LTF)\b/i.test(sentence);
    if (mentionsRelativeTimeframe && verifiedTimeframes.size < 2) return false;
    return Array.from(sentence.matchAll(pattern)).every((match) => {
      const timeframe = normalizeVisibleTimeframe(match[0]);
      return timeframe !== null && verifiedTimeframes.has(timeframe);
    });
  }).join(' ').replace(/\s+/g, ' ').replace(/\s+([,.!?;:])/g, '$1').trim();
}

function normalizeVisiblePrice(value: unknown): string | null {
  const raw = String(value || '').trim().replace(/\s+/g, '');
  if (!/^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,8})?$/.test(raw)) return null;
  const normalized = raw.replace(/,/g, '');
  const price = Number(normalized);
  return Number.isFinite(price) && price > 0 ? normalized : null;
}

function timeframeMinutes(value: string | null): number | null {
  const match = String(value || '').match(/^(\d+)(MO|M|H|D|W)$/);
  if (!match) return null;
  const amount = Number(match[1]);
  const unitMinutes: Record<string, number> = { M: 1, H: 60, D: 1440, W: 10080, MO: 43200 };
  return amount > 0 ? amount * unitMinutes[match[2]] : null;
}

function chartPricePrecision(pair: unknown): number {
  const normalizedPair = String(pair || '').toUpperCase();
  if (normalizedPair.includes('JPY')) return 3;
  if (normalizedPair.includes('XAU') || normalizedPair.includes('XAG')) return 3;
  if (/BTC|ETH|SOL/.test(normalizedPair)) return 2;
  return 5;
}

function calculateRTargets(direction: string, entry: number, stopLoss: number, pair: unknown): { tp1: string; tp2: string; tp3: string } {
  const risk = Math.abs(entry - stopLoss);
  const sign = direction === 'BUY' ? 1 : -1;
  const precision = chartPricePrecision(pair);
  return {
    tp1: (entry + sign * risk).toFixed(precision),
    tp2: (entry + sign * risk * 2).toFixed(precision),
    tp3: (entry + sign * risk * 3).toFixed(precision),
  };
}

async function readVisibleChartHeaderData(ai: any, image1: ChartImage, image2: ChartImage | null): Promise<{ image1: string | null; image2: string | null; image1Close: string | null; image2Close: string | null }> {
  const parts: any[] = [
    { text: `Read the chart header in each magnified crop. Extract TWO fields per image: (1) the visible timeframe selector and (2) the active/current candle Close value explicitly labeled C in the OHLC header. In an OHLC row, the price immediately after the C label is the close. Never take a price from the right price scale, colored horizontal lines, manually drawn levels, indicator labels, bid/ask boxes, or another part of the chart. Only return a close when the number is visibly attached to the C label; otherwise return UNREADABLE. For TradingView headers, the timeframe appears between the instrument name and broker, e.g. “Euro / U.S. Dollar · 15 · Pepperstone” means 15M and “Euro / U.S. Dollar · 5 · Pepperstone” means 5M. Treat bare 1, 5, 15, or 30 as minutes. Return JSON only: {"image1":{"timeframe":"<normalized timeframe or UNREADABLE>","close":"<exact C value or UNREADABLE>"},"image2":{"timeframe":"<normalized timeframe or UNREADABLE>","close":"<exact C value or UNREADABLE>"}}. Image 1 and image 2 refer to the crops in attachment order. If image 2 is absent, set both image2 fields to UNREADABLE. Never infer or invent a value.` },
    { inlineData: { mimeType: image1.mimeType, data: image1.data } },
  ];
  if (image2) parts.push({ inlineData: { mimeType: image2.mimeType, data: image2.data } });
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-pro',
      contents: [{ role: 'user', parts }],
      config: { temperature: 0, responseMimeType: 'application/json' },
    });
    const result = JSON.parse(response.text || '{}');
    return {
      image1: normalizeVisibleTimeframe(result.image1?.timeframe),
      image2: image2 ? normalizeVisibleTimeframe(result.image2?.timeframe) : null,
      image1Close: normalizeVisiblePrice(result.image1?.close),
      image2Close: image2 ? normalizeVisiblePrice(result.image2?.close) : null,
    };
  } catch {
    return { image1: null, image2: null, image1Close: null, image2Close: null };
  }
}

function parseForexFactoryEventUtc(event: FFEvent): string | null {
  const rawTimestamp = String(event.date || '').trim();
  if (!rawTimestamp) return null;
  const timestamp = Date.parse(rawTimestamp);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function normalizeAnalysisNewsTime(analysis: any): string | null {
  const candidate = String(analysis?.newsTime || analysis?.news_time || '').trim();
  if (!candidate) return null;
  const parsed = new Date(candidate);
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed.toISOString();
}

function normalizeCalendarTitle(value: unknown): string {
  return String(value || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function calendarDateKey(date: Date, timeZone?: string): string {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
  } catch {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
  }
  const part = (type: string) => parts.find((item) => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function pairCurrencies(pair: string): string[] {
  const normalized = String(pair || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (normalized.includes('XAU') || normalized.includes('XAG') || normalized.includes('GOLD') || normalized.includes('SILVER')) return ['USD'];
  const code = normalized.slice(0, 6);
  return code.length === 6 ? [code.slice(0, 3), code.slice(3, 6)] : [];
}

function getUpcomingHighImpactEvents(events: FFEvent[], currencies: string[], timeZone?: string): Array<{ event: FFEvent; timestamp: string }> {
  const now = Date.now();
  const today = calendarDateKey(new Date(now), timeZone);
  const relevantCurrencies = new Set(currencies.map((currency) => currency.toUpperCase()));
  return events
    .map((event) => ({ event, timestamp: parseForexFactoryEventUtc(event) }))
    .filter(({ event, timestamp }) => {
      if ((event.impact || '').toLowerCase() !== 'high' || !timestamp) return false;
      const eventDate = new Date(timestamp);
      if (eventDate.getTime() <= now || calendarDateKey(eventDate, timeZone) !== today) return false;
      return relevantCurrencies.has(String(event.country || '').toUpperCase());
    })
    .sort((a, b) => new Date(a.timestamp!).getTime() - new Date(b.timestamp!).getTime())
    .map(({ event, timestamp }) => ({ event, timestamp: timestamp! }));
}

function matchCalendarEvent(events: FFEvent[], title: string, currencies: string[], timeZone?: string): string | null {
  const normalizedTitle = normalizeCalendarTitle(String(title || '').split('·')[0]);
  if (!normalizedTitle) return null;
  return getUpcomingHighImpactEvents(events, currencies, timeZone)
    .find(({ event }) => normalizeCalendarTitle(event.title) === normalizedTitle)?.timestamp || null;
}
let ffCache: { at: number; events: FFEvent[] } | null = null;
const FF_CACHE_MS = 15 * 60 * 1000; // 15 minutes

async function getEconomicCalendar(): Promise<FFEvent[]> {
  if (ffCache && Date.now() - ffCache.at < FF_CACHE_MS) {
    console.log('[calendar] cache hit', {
      ageSeconds: Math.floor((Date.now() - ffCache.at) / 1000),
      events: ffCache.events.length,
    });
    return ffCache.events;
  }
  try {
    const resp = await fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json', {
      headers: { 'User-Agent': 'Mozilla/5.0 (4xLifeAI Chart Analyzer)' },
    });
    if (!resp.ok) throw new Error(`FF feed ${resp.status}`);
    const data = (await resp.json()) as FFEvent[];
    ffCache = { at: Date.now(), events: Array.isArray(data) ? data : [] };
    console.log('[calendar] fetched live feed', {
      fetchedAtUtc: new Date(ffCache.at).toISOString(),
      events: ffCache.events.length,
    });
    return ffCache.events;
  } catch (e) {
    console.error('[calendar] fetch failed:', (e as any)?.message || e);
    return ffCache?.events || [];
  }
}

function isEconomicCalendarAvailable(): boolean {
  return Boolean(ffCache && Date.now() - ffCache.at <= FF_CACHE_MS * 2);
}

// Build a compact, high-impact-only calendar string for the analysis engine.
// We include the currency so Gemini can match it to the detected pair.
// Times are shown in the viewer's local timezone when provided (like Forex Factory).
function buildCalendarPromptBlock(events: FFEvent[], timeZone?: string): string {
  const now = Date.now();
  const today = calendarDateKey(new Date(now), timeZone);
  const highImpact = events.filter((event) => {
    if ((event.impact || '').toLowerCase() !== 'high') return false;
    const timestamp = parseForexFactoryEventUtc(event);
    if (!timestamp) return false;
    const eventDate = new Date(timestamp);
    return eventDate.getTime() > now && calendarDateKey(eventDate, timeZone) === today;
  });
  if (highImpact.length === 0) return 'NONE (no upcoming high-impact events for today).';
  return highImpact
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
    .slice(0, 20)
    .map((event) => {
      const timestamp = parseForexFactoryEventUtc(event);
      const date = timestamp ? new Date(timestamp) : new Date(NaN);
      let when: string;
      if (isNaN(date.getTime())) when = event.date;
      else if (timeZone) {
        try {
          when = date.toLocaleString('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' (user local time)';
        } catch {
          when = date.toUTCString().replace(':00 GMT', ' GMT') + ' (GMT)';
        }
      } else {
        when = date.toUTCString().replace(':00 GMT', ' GMT') + ' (GMT)';
      }
      const actual = event.actual && event.actual !== '' ? event.actual : 'PENDING';
      return `- ${when} | ${event.country} | ${event.title} | forecast: ${event.forecast || 'n/a'} | previous: ${event.previous || 'n/a'} | actual: ${actual}`;
    })
    .join('\n');
}

function escapeTelegramHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function shouldSendAdminAlert(key: string, cooldownMs = 60000) {
  const now = Date.now();
  const lastSent = adminAlertCooldown.get(key) || 0;
  if (now - lastSent < cooldownMs) return false;
  adminAlertCooldown.set(key, now);
  return true;
}

// Notification helper - inserts into Supabase notifications table
async function sendNotification(userEmail: string, title: string, message: string, type: string = 'info') {
  if (!supabase || !notificationsTableAvailable) return;
  let userId: string | null = null;
  try {
    const { data: authUsers } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const authUserList = ((authUsers as any)?.users || []) as Array<{ id: string; email?: string | null }>;
    const targetUser = authUserList.find(user => (user.email || '').toLowerCase() === userEmail.toLowerCase());
    userId = targetUser?.id || null;
  } catch (error: any) {
    console.error('Notification user lookup error:', error?.message || error);
  }

  const { error } = await supabase.from('notifications').insert([{
    user_id: userId,
    email: userEmail,
    title,
    message,
    type,
    is_read: false,
    created_at: new Date().toISOString()
  }]);
  if (error) {
    if (error.message.includes("Could not find the table 'public.notifications'")) {
      notificationsTableAvailable = false;
      console.warn('Notifications table missing; web notifications disabled until table is created.');
      return;
    }
    console.error('Notification insert error:', error.message);
  }
}

async function sendAdminWebNotification(title: string, message: string, type: string = 'system_alert') {
  if (!supabase || !notificationsTableAvailable) return;

  const { data: admins, error } = await supabase
    .from('users')
    .select('email')
    .eq('role', 'ADMIN');

  if (error || !admins?.length) {
    console.error('[ADMIN NOTIFY] Failed to load admins:', error?.message || 'No admins found');
    return;
  }

  const { data: authUsers } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const rows = admins
    .map((admin: any) => {
      const authUserList = ((authUsers as any)?.users || []) as Array<{ id: string; email?: string | null }>;
      const authUser = authUserList.find(user => (user.email || '').toLowerCase() === String(admin.email || '').toLowerCase());
      if (!authUser?.id) return null;
      return {
        user_id: authUser.id,
        email: admin.email,
        title,
        message,
        type,
        is_read: false,
        created_at: new Date().toISOString()
      };
    })
    .filter(Boolean);

  if (!rows.length) return;

  const { error: insertError } = await supabase.from('notifications').insert(rows);
  if (insertError) {
    if (insertError.message.includes("Could not find the table 'public.notifications'")) {
      notificationsTableAvailable = false;
      console.warn('[ADMIN NOTIFY] Notifications table missing; web notifications disabled until table is created.');
      return;
    }
    console.error('[ADMIN NOTIFY] Web notification insert error:', insertError.message);
  }
}

async function notifyAdmin(title: string, message: string, type: string = 'system_alert', dedupeKey?: string) {
  const key = dedupeKey || `${type}:${title}:${message.slice(0, 80)}`;
  if (!shouldSendAdminAlert(key)) return;

  await Promise.allSettled([
    sendTelegramMessage(`<b>${escapeTelegramHtml(title)}</b>\n${escapeTelegramHtml(message)}`),
    sendAdminWebNotification(title, message, type)
  ]);
}

type CanonicalPlan = 'FREE' | 'PRO';

function canonicalPlan(value: unknown): CanonicalPlan {
  const normalized = String(value || '').trim().toUpperCase();
  return normalized === 'PRO' || normalized === 'PREMIUM' || normalized === 'ELITE' || normalized === 'PAID'
    ? 'PRO'
    : 'FREE';
}

function getCanonicalPlan(record: any): CanonicalPlan {
  if (
    canonicalPlan(record?.plan) === 'PRO' ||
    canonicalPlan(record?.plan_status) === 'PRO' ||
    Number(record?.credits || 0) > 0
  ) {
    return 'PRO';
  }
  return 'FREE';
}

async function getUserSubscription(email: string) {
  if (!supabase) return { record: null, error: new Error('Supabase is not configured') };

  let result: any = await supabase
    .from('users')
    .select('plan, plan_status, credits')
    .ilike('email', email.trim());

  if (result.error && result.error.message.toLowerCase().includes('plan_status')) {
    result = await supabase
      .from('users')
      .select('plan, credits')
      .ilike('email', email.trim());
  }

  if (result.error && result.error.message.toLowerCase().includes('plan')) {
    result = await supabase
      .from('users')
      .select('plan_status, credits')
      .ilike('email', email.trim());
  }

  const records = result.data || [];
  const record = records.reduce((best: any, candidate: any) => {
    if (!best) return candidate;
    const bestScore = getCanonicalPlan(best) === 'PRO' ? 1 : 0;
    const candidateScore = getCanonicalPlan(candidate) === 'PRO' ? 1 : 0;
    if (candidateScore !== bestScore) return candidateScore > bestScore ? candidate : best;
    return Number(candidate?.credits || 0) > Number(best?.credits || 0) ? candidate : best;
  }, null);

  return { record, error: result.error };
}

async function updateUserSubscription(email: string, plan: CanonicalPlan, credits?: number) {
  if (!supabase) return new Error('Supabase is not configured');

  const payload: Record<string, unknown> = {
    plan,
    plan_status: plan
  };
  if (credits !== undefined) payload.credits = credits;

  let result = await supabase
    .from('users')
    .update(payload)
    .ilike('email', email.trim());

  if (result.error && result.error.message.toLowerCase().includes('plan_status')) {
    const fallbackPayload = { plan, ...(credits !== undefined ? { credits } : {}) };
    result = await supabase
      .from('users')
      .update(fallbackPayload)
      .ilike('email', email.trim());
  } else if (result.error && result.error.message.toLowerCase().includes('plan')) {
    const fallbackPayload = { plan_status: plan, ...(credits !== undefined ? { credits } : {}) };
    result = await supabase
      .from('users')
      .update(fallbackPayload)
      .ilike('email', email.trim());
  }

  return result.error;
}

function getPrompts() {
  try {
    const data = fs.readFileSync(path.join(process.cwd(), 'prompts.json'), 'utf8');
    return JSON.parse(data);
  } catch (e) {
    return {
      coach_system_instruction: "You are the 4xLifeAI Coach, an expert in Smart Money Concepts (SMC) and quantitative trading. You help users with risk management, position sizing, understanding market structure (BOS, CHoCH, Order Blocks, Liquidity Sweeps), and trading psychology. Keep responses concise, professional, and directly actionable. Avoid long generic paragraphs.",
      signal_explainer_prompt: "You are an expert forex trader. Explain this signal to a user in plain English:\nPair: ${signal.pair}\nDirection: ${signal.direction}\nConfidence Score: ${signal.aiConfidence}%\nStatus: ${signal.tier}\nMarket Regime: ${signal.diagnostics?.confidenceBreakdown?.regime === 5 ? 'Trending (Clean)' : 'Chop / Mixed'}\nWhy this triggered:\n- ATR, VWAP, EMA alignments were matched\n- Pullback and stochastic were confirmed\n- Stop Loss is well placed\n\nGive a short, punchy 2-3 sentence explanation of why this trade looks good and what market structure we are following. No fluffy intros. Keep it to the point."
    };
  }
}

function savePrompts(prompts: any) {
  fs.writeFileSync(path.join(process.cwd(), 'prompts.json'), JSON.stringify(prompts, null, 2), 'utf8');
}

function getLimits() {
  try {
    const data = fs.readFileSync(path.join(process.cwd(), 'limits.json'), 'utf8');
    const parsed = JSON.parse(data);
    return {
      freeDaily: Math.max(1, Number(parsed.freeDaily) || 4),
      proDaily: Math.max(1, Number(parsed.proDaily) || 30),
    };
  } catch (e) {
    return { freeDaily: 4, proDaily: 30 };
  }
}

function saveLimits(limits: { freeDaily: number; proDaily: number }) {
  fs.writeFileSync(path.join(process.cwd(), 'limits.json'), JSON.stringify(limits, null, 2), 'utf8');
}

async function ensureAdminUser() {
  if (!supabase) {
    console.warn('[AUTH] Admin bootstrap skipped: Supabase client is not configured.');
    return;
  }

  const adminEmail = (process.env.AUTH_ADMIN_EMAIL || '').trim();
  const adminPassword = (process.env.AUTH_ADMIN_PASSWORD || '').trim();

  if (!adminEmail || !adminPassword) {
    console.warn('[AUTH] Admin bootstrap skipped: AUTH_ADMIN_EMAIL or AUTH_ADMIN_PASSWORD is missing.');
    return;
  }

  const { data: userList, error: listError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listError) {
    console.error('[AUTH] Failed to read Supabase auth users:', listError.message);
    return;
  }

  const users = ((userList as any)?.users || []) as Array<{
    id: string;
    email?: string | null;
    user_metadata?: Record<string, any>;
  }>;
  const existingUser = users.find(user => (user.email || '').toLowerCase() === adminEmail.toLowerCase());
  let adminUserId = existingUser?.id || null;

  if (!existingUser) {
    const { data, error } = await supabase.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
      user_metadata: {
        full_name: 'Admin',
        role: 'admin'
      }
    });

    if (error || !data.user) {
      console.error('[AUTH] Failed to auto-create admin user:', error?.message || 'Unknown error');
      return;
    }

    adminUserId = data.user.id;
    console.log(`[AUTH] Admin user auto-created in Supabase users table: ${adminEmail}`);
  } else {
    const { error } = await supabase.auth.admin.updateUserById(existingUser.id, {
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
      user_metadata: {
        ...(existingUser.user_metadata || {}),
        full_name: existingUser.user_metadata?.full_name || 'Admin',
        role: 'admin'
      }
    });

    if (error) {
      console.error('[AUTH] Failed to sync admin password:', error.message);
      return;
    }

    console.log(`[AUTH] Admin user password synchronized in Supabase users table: ${adminEmail}`);
  }

  if (!adminUserId) {
    return;
  }

  console.log(`[AUTH] Admin role confirmed via user_metadata: ${adminEmail}`);
}

process.on('uncaughtException', (err) => {
  if (!err?.message?.includes('terminated')) {
    console.error('Uncaught Exception:', err);
    notifyAdmin('Server Exception', err?.message || String(err), 'server_error', `uncaught:${err?.message || String(err)}`)
      .catch(error => console.error('[ADMIN NOTIFY] Uncaught exception alert failed:', error?.message || error));
  }
});

process.on('unhandledRejection', (reason, promise) => {
  const err = reason as any;
  if (!err?.message?.includes('terminated')) {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    notifyAdmin('Unhandled Server Rejection', err?.message || String(reason), 'server_error', `unhandled:${err?.message || String(reason)}`)
      .catch(error => console.error('[ADMIN NOTIFY] Unhandled rejection alert failed:', error?.message || error));
  }
});

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  // Initialize the internal analysis provider
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  await ensureAdminUser();

  // Start the background scanner
  await startScanner();
  startStrategyWorker();

  // Start session-based motivational messaging (every 4-6 hours during trading sessions)
  startSessionMessaging();

  app.disable('x-powered-by');

  // Security headers (browser protections; improves securityheaders.com grade)
  app.use((req, res, next) => {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    res.setHeader('Content-Security-Policy', "default-src 'self' https: wss: data: blob: 'unsafe-inline'");
    next();
  });

  app.use(express.json({ limit: '10mb' }));
  app.use((req, res, next) => {
    res.on('finish', () => {
      if (req.path.startsWith('/api/') && res.statusCode >= 500) {
        console.error(`[API ERROR] ${req.method} ${req.path} returned ${res.statusCode}`);
      }
    });
    next();
  });

  // Health check endpoint for external monitoring (UptimeRobot, etc.)
  app.get("/api/health", (req, res) => {
    const lastScanAge = scannerState.stats.lastScanTime ? Date.now() - scannerState.stats.lastScanTime : -1;
    const isHealthy = lastScanAge >= 0 && lastScanAge < 30000; // Unhealthy if no scan in 30s

    res.status(isHealthy ? 200 : 503).json({
      status: isHealthy ? "ok" : "degraded",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      scanner: {
        isRunning: isHealthy,
        lastScanTime: scannerState.stats.lastScanTime ? new Date(scannerState.stats.lastScanTime).toISOString() : null,
        scansLastHour: scannerState.stats.scanCycles,
        activeSignals: scannerState.signals.length,
        isDegraded: scannerState.stats.isDegraded
      }
    });
  });

  // TEST ENDPOINT: Send a session message immediately (for testing)
  app.get("/api/test-session-message", async (req, res) => {
    try {
      console.log("🧪 [TEST] Manual session message trigger");
      await sendSessionUpdate();
      res.json({ 
        success: true, 
        message: "Session update sent to Telegram. Check your channel!" 
      });
    } catch (error: any) {
      console.error("Test session message failed:", error);
      res.status(500).json({ 
        success: false, 
        error: error?.message || "Failed to send test message" 
      });
    }
  });

  // DIAGNOSTIC ENDPOINT: Show why engine is/isn't firing signals
  app.get("/api/debug/signal-engine", async (req, res) => {
    const state = {
      timestamp: new Date().toISOString(),
      scanner: {
        isRunning: scannerState.stats.lastScanTime ? Date.now() - scannerState.stats.lastScanTime < 30000 : false,
        lastScanTime: scannerState.stats.lastScanTime ? new Date(scannerState.stats.lastScanTime).toISOString() : null,
        scanCycles: scannerState.stats.scanCycles,
      },
      signals: {
        active: scannerState.signals.filter(s => s.tier !== 'Reject').length,
        rejected: scannerState.signals.filter(s => s.tier === 'Reject').length,
        total: scannerState.signals.length,
      },
      pairs: {
        configured: scannerState.pairStatuses.map(p => ({
          pair: p.pair,
          lastUpdate: p.lastScanTime || null,
          status: p.status,
        })),
      },
      recentSignals: scannerState.signals.slice(0, 5).map(s => ({
        pair: s.pair,
        direction: s.direction,
        tier: s.tier,
        status: s.status,
        timestamp: s.timestamp,
        confidence: s.aiConfidence,
      })),
    };

    res.json(state);
  });

  app.post("/api/admin/notify-signup", async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const fullName = String(req.body?.fullName || 'New user').trim();

    if (!email) return res.status(400).json({ error: "Email is required" });

    await notifyAdmin(
      'New User Signup',
      `${fullName} signed up.\nEmail: ${email}`,
      'user_signup',
      `signup:${email}`
    );

    res.json({ success: true });
  });

  // API Routes
  // Real-time Event Stream (SSE) for zero-database overhead memory state
  app.get("/api/stream", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const sendState = () => {
      res.write(`data: ${JSON.stringify({
        stats: scannerState.stats,
        pairStatuses: scannerState.pairStatuses,
        marketStates: Array.from(latestMarketState.values()).map(ms => {
          const st = scannerState.pairStatuses.find(p => p.pair === ms.pair);
          return { ...ms, status: st ? st.status : 'success' };
        }),
        rejectionStats,
        confidenceHistory: scannerState.confidenceHistory
      })}\n\n`);
    };

    // Send initial immediately
    sendState();

    // Send updates every second. (In memory, no DB cost)
    const intervalId = setInterval(sendState, 1000);

    req.on("close", () => {
      clearInterval(intervalId);
    });
  });

  app.get("/api/state", async (req, res) => {
    let recentSignals: any[] = [];
    let activeSignalsCount = 0;
    let signalsTodayCount = 0;
    const scannerSummary = {
      isRunning: false,
      lastScanTime: null as string | null,
      scansLastHour: 0,
      activeSignals: 0,
      isDegraded: false
    };

    if (supabase) {
      const { data } = await supabase
        .from('signals')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);
      
      if (data) {
        recentSignals = data.map((d: any) => ({
        ...d,
      newsEvent: d.news_event || d.newsEvent,
      newsPrediction: d.news_prediction || d.newsPrediction,
      newsProbability: d.news_probability || d.newsProbability,
      newsReason: d.news_reason || d.newsReason,
          entry: d.entry_price,
          timestamp: d.created_at,
          aiConfidence: (d.confidence || 0) * 10,
          score: d.score || ((d.confidence || 0) * 10),
        }));
      }

      // Fetch authentic counts from Supabase database to avoid 20-item local limitation mismatch
      const { count: activeCount } = await supabase
        .from('signals')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true)
        .in('status', ['LIVE', 'TP1_HIT', 'TP2_HIT']);
      if (activeCount !== null) activeSignalsCount = activeCount;

      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);

      const { count: todayCount } = await supabase
        .from('signals')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', startOfDay.toISOString())
        .neq('status', 'REJECTED_BY_ADMIN');
      if (todayCount !== null) signalsTodayCount = todayCount;

      const { data: activeOpps } = await supabase
        .from('active_opportunities')
        .select('*');
      
      if (activeOpps) {
         scannerState.activeOpportunities = activeOpps;
      }

    } else {
      recentSignals = scannerState.signals.slice(0, 20);
      const validMem = scannerState.signals.filter(s => s.tier !== 'Reject');
      activeSignalsCount = validMem.filter(s => s.status === 'ACTIVE').length;
      signalsTodayCount = validMem.filter(s => new Date(s.timestamp).toDateString() === new Date().toDateString()).length;
    }

    const lastScanAge = scannerState.stats.lastScanTime ? Date.now() - scannerState.stats.lastScanTime : -1;
    scannerSummary.isRunning = lastScanAge >= 0 && lastScanAge < 30000;
    scannerSummary.lastScanTime = scannerState.stats.lastScanTime ? new Date(scannerState.stats.lastScanTime).toISOString() : null;
    scannerSummary.scansLastHour = scannerState.stats.scanCycles;
    scannerSummary.activeSignals = scannerState.signals.length;
    scannerSummary.isDegraded = scannerState.stats.isDegraded;

    res.json({
        scanner: scannerSummary,
        opportunities: scannerState.activeOpportunities || [],
        stats: scannerState.stats,
        pairStatuses: scannerState.pairStatuses,
        latestSignal: recentSignals.find(s => s.status !== 'REJECTED' && s.tier !== 'Reject') || null,
        signals: recentSignals, 
        activeSignalsCount,
        signalsTodayCount,
        activeOpportunities: scannerState.activeOpportunities || [],
        marketStates: Array.from(latestMarketState.values()).map(ms => {
          const st = scannerState.pairStatuses.find(p => p.pair === ms.pair);
          return { ...ms, status: st ? st.status : 'success' };
        }),
        rejectionStats,
        confidenceHistory: scannerState.confidenceHistory
    });
  });

  app.get("/api/signals", async (req, res) => {
    if (supabase) {
      const { data } = await supabase
        .from('signals')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
      if (data) {
        res.json(data.map((d: any) => ({
          ...d,
          sl: d.is_active ? d.sl : d.original_sl ?? d.sl,
          breakeven_at: d.breakeven_at,
          entry: d.entry_price,
          timestamp: d.created_at,
          aiConfidence: (d.confidence || 0) * 10,
          score: d.score || ((d.confidence || 0) * 10),
        })));
        return;
      }
    }
    res.json(scannerState.signals);
  });

  app.get("/api/trades", async (req, res) => {
    let openTrades: any[] = [];
    let closedTrades: any[] = [];
    let allTrades: any[] = [];

    if (supabase) {
      const { data } = await supabase
        .from('signals')
        .select('*')
        .order('created_at', { ascending: false });
        
      if (data) {
        allTrades = data.map((d: any) => ({
           ...d,
           opened_at: d.created_at,
           entry: d.entry_price,
        }));
        openTrades = allTrades.filter((t: any) => t.is_active);
        closedTrades = allTrades.filter((t: any) => !t.is_active && t.result);
      }
    } else {
      // In-memory fallback
      allTrades = scannerState.signals.filter(s => s.tier !== 'Reject');
      openTrades = allTrades.filter(s => ['LIVE', 'TP1_HIT', 'TP2_HIT'].includes(s.status));
      closedTrades = allTrades.filter(s => s.status === 'CLOSED' || s.result === 'LOSS' || s.result === 'WIN' || s.result === 'PARTIAL WIN');
    }

    // Process Stats
    const totalTrades = closedTrades.length;
    let winningTrades = 0;
    let losingTrades = 0;
    let breakevenTrades = 0;

    let tp1Hits = 0;
    let tp2Hits = 0;
    let tp3Hits = 0;
    let slHits = 0;

    let grossPipsWon = 0;
    let grossPipsLost = 0;

    let bestTrade = 0;
    let worstTrade = 0;

    let consecutiveWins = 0;
    let consecutiveLosses = 0;
    let currentWinStreak = 0;
    let currentLossStreak = 0;
    
    // Process chronologically to get streaks right
    const chronoClosed = [...closedTrades].sort((a: any, b: any) => 
        new Date(a.closed_at || a.opened_at || a.timestamp).getTime() - new Date(b.closed_at || b.opened_at || b.timestamp).getTime()
    );

    chronoClosed.forEach((t: any) => {
        const isWin = t.result === 'WIN' || t.result === 'PARTIAL WIN';
        const isLoss = t.result === 'LOSS';
        
        if (isWin) winningTrades++;
        if (isLoss) losingTrades++;
        if (!isWin && !isLoss) breakevenTrades++;

        if (t.tp1_hit_at || t.status === 'TP1 HIT' || t.status === 'TP2 HIT' || t.status === 'TP3 HIT' || t.result === 'PARTIAL WIN' || t.result === 'WIN') tp1Hits++;
        if (t.tp2_hit_at || t.status === 'TP2 HIT' || t.status === 'TP3 HIT' || t.result === 'WIN') tp2Hits++;
        if (t.tp3_hit_at || t.status === 'TP3 HIT' || (t.result === 'WIN' && t.status === 'CLOSED' && !t.tp2_hit_at)) tp3Hits++; // Best guess if exact level hit not saved
        if (t.result === 'LOSS' || (t.status === 'CLOSED' && t.result !== 'WIN' && t.result !== 'PARTIAL WIN' && t.result !== 'BREAKEVEN')) slHits++;

        const pWon = t.pips_won || 0;
        const pLost = t.pips_lost || 0;
        
        grossPipsWon += pWon;
        grossPipsLost += pLost;

        if (pWon > bestTrade) bestTrade = pWon;
        if (pLost > worstTrade) worstTrade = pLost;

        if (isWin) {
            currentWinStreak++;
            currentLossStreak = 0;
            if (currentWinStreak > consecutiveWins) consecutiveWins = currentWinStreak;
        } else if (isLoss) {
            currentLossStreak++;
            currentWinStreak = 0;
            if (currentLossStreak > consecutiveLosses) consecutiveLosses = currentLossStreak;
        }
    });

    const netPips = grossPipsWon - grossPipsLost;
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
    const lossRate = totalTrades > 0 ? (losingTrades / totalTrades) * 100 : 0;
    
    const profitFactor = grossPipsLost > 0 ? (grossPipsWon / grossPipsLost) : (grossPipsWon > 0 ? 999 : 0);
    
    const averageWin = winningTrades > 0 ? (grossPipsWon / winningTrades) : 0;
    const averageLoss = losingTrades > 0 ? (grossPipsLost / losingTrades) : 0;
    
    const averageRR = averageLoss > 0 ? (averageWin / averageLoss) : (averageWin > 0 ? averageWin : 0);
    
    // Expectancy: (Win Rate * Average Win) - (Loss Rate * Average Loss)
    const expectancy = ((winRate / 100) * averageWin) - ((lossRate / 100) * averageLoss);

    const averageCycleDuration = scannerState.stats.scanCycles > 0 
        ? Math.round(scannerState.stats.totalScanDurationMs / scannerState.stats.scanCycles) 
        : 0;

    res.json({
      openTrades,
      closedTrades,
      tradeStats: {
        totalTrades,
        winningTrades,
        losingTrades,
        breakevenTrades,
        openTradesCount: openTrades.length,
        closedTradesCount: closedTrades.length,
        tp1Hits,
        tp2Hits,
        tp3Hits,
        slHits,
        grossPipsWon,
        grossPipsLost,
        netPips,
        winRate,
        lossRate,
        profitFactor,
        expectancy,
        averageWin,
        averageLoss,
        averageRR,
        bestTrade,
        worstTrade,
        consecutiveWins,
        consecutiveLosses
      },
      telemetry: {
        telegramPushes: scannerState.stats.telegramPushes,
        duplicateEvents: scannerState.stats.duplicateEvents,
        rateLimitRecoveries: scannerState.stats.rateLimitRecoveries,
        lastSignalTimestamp: scannerState.stats.lastSignalTimestamp,
        lastTradeTimestamp: scannerState.stats.lastTradeTimestamp,
        scannerUptime: Date.now() - scannerState.stats.scannerStartTime,
        averageCycleDuration
      }
    });
  });

  app.get("/api/market-state", (req, res) => {
    res.json({
      states: Array.from(latestMarketState.values())
    });
  });

  const priceCache: { timestamp: number; data: any } = { timestamp: 0, data: [] };
  const PRICE_CACHE_TTL = 5000;

  app.get("/api/prices", async (req, res) => {
    if (priceCache.data.length > 0 && Date.now() - priceCache.timestamp < PRICE_CACHE_TTL) {
      return res.json({ prices: priceCache.data, cached: true });
    }

    try {
      const liveModule: any = await import('./server/live-market-feed.js');
      // Kept in sync with server/scanner.ts APPROVED_PAIRS (9-pair roster:
      // XAUUSD + 5 forex majors + 3 crypto; Oil excluded, Silver/BNB dropped).
      const approved = [
        'XAUUSD',
        'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD',
        'BTCUSD', 'ETHUSD', 'SOLUSD',
      ];
      const results: any[] = [];
      for (const [index, pair] of approved.entries()) {
        const item = await liveModule.getLatestPrice(pair);
        results.push(item);
        if (index !== approved.length - 1) {
          await new Promise(r => setTimeout(r, 35));
        }
      }

      priceCache.timestamp = Date.now();
      priceCache.data = results;
      res.json({ prices: results, cached: false });
    } catch (error: any) {
      console.error('[API /api/prices] error:', error?.message || error);
      res.status(500).json({ error: 'Failed to fetch prices', message: error?.message || String(error) });
    }
  });

  app.get("/api/config", (req, res) => {
    res.json({
      USDT_TRC20_ADDRESS: process.env.USDT_TRC20_ADDRESS || "TN3zCR5gACd16f7iDJH97GMB7mKRg3opXe",
      USDT_BEP20_ADDRESS: process.env.USDT_BEP20_ADDRESS || "0xa061175dd8cd00a87ae55d29a3fc7c31f8cb476a"
    });
  });

  // Payments API
  const runtimePayments: any[] = [];
  const runtimePayouts: any[] = [];
  const runtimeReferralBalances: Record<string, any> = {};

  const requireAuth = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: "Missing authorization header" });
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return res.status(401).json({ error: "Invalid token" });
    
    (req as any).user = user;
    next();
  };

  app.get("/api/auth/admin-status", requireAuth, async (req, res) => {
    if (!supabase) return res.status(500).json({ error: "4x System Error" });

    const user = (req as any).user;
    const email = String(user?.email || '').trim().toLowerCase();
    if (!email) return res.json({ isAdmin: false });

    const { data, error } = await supabase
      .from('users')
      .select('role')
      .ilike('email', email)
      .eq('role', 'ADMIN')
      .limit(1);

    if (error) {
      console.error('[AUTH] Admin status lookup failed:', error.message);
      return res.status(500).json({ error: 'Unable to verify admin status' });
    }

    res.json({ isAdmin: (data || []).some(row => String(row.role || '').toUpperCase() === 'ADMIN') });
  });

  app.get("/api/auth/subscription", requireAuth, async (req, res) => {
    const user = (req as any).user;
    const email = String(user?.email || '').trim();
    if (!email) return res.json({ plan: 'FREE', credits: 0, isPro: false });

    const { record, error } = await getUserSubscription(email);
    if (error) {
      console.error('[AUTH] Subscription lookup failed:', error.message);
      return res.status(500).json({ error: 'Unable to verify subscription' });
    }

    const plan = getCanonicalPlan(record);
    res.json({
      plan,
      credits: Number(record?.credits || 0),
      isPro: plan === 'PRO'
    });
  });

  app.get("/api/today-signals", requireAuth, async (req, res) => {
    try {
      const user = (req as any).user;
      
      // Get user plan and scan limit
      let planStatus = 'FREE';
      let scanLimit: number | null = null;
      if (supabase) {
        const { record: userRecord } = await getUserSubscription(user.email);
        planStatus = getCanonicalPlan(userRecord);
        
        // Fetch scan_limit from plans table
        const { data: planRecord } = await supabase
          .from('plans')
          .select('scan_limit')
          .ilike('name', planStatus === 'FREE' ? 'Free' : planStatus === 'PRO' ? 'Pro' : '%')
          .single();
        scanLimit = planRecord?.scan_limit ?? null;
      }
      
      const isPremium = planStatus === 'PRO';
      
      let signalsList: any[] = [];
      
      if (supabase) {
        // Keep "today" rows AND always include currently active trades
        const startOfTodayUtc = new Date();
        startOfTodayUtc.setUTCHours(0, 0, 0, 0);

        const [{ data: todayData, error: todayError }, { data: activeData, error: activeError }] = await Promise.all([
          supabase
            .from('signals')
            .select('*')
            .gte('created_at', startOfTodayUtc.toISOString())
            .order('created_at', { ascending: false }),
          supabase
            .from('signals')
            .select('*')
            .eq('is_active', true)
            .order('created_at', { ascending: false }),
        ]);

        if (todayError) {
          console.error("Supabase error fetching today signals:", todayError);
        }
        if (activeError) {
          console.error("Supabase error fetching active signals:", activeError);
        }

        const merged = new Map<any, any>();
        for (const row of todayData || []) merged.set(row.id, row);
        for (const row of activeData || []) merged.set(row.id, row);
        signalsList = Array.from(merged.values()).sort(
          (a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
      }
      
      // In-memory fallback
      if (signalsList.length === 0) {
        const fallbackToday = new Date();
        fallbackToday.setUTCHours(0,0,0,0);
        signalsList = scannerState.signals
          .filter(s => s.tier !== 'Reject' && new Date(s.timestamp).getTime() >= fallbackToday.getTime())
          .reverse();
      }
      
      // Enforce Free plan scan limit only when not explicitly disabled (e.g. dashboard overview)
      let limitInfo = { limited: false, limit: scanLimit, viewed: 0, remaining: null as number | null };
      const noLimit = req.query.noLimit === '1' || req.query.noLimit === 'true';
      
      if (!noLimit && !isPremium && scanLimit !== null && scanLimit > 0 && supabase) {
        const today = new Date().toISOString().split('T')[0];
        
        // Count unique signals viewed today
        const { count, error: countError } = await supabase
          .from('user_signal_views')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .eq('view_date', today);
        
        if (countError) {
          console.error('Error counting signal views:', countError.message);
        }
        
        const viewed = count || 0;
        const remaining = Math.max(0, scanLimit - viewed);
        limitInfo = { limited: true, limit: scanLimit, viewed, remaining };
        
        // Record views for signals being returned
        const toRecord = signalsList.slice(0, remaining);
        if (toRecord.length > 0) {
          const inserts = toRecord.map((s: any) => ({
            user_id: user.id,
            view_date: today,
            signal_id: s.id,
          }));
          // Insert one by one, ignore duplicates
          for (const insert of inserts) {
           try {
             await supabase.from('user_signal_views').insert([insert]);
           } catch {
           }
          }
        }
        
        // Slice to remaining limit
        signalsList = signalsList.slice(0, remaining);
      }
      
      const mapped = signalsList.map((d: any) => ({
        id: d.id,
        pair: d.pair,
        direction: d.direction,
        entry: d.entry_price,
        entry_price: d.entry_price,
        sl: d.is_active ? d.sl : d.original_sl ?? d.sl,
        original_sl: d.original_sl,
        breakeven_at: d.breakeven_at,
        tp1: d.tp1,
        tp2: d.tp2,
        tp3: d.tp3,
        tp4: d.tp4,
        tp5: d.tp5,
        news_event: d.news_event,
        news_impact: d.news_impact,
        news_time: d.news_time,
        news_prediction: d.news_prediction,
        news_probability: d.news_probability,
        news_reason: d.news_reason,
        confidence: d.confidence,
        aiConfidence: (d.confidence || 0) * 10,
        score: d.score || d.confidence,
        status: d.status,
        is_active: d.is_active,
        result: d.result,
        pips_won: d.pips_won,
        pips_lost: d.pips_lost,
        closed_at: d.closed_at,
        created_at: d.created_at,
        timestamp: d.created_at,
        tp1_hit_at: d.tp1_hit_at,
        tp2_hit_at: d.tp2_hit_at,
        tp3_hit_at: d.tp3_hit_at
      }));
      
      res.json({
        signals: mapped,
        limit: limitInfo,
      });
    } catch (e) {
      console.error("Route error:", e);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });

  // Recent closed signals for dashboard history (auth required)
  app.get("/api/recent-closed-signals", requireAuth, async (req, res) => {
    try {
      if (!supabase) return res.json({ signals: [] });
      
      const { data, error } = await supabase
        .from('signals')
        .select('*')
        .eq('is_active', false)
        .order('closed_at', { ascending: false })
        .limit(20);
      
      if (error) {
        console.error("Error fetching recent closed signals:", error.message);
        return res.status(500).json({ error: error.message });
      }
      
      const mapped = (data || []).map((d: any) => ({
        id: d.id,
        pair: d.pair,
        direction: d.direction,
        entry: d.entry_price,
        entry_price: d.entry_price,
        sl: d.is_active ? d.sl : d.original_sl ?? d.sl,
        original_sl: d.original_sl,
        breakeven_at: d.breakeven_at,
        tp1: d.tp1,
        tp2: d.tp2,
        tp3: d.tp3,
        tp4: d.tp4,
        tp5: d.tp5,
        confidence: d.confidence,
        aiConfidence: (d.confidence || 0) * 10,
        score: d.score || d.confidence,
        status: d.status,
        is_active: d.is_active,
        result: d.result,
        pips_won: d.pips_won,
        pips_lost: d.pips_lost,
        closed_at: d.closed_at,
        created_at: d.created_at,
        timestamp: d.created_at,
      }));
      
      res.json({ signals: mapped });
    } catch (e) {
      console.error("Route error:", e);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });

  const APPROVED_PAIRS = ['XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'BTCUSD', 'ETHUSD', 'SOLUSD'];

  function num(value: any): number | null {
    const n = Number(value);
    return isFinite(n) ? n : null;
  }

  function normalizePair(value: any): string {
    const normalized = String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const aliases: Record<string, string> = {
      XAUUSDM: 'XAUUSD',
      GOLD: 'XAUUSD',
      GOLDUSD: 'XAUUSD',
      XAU: 'XAUUSD',
    };
    return aliases[normalized] || normalized;
  }

  async function publishManualSignal(analysis: any, pair: string): Promise<{ ok: boolean; error?: string; signal?: any }> {
    if (!supabase) return { ok: false, error: 'Supabase not available' };

    const trade = String(analysis.trade || '').toUpperCase();
    if (trade !== 'BUY' && trade !== 'SELL') {
      return { ok: false, error: `Invalid trade direction: ${analysis.trade}` };
    }

    const direction = trade;
    const entry = num(analysis.entry);
    const sl = num(analysis.stopLoss);
    const confidence = Math.min(80, Math.max(0, Number(analysis.confidence) || 0));

    if (entry === null || sl === null) {
      return { ok: false, error: 'Missing required Entry or Stop Loss price' };
    }
    const screenshotPrice = num(analysis.screenshotMarketPrice);
    if (screenshotPrice === null || entry !== screenshotPrice) {
      return { ok: false, error: 'Entry must exactly match the active candle close read from the screenshot' };
    }

    const targetPrices = calculateRTargets(direction, entry, sl, pair);
    const tp1 = Number(targetPrices.tp1);
    const tp2 = Number(targetPrices.tp2);
    const tp3 = Number(targetPrices.tp3);
    if (confidence < 65) {
      return { ok: false, error: 'Confidence below 65: setup must remain WAITING' };
    }

    const isLong = direction === 'BUY';
    if (isLong && sl >= entry) return { ok: false, error: 'BUY SL must be below entry' };
      if (!isLong && sl <= entry) return { ok: false, error: 'SELL SL must be above entry' };

    // Cancel any existing active signal for this pair
    await supabase
      .from('signals')
      .update({ status: 'CLOSED', is_active: false, closed_at: new Date().toISOString(), result: 'CANCELLED' })
      .eq('pair', pair)
      .in('status', ['LIVE', 'TP1_HIT', 'TP2_HIT'])
      .eq('is_active', true);

    const now = new Date().toISOString();
    const risk = Math.abs(entry - sl);
    const rr = risk > 0 ? (Math.abs(tp1 - entry) / risk).toFixed(1) : '0.0';
    const newsBias = {
      lean: String(analysis.newsPrediction || 'NEUTRAL').toUpperCase(),
      probability: analysis.newsHasEvent ? Math.max(50, Math.min(75, Number(analysis.newsProbability) || 50)) : undefined,
      eventSummary: analysis.newsEvent || undefined,
      bullishScenario: analysis.newsReason || undefined,
      bearishScenario: undefined,
    };

    const normalizedNewsTime = normalizeAnalysisNewsTime(analysis);
    const hasFutureNews = Boolean(
      analysis.newsHasEvent &&
      analysis.newsEvent &&
      normalizedNewsTime &&
      new Date(normalizedNewsTime).getTime() > Date.now(),
    );
    console.log('[signal] news mapping', {
      pair,
      matchedTitle: analysis.newsEvent || null,
      normalizedUtc: normalizedNewsTime,
      nowUtc: new Date().toISOString(),
      remainingSeconds: normalizedNewsTime
        ? Math.floor((new Date(normalizedNewsTime).getTime() - Date.now()) / 1000)
        : null,
      saved: hasFutureNews,
    });

    const signalPayload: any = {
      pair,
      direction,
      bias: isLong ? 'BULLISH' : 'BEARISH',
      score: confidence,
      tier: confidence >= 75 ? 'Strong' : confidence >= 70 ? 'Good' : confidence >= 65 ? 'Valid' : 'Reject',
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
      news_event: hasFutureNews ? String(analysis.newsEvent) : null,
      news_impact: hasFutureNews ? 'HIGH' : null,
      news_time: hasFutureNews ? normalizedNewsTime : null,
      news_prediction: hasFutureNews ? String(analysis.newsPrediction || 'NEUTRAL').toUpperCase() : null,
      news_probability: hasFutureNews ? Math.max(50, Math.min(75, Number(analysis.newsProbability) || 50)) : null,
      news_reason: hasFutureNews ? String(analysis.newsReason || '') : null,
      reason: `${analysis.reasoning || 'Manual screenshot signal'}${hasFutureNews ? ` NEWS: ${analysis.newsEvent} — ${analysis.newsPrediction || 'NEUTRAL'} ${analysis.newsProbability || 50}% — ${analysis.newsReason || ''}` : ''}`,
    };

    let { error: insertError } = await supabase.from('signals').insert([signalPayload]);
    if (insertError && /news_(?:event|impact|time|prediction|probability|reason).*column|column.*news_(?:event|impact|time|prediction|probability|reason)/i.test(insertError.message)) {
      const compatiblePayload = { ...signalPayload };
      for (const newsColumn of ['news_event', 'news_impact', 'news_time', 'news_prediction', 'news_probability', 'news_reason']) {
        delete compatiblePayload[newsColumn];
      }
      const retry = await supabase.from('signals').insert([compatiblePayload]);
      insertError = retry.error;
    }
    if (insertError) {
      return { ok: false, error: insertError.message };
    }

    // Telegram broadcast
    const emoji = isLong ? '🟢' : '🔴';
    const msg = `${emoji} <b>4xFiveAI MANUAL SIGNAL</b>\n\n`
      + `Pair: ${pair}\n`
      + `Signal: ${trade}\n\n`
      + `Entry: ${entry}\n`
      + `SL: ${sl}\n`
      + `TP1: ${tp1}\n`
      + `TP2: ${tp2}\n`
      + `TP3: ${tp3}\n`
      + `RR: 1:${rr}\n`
      + `Confidence: ${confidence}%\n\n`
      + `${analysis.reasoning || ''}\n\n`
      + (analysis.newsHasEvent && analysis.newsEvent
        ? `📰 NEWS: ${analysis.newsEvent}\n`
          + `News bias: ${String(analysis.newsPrediction || 'NEUTRAL').toUpperCase()} `
          + `${Number(analysis.newsProbability) || 50}%\n`
          + `News scenario: ${analysis.newsReason || 'Monitor the event and volatility.'}`
        : '📰 NEWS: No high-impact news scheduled today for this pair.');

    await sendTelegramMessage(msg, process.env.TELEGRAM_VIP_CHAT_ID || undefined);

    // Mark pair as manual override so auto engine skips it
    const { MANUAL_OVERRIDE_PAIRS } = await import('./server/scanner.js');
    MANUAL_OVERRIDE_PAIRS.add(pair);

    return { ok: true, signal: signalPayload };
  }

  function formatSignalTelegramMessage(signal: any, label = 'SIGNAL') {
    const isLong = signal.direction === 'BUY' || signal.direction === 'LONG';
    const emoji = isLong ? '🟢' : '🔴';
    const securedPips = Number(signal.pips_won || 0);
    const confidence = Number(signal.score ?? signal.confidence ?? 0);
    const confidencePercent = Math.min(80, confidence <= 10 ? confidence * 10 : confidence);
    const pipMultiplier = ['XAUUSD', 'XAGUSD'].includes(String(signal.pair).toUpperCase())
      ? 0.1
      : String(signal.pair).toUpperCase().includes('JPY') ? 0.01 : 0.0001;
    const pipsBetween = (target: unknown) => {
      const distance = Math.abs(Number(target) - Number(signal.entry_price ?? signal.entry));
      return Number.isFinite(distance) ? (distance / pipMultiplier).toFixed(1) : '0.0';
    };
    return `${emoji} <b>4xFiveAI ${label}</b>\n\n`
      + `Pair: ${signal.pair}\n`
      + `Signal: ${signal.direction}\n\n`
      + `Entry: ${signal.entry_price ?? signal.entry}\n`
      + `SL: ${signal.sl}\n`
      + `TP1: ${signal.tp1} (+${pipsBetween(signal.tp1)} pips)\n`
      + `TP2: ${signal.tp2} (+${pipsBetween(signal.tp2)} pips)\n`
      + `TP3: ${signal.tp3 ?? 'N/A'}${signal.tp3 != null ? ` (+${pipsBetween(signal.tp3)} pips)` : ''}\n`
      + `Confidence: ${confidencePercent}%\n`
      + (securedPips > 0 ? `Secured pips: +${securedPips.toFixed(1)}\n` : '')
      + `\n💬 <b>Support:</b> <a href="https://t.me/TOFIFX1">Contact support</a>\n`
      + (signal.news_event
        ? `\n📰 <b>News:</b> ${signal.news_event}\n`
          + `Impact: ${String(signal.news_impact || 'N/A').toUpperCase()}\n`
          + `Time: ${signal.news_time || 'Scheduled event time unavailable'}\n`
          + `Analysis: Monitor the event and volatility.`
        : '\n📰 No high-impact news scheduled today for this pair.');
  }

  async function sendSignalTelegram(signal: any, label = 'SIGNAL') {
    return sendTelegramMessage(formatSignalTelegramMessage(signal, label));
  }

  const requireAdmin = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: "Missing authorization header" });
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return res.status(401).json({ error: "Invalid token" });
    
    // Check our users table for role = 'ADMIN'
    const { data: userRecords, error: roleError } = await supabase
      .from('users')
      .select('role')
      .ilike('email', String(user.email || '').trim())
      .eq('role', 'ADMIN')
      .limit(1);
    if (roleError || !userRecords?.length) {
        return res.status(403).json({ error: "Forbidden: Admin access required" });
    }
    
    (req as any).user = user;
    next();
  };

  app.get('/api/admin/strategy/config', requireAdmin, async (_req, res) => {
    const [stored, presetsResult] = await Promise.all([readStrategyConfig(), listStrategyPresets()]);
    res.json({
      config: stored.config,
      storageReady: stored.storageReady,
      storageError: stored.error,
      presets: presetsResult.presets,
      presetError: presetsResult.error || null,
      worker: getStrategyWorkerState(),
    });
  });

  app.get('/api/strategy/analysis', requireAuth, async (_req, res) => {
    const stored = await readStrategyConfig();
    if (!stored.storageReady) return res.status(503).json({ analyses: [], error: stored.error || 'Strategy storage is unavailable.' });
    const result = await getLatestStrategyAnalyses(stored.config.allowedSymbols);
    if (result.error) return res.status(503).json({ analyses: [], error: result.error });
    res.json({ active: stored.config.active, analyses: result.analyses });
  });

  app.put('/api/admin/strategy/config', requireAdmin, async (req, res) => {
    const checked = validateStrategyConfig(req.body?.config);
    if (checked.ok === false) return res.status(400).json({ error: checked.errors.join(' ') });
    const stored = await readStrategyConfig();
    if (!stored.storageReady) return res.status(503).json({ error: stored.error || 'Strategy storage is not ready.' });
    const saved = await writeStrategyConfig(checked.config, (req as any).user?.id, stored.config.active, null);
    if (saved.error || !saved.config) return res.status(503).json({ error: saved.error || 'Strategy could not be saved.' });
    res.json({ success: true, config: saved.config });
  });

  app.post('/api/admin/strategy/activate', requireAdmin, async (req, res) => {
    const checked = validateStrategyConfig(req.body?.config);
    if (checked.ok === false) return res.status(400).json({ error: checked.errors.join(' ') });
    const saved = await writeStrategyConfig(checked.config, (req as any).user?.id, true, null);
    if (saved.error || !saved.config) return res.status(503).json({ error: saved.error || 'Strategy could not be activated.' });
    res.json({ success: true, config: saved.config, message: 'Strategy is active for signal generation only; no broker orders are placed.' });
  });

  app.post('/api/admin/strategy/deactivate', requireAdmin, async (req, res) => {
    const stored = await readStrategyConfig();
    if (!stored.storageReady) return res.status(503).json({ error: stored.error || 'Strategy storage is not ready.' });
    const checked = validateStrategyConfig(req.body?.config || stored.config);
    if (checked.ok === false) return res.status(400).json({ error: checked.errors.join(' ') });
    const saved = await writeStrategyConfig(checked.config, (req as any).user?.id, false, null);
    if (saved.error || !saved.config) return res.status(503).json({ error: saved.error || 'Strategy could not be deactivated.' });
    res.json({ success: true, config: saved.config });
  });

  app.get('/api/admin/strategy/presets', requireAdmin, async (_req, res) => {
    const result = await listStrategyPresets();
    if (result.error) return res.status(503).json({ error: result.error });
    res.json({ presets: result.presets });
  });

  app.post('/api/admin/strategy/presets', requireAdmin, async (req, res) => {
    const result = await createStrategyPreset(req.body?.name, req.body?.description, req.body?.config, (req as any).user?.id);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ success: true, preset: result.preset });
  });

  app.post('/api/admin/strategy/presets/:id/activate', requireAdmin, async (req, res) => {
    const result = await activateStrategyPreset(req.params.id, (req as any).user?.id);
    if (result.error || !result.config) return res.status(400).json({ error: result.error || 'Preset could not be activated.' });
    res.json({ success: true, config: result.config });
  });

  app.post('/api/admin/strategy/test', requireAdmin, async (req, res) => {
    const checked = validateStrategyConfig({ ...req.body?.config, active: true });
    if (checked.ok === false) return res.status(400).json({ error: checked.errors.join(' ') });
    const pair = String(req.body?.symbol || '').trim().toUpperCase();
    if (!pair || !checked.config.allowedSymbols.includes(pair)) return res.status(400).json({ error: 'Choose a symbol enabled by this strategy.' });
    if (!process.env.CTRADER_ACCESS_TOKEN || !process.env.CTRADER_ACCOUNT_ID) return res.status(503).json({ error: 'cTrader live market data is not connected.' });
    const candles: Record<string, any[]> = {};
    for (const timeframe of checked.config.timeframes.filter(item => item.enabled)) {
      candles[timeframe.timeframe] = await fetchCandlesForTimeframe(pair, timeframe.timeframe) || [];
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    const analysis = analyzeStrategyMarket(pair, candles, checked.config);
    const userId = (req as any).user?.id;
    let persistenceWarning: string | null = null;
    if (supabase && userId) {
      const { error } = await supabase.from('strategy_test_results').insert({
        user_id: userId,
        symbol: pair,
        strategy_version: checked.config.version,
        test_config: checked.config,
        result: analysis,
      });
      if (error) persistenceWarning = `Test ran, but its history could not be saved: ${error.message}`;
    }
    res.json({ success: true, analysis, persistenceWarning });
  });

  app.post("/api/payments", requireAuth, async (req, res) => {
    if (!supabase) return res.status(500).json({ error: "4x System Error" });
    const { email, network, txid, plan, amount_usd, credits } = req.body;
    const user = (req as any).user;

    if (user.email !== email) {
      return res.status(403).json({ error: "Forbidden: You can only submit payments for your own account" });
    }

    const cleanTxid = String(txid || '').trim();
    if (!cleanTxid) return res.status(400).json({ error: "Transaction hash is required" });

    const selectedPlan = String(plan || 'PRO').toUpperCase();
    const amount = Number(amount_usd || (selectedPlan === 'ELITE' ? 50 : 20));
    const planCredits = Number(credits || (selectedPlan === 'ELITE' ? 100 : 25));
    const methodValue = (network || 'TRC20').toUpperCase();
    const payload = {
      email: user.email,
      method: methodValue === 'BEP20' ? 'USDT_BEP20' : 'USDT_TRC20',
      plan: selectedPlan === 'PREMIUM' ? 'PRO' : selectedPlan,
      amount_usd: amount,
      credits: planCredits,
      destination: cleanTxid,
      tx_hash: cleanTxid,
      status: 'PENDING'
    };

    let insert = await supabase.from('payment_intents').insert([payload]).select('*').single();
    if (insert.error && insert.error.message.includes("'tx_hash' column")) {
      const { tx_hash, ...fallbackPayload } = payload;
      insert = await supabase.from('payment_intents').insert([fallbackPayload]).select('*').single();
    }

    if (insert.error) return res.status(500).json({ error: insert.error.message });

    await sendNotification(user.email, 'Payment Submitted', `We received your payment. Our team will review and activate your account within 24 hours.`, 'payment');
    await notifyAdmin(
      'New Payment Submitted',
      `${user.email} submitted ${selectedPlan} payment.\nMethod: ${payload.method}\nAmount: $${amount}\nCredits: ${planCredits}\nTXID: ${cleanTxid}`,
      'payment_submitted',
      `payment-submitted:${insert.data?.id || cleanTxid}`
    );
    res.json({ success: true, payment: insert.data });
  });

  app.get("/api/payments", requireAdmin, async (req, res) => {
    if (!supabase) return res.status(500).json({ error: "4x System Error" });
    const { data, error } = await supabase.from('payment_intents').select('*').order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json((data || []).map((payment: any) => ({
      ...payment,
      amount: payment.amount_usd,
      network: payment.method,
      proof_url: payment.method,
      tx_hash: payment.tx_hash || payment.destination,
      txid: payment.tx_hash || payment.destination
    })));
  });

  app.get("/api/payments/:email/status", requireAuth, async (req, res) => {
    if (!supabase) return res.status(500).json({ error: "4x System Error" });
    
    const user = (req as any).user;
    const requestedEmail = req.params.email;
    if (user.email !== requestedEmail) {
      const { data: userRecord } = await supabase.from('users').select('role').eq('email', user.email).single();
      if (userRecord?.role !== 'ADMIN') {
        return res.status(403).json({ error: "Forbidden: email mismatch" });
      }
    }
    const { data, error } = await supabase.from('payment_intents').select('*').eq('email', req.params.email).order('created_at', { ascending: false }).limit(1);
    if (error) return res.status(500).json({ error: error.message });
    res.json(data[0] || null);
  });

  // Admin: approve payment and send notification
  app.post("/api/admin/payments/:id/approve", requireAdmin, async (req, res) => {
    if (!supabase) return res.status(500).json({ error: "4x System Error" });
    const paymentId = req.params.id;
    const { data: payment, error: paymentError } = await supabase.from('payment_intents').select('*').eq('id', paymentId).single();
    if (paymentError || !payment) return res.status(404).json({ error: 'Payment not found' });

    // Validate payment has required fields
    if (!payment.email) return res.status(400).json({ error: 'Payment missing email address' });
    
    // Normalize plan name to PRO if missing
    const userPlan = canonicalPlan(payment.plan);
    const paymentWasAlreadyConfirmed = String(payment.status || '').toUpperCase() === 'CONFIRMED';

    const { record: existingUser, error: existingUserError } = await getUserSubscription(payment.email);
    if (existingUserError) {
      return res.status(500).json({ error: `Failed to load user subscription: ${existingUserError.message}` });
    }

    let nextCredits = 0;

    if (existingUser) {
      nextCredits = paymentWasAlreadyConfirmed
        ? Number(existingUser?.credits || 0)
        : Number(existingUser?.credits || 0) + Number(payment.credits || 0);
      const userUpdateError = await updateUserSubscription(payment.email, canonicalPlan(userPlan), nextCredits);
      if (userUpdateError) return res.status(500).json({ error: `Failed to update user: ${userUpdateError.message}` });
    } else {
      // No users row yet - find their Supabase Auth account so we can create one
      const { data: authUsers, error: authListError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (authListError) return res.status(500).json({ error: `Could not look up auth account: ${authListError.message}` });

      const authUser = ((authUsers as any)?.users || []).find(
        (u: any) => (u.email || '').toLowerCase() === String(payment.email).toLowerCase()
      );

      if (!authUser) {
        return res.status(400).json({ error: `No account found for ${payment.email}. Ask the customer to sign up with this exact email first, then approve again.` });
      }

      nextCredits = Number(payment.credits || 0);
      const insertPayload: Record<string, unknown> = {
        email: payment.email,
        password_hash: 'SUPABASE_AUTH_MANAGED',
        role: 'USER',
        plan: canonicalPlan(userPlan),
        plan_status: canonicalPlan(userPlan),
        credits: nextCredits,
      };
      let userInsert = await supabase.from('users').insert([insertPayload]);
      if (userInsert.error && userInsert.error.message.toLowerCase().includes('plan_status')) {
        const { plan_status, ...fallbackPayload } = insertPayload;
        userInsert = await supabase.from('users').insert([fallbackPayload]);
      }

      if (userInsert.error) return res.status(500).json({ error: `Failed to create user record: ${userInsert.error.message}` });
    }

    const { error: paymentUpdateError } = await supabase.from('payment_intents').update({ status: 'CONFIRMED' }).eq('id', paymentId);
    if (paymentUpdateError) return res.status(500).json({ error: paymentUpdateError.message });

    await sendNotification(payment.email, 'Payment Approved', `Congratulations! Your subscription is now active. You have full access to all trading signals and premium features. Welcome to 4xLifeAI!`, 'success');
    await notifyAdmin(
      'Payment Confirmed',
      `${payment.email} was approved.\nPlan: ${payment.plan}\nCredits added: ${payment.credits || 0}\nNew credits: ${nextCredits}`,
      'payment_confirmed',
      `payment-confirmed:${paymentId}`
    );

    res.json({ success: true });
  });

  // Admin: reject payment and send notification
  app.post("/api/admin/payments/:id/reject", requireAdmin, async (req, res) => {
    if (!supabase) return res.status(500).json({ error: "4x System Error" });
    const paymentId = req.params.id;
    const { data: payment, error: paymentError } = await supabase.from('payment_intents').select('*').eq('id', paymentId).single();
    if (paymentError || !payment) return res.status(404).json({ error: 'Payment not found' });

    // Validate payment has email
    if (!payment.email) return res.status(400).json({ error: 'Payment missing email address - cannot send rejection notice' });

    const { error: updateError } = await supabase.from('payment_intents').update({ status: 'REJECTED' }).eq('id', paymentId);
    if (updateError) return res.status(500).json({ error: updateError.message });

    await sendNotification(payment.email, 'Payment Review Update', `We were unable to verify your payment. Please check your transaction details and contact support if you believe this is an error.`, 'warning');
    await notifyAdmin(
      'Payment Rejected',
      `${payment.email} payment was rejected.\nPlan: ${payment.plan || 'N/A'}\nTXID: ${payment.tx_hash || payment.destination || 'N/A'}`,
      'payment_rejected',
      `payment-rejected:${paymentId}`
    );

    res.json({ success: true });
  });



  // Referrals API
  app.get("/api/referrals", requireAuth, async (req, res) => {
    if (!supabase) return res.status(500).json({ error: "4x System Error" });
    const user = (req as any).user;
    const email = user.email;
    
    let { data, error } = await supabase.from('referral_balances').select('*').eq('email', email).single();
    
    if (error && error.message.includes('find the table')) {
       return res.json({
          balance: runtimeReferralBalances[email]?.balance || 0,
          paid_referrals: runtimeReferralBalances[email]?.paid_referrals || 0,
          payouts: runtimePayouts.filter(p => p.email === email).sort((a,b) => b.created_at.localeCompare(a.created_at))
       });
    }

    if (error || !data) {
        await supabase.from('referral_balances').upsert([{ email: email, balance: 0, paid_referrals: 0 }]);
        const fresh = await supabase.from('referral_balances').select('*').eq('email', email).single();
        data = fresh.data;
    }
    
    const { data: payouts } = await supabase.from('payout_requests').select('*').eq('email', email).order('created_at', { ascending: false });
    
    res.json({
        balance: data?.balance || 0,
        paid_referrals: data?.paid_referrals || 0,
        payouts: payouts || []
    });
  });

  app.post("/api/referrals/claim", requireAuth, async (req, res) => {
    if (!supabase) return res.status(500).json({ error: "4x System Error" });
    const user = (req as any).user;
    const email = user.email;

    let { data, error: refError } = await supabase.from('referral_balances').select('*').eq('email', email).single();
    
    if (refError && refError.message.includes('find the table')) {
       const balance = runtimeReferralBalances[email]?.balance || 0;
       if (balance <= 0) return res.status(400).json({ error: "No balance to claim" });
       runtimePayouts.push({ id: crypto.randomUUID(), email: email, amount: balance, status: 'PENDING', created_at: new Date().toISOString() });
       return res.json({ success: true });
    }

    const balance = data?.balance || 0;
    
    if (balance <= 0) return res.status(400).json({ error: "No balance to claim" });
    
    const { error } = await supabase.from('payout_requests').insert([{ email: email, amount: balance }]);
    if (error) return res.status(500).json({ error: error.message });
    
    res.json({ success: true });
  });

  app.post("/api/support", async (req, res) => {
    if (!supabase) return res.status(500).json({ error: "4x System Error" });
    const { user_id, email, subject, message } = req.body;
    
    // We embed email in the message so admin knows who it's from since table may lack email column
    const enrichedMessage = email ? `Contact Email: ${email}\n\n${message}` : message;
    const payload: any = { subject, message: enrichedMessage };
    if (user_id) payload.user_id = user_id;

    const { error } = await supabase.from('support_tickets').insert([payload]);
    
    if (error) {
       console.error("Support insert error:", error);
       return res.status(500).json({ error: error.message });
    }
    res.json({ success: true });
  });

  app.get("/api/limits", (req, res) => {
    res.json(getLimits());
  });

  app.get("/api/admin/limits", async (req, res) => {
    res.json(getLimits());
  });

  app.post("/api/admin/limits", async (req, res) => {
    try {
      const freeDaily = Math.max(1, Math.min(9999, Math.round(Number(req.body?.freeDaily)) || 4));
      const proDaily = Math.max(1, Math.min(9999, Math.round(Number(req.body?.proDaily)) || 30));
      saveLimits({ freeDaily, proDaily });
      res.json({ success: true, ...getLimits() });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/admin/prompts", async (req, res) => {
    try {
      res.json(getPrompts());
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/admin/prompts", async (req, res) => {
    try {
      const { coach_system_instruction, signal_explainer_prompt } = req.body;
      if (!coach_system_instruction || !signal_explainer_prompt) {
        return res.status(400).json({ error: "Missing required prompt configurations" });
      }
      savePrompts({ coach_system_instruction, signal_explainer_prompt });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/admin/tickets/:id/mark-read", async (req, res) => {
    if (!supabase) return res.status(500).json({ error: "4x System Error" });
    const { id } = req.params;
    const { error } = await supabase.from('support_tickets').update({ status: 'READ' }).eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  app.get("/api/admin/payouts", async (req, res) => {
    if (!supabase) return res.status(500).json({ error: "4x System Error" });
    const { data, error } = await supabase.from('payout_requests').select('*').order('created_at', { ascending: false });
    if (error && error.message.includes('find the table')) {
       return res.json(runtimePayouts.sort((a,b) => b.created_at.localeCompare(a.created_at)));
    }
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  app.post("/api/admin/payouts/:id/mark-paid", async (req, res) => {
    if (!supabase) return res.status(500).json({ error: "4x System Error" });
    const { data: payout, error: payoutError } = await supabase.from('payout_requests').select('*').eq('id', req.params.id).single();
    
    if (payoutError && payoutError.message.includes('find the table')) {
       const p = runtimePayouts.find(x => x.id === req.params.id);
       if (!p) return res.status(404).json({ error: "Not found" });
       if (p.status !== 'PAID') {
          p.status = 'PAID';
          if (runtimeReferralBalances[p.email]) {
            runtimeReferralBalances[p.email].balance = Math.max(0, runtimeReferralBalances[p.email].balance - p.amount);
          }
       }
       return res.json({ success: true });
    }

    if (!payout) return res.status(404).json({ error: "Not found" });
    
    if (payout.status !== 'PAID') {
        const { error: updateError } = await supabase.from('payout_requests').update({ status: 'PAID' }).eq('id', req.params.id);
        const { data: refData } = await supabase.from('referral_balances').select('*').eq('email', payout.email).single();
        if (refData) {
            await supabase.from('referral_balances').update({ balance: Math.max(0, refData.balance - payout.amount) }).eq('email', payout.email);
        }
        res.json({ success: true });
    } else {
        res.json({ success: true });
    }
  });

  app.get("/api/admin/users", requireAdmin, async (req, res) => {
    if (!supabase) return res.status(500).json({ error: "4x System Error" });
    const authUsersRes = await supabase.auth.admin.listUsers();
    if (authUsersRes.error) return res.status(500).json({ error: authUsersRes.error.message });
    
    const { data: users } = await supabase.from('users').select('*');
    
    const combinedUsers = authUsersRes.data.users.map(u => {
       const matchingRecords = users?.filter(p =>
         p.id === u.id ||
         String(p.email || '').trim().toLowerCase() === String(u.email || '').trim().toLowerCase()
       ) || [];
       const userRecord = matchingRecords.reduce((best: any, candidate: any) => {
         if (!best) return candidate;
         return getCanonicalPlan(candidate) === 'PRO' || Number(candidate?.credits || 0) > Number(best?.credits || 0)
           ? candidate
           : best;
       }, null);
       return {
         ...userRecord,
         id: u.id,
         email: u.email,
         full_name: userRecord?.full_name || u.user_metadata?.full_name || '',
         avatar_url: userRecord?.avatar_url || u.user_metadata?.avatar_url || '',
         plan: getCanonicalPlan(userRecord),
         credits: userRecord?.credits || 0,
         is_admin: userRecord?.role === 'ADMIN',
         created_at: u.created_at,
       };
    });
    res.json(combinedUsers);
  });

  app.post("/api/admin/users/:id/plan", requireAdmin, async (req, res) => {
    if (!supabase) return res.status(500).json({ error: "4x System Error" });
    const { id } = req.params;
    const { plan } = req.body;
    const authUsersRes = await supabase.auth.admin.getUserById(id);
    if (authUsersRes.error || !authUsersRes.data.user?.email) return res.status(404).json({ error: "User not found" });
    const normalizedPlan = canonicalPlan(plan);
    const error = await updateUserSubscription(
      authUsersRes.data.user.email,
      normalizedPlan,
      normalizedPlan === 'FREE' ? 0 : undefined
    );
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  app.post("/api/admin/users/:id/delete", requireAdmin, async (req, res) => {
    if (!supabase) return res.status(500).json({ error: "4x System Error" });
    const { id } = req.params;
    const { data, error } = await supabase.auth.admin.deleteUser(id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  app.post("/api/chat", async (req, res) => {
    try {
      const { prompt, history } = req.body;
      
      const contents = history.map((msg: any) => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }]
      }));
      contents.push({ role: 'user', parts: [{ text: prompt }] });

      const prompts = getPrompts();

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents,
        config: {
          systemInstruction: prompts.coach_system_instruction,
        }
      });
      
      res.json({ success: true, text: response.text });
    } catch (e: any) {
      let errorMessage = 'Failed to get AI response';
      
      if (e.message && e.message.includes('429')) {
          errorMessage = '4xLifeAI Coach is currently experiencing high demand. Please try again in 1 minute.';
      } else if (e.status === 429) {
          errorMessage = '4xLifeAI Coach is currently experiencing high demand. Please try again in 1 minute.';
      } else if (e.message) {
          errorMessage = e.message;
      }

      res.status(500).json({ error: errorMessage });
    }
  });

  // AI Chart Analyzer Endpoint
  app.post("/api/chart-analyzer", async (req, res) => {
    try {
      const { imageBase64, chartType, imageBase64_2, timezone, timeframeImageBase64, timeframeImageBase64_2 } = req.body;
      
      if (!imageBase64) {
        return res.status(400).json({ error: "No image provided" });
      }

      const image1 = parseChartImage(imageBase64);
      const image2 = imageBase64_2 ? parseChartImage(imageBase64_2) : null;
      if (!image1 || (imageBase64_2 && !image2)) {
        return res.status(400).json({ error: 'Please upload chart images in PNG, JPEG, or WebP format.' });
      }
      const base64Data = image1.data;
      const base64Data2 = image2?.data || '';
      const timeframeImage1 = (timeframeImageBase64 && parseChartImage(timeframeImageBase64)) || image1;
      const timeframeImage2 = (timeframeImageBase64_2 && parseChartImage(timeframeImageBase64_2)) || image2;
      const chartHeaderData = await readVisibleChartHeaderData(ai, timeframeImage1, timeframeImage2);
      const visibleTimeframes = chartHeaderData;

      // Fetch the free Forex Factory high-impact calendar for the news bias
      const calendarEvents = await getEconomicCalendar();
      const tz = typeof timezone === 'string' && timezone ? timezone : undefined;
      const calendarBlock = buildCalendarPromptBlock(calendarEvents, tz);
      const chartHeaderNotice = `Focused chart-header OCR: IMAGE #1 timeframe=${chartHeaderData.image1 || 'UNREADABLE'}, active candle C=${chartHeaderData.image1Close || 'UNREADABLE'}; IMAGE #2 timeframe=${chartHeaderData.image2 || 'UNREADABLE'}, active candle C=${chartHeaderData.image2Close || 'UNREADABLE'}.`;
      
      const chartAnalyzerPrompt = `You are 4xLifeAI Chart Analyzer, an expert institutional price action analyst specialized in generating actionable trading signals.

HIGH-IMPACT ECONOMIC CALENDAR (red-folder events only, ${tz ? "times in the USER'S LOCAL time" : 'times in GMT/UTC'}):
${calendarBlock}
${chartHeaderNotice}

${base64Data2 ? `TWO-CHART MODE — TWO screenshots are attached:
IMAGE #1 (first image) = the primary chart.
IMAGE #2 (second image) = a second chart for the same instrument.
Read each timeframe from the visible label in the top-left chart header. For TradingView headers, “Euro / U.S. Dollar · 15 · Pepperstone” means 15M and “Euro / U.S. Dollar · 5 · Pepperstone” means 5M. Put both detected intervals in timeframe in image order, such as "15M/5M". Do not assume IMAGE #1 or IMAGE #2 has a particular timeframe.
` : `SINGLE-CHART MODE — read the timeframe from the visible label in the top-left chart header. For example, “Euro / U.S. Dollar · 15 · Pepperstone” means 15M. Put the detected interval in timeframe. Do not infer or assume a timeframe.`}Analyze the trading chart screenshot(s) using professional price action methodology.

IMPORTANT: Analyze every attached screenshot in full for structure, trend, support/resistance, stop loss, and setup. For Entry, use the exact C value reported by the focused chart-header OCR above for the screenshot with the lowest verified timeframe. The header's active-candle Close is the screenshot market price. Ignore horizontal drawings and all price-scale labels for Entry. Never substitute a live market quote.

Determine:
1. Trend (Bullish/Bearish/Range)
2. Market Structure (HH/HL/LH/LL or Neutral)
3. Support & Resistance levels
4. Momentum (Strong/Weak/Exhausted)
5. Setup Quality (Breakout/Pullback/Rejection/Continuation)
6. Trade Decision (BUY/SELL/WAIT)
7. Entry Type (BUY STOP/SELL STOP/IMMEDIATE BUY/IMMEDIATE SELL)
8. Entry Price (use the current-price marker from the screenshot with the lowest readable timeframe)
8. Stop Loss (beyond nearest swing)
9. TP1, TP2, TP3 at exactly 1R, 2R, and 3R, calculated only from Entry and Stop Loss
10. Risk:Reward ratio
11. Confidence Score (0-80%) — never return more than 80
12. Reasoning (why this trade exists)
13. Warnings (any risks to be aware of)
14. News Bias — use only upcoming high-impact red-folder events for today in the calendar above and only currencies that belong to the detected instrument. If there are no matching events, set newsHasEvent=false; never invent a news event.
15. Timeframe Alignment (ONLY when two charts are attached; otherwise tfStatus = "SINGLE")

NEWS BIAS RULES (use ONLY the calendar events above whose currency matches the detected pair):
- First detect the instrument's currencies (e.g. EURUSD → EUR + USD; XAUUSD/Gold → USD only).
- Pick the single most important upcoming or just-released high-impact event for those currencies. If none match, set newsHasEvent=false.
- Direction logic (how the number moves the currency, then the pair):
  * Actual BEATS forecast → that currency stronger. Actual MISSES forecast → that currency weaker.
  * If not yet released (actual PENDING), lean on Forecast vs Previous (much higher forecast = market expects a strong number = currency-positive bias).
  * Convert the currency effect into a pair direction (base up or quote up), then output BUY or SELL for the pair. Use NEUTRAL only when the calendar clearly implies no directional edge.
- newsProbability: 50-75 integer. Bigger forecast-vs-previous gap or a released beat/miss = higher number. Never above 75 (news is a lean, not a certainty).
- newsReason: ONE short sentence, plain English, scenario/lean language (e.g. "NFP forecast far above previous — a strong number would lift USD and pressure Gold"). Never promise ("will rise"). Never invent numbers not in the calendar.
- newsBigMove: true if the chosen event is still PENDING (not released) and within the next ~48h; otherwise false.
- newsEvent: short label like "NFP · Fri 3:30pm" (event name + day + time EXACTLY as shown in the calendar above).
- newsTime: copy the matching event's normalized UTC timestamp from the calendar data exactly. Never calculate it from the display label, user's timezone, or current time.

MULTI-CHART RULES (apply when two screenshots are attached):
- The server first reads the timeframe labels with a focused header OCR pass. If that pass cannot read a label, use the timeframe value you returned from the full chart analysis. You MUST copy each visible chart interval into timeframe in image order; never leave it empty or write "Unclear" when the label is readable.
- Describe chart 1 and chart 2 only; never refer to an unseen or assumed timeframe.
- Read the directional bias of each chart (bullish / bearish / range).
- tfStatus = "ALIGNED" if both charts lean the same direction; "CONFLICT" if they disagree (one bullish vs the other bearish, or one strongly trending vs the other reversing).
- If tfStatus = "CONFLICT": trade MUST be "WAIT", and warnings must state that the two charts disagree.
- Do not add a timeframe-alignment confidence bonus; the server applies it only after both visible labels are verified.
- When only one chart is attached: set tfStatus = "SINGLE", tfNote = "".

CRITICAL RULES FOR SIGNAL GENERATION:
- GENERATE ACTIONABLE SIGNALS: Return BUY/SELL when there is a clear trend, visible chart structure, and confluence of price action
- Only return WAIT if: (1) setup is genuinely unclear, (2) momentum is exhausted/reversal imminent, (3) price is in a true ranging market
- For strong trends with higher highs/lows: Return BUY if trend is bullish and structure is clear (breakout or pullback both valid)
- For strong downtrends with lower lows: Return SELL if trend is bearish and structure is clear (breakout or pullback both valid)
- Stop Loss must be beyond the nearest valid swing high/low
- Never place SL inside market noise
- ENTRY PRICE RULE: the server will set Entry from the focused header OCR's active candle C value for the image with the lowest verified timeframe. Do not replace that value with a horizontal drawing, price-scale label, trigger price, support/resistance, or live quote. A pending trigger belongs only in triggerPrice.
- If the focused header OCR cannot read the active candle C value, the server sets Entry and risk targets to N/A and forces WAIT. Never infer or invent the current price.
- ENTRY TYPE RULE: use BUY STOP or SELL STOP only to describe a separate pending trigger, and put that trigger in triggerPrice. Use IMMEDIATE BUY or IMMEDIATE SELL when the screenshot shows a completed directional close and price remains near the valid setup. The Entry field still remains the screenshotMarketPrice.
- Avoid entries directly AT support/resistance; better entries are fresh breakouts or pullbacks to key levels
- Never place SL inside market noise
- Confidence is a setup-strength score, not a win-rate or profit probability. It must be an integer from 0 to 80; never return more than 80. Use: Strong clear setups = 70-80, Decent setups = 60-69, Ambiguous = 40-59, Unclear = 0-39.

Return the analysis in this exact JSON format:
{
  "instrument": "detected pair",
  "timeframe": "detected TF",
  "trend": "Bullish/Bearish/Range",
  "marketStructure": "description",
  "support": "price level",
  "resistance": "price level",
  "trade": "BUY/SELL/WAIT",
  "entryType": "BUY STOP/SELL STOP/IMMEDIATE BUY/IMMEDIATE SELL/WAITING",
  "triggerPrice": "price or empty",
  "screenshotMarketPrice": "visible screenshot price for reference or N/A",
  "entry": "same as screenshotMarketPrice",
  "stopLoss": "price",
  "tp1": "price",
  "tp2": "price",
  "tp3": "price",
  "riskReward": "ratio",
  "confidence": number,
  "reasoning": "explanation",
  "warnings": "risks",
  "newsHasEvent": true/false,
      "newsEvent": "short event label with day and time, or empty string",
  "newsTime": "ISO timestamp for the event in UTC, or empty string",
  "newsPrediction": "BUY/SELL/NEUTRAL",
  "newsProbability": number,
  "newsReason": "one short scenario sentence, or empty string",
  "newsBigMove": true/false,
  "tfStatus": "ALIGNED/CONFLICT/SINGLE",
  "tfNote": "one short sentence, or empty string"
}`;
      
      const parts: any[] = [
        { text: chartAnalyzerPrompt },
        { inlineData: { mimeType: image1.mimeType, data: base64Data } }
      ];
      if (image2) parts.push({ inlineData: { mimeType: image2.mimeType, data: base64Data2 } });

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{
          role: 'user',
          parts
        }],
        config: {
          temperature: 0.3,
          responseMimeType: 'application/json'
        }
      });
      
      const analysisText = response.text;
      let analysis;
      
      try {
        analysis = JSON.parse(analysisText);
      } catch (e) {
        // If the analysis provider didn't return pure JSON, extract it
        const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          analysis = JSON.parse(jsonMatch[0]);
        } else {
          analysis = {
            instrument: "Unknown",
            timeframe: "Unknown",
            trend: "Unable to determine",
            marketStructure: "Analysis failed to parse",
            support: "N/A",
            resistance: "N/A",
            trade: "WAIT",
            entry: "N/A",
            stopLoss: "N/A",
            tp1: "N/A",
            tp2: "N/A",
            tp3: "N/A",
            riskReward: "N/A",
            confidence: 0,
            reasoning: analysisText,
            warnings: "Could not parse structured response"
          };
        }
      }
      
      if (analysis && typeof analysis === 'object') {
        const eventCurrencies = pairCurrencies(normalizePair(String(analysis.instrument || '')));
        const relevantEvents = getUpcomingHighImpactEvents(calendarEvents, eventCurrencies, tz);
        const matchedNewsTime = analysis.newsEvent
          ? matchCalendarEvent(calendarEvents, String(analysis.newsEvent), eventCurrencies, tz)
          : null;
        const selectedNewsTime = matchedNewsTime || relevantEvents[0]?.timestamp || null;
        analysis.newsTime = selectedNewsTime;
        analysis.newsHasEvent = Boolean(selectedNewsTime);
        analysis.newsStatus = !isEconomicCalendarAvailable()
          ? 'UNAVAILABLE'
          : !analysis.newsHasEvent
            ? 'NO_HIGH_IMPACT'
            : matchedNewsTime
              ? 'HIGH_IMPACT'
              : 'HIGH_IMPACT_UNASSESSED';
        if (!analysis.newsHasEvent) {
          analysis.newsEvent = '';
          analysis.newsTime = null;
          analysis.newsReason = '';
          analysis.newsProbability = undefined;
          analysis.newsBigMove = false;
        } else if (!matchedNewsTime) {
          const nextEvent = relevantEvents[0];
          analysis.newsEvent = nextEvent.event.title;
          analysis.newsPrediction = 'NEUTRAL';
          analysis.newsReason = 'A high-impact event is scheduled for this pair today, but no reliable directional news bias was available.';
          analysis.newsProbability = undefined;
          analysis.newsBigMove = new Date(nextEvent.timestamp).getTime() - Date.now() <= 48 * 60 * 60 * 1000;
        }
        const pred = String(analysis.newsPrediction || '').toUpperCase();
        analysis.newsPrediction = pred === 'BUY' || pred === 'SELL' ? pred : 'NEUTRAL';
        const prob = Number(analysis.newsProbability);
        analysis.newsProbability = analysis.newsHasEvent && isFinite(prob)
          ? Math.max(50, Math.min(75, Math.round(prob)))
          : undefined;
        analysis.newsBigMove = analysis.newsHasEvent && analysis.newsBigMove === true;

        const analysisTimeframes = normalizeAnalysisTimeframes(analysis.timeframe);
        const verifiedImage1 = visibleTimeframes.image1 || analysisTimeframes.image1;
        const verifiedImage2 = base64Data2 ? visibleTimeframes.image2 || analysisTimeframes.image2 : null;
        const verifiedTimeframes = new Set([verifiedImage1, verifiedImage2].filter((timeframe): timeframe is string => Boolean(timeframe)));
        const image1Timeframe = verifiedImage1 || 'Unclear';
        const image2Timeframe = verifiedImage2 || 'Unclear';
        analysis.timeframe = base64Data2
          ? `${image1Timeframe}/${image2Timeframe}`
          : image1Timeframe;

        let screenshotMarketPrice: string | null = chartHeaderData.image1Close;
        if (base64Data2) {
          const image1Minutes = timeframeMinutes(chartHeaderData.image1);
          const image2Minutes = timeframeMinutes(chartHeaderData.image2);
          screenshotMarketPrice = image1Minutes !== null && image2Minutes !== null
            ? image1Minutes <= image2Minutes ? chartHeaderData.image1Close : chartHeaderData.image2Close
            : null;
        }
        const modelEntry = normalizeVisiblePrice(analysis.entry);
        const modelScreenshotPrice = normalizeVisiblePrice(analysis.screenshotMarketPrice);
        const currentEntry = screenshotMarketPrice === null ? null : Number(screenshotMarketPrice);
        analysis.screenshotMarketPrice = screenshotMarketPrice || 'N/A';
        analysis.entry = screenshotMarketPrice || 'N/A';

        if (currentEntry === null) {
          analysis.trade = 'WAIT';
          analysis.stopLoss = 'N/A';
          analysis.tp1 = 'N/A';
          analysis.tp2 = 'N/A';
          analysis.tp3 = 'N/A';
          analysis.riskReward = 'N/A';
          analysis.warnings = `Entry blocked: the active candle C value was not clearly readable in the focused header of the lowest-timeframe chart. ${analysis.warnings || ''}`.trim();
        } else {
          const stopLossText = normalizeVisiblePrice(analysis.stopLoss);
          const stopLoss = stopLossText === null ? null : Number(stopLossText);
          const requestedDirection = String(analysis.trade || '').toUpperCase();
          const targetDirection = requestedDirection === 'BUY' || requestedDirection === 'SELL'
            ? requestedDirection
            : stopLoss !== null && stopLoss > currentEntry ? 'SELL' : 'BUY';
          const stopIsValid = stopLoss !== null && (targetDirection === 'BUY' ? stopLoss < currentEntry : stopLoss > currentEntry);

          if (!stopIsValid) {
            analysis.trade = 'WAIT';
            analysis.stopLoss = stopLossText || 'N/A';
            analysis.tp1 = 'N/A';
            analysis.tp2 = 'N/A';
            analysis.tp3 = 'N/A';
            analysis.riskReward = 'N/A';
            analysis.warnings = `Entry blocked: the chart-based Stop Loss is missing, equal to Entry, or on the wrong side of the current screenshot price. ${analysis.warnings || ''}`.trim();
          } else {
            analysis.stopLoss = stopLossText;
            const targets = calculateRTargets(targetDirection, currentEntry, stopLoss, analysis.instrument);
            analysis.tp1 = targets.tp1;
            analysis.tp2 = targets.tp2;
            analysis.tp3 = targets.tp3;
            analysis.riskReward = '1:3';
            if (modelEntry !== screenshotMarketPrice || modelScreenshotPrice !== screenshotMarketPrice) {
              analysis.warnings = `Entry corrected from the model's estimate to the focused OHLC C price ${screenshotMarketPrice}; all R targets were recalculated from this exact screenshot Entry and Stop Loss. ${analysis.warnings || ''}`.trim();
            }
          }
        }

        for (const field of ['trend', 'marketStructure', 'reasoning', 'warnings']) {
          if (typeof analysis[field] === 'string') {
            analysis[field] = sanitizeUnverifiedTimeframes(analysis[field], verifiedTimeframes)
              || 'Analysis is limited to what is clearly visible in the uploaded screenshot(s).';
          }
        }
        const modelTfStatus = String(analysis.tfStatus || '').toUpperCase();
        const bothTimeframesVerified = Boolean(base64Data2 && verifiedImage1 && verifiedImage2);
        analysis.tfStatus = bothTimeframesVerified && (modelTfStatus === 'ALIGNED' || modelTfStatus === 'CONFLICT')
          ? modelTfStatus
          : 'SINGLE';
        analysis.tfNote = analysis.tfStatus === 'ALIGNED'
          ? `The ${visibleTimeframes.image1} and ${visibleTimeframes.image2} screenshots show aligned directional structure.`
          : analysis.tfStatus === 'CONFLICT'
            ? `The ${visibleTimeframes.image1} and ${visibleTimeframes.image2} screenshots show conflicting directional structure.`
            : '';

        // Dual-timeframe safety: a conflict always blocks entry, whatever the analysis returns
        analysis.confidence = Math.min(80, Math.max(0, Number(analysis.confidence) || 0));
        if (analysis.tfStatus === 'CONFLICT') {
          if (String(analysis.trade || '').toUpperCase() !== 'WAIT') analysis.trade = 'WAIT';
          analysis.warnings = `The two timeframes disagree — entry blocked. ${analysis.warnings || ''}`;
        }
        if (analysis.confidence < 65 && String(analysis.trade || '').toUpperCase() !== 'WAIT') {
          analysis.trade = 'WAIT';
          analysis.warnings = `Confidence below 65 — setup is too weak to publish. ${analysis.warnings || ''}`;
        }
        const trade = String(analysis.trade || '').toUpperCase();
        const entryType = String(analysis.entryType || '').toUpperCase();
        analysis.entryType = trade === 'BUY'
          ? (entryType === 'IMMEDIATE BUY' || entryType === 'BUY STOP' ? entryType : 'BUY STOP')
          : trade === 'SELL'
            ? (entryType === 'IMMEDIATE SELL' || entryType === 'SELL STOP' ? entryType : 'SELL STOP')
            : 'WAITING';
      }

      const direction = String(analysis.trade || '').toUpperCase();
      const requestedEntryType = String(analysis.entryType || '').toUpperCase();
      const hasCompletedConfirmation = requestedEntryType === 'IMMEDIATE BUY' || requestedEntryType === 'IMMEDIATE SELL';

      if (direction === 'BUY' || direction === 'SELL') {
        if (!hasCompletedConfirmation) {
          analysis.entryType = direction === 'BUY' ? 'BUY STOP' : 'SELL STOP';
          analysis.status = Number(analysis.confidence) >= 65 ? 'PLANNED' : 'WAITING';
          analysis.triggerPrice = analysis.triggerPrice || analysis.resistance || analysis.support || '';
          analysis.warnings = `Waiting for a confirmed directional close beyond the visible breakout/breakdown trigger before entry. ${analysis.warnings || ''}`.trim();
        }
      } else {
        analysis.entryType = 'WAITING';
        analysis.status = 'WAITING';
      }


      res.json({ success: true, analysis });
    } catch (e: any) {
      let errorMessage = 'Failed to analyze chart';
      
      if (e.message && e.message.includes('429')) {
        errorMessage = 'Chart Analyzer is currently experiencing high demand. Please try again in 1 minute.';
      } else if (e.status === 429) {
        errorMessage = 'Chart Analyzer is currently experiencing high demand. Please try again in 1 minute.';
      } else if (e.message) {
        errorMessage = e.message;
      }

      res.status(500).json({ error: errorMessage });
    }
  });

  // Admin manual signal routes
  app.post("/api/admin/manual-signal/analyze", requireAdmin, async (req, res) => {
    try {
      const { imageBase64, imageBase64_2, pair, timezone } = req.body;
      if (!imageBase64) return res.status(400).json({ error: 'No image provided' });
      const normalizedPair = normalizePair(pair);
      if (!APPROVED_PAIRS.includes(normalizedPair)) return res.status(400).json({ error: `Invalid pair: ${pair || 'missing'}` });

      const analyzerResponse = await fetch(`${req.protocol}://${req.get('host')}/api/chart-analyzer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}),
        },
        body: JSON.stringify({ imageBase64, imageBase64_2, timezone, chartType: normalizedPair }),
      });
      const data = await analyzerResponse.json();
      if (!analyzerResponse.ok || !data.success) {
        return res.status(analyzerResponse.status || 500).json({ error: data.error || 'Failed to analyze screenshot' });
      }
      res.json(data);
    } catch (e: any) {
      console.error('[manual-signal/analyze] error:', e);
      res.status(500).json({ error: e.message || 'Failed to analyze screenshot' });
    }
  });

  app.post("/api/admin/manual-signal/send", requireAdmin, async (req, res) => {
    try {
      const { pair, analysis } = req.body;
      if (!pair || !analysis) return res.status(400).json({ error: 'Missing pair or analysis' });
      const normalizedPair = normalizePair(pair || analysis.instrument);
      const detectedPair = normalizePair(analysis.instrument);
      const finalPair = APPROVED_PAIRS.includes(normalizedPair) ? normalizedPair : detectedPair;
      if (!APPROVED_PAIRS.includes(finalPair)) return res.status(400).json({ error: `Invalid pair: ${pair || analysis.instrument || 'missing'}` });

      const trade = String(analysis.trade || '').toUpperCase();
      if (trade !== 'BUY' && trade !== 'SELL') {
        return res.status(400).json({ error: `Cannot send WAIT signal: ${analysis.trade}` });
      }

      const result = await publishManualSignal(analysis, finalPair);
      if (!result.ok) return res.status(400).json({ error: result.error });
      res.json({ success: true, signal: result.signal });
    } catch (e: any) {
      console.error('[manual-signal/send] error:', e);
      res.status(500).json({ error: e.message || 'Failed to publish manual signal' });
    }
  });

  // Admin Signal Builder routes
  app.get("/api/admin/signal-builder/drafts", requireAdmin, async (req, res) => {
    try {
      const user = (req as any).user;
      const result = await listDrafts(String(user?.email || ''));
      if (!result.ok) return res.status(500).json({ error: result.error });
      res.json({ success: true, drafts: result.drafts });
    } catch (e: any) {
      console.error('[signal-builder/drafts] error:', e);
      res.status(500).json({ error: e.message || 'Failed to load drafts' });
    }
  });

  app.post("/api/admin/signal-builder/drafts", requireAdmin, async (req, res) => {
    try {
      const user = (req as any).user;
      const result = await saveDraft(String(user?.email || ''), req.body);
      if (!result.ok) return res.status(500).json({ error: result.error });
      res.json({ success: true, draft: result.draft });
    } catch (e: any) {
      console.error('[signal-builder/drafts save] error:', e);
      res.status(500).json({ error: e.message || 'Failed to save draft' });
    }
  });

  app.delete("/api/admin/signal-builder/drafts/:id", requireAdmin, async (req, res) => {
    try {
      const user = (req as any).user;
      const result = await deleteDraft(req.params.id, String(user?.email || ''));
      if (!result.ok) return res.status(500).json({ error: result.error });
      res.json({ success: true });
    } catch (e: any) {
      console.error('[signal-builder/drafts delete] error:', e);
      res.status(500).json({ error: e.message || 'Failed to delete draft' });
    }
  });

  app.post("/api/admin/signal-builder/preview", requireAdmin, async (req, res) => {
    try {
      const { score, breakdown } = calculateConfidence(req.body);
      const reason = generateReason(req.body);
      res.json({ success: true, confidence: score, breakdown, reason });
    } catch (e: any) {
      console.error('[signal-builder/preview] error:', e);
      res.status(500).json({ error: e.message || 'Failed to preview' });
    }
  });

  app.post("/api/admin/signal-builder/news-predict", requireAdmin, async (req, res) => {
    try {
      const { pair, direction, timezone } = req.body || {};
      if (!pair || !direction) return res.status(400).json({ error: 'Pair and direction required' });
      const events = await getEconomicCalendar();
      const result = await predictNewsFromCalendar(String(pair), String(direction) as 'BUY' | 'SELL', events, timezone ? String(timezone) : undefined);
      if ('error' in result) return res.status(500).json({ error: result.error });
      res.json({ success: true, prediction: result });
    } catch (e: any) {
      console.error('[signal-builder/news-predict] error:', e);
      res.status(500).json({ error: e.message || 'News prediction failed' });
    }
  });

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

  app.post("/api/admin/signal-builder/analyze-chart", requireAdmin, upload.single('image'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'Chart image required' });
      const { pair, timeframe } = req.body || {};
      const result = await analyzeChartWithGemini(req.file.buffer, pair ? String(pair) : undefined, timeframe ? String(timeframe) : undefined);
      if ('error' in result) return res.status(500).json({ error: result.error });
      res.json({ success: true, suggestion: result });
    } catch (e: any) {
      console.error('[signal-builder/analyze-chart] error:', e);
      res.status(500).json({ error: e.message || 'Chart analysis failed' });
    }
  });

  app.post("/api/admin/signal-builder/publish", requireAdmin, async (req, res) => {
    try {
      const user = (req as any).user;
      const result = await publishBuiltSignal(req.body, String(user?.email || ''));
      if (!result.ok) return res.status(400).json({ error: result.error });
      res.json({ success: true, signal: result.signal });
    } catch (e: any) {
      console.error('[signal-builder/publish] error:', e);
      res.status(500).json({ error: e.message || 'Failed to publish signal' });
    }
  });

  app.get("/api/admin/signal-builder/history", requireAdmin, async (req, res) => {
    try {
      const result = await listAdminSignals(200);
      if (!result.ok) return res.status(500).json({ error: result.error });
      res.json({ success: true, signals: result.signals });
    } catch (e: any) {
      console.error('[signal-builder/history] error:', e);
      res.status(500).json({ error: e.message || 'Failed to load history' });
    }
  });

  // ---- Copilot Signal: paste TradingView Copilot analysis → extract → review → publish ----

  app.post("/api/admin/copilot-signal/analyze", requireAdmin, async (req, res) => {
    try {
      const text = String(req.body?.text || '').trim();
      if (!text) return res.status(400).json({ error: 'Paste the complete Copilot analysis first.' });
      const extraction = extractCopilotSignal(text);
      const validation = validateCopilotSignal(extraction);
      const understood = Boolean(extraction.pair || extraction.direction || extraction.entry || extraction.sl);
      if (!understood) {
        return res.status(422).json({
          error: 'Could not reliably extract a signal.',
          hint: 'Please check that the complete Copilot analysis was pasted.',
          extraction,
          missing: validation.missing,
        });
      }
      res.json({ success: true, extraction, missing: validation.missing });
    } catch (e: any) {
      console.error('[copilot-signal/analyze] error:', e);
      res.status(500).json({ error: e.message || 'Failed to analyze pasted text' });
    }
  });

  app.post("/api/admin/copilot-signal/publish", requireAdmin, async (req, res) => {
    try {
      if (!supabase) return res.status(503).json({ error: "Database unavailable" });
      const adminEmail = String((req as any).user?.email || '');
      const payload = req.body?.extraction || {};
      const originalCopilotText = String(req.body?.originalText || '');

      const candidate = {
        pair: String(payload.pair || '').trim(),
        timeframe: String(payload.timeframe || '').trim(),
        direction: payload.direction,
        signalType: payload.signalType,
        entry: Number(payload.entry),
        trigger: payload.trigger ? String(payload.trigger) : undefined,
        triggerPrice: payload.triggerPrice != null ? Number(payload.triggerPrice) : undefined,
        sl: Number(payload.sl),
        tp1: payload.tp1 != null && payload.tp1 !== '' ? Number(payload.tp1) : undefined,
        tp2: payload.tp2 != null && payload.tp2 !== '' ? Number(payload.tp2) : undefined,
        tp3: payload.tp3 != null && payload.tp3 !== '' ? Number(payload.tp3) : undefined,
        confidence: payload.confidence != null && payload.confidence !== '' ? Number(payload.confidence) : undefined,
        trend: payload.trend ? String(payload.trend) : undefined,
        strategy: String(payload.strategy || '').trim(),
        reason: payload.reason ? String(payload.reason) : undefined,
        status: payload.status,
      };

      const pair = candidate.pair.toUpperCase().replace(/[^A-Z0-9]/g, '');
      const validation = validateCopilotSignal({ ...candidate, pair });
      if (!validation.ok) {
        return res.status(400).json({ error: 'SIGNAL INCOMPLETE — missing: ' + validation.missing.join(', '), missing: validation.missing });
      }

      const isStop = candidate.signalType === 'BUY STOP' || candidate.signalType === 'SELL STOP';
      const dbStatus = isStop ? 'WAITING_TRIGGER' : 'LIVE';
      const confidence = Math.min(80, Math.max(0, Math.round(candidate.confidence)));
      const tier = confidence >= 75 ? 'Strong' : confidence >= 70 ? 'Good' : confidence >= 65 ? 'Valid' : 'Reject';
      const now = new Date().toISOString();
      const isLong = candidate.direction === 'BUY';

      const signalPayload: any = {
        id: randomUUID(),
        pair,
        direction: candidate.direction,
        bias: isLong ? 'BULLISH' : 'BEARISH',
        score: confidence,
        tier,
        confidence: Math.min(10, Math.max(1, Math.round(confidence / 10))),
        entry: candidate.entry,
        entry_price: candidate.entry,
        sl: candidate.sl,
        original_sl: candidate.sl,
        tp1: candidate.tp1 ?? null,
        tp2: candidate.tp2 ?? null,
        tp3: candidate.tp3 ?? null,
        timeframe: candidate.timeframe,
        signal_type: candidate.signalType,
        trigger_price: candidate.triggerPrice ?? null,
        trend: candidate.trend ?? null,
        strategy: candidate.strategy,
        analysis_reason: candidate.reason ?? null,
        original_copilot_text: originalCopilotText,
        created_at: now,
        timestamp: now,
        status: dbStatus,
        is_active: true,
        result: null,
        pips_won: null,
        pips_lost: null,
      };

      // Close any previous active signal for this pair, matching the existing publish flow.
      await supabase
        .from('signals')
        .update({ status: 'CLOSED', is_active: false, closed_at: now, result: 'CANCELLED' })
        .eq('pair', pair)
        .in('status', ['LIVE', 'TP1_HIT', 'TP2_HIT'])
        .eq('is_active', true);

      const { data: inserted, error: insertError } = await supabase.from('signals').insert([signalPayload]).select('*').maybeSingle();
      if (insertError) {
        if (/signal_type|trigger_price|original_copilot_text|timeframe|strategy|schema cache/i.test(insertError.message)) {
          return res.status(503).json({ error: 'Database migration required: apply copilot-signal-migration.sql (and required-migrations.sql) to Supabase before publishing Copilot signals.' });
        }
        return res.status(500).json({ error: insertError.message });
      }

      // Notify both Telegram channels, consistent with the rest of the platform.
      let telegramSent = false;
      try {
        const emoji = isLong ? '🟢' : '🔴';
        const tpLines = [
          candidate.tp1 != null ? `TP1: ${candidate.tp1}` : null,
          candidate.tp2 != null ? `TP2: ${candidate.tp2}` : null,
          candidate.tp3 != null ? `TP3: ${candidate.tp3}` : null,
        ].filter(Boolean).join('\n');
        telegramSent = await sendTelegramToVipAndFree(
          `${emoji} <b>4xLifeAI SIGNAL</b>\n\n`
          + `Pair: ${pair}\n`
          + `Signal: ${candidate.signalType}\n`
          + `Timeframe: ${candidate.timeframe}\n\n`
          + `Entry: ${candidate.entry}\n`
          + (isStop && candidate.trigger ? `Trigger: ${candidate.trigger}\n` : '')
          + `SL: ${candidate.sl}\n`
          + `${tpLines}\n`
          + `Confidence: ${confidence}/80\n`
          + `Strategy: ${candidate.strategy}\n\n`
          + `Status: ${isStop ? 'WAITING FOR TRIGGER' : 'ACTIVE'}`,
        );
      } catch (telegramError: any) {
        console.error('[copilot-signal/publish] telegram notification failed:', telegramError?.message || telegramError);
      }

      const { MANUAL_OVERRIDE_PAIRS } = await import('./server/scanner.js');
      MANUAL_OVERRIDE_PAIRS.add(pair);

      res.json({ success: true, signal: inserted || signalPayload, telegramSent });
    } catch (e: any) {
      console.error('[copilot-signal/publish] error:', e);
      res.status(500).json({ error: e.message || 'Failed to publish signal' });
    }
  });

  app.post("/api/admin/copilot-signal/:id/status", requireAdmin, async (req, res) => {
    try {
      if (!supabase) return res.status(503).json({ error: "Database unavailable" });
      const requested = String(req.body?.status || '').toUpperCase();
      const allowed: Record<string, { status: string; isActive: boolean; result: string | null }> = {
        'WAITING FOR TRIGGER': { status: 'WAITING_TRIGGER', isActive: true, result: null },
        'ACTIVE': { status: 'LIVE', isActive: true, result: null },
        'TP1 HIT': { status: 'TP1_HIT', isActive: true, result: null },
        'TP2 HIT': { status: 'TP2_HIT', isActive: true, result: null },
        'TP3 HIT': { status: 'TP3_HIT', isActive: false, result: 'TP3' },
        'SL HIT': { status: 'STOP_LOSS_HIT', isActive: false, result: 'SL' },
        'CANCELLED': { status: 'CLOSED', isActive: false, result: 'CANCELLED' },
        'EXPIRED': { status: 'CLOSED', isActive: false, result: 'EXPIRED' },
      };
      const mapped = allowed[requested];
      if (!mapped) return res.status(400).json({ error: 'Invalid status. Allowed: ' + Object.keys(allowed).join(', ') });
      const now = new Date().toISOString();
      const update: any = { status: mapped.status, is_active: mapped.isActive, updated_at: now };
      if (!mapped.isActive) {
        update.closed_at = now;
        update.result = mapped.result;
      }
      const { data: updated, error } = await supabase.from('signals').update(update).eq('id', req.params.id).select('*').maybeSingle();
      if (error) return res.status(500).json({ error: error.message });
      if (!updated) return res.status(404).json({ error: 'Signal not found' });
      res.json({ success: true, signal: updated });
    } catch (e: any) {
      console.error('[copilot-signal/status] error:', e);
      res.status(500).json({ error: e.message || 'Failed to update status' });
    }
  });

  app.post("/api/admin/signals/:id/move-sl-to-entry", requireAdmin, async (req, res) => {
    try {
      if (!supabase) return res.status(503).json({ error: "Database unavailable" });
      const { data: signal, error: readError } = await supabase
        .from("signals")
        .select("id,status,is_active,pair,direction,entry_price,sl,original_sl,tp1,tp2,tp3,breakeven_at")
        .eq("id", req.params.id)
        .maybeSingle();
      if (readError) {
        if (readError.message.includes("breakeven_at") || readError.message.includes("schema cache")) {
          return res.status(503).json({ error: "Database migration required: add signals.breakeven_at before enabling break-even protection." });
        }
        return res.status(500).json({ error: readError.message });
      }
      if (!signal || signal.is_active === false) return res.status(404).json({ error: "Active signal not found" });
      if (signal.breakeven_at) return res.json({ success: true, signal, alreadyActive: true, telegramSent: null });

      const entry = Number(signal.entry_price);
      const direction = signal.direction === "BUY" || signal.direction === "LONG" ? "BUY" : "SELL";
      const currentStop = Number(signal.sl);
      if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(currentStop) || currentStop <= 0) {
        return res.status(400).json({ error: "Signal Entry or Stop Loss is invalid" });
      }
      const wouldLoosenStop = direction === "BUY" ? currentStop > entry : currentStop < entry;
      if (wouldLoosenStop) return res.status(409).json({ error: "The current Stop Loss is already beyond Entry; refusing to reduce protection." });
      const activatedAt = new Date().toISOString();
      const { data: updated, error: updateError } = await supabase
        .from("signals")
        .update({ sl: entry, original_sl: signal.original_sl ?? signal.sl, breakeven_at: activatedAt })
        .eq("id", req.params.id)
        .eq("sl", signal.sl)
        .eq("is_active", true)
        .is("breakeven_at", null)
        .select("*")
        .maybeSingle();
      if (updateError) {
        if (updateError.message.includes("breakeven_at") || updateError.message.includes("schema cache")) {
          return res.status(503).json({ error: "Database migration required: add signals.breakeven_at before enabling break-even protection." });
        }
        return res.status(500).json({ error: updateError.message });
      }
      if (!updated) return res.status(409).json({ error: "Signal was updated or closed. Refresh and try again." });

      let telegramSent = false;
      try {
        telegramSent = await sendTelegramToVipAndFree(
          `🛡️ <b>4xFiveAI — STOP MOVED TO ENTRY</b>\n\n`
          + `Pair: ${signal.pair}\n`
          + `Signal: ${direction}\n`
          + `Entry: ${entry}\n`
          + `New Stop Loss: ${entry}\n`
          + `TP1: ${signal.tp1 ?? "N/A"}\n`
          + `TP2: ${signal.tp2 ?? "N/A"}\n`
          + `TP3: ${signal.tp3 ?? "N/A"}\n\n`
          + `Signal remains active. Monitoring for a return to Entry.`,
        );
      } catch (telegramError: any) {
        console.error("[admin/move-sl-to-entry] telegram update failed:", telegramError?.message || telegramError);
      }
      res.json({ success: true, signal: updated, telegramSent });
    } catch (error: any) {
      console.error("[admin/move-sl-to-entry] failed:", error?.message || error);
      res.status(500).json({ error: error?.message || "Failed to move Stop Loss to Entry" });
    }
  });

  app.post("/api/admin/signals/:id/mark-tp", requireAdmin, async (req, res) => {
    try {
      if (!supabase) return res.status(503).json({ error: "Database unavailable" });
      const level = String(req.body?.level || req.body?.tp_level || "").toUpperCase();
      if (!["SL", "TP1", "TP2", "TP3", "BE", "BREAKEVEN"].includes(level)) return res.status(400).json({ error: "Invalid target" });
      const { data: signal, error: readError } = await supabase.from("signals").select("id,status,is_active,pair,direction,entry_price,sl,tp1,tp2,tp3,pips_won,pips_lost").eq("id", req.params.id).maybeSingle();
      if (readError) return res.status(500).json({ error: readError.message });
      if (!signal || signal.is_active === false) return res.status(404).json({ error: "Active signal not found" });
      const now = new Date().toISOString();
      if (level === "TP1" && ["TP1_HIT", "TP2_HIT", "TP3_HIT"].includes(signal.status)) {
        return res.json({ success: true, signal, alreadySecured: true });
      }
      if (["BE", "BREAKEVEN"].includes(level)) {
        if (!["TP1_HIT", "TP2_HIT"].includes(signal.status)) return res.status(400).json({ error: "Break-even requires TP1 or TP2 secured" });
        const targetPrice = signal.status === "TP2_HIT" ? signal.tp2 : signal.tp1;
        const pipMultiplier = ["XAUUSD", "XAGUSD"].includes(String(signal.pair).toUpperCase()) ? 0.1 : (String(signal.pair).toUpperCase().includes("JPY") ? 0.01 : 0.0001);
        const securedPips = Math.abs(Number(targetPrice) - Number(signal.entry_price)) / pipMultiplier;
        const update = {
          status: "CLOSED",
          is_active: false,
          result: "TP1_SECURED_BE",
          pips_won: securedPips,
          pips_lost: 0,
          closed_at: now,
        };
        const { data: updated, error: updateError } = await supabase.from("signals").update(update).eq("id", req.params.id).eq("is_active", true).select("*").maybeSingle();
        if (updateError) return res.status(500).json({ error: updateError.message });
        if (!updated) return res.status(409).json({ error: "Signal was already closed" });
        await sendTelegramToVipAndFree(
          `🛡️ <b>4xFiveAI — BREAK-EVEN CLOSED</b> ✅\n\n`
          + `Pair: ${signal.pair}\n`
          + `Signal: ${signal.direction === "BUY" || signal.direction === "LONG" ? "🟢 BUY" : "🔴 SELL"}\n`
          + `TP${signal.status === "TP2_HIT" ? "2" : "1"} secured: ${targetPrice} 🎯\n`
          + `Entry protected: ${signal.entry_price} 🛡️\n`
          + `Secured profit: +${securedPips.toFixed(1)} pips 💰\n`
          + `Remaining position: closed at break-even`,
        ).catch((telegramError) => console.error("[TELEGRAM] break-even notification failed:", telegramError));
        return res.json({ success: true, signal: updated });
      }
      if (level === "SL" && ["TP1_HIT", "TP2_HIT", "TP3_HIT"].includes(signal.status)) {
        return res.json({ success: true, signal, protectedByTarget: true });
      }
      const nextStatus = level === "SL" ? "STOP_LOSS_HIT" : level === "TP1" ? "TP1_HIT" : level === "TP2" ? "TP2_HIT" : "TP3_HIT";
      const isLong = signal.direction === "BUY" || signal.direction === "LONG";
      const pipMultiplier = ["XAUUSD", "XAGUSD"].includes(String(signal.pair).toUpperCase()) ? 0.1 : (String(signal.pair).toUpperCase().includes("JPY") ? 0.01 : 0.0001);
      const targetPrice = level === "SL" ? signal.sl : level === "TP1" ? signal.tp1 : level === "TP2" ? signal.tp2 : signal.tp3;
      const targetPips = Math.abs(Number(targetPrice) - Number(signal.entry_price)) / pipMultiplier;
      const update: Record<string, any> = {
        status: nextStatus,
        is_active: level === "TP3" || level === "SL" ? false : true,
        result: level === "SL" ? "LOSS" : level === "TP3" ? "WIN" : "PARTIAL WIN",
      };
      if (level === "TP1") update.tp1_hit_at = now;
      if (level === "TP2") update.tp2_hit_at = now;
      if (level === "TP3") update.tp3_hit_at = now;
      if (level === "TP3" || level === "SL") update.closed_at = now;
      if (level !== "SL") {
        update.pips_won = targetPips;
        update.pips_lost = 0;
      } else {
        update.pips_lost = targetPips;
      }
      const { data: updated, error: updateError } = await supabase.from("signals").update(update).eq("id", req.params.id).eq("is_active", true).select("*").maybeSingle();
      if (updateError) return res.status(500).json({ error: updateError.message });
      if (!updated) return res.status(409).json({ error: "Signal was already updated" });
      const eventIcon = level === "SL" ? "🛑" : level === "TP1" ? "🎯" : level === "TP2" ? "🚀" : "🏆";
      const eventLabel = level === "SL" ? "STOP LOSS HIT" : `${level} SECURED`;
      const outcomeLine = level === "SL"
        ? `Loss: -${targetPips.toFixed(1)} pips 📉`
        : `Secured profit: +${targetPips.toFixed(1)} pips 💰`;
      const vipOutcomeMessage = `${eventIcon} <b>4xFiveAI — ${eventLabel}</b> ✅\n\n`
        + `Pair: ${signal.pair}\n`
        + `Signal: ${signal.direction === "BUY" || signal.direction === "LONG" ? "🟢 BUY" : "🔴 SELL"}\n`
        + `Entry: ${signal.entry_price}\n`
        + `${level}: ${targetPrice} ${level === "SL" ? "🛑" : "🎯"}\n`
        + `${outcomeLine}\n`
        + (level === "TP1" ? "Remaining position: protected at Entry 🛡️ while waiting for TP2" : level === "TP2" ? "Remaining position: protected at Entry 🛡️ while waiting for TP3" : "");
      if (level === "TP1" || level === "TP2" || level === "TP3") {
        await sendTelegramOutcomeToVipAndFree(
          vipOutcomeMessage,
          formatFreeTpHitMessage(signal.pair, signal.direction === "BUY" || signal.direction === "LONG" ? "BUY" : "SELL", level, targetPrice, signal.entry_price),
        ).catch((telegramError) => console.error(`[TELEGRAM] ${level} notification failed:`, telegramError));
      } else {
        await sendTelegramToVipAndFree(vipOutcomeMessage)
          .catch((telegramError) => console.error(`[TELEGRAM] ${level} notification failed:`, telegramError));
      }
      res.json({ success: true, signal: updated });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Failed to mark target" });
    }
  });

  app.post("/api/admin/signals/:id/send-telegram", requireAdmin, async (req, res) => {
    try {
      if (!supabase) return res.status(503).json({ error: "Database unavailable" });
      const { data: signal, error } = await supabase
        .from("signals")
        .select("id,pair,direction,entry_price,sl,tp1,tp2,tp3,confidence,score,pips_won,news_event,news_impact,news_time")
        .eq("id", req.params.id)
        .maybeSingle();
      if (error) return res.status(500).json({ error: error.message });
      if (!signal) return res.status(404).json({ error: "Signal not found" });
      const telegramSent = await sendTelegramMessage(formatSignalTelegramMessage(signal, "SIGNAL UPDATE"), process.env.TELEGRAM_FREE_CHAT_ID || undefined);
      if (!telegramSent) return res.status(502).json({ error: "Telegram message failed" });
      res.json({ success: true, telegramSent: true });
    } catch (error: any) {
      console.error("[admin/send-telegram] failed", {
        signalId: req.params.id,
        stack: error?.stack || String(error),
        message: error?.message || String(error),
      });
      res.status(500).json({ error: error?.message || "Failed to send Telegram message" });
    }
  });

  app.post("/api/admin/signals/:id/send-telegram-channel", requireAdmin, async (req, res) => {
    try {
      if (!supabase) return res.status(503).json({ error: "Database unavailable" });
      const channel = String(req.body?.channel || "").toUpperCase();
      if (channel !== "FREE" && channel !== "VIP") return res.status(400).json({ error: "Invalid Telegram channel" });
      const chatId = channel === "VIP" ? process.env.TELEGRAM_VIP_CHAT_ID : process.env.TELEGRAM_FREE_CHAT_ID;
      if (!chatId) return res.status(503).json({ error: `Telegram ${channel.toLowerCase()} channel is not configured` });
      const { data: signal, error } = await supabase
        .from("signals")
        .select("id,pair,direction,entry_price,sl,tp1,tp2,tp3,confidence,score,pips_won,news_event,news_impact,news_time")
        .eq("id", req.params.id)
        .maybeSingle();
      if (error) return res.status(500).json({ error: error.message });
      if (!signal) return res.status(404).json({ error: "Signal not found" });
      const telegramSent = await sendTelegramMessage(
        formatSignalTelegramMessage(signal, "SIGNAL UPDATE"),
        chatId,
      );
      if (!telegramSent) return res.status(502).json({ error: "Telegram message failed" });
      res.json({ success: true, telegramSent: true, channel });
    } catch (error: any) {
      console.error("[admin/send-telegram-channel] failed", {
        signalId: req.params.id,
        channel: req.body?.channel,
        stack: error?.stack || String(error),
        message: error?.message || String(error),
      });
      res.status(500).json({ error: error?.message || "Failed to send Telegram message" });
    }
  });

  app.post("/api/admin/signals/:id/cancel", requireAdmin, async (req, res) => {
    try {
      if (!supabase) return res.status(503).json({ error: "Database unavailable" });
      const { data: signal, error: readError } = await supabase
        .from("signals")
        .select("id,pair,direction,is_active,status")
        .eq("id", req.params.id)
        .maybeSingle();
      if (readError) return res.status(500).json({ error: readError.message });
      if (!signal || signal.is_active === false) return res.status(404).json({ error: "Active signal not found" });

      const { data: updated, error: updateError } = await supabase
        .from("signals")
        .update({
          status: "CLOSED",
          is_active: false,
          result: "CANCELLED",
          closed_at: new Date().toISOString(),
        })
        .eq("id", req.params.id)
        .eq("is_active", true)
        .select("*")
        .maybeSingle();
      if (updateError) return res.status(500).json({ error: updateError.message });
      if (!updated) return res.status(409).json({ error: "Signal was already closed" });

      const { MANUAL_OVERRIDE_PAIRS } = await import("./server/scanner.js");
      MANUAL_OVERRIDE_PAIRS.delete(signal.pair);
      const telegramSent = await sendTelegramMessage(
        `⚪ <b>4xFiveAI — SIGNAL CANCELLED</b>\n\n`
        + `Pair: ${signal.pair}\n`
        + `Signal: ${signal.direction === "BUY" || signal.direction === "LONG" ? "🟢 BUY" : "🔴 SELL"}\n`
        + `Status: Cancelled before trade result\n`
        + `Outcome: 0 pips — no profit, no loss\n`
        + `Reason: Administrative correction / market conditions`
      );
      res.json({ success: true, signal: updated, telegramSent });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Failed to cancel signal" });
    }
  });

  app.post("/api/admin/signals/clear", requireAdmin, async (_req, res) => {
    try {
      if (!supabase) return res.status(503).json({ error: "Database unavailable" });
      const { data, error } = await supabase
        .from("signals")
        .delete()
        .not("id", "is", null)
        .select("id");
      if (error) return res.status(500).json({ error: error.message });
      const { MANUAL_OVERRIDE_PAIRS } = await import('./server/scanner.js');
      MANUAL_OVERRIDE_PAIRS.clear();
      res.json({ success: true, cleared: data?.length || 0 });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Failed to clear active signals" });
    }
  });

  // Test-only route to trigger notifications
  app.post("/api/test/trigger-notification", async (req, res) => {
    if (process.env.NODE_ENV === "production") {
      return res.status(403).json({ error: "Not allowed in production environment" });
    }

    try {
      if (!supabase) return res.status(500).json({ error: "4x System Error" });

      const { data: profiles } = await supabase.from('profiles').select('id');
      if (!profiles || profiles.length === 0) return res.status(404).json({ error: "No user profiles found to send notifications to" });

      const testNotifications = [];
      const timestamp = new Date().toISOString();

      for (const profile of profiles) {
         testNotifications.push({
             user_id: profile.id,
             title: 'New Premium Signal',
             message: 'Signal generated for EURUSD (LONG). Score: 12/14. Confidence: 89%.',
             created_at: timestamp
         });
         testNotifications.push({
             user_id: profile.id,
             title: 'Payment Approved',
             message: 'Your payment (TX123456789) has been approved. Subscription activated!',
             created_at: timestamp
         });
         testNotifications.push({
             user_id: profile.id,
             title: 'New Trade Signal',
             message: 'Signal generated for GBPUSD (SHORT)',
             created_at: timestamp
         });
         testNotifications.push({
             user_id: profile.id,
             title: 'Support Ticket Resolved',
             message: 'Your support ticket "Cannot access Elite Scanners" has been resolved.',
             created_at: timestamp
         });
      }

      const { error } = await supabase.from('notifications').insert(testNotifications);
      if (error) throw error;

      res.json({ success: true, message: `Inserted 4 test notifications for ${profiles.length} users.` });
    } catch (e: any) {
      console.error("Error inserting test notifications:", e);
      res.status(500).json({ error: e.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));

    const injectSupabaseConfig = (html: string) => {
      let url = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/^["']|["']$/g, '').trim();
      const key = (process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '').replace(/^["']|["']$/g, '').trim();
      // Supabase client expects the base URL only, not /rest/v1/ or /auth/v1/
      url = url.replace(/\/(rest|auth)\/v1\/?$/i, '').replace(/\/$/, '');
      if (!url || !key) return html;
      const script = `<script>window.__SUPABASE_CONFIG__={url:${JSON.stringify(url)},key:${JSON.stringify(key)}}</script>`;
      return html.replace('<head>', `<head>${script}`);
    };

    // For Express 4.x
    app.get('*', (req, res) => {
      const indexPath = path.join(distPath, 'index.html');
      fs.readFile(indexPath, 'utf8', (err, html) => {
        if (err) {
          console.error('Failed to read index.html:', err);
          return res.status(500).send('Server error');
        }
        res.send(injectSupabaseConfig(html));
      });
    });
  }

  app.listen(Number(PORT), "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
