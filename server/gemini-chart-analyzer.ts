import { GoogleGenAI } from '@google/genai';

export interface ChartAnalysisSuggestion {
  pair?: string;
  timeframe?: string;
  marketStructure?: 'HH + HL' | 'LL + LH' | 'Mixed / Unclear';
  liquidity?: 'Liquidity Taken' | 'Liquidity Not Taken';
  asianHighLow?: 'Asian High Taken' | 'Asian Low Taken' | 'Neither Taken';
  strategy?: 'Classic A' | 'Classic V';
  tradeType?: 'Main Trend' | 'Counter Trend';
  asianReaction?: 'Wick Taken' | 'Body Taken' | 'Not Taken';
  confirmations?: ('MSS' | 'OCL' | 'QML' | 'RBS' | 'SBR')[];
  direction?: 'BUY' | 'SELL';
  entry?: number;
  sl?: number;
  tpMultiples?: number[];
}

const VALID_STRUCTURES: ChartAnalysisSuggestion['marketStructure'][] = ['HH + HL', 'LL + LH', 'Mixed / Unclear'];
const VALID_LIQUIDITY: ChartAnalysisSuggestion['liquidity'][] = ['Liquidity Taken', 'Liquidity Not Taken'];
const VALID_ASIAN: ChartAnalysisSuggestion['asianHighLow'][] = ['Asian High Taken', 'Asian Low Taken', 'Neither Taken'];
const VALID_STRATEGY: ChartAnalysisSuggestion['strategy'][] = ['Classic A', 'Classic V'];
const VALID_TRADE_TYPE: ChartAnalysisSuggestion['tradeType'][] = ['Main Trend', 'Counter Trend'];
const VALID_REACTION: ChartAnalysisSuggestion['asianReaction'][] = ['Wick Taken', 'Body Taken', 'Not Taken'];
const VALID_CONFIRMATIONS = ['MSS', 'OCL', 'QML', 'RBS', 'SBR'];

function clampToEnum<T extends string>(value: unknown, allowed: T[]): T | undefined {
  const v = String(value || '').trim();
  return allowed.find((a) => a.toLowerCase() === v.toLowerCase()) || undefined;
}

function sanitizeNumber(n: unknown): number | undefined {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : undefined;
}

export async function analyzeChartWithGemini(
  imageBuffer: Buffer,
  pair?: string,
  timeframe?: string,
): Promise<ChartAnalysisSuggestion | { error: string }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { error: 'GEMINI_API_KEY not configured' };

  const prompt = `You are an expert price-action analyst for forex and crypto. Analyze the provided chart image using the following strict methodology and return ONLY a JSON object.

15M High-Timeframe Analysis:
- marketStructure: "HH + HL" if bullish structure, "LL + LH" if bearish, "Mixed / Unclear" if not clear.
- liquidity: "Liquidity Taken" if a recent swing high/low liquidity sweep is visible, otherwise "Liquidity Not Taken".
- asianHighLow: "Asian High Taken" if price took the Asian session high, "Asian Low Taken" if it took the Asian low, otherwise "Neither Taken".
- strategy: "Classic A" if the setup shows an A-shaped reversal pattern, "Classic V" if it shows a V-shaped reversal pattern. Strategy does NOT determine direction.
- tradeType: "Main Trend" if the setup aligns with the 15M structure, "Counter Trend" if it goes against it.
- asianReaction: "Wick Taken" if only the wick swept the Asian level, "Body Taken" if the body closed through it, "Not Taken" if no interaction.

1M Confirmation (return all that are clearly visible on 1M):
- confirmations: array containing any of "MSS", "OCL", "QML", "RBS", "SBR".
  - MSS = Market Structure Shift
  - OCL = Order Block / level reaction
  - QML = Quasimodo level
  - RBS = Resistance become Support
  - SBR = Support become Resistance

Trade Levels:
- pair: the trading pair shown on the chart (e.g. "EURUSD", "XAUUSD").
- timeframe: the chart timeframe if visible (e.g. "15M", "1H").
- direction: "BUY" or "SELL" based on the current setup and 1M confirmation.
- entry: the most logical immediate entry price shown on the chart.
- sl: the stop-loss price that respects the setup (below entry for BUY, above entry for SELL).
- tpMultiples: array of R-multiples to use, choose from [1, 2.1, 3.1, 4.1, 5, 6]. Use 2.1 minimum for a normal setup.

Return ONLY this JSON structure, no markdown, no explanation:
{
  "pair": "EURUSD",
  "timeframe": "15M",
  "marketStructure": "HH + HL",
  "liquidity": "Liquidity Taken",
  "asianHighLow": "Asian Low Taken",
  "strategy": "Classic V",
  "tradeType": "Main Trend",
  "asianReaction": "Body Taken",
  "confirmations": ["MSS", "OCL"],
  "direction": "BUY",
  "entry": 1.08500,
  "sl": 1.08450,
  "tpMultiples": [2.1, 3.1, 4.1]
}`;

  try {
    const ai = new GoogleGenAI({ apiKey });
    const mimeType = 'image/png';
    const base64 = imageBuffer.toString('base64');

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        { text: prompt },
        {
          inlineData: {
            mimeType,
            data: base64,
          },
        },
      ],
    });

    const text = response.text || '';
    const match = text.match(/\{[\s\S]*\}/);
    const raw = match ? match[0] : text;

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const sanitized = raw
        .replace(/([''])(?=(?:[^"]*"[^"]*")*[^"]*$)/g, '"')
        .replace(/,\s*([}\]])/g, '$1');
      parsed = JSON.parse(sanitized);
    }

    const suggestion: ChartAnalysisSuggestion = {
      pair: pair || (parsed.pair ? String(parsed.pair).toUpperCase() : undefined),
      timeframe: timeframe || (parsed.timeframe ? String(parsed.timeframe) : undefined),
      marketStructure: clampToEnum(parsed.marketStructure, VALID_STRUCTURES),
      liquidity: clampToEnum(parsed.liquidity, VALID_LIQUIDITY),
      asianHighLow: clampToEnum(parsed.asianHighLow, VALID_ASIAN),
      strategy: clampToEnum(parsed.strategy, VALID_STRATEGY),
      tradeType: clampToEnum(parsed.tradeType, VALID_TRADE_TYPE),
      asianReaction: clampToEnum(parsed.asianReaction, VALID_REACTION),
      confirmations: Array.isArray(parsed.confirmations)
        ? parsed.confirmations
            .map((c: any) => clampToEnum(String(c).toUpperCase(), VALID_CONFIRMATIONS as any))
            .filter(Boolean) as any
        : [],
      direction: clampToEnum(String(parsed.direction).toUpperCase(), ['BUY', 'SELL']),
      entry: sanitizeNumber(parsed.entry),
      sl: sanitizeNumber(parsed.sl),
      tpMultiples: Array.isArray(parsed.tpMultiples)
        ? parsed.tpMultiples.map((r: any) => Number(r)).filter((r: number) => [1, 2.1, 3.1, 4.1, 5, 6].includes(r))
        : [2.1, 3.1, 4.1],
    };

    return suggestion;
  } catch (e: any) {
    console.error('[analyzeChartWithGemini] error:', e.message);
    return { error: e.message || 'Chart analysis failed' };
  }
}
