import { GoogleGenAI } from '@google/genai';
import JSON5 from 'json5';

export interface FFEvent {
  title: string;
  country: string;
  date: string;
  time?: string;
  impact: string;
  forecast: string;
  previous: string;
  actual?: string;
}

export interface NewsPrediction {
  newsHasEvent: boolean;
  newsEvent: string;
  newsPrediction: 'BUY' | 'SELL' | 'NEUTRAL';
  newsProbability: number;
  newsReason: string;
}

function parseForexFactoryEventUtc(event: FFEvent): string | null {
  const rawTimestamp = String(event.date || '').trim();
  if (!rawTimestamp) return null;
  const timestamp = Date.parse(rawTimestamp);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function buildCalendarPromptBlock(events: FFEvent[], pair: string, timeZone?: string): string {
  const now = Date.now();
  const relevantCurrencies = pairCurrencies(pair);
  const highImpact = events.filter((e) => {
    const impact = (e.impact || '').toLowerCase();
    if (impact !== 'high') return false;
    const normalizedUtc = parseForexFactoryEventUtc(e);
    const t = normalizedUtc ? new Date(normalizedUtc).getTime() : NaN;
    if (isNaN(t)) return false;
    if (!relevantCurrencies.has(e.country.toUpperCase())) return false;
    return t > now && t < now + 5 * 24 * 60 * 60 * 1000;
  });
  if (highImpact.length === 0) return 'NONE (no high-impact red-folder events this week for this pair).\n';
  return highImpact
    .slice(0, 20)
    .map((e) => {
      const normalizedUtc = parseForexFactoryEventUtc(e);
      const d = normalizedUtc ? new Date(normalizedUtc) : new Date(NaN);
      let when: string;
      if (isNaN(d.getTime())) when = e.date;
      else if (timeZone) {
        try {
          when = d.toLocaleString('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' (user local time)';
        } catch {
          when = d.toUTCString().replace(':00 GMT', ' GMT') + ' (GMT)';
        }
      } else {
        when = d.toUTCString().replace(':00 GMT', ' GMT') + ' (GMT)';
      }
      const actual = e.actual && e.actual !== '' ? e.actual : 'PENDING';
      return `- ${when} | ${e.country} | ${e.title} | forecast: ${e.forecast || 'n/a'} | previous: ${e.previous || 'n/a'} | actual: ${actual}`;
    })
    .join('\n') + '\n';
}

function pairCurrencies(pair: string): Set<string> {
  const p = pair.toUpperCase();
  if (p.length === 6) return new Set([p.slice(0, 3), p.slice(3, 6)]);
  if (p.includes('XAU') || p.includes('GOLD')) return new Set(['USD']);
  if (p.includes('BTC') || p.includes('ETH') || p.includes('SOL')) return new Set(['USD']);
  return new Set(['USD']);
}

export async function predictNewsFromCalendar(
  pair: string,
  direction: 'BUY' | 'SELL',
  events: FFEvent[],
  timeZone?: string,
): Promise<NewsPrediction | { error: string }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { error: 'GEMINI_API_KEY not configured' };

  const calendarBlock = buildCalendarPromptBlock(events, pair, timeZone);
  const prompt = `You are a forex/crypto news analyst. Given the following Forex Factory high-impact economic calendar events for the relevant currencies of ${pair}, decide whether any upcoming event materially supports a ${direction} trade on ${pair}.

Upcoming high-impact events for ${pair} currencies:
${calendarBlock}

Rules:
- If there are no relevant high-impact events, return newsHasEvent=false and prediction=NEUTRAL.
- If an event is likely to push the pair in the same direction as the ${direction} trade, return newsPrediction="${direction}" with 55-75 probability.
- If an event is likely to push the pair in the opposite direction, return newsPrediction=the opposite direction with 55-75 probability.
- If the event impact is mixed or unclear, return newsPrediction=NEUTRAL.
- Do not output probability above 75. Confidence is not a guarantee.

Return ONLY a JSON object exactly like this:
{
  "newsHasEvent": true,
  "newsEvent": "short event label",
  "newsPrediction": "BUY" | "SELL" | "NEUTRAL",
  "newsProbability": 65,
  "newsReason": "one short customer-friendly sentence explaining the bias"
}`;

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: 'gemini-1.5-flash',
      contents: prompt,
    });
    const text = response.text || '';
    const match = text.match(/\{[\s\S]*\}/);
    const raw = match ? match[0] : text;
    const parsed = JSON5.parse(raw) as NewsPrediction;

    const prediction = String(parsed.newsPrediction || '').toUpperCase();
    const validPrediction = prediction === 'BUY' || prediction === 'SELL' ? prediction : 'NEUTRAL';
    const probability = Math.min(75, Math.max(50, Number(parsed.newsProbability) || 50));

    return {
      newsHasEvent: Boolean(parsed.newsHasEvent),
      newsEvent: String(parsed.newsEvent || 'Economic event'),
      newsPrediction: validPrediction as 'BUY' | 'SELL' | 'NEUTRAL',
      newsProbability: probability,
      newsReason: String(parsed.newsReason || ''),
    };
  } catch (e: any) {
    console.error('[predictNewsFromCalendar] error:', e.message);
    return { error: e.message || 'Gemini news prediction failed' };
  }
}
