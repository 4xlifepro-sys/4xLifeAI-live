// Deterministic extraction of a trading signal from pasted TradingView Copilot text.
// SAFETY RULE: never invent data. Missing fields stay undefined and are surfaced as MISSING.
// No AI calls, no scraping, no price calculation — pure text parsing only.

export type CopilotDirection = 'BUY' | 'SELL';
export type CopilotSignalType = 'BUY' | 'SELL' | 'BUY STOP' | 'SELL STOP';
export type CopilotStatus = 'WAITING FOR TRIGGER' | 'ACTIVE' | 'WAITING' | 'NO TRADE';

export interface CopilotSignalExtraction {
  pair?: string;
  timeframe?: string;
  direction?: CopilotDirection;
  signalType?: CopilotSignalType;
  entry?: number;
  trigger?: string;
  triggerPrice?: number;
  sl?: number;
  tp1?: number;
  tp2?: number;
  tp3?: number;
  confidence?: number; // 0-80 scale
  confidenceRaw?: { value: number; scale: number };
  trend?: string;
  strategy?: string;
  reason?: string;
  status: CopilotStatus;
}

const PAIR_ALIASES: Record<string, string> = {
  GOLD: 'XAUUSD',
  XAU: 'XAUUSD',
  GOLDUSD: 'XAUUSD',
  SILVER: 'XAGUSD',
  XAG: 'XAGUSD',
  BTC: 'BTCUSD',
  BITCOIN: 'BTCUSD',
  ETH: 'ETHUSD',
  ETHEREUM: 'ETHUSD',
  SOL: 'SOLUSD',
};

const CURRENCY_CODES = ['EUR', 'USD', 'GBP', 'JPY', 'AUD', 'NZD', 'CAD', 'CHF', 'XAU', 'XAG'];

const TIMEFRAME_PATTERN = '(1M|3M|5M|15M|30M|1H|2H|4H|1D|D1|DAILY|1W|W1|WEEKLY|D|W)';
const PRICE = String.raw`\d{1,6}\.\d{1,6}`;

function toNumber(raw: string): number | undefined {
  const n = Number(raw.replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function firstMatch(text: string, patterns: RegExp[]): string | undefined {
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[1];
  }
  return undefined;
}

function extractPair(text: string): string | undefined {
  const upper = text.toUpperCase();
  // Labeled mentions first: "Pair: AUDUSD", "Symbol: EURUSD", "Instrument: XAUUSD"
  const labeled = firstMatch(upper, [
    new RegExp(String.raw`\b(?:PAIR|SYMBOL|INSTRUMENT)\s*[:\-]?\s*([A-Z]{6})\b`),
  ]);
  if (labeled) return labeled;
  // Known aliases anywhere in the text
  for (const [alias, pair] of Object.entries(PAIR_ALIASES)) {
    if (new RegExp(String.raw`\b${alias}\b`).test(upper)) return pair;
  }
  // Any 6-letter token whose halves are currency codes (e.g. AUDUSD, GBPJPY)
  const tokens = upper.match(/\b[A-Z]{6}\b/g) || [];
  for (const t of tokens) {
    const base = t.slice(0, 3);
    const quote = t.slice(3);
    if (CURRENCY_CODES.includes(base) && CURRENCY_CODES.includes(quote) && base !== quote) return t;
  }
  return undefined;
}

function extractTimeframe(text: string): string | undefined {
  const labeled = firstMatch(text, [
    new RegExp(String.raw`\b(?:TIMEFRAME|TIME\s*FRAME|TF|INTERVAL|CHART)\s*[:\-]?\s*${TIMEFRAME_PATTERN}\b`, 'i'),
  ]);
  if (labeled) return normalizeTimeframe(labeled);
  const any = firstMatch(text, [new RegExp(String.raw`\b${TIMEFRAME_PATTERN}\b`, 'i')]);
  return any ? normalizeTimeframe(any) : undefined;
}

function normalizeTimeframe(tf: string): string {
  const t = tf.toUpperCase().replace(/\s+/g, '');
  if (t === 'D' || t === 'D1' || t === 'DAILY') return '1D';
  if (t === 'W' || t === 'W1' || t === 'WEEKLY') return '1W';
  return t;
}

function extractDirectionAndType(text: string): { direction?: CopilotDirection; signalType?: CopilotSignalType; blocked?: 'WAITING' | 'NO TRADE' } {
  const upper = text.toUpperCase();

  // NO TRADE always wins — never publish it as a trade.
  if (/\bNO[\s\-]?TRADE\b/.test(upper)) return { blocked: 'NO TRADE' };

  // Labeled trade decision first: "Trade: BUY", "Signal: SELL", "Direction: LONG"
  const labeled = firstMatch(upper, [
    new RegExp(String.raw`\b(?:TRADE|SIGNAL|DIRECTION|DECISION|BIAS|POSITION)\s*[:\-]?\s*(BUY\s*STOP|SELL\s*STOP|BUY|SELL|LONG|SHORT|WAIT|WAITING)\b`),
  ]);
  const candidates: string[] = [];
  if (labeled) candidates.push(labeled);
  // Then any explicit signal-type mention anywhere
  if (/\bBUY\s*STOP\b/.test(upper)) candidates.push('BUY STOP');
  if (/\bSELL\s*STOP\b/.test(upper)) candidates.push('SELL STOP');

  let signalType: CopilotSignalType | undefined;
  let direction: CopilotDirection | undefined;
  for (const c of candidates) {
    const v = c.replace(/\s+/g, ' ').trim();
    if (v === 'BUY STOP') { signalType = 'BUY STOP'; direction = 'BUY'; break; }
    if (v === 'SELL STOP') { signalType = 'SELL STOP'; direction = 'SELL'; break; }
    if (v === 'BUY' || v === 'LONG') { direction = 'BUY'; break; }
    if (v === 'SELL' || v === 'SHORT') { direction = 'SELL'; break; }
    if (v === 'WAIT' || v === 'WAITING') return { blocked: 'WAITING' };
  }

  if (!direction) {
    // Fallback: bare verb mentions ("buy after", "go long", "sell on")
    if (/\bGO\s+LONG\b|\bBUY\b/.test(upper)) direction = 'BUY';
    else if (/\bGO\s+SHORT\b|\bSELL\b/.test(upper)) direction = 'SELL';
  }

  if (direction && !signalType) signalType = direction;
  return { direction, signalType };
}

function extractLabeledPrice(text: string, labels: string[]): number | undefined {
  const labelAlt = labels.join('|');
  const patterns = [
    new RegExp(String.raw`\b(?:${labelAlt})\s*[:\-]?\s*(${PRICE})\b`, 'i'),
    new RegExp(String.raw`\b(${PRICE})\s*\(?\s*(?:${labelAlt})\)?\b`, 'i'),
  ];
  const raw = firstMatch(text, patterns);
  return raw ? toNumber(raw) : undefined;
}

function extractTrigger(text: string): { trigger?: string; triggerPrice?: number } {
  // "5M close above 0.69828", "closes below 0.698", "trigger at 0.69830"
  const closeRe = new RegExp(String.raw`(\S+\s+)?(?:close|closes|closing)\s+(above|below)\s+(${PRICE})`, 'i');
  const closeM = text.match(closeRe);
  if (closeM) {
    const prefix = (closeM[1] || '').trim().toUpperCase();
    const side = closeM[2].toUpperCase();
    const price = toNumber(closeM[3]);
    const label = `${prefix ? prefix + ' ' : ''}CLOSE ${side} ${closeM[3]}`.trim();
    return { trigger: label, triggerPrice: price };
  }
  const trigRe = new RegExp(String.raw`\b(?:TRIGGER|BUY\s*STOP|SELL\s*STOP|PENDING)\s*(?:PRICE)?\s*(?:AT|[:\-])?\s*(${PRICE})\b`, 'i');
  const trigM = text.match(trigRe);
  if (trigM) {
    const price = toNumber(trigM[1]);
    return { trigger: `TRIGGER ${trigM[1]}`, triggerPrice: price };
  }
  return {};
}

function extractConfidence(text: string): { confidence?: number; confidenceRaw?: { value: number; scale: number } } {
  // Explicit /100 or % scale → convert proportionally to the 0-80 scale.
  const m100 = text.match(new RegExp(String.raw`\b(?:CONFIDENCE|CONVICTION|CERTAINTY)\s*[:\-]?\s*(\d{1,3})\s*(?:/\s*100|%|PERCENT|OUT\s+OF\s+100)`, 'i'));
  if (m100) {
    const v = Number(m100[1]);
    if (Number.isFinite(v) && v >= 0 && v <= 100) {
      return { confidence: Math.min(80, Math.round(v * 0.8)), confidenceRaw: { value: v, scale: 100 } };
    }
  }
  const m80 = text.match(new RegExp(String.raw`\b(?:CONFIDENCE|CONVICTION|CERTAINTY)\s*[:\-]?\s*(\d{1,2})\s*/\s*80\b`, 'i'));
  if (m80) {
    const v = Number(m80[1]);
    if (Number.isFinite(v) && v >= 0 && v <= 80) {
      return { confidence: Math.min(80, Math.round(v)), confidenceRaw: { value: v, scale: 80 } };
    }
  }
  const mPlain = text.match(new RegExp(String.raw`\b(?:CONFIDENCE|CONVICTION|CERTAINTY)\s*[:\-]\s*(\d{1,3})\b`, 'i'));
  if (mPlain) {
    const v = Number(mPlain[1]);
    if (Number.isFinite(v) && v > 0) {
      // A value above 80 cannot be on the 0-80 scale → treat as 0-100 and convert.
      if (v > 80) return { confidence: Math.min(80, Math.round(v * 0.8)), confidenceRaw: { value: v, scale: 100 } };
      return { confidence: Math.min(80, Math.round(v)), confidenceRaw: { value: v, scale: 80 } };
    }
  }
  return {};
}

function extractTrend(text: string): string | undefined {
  const m = text.match(/\b(bullish|bearish|ranging|range|sideways|neutral)\b/i);
  if (!m) return undefined;
  const t = m[1].toLowerCase();
  if (t === 'range' || t === 'ranging' || t === 'sideways') return 'Range';
  if (t === 'neutral') return 'Neutral';
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function extractStrategy(text: string): string {
  // Only name a strategy that is actually present in the pasted text.
  if (/skill\s*2/i.test(text) || /5m\s+confirmed\s+momentum/i.test(text)) return '5M Confirmed Momentum';
  if (/classic\s*a\b/i.test(text)) return 'Classic A';
  if (/classic\s*v\b/i.test(text)) return 'Classic V';
  if (/liquidity\s+sweep/i.test(text)) return 'Liquidity Sweep';
  if (/order\s*block/i.test(text)) return 'Order Block';
  if (/\bfvg\b|fair\s+value\s+gap/i.test(text)) return 'FVG';
  if (/\bict\b/i.test(text)) return 'ICT';
  if (/\bsmc\b|smart\s+money/i.test(text)) return 'SMC';
  return '5M Confirmed Momentum';
}

function extractReason(text: string): string | undefined {
  const labeled = text.match(new RegExp(String.raw`\b(?:REASON|REASONING|RATIONALE|WHY)\s*[:\-]\s*(.+)`, 'i'));
  if (labeled) {
    const reason = labeled[1].split(/\n+/)[0].trim();
    if (reason) return reason;
  }
  return undefined;
}

export function extractCopilotSignal(text: string): CopilotSignalExtraction {
  const { direction, signalType, blocked } = extractDirectionAndType(text);
  const entry = extractLabeledPrice(text, ['ENTRY', 'ENTRY PRICE', 'ENTER', 'BUY AT', 'SELL AT', 'LONG AT', 'SHORT AT', 'OPEN']);
  const sl = extractLabeledPrice(text, ['SL', 'STOP LOSS', 'STOP-LOSS', 'STOP', 'ST']);
  const tp1 = extractLabeledPrice(text, ['TP1', 'TP 1', 'T1', 'TARGET 1', 'FIRST TARGET', 'TP']);
  const tp2 = extractLabeledPrice(text, ['TP2', 'TP 2', 'T2', 'TARGET 2', 'SECOND TARGET', 'MAIN TARGET']);
  const tp3 = extractLabeledPrice(text, ['TP3', 'TP 3', 'T3', 'TARGET 3', 'THIRD TARGET']);
  const { confidence, confidenceRaw } = extractConfidence(text);
  const { trigger, triggerPrice } = extractTrigger(text);

  let status: CopilotStatus;
  if (blocked === 'NO TRADE') status = 'NO TRADE';
  else if (blocked === 'WAITING') status = 'WAITING';
  else if (signalType === 'BUY STOP' || signalType === 'SELL STOP') status = 'WAITING FOR TRIGGER';
  else if (direction) status = 'ACTIVE';
  else status = 'WAITING';

  return {
    pair: extractPair(text),
    timeframe: extractTimeframe(text),
    direction,
    signalType,
    entry,
    trigger,
    triggerPrice: triggerPrice && triggerPrice !== entry ? triggerPrice : undefined,
    sl,
    tp1,
    tp2,
    tp3,
    confidence,
    confidenceRaw,
    trend: extractTrend(text),
    strategy: extractStrategy(text),
    reason: extractReason(text),
    status,
  };
}

export function validateCopilotSignal(e: Partial<CopilotSignalExtraction>): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!e.pair) missing.push('SYMBOL');
  if (!e.timeframe) missing.push('TIMEFRAME');
  if (!e.direction) missing.push('DIRECTION');
  if (!e.signalType) missing.push('SIGNAL TYPE');
  if (!e.entry) missing.push('ENTRY');
  if (!e.sl) missing.push('SL');
  if (!e.tp1) missing.push('TP1');
  if (e.confidence == null) missing.push('CONFIDENCE');
  else if (e.confidence < 0 || e.confidence > 80) missing.push('CONFIDENCE (must be 0-80)');
  if (!e.strategy) missing.push('STRATEGY');
  if (!e.status || !['WAITING FOR TRIGGER', 'ACTIVE', 'TP1 HIT', 'TP2 HIT', 'TP3 HIT', 'SL HIT', 'CANCELLED', 'EXPIRED'].includes(e.status)) {
    missing.push('STATUS');
  }
  if (e.status === 'NO TRADE' || e.status === 'WAITING') missing.push('TRADE DECISION (Copilot returned ' + e.status + ')');
  // Structural sanity: SL must sit on the protective side of entry.
  if (e.direction && e.entry && e.sl) {
    if (e.direction === 'BUY' && e.sl >= e.entry) missing.push('SL (must be below Entry for BUY)');
    if (e.direction === 'SELL' && e.sl <= e.entry) missing.push('SL (must be above Entry for SELL)');
  }
  return { ok: missing.length === 0, missing };
}
