import { GoogleGenAI } from "@google/genai";
import { sendTelegramMessage } from "./telegram.js";
import { scannerState } from "./scanner.js";

const ai = process.env.GEMINI_API_KEY ? new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
}) : null;

// Session definitions (UTC times)
interface TradingSession {
  name: string;
  emoji: string;
  startUTC: number; // hours
  endUTC: number;
  timezone: string;
}

const TRADING_SESSIONS: TradingSession[] = [
  { name: "Asian", emoji: "🌅", startUTC: 22, endUTC: 8, timezone: "Tokyo/Singapore" },
  { name: "BD/Indian", emoji: "🌄", startUTC: 3, endUTC: 12, timezone: "Dhaka" },
  { name: "London", emoji: "🇬🇧", startUTC: 8, endUTC: 17, timezone: "London" },
  { name: "New York", emoji: "🗽", startUTC: 13, endUTC: 22, timezone: "New York" },
];

function getCurrentSession(): TradingSession | null {
  const now = new Date();
  const utcHour = now.getUTCHours();

  for (const session of TRADING_SESSIONS) {
    if (session.startUTC <= session.endUTC) {
      // Normal range (e.g., 8-17)
      if (utcHour >= session.startUTC && utcHour < session.endUTC) {
        return session;
      }
    } else {
      // Wrapping range (e.g., 22-8, means 22-24, 0-8)
      if (utcHour >= session.startUTC || utcHour < session.endUTC) {
        return session;
      }
    }
  }
  return null;
}

interface MarketStatus {
  session: TradingSession;
  volatility: "HIGH" | "MEDIUM" | "LOW";
  activeSignals: number;
  confidence: number;
  pairs: string[];
  time: string;
}

function generateMarketStatus(): MarketStatus {
  const session = getCurrentSession();
  if (!session) {
    throw new Error("No active trading session");
  }

  const now = new Date();
  const activeSignals = scannerState.signals.filter(s => s.tier !== "Reject").length;
  
  // Calculate volatility from ATR or market state
  const avgConfidence = scannerState.signals.length > 0
    ? Math.round(scannerState.signals.reduce((sum, s) => sum + (s.aiConfidence || 50), 0) / scannerState.signals.length)
    : 50;

  // Determine volatility based on active signals and confidence
  let volatility: "HIGH" | "MEDIUM" | "LOW" = "MEDIUM";
  if (activeSignals > 3 && avgConfidence > 70) volatility = "HIGH";
  if (activeSignals === 0 && avgConfidence < 50) volatility = "LOW";

  return {
    session,
    volatility,
    activeSignals,
    confidence: avgConfidence,
    pairs: scannerState.pairStatuses.map(p => p.pair),
    time: now.toISOString(),
  };
}

async function generateMarketImageBase64(status: MarketStatus): Promise<string> {
  // Create emoji-based visual representation instead of SVG
  const volatilityEmoji = status.volatility === "HIGH" ? "🔴🔴🔴" : status.volatility === "MEDIUM" ? "🟡🟡⚪" : "🟢⚪⚪";
  const confidenceBar = "█".repeat(Math.ceil(status.confidence / 10)) + "░".repeat(10 - Math.ceil(status.confidence / 10));
  
  const visualization = `
╔════════════════════════════════════════════════╗
║  ${status.session.emoji}  ${status.session.name.toUpperCase()} SESSION UPDATE
║  ${status.session.timezone}
╚════════════════════════════════════════════════╝

📊 MARKET STATUS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🎯 Active Signals:  ${String(status.activeSignals).padEnd(2)} ${status.activeSignals > 2 ? "🔥" : "⏳"}

📈 Volatility:     ${status.volatility.padEnd(6)} ${volatilityEmoji}

💪 Confidence:     ${String(status.confidence).padEnd(3)}%
                  ${confidenceBar}

🔍 Scanning:       ${status.pairs.slice(0, 3).join(" | ")}
                  ${status.pairs.slice(3, 6).join(" | ") || ""}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⏰ ${new Date(status.time).toUTCString().slice(0, 16)} UTC
✨ 4xFiveAI Signal Engine
`;

  return Buffer.from(visualization).toString("base64");
}

async function generateSessionMessage(status: MarketStatus): Promise<string> {
  if (!ai) {
    return `${status.session.emoji} **${status.session.name} Session Update**\n\n` +
           `📊 Active Signals: ${status.activeSignals}\n` +
           `📈 Volatility: ${status.volatility}\n` +
           `💪 Confidence: ${status.confidence}%\n\n` +
           `Scanning: ${status.pairs.join(", ") || "Initializing..."}\n` +
           `Stay focused. The best trades come to those who wait for confirmation.`;
  }

  try {
    const prompt = `You are a professional trading coach. Generate a SHORT (3-4 sentences max), motivational market update for the ${status.session.name} session.

Current market state:
- Active signals: ${status.activeSignals}
- Market volatility: ${status.volatility}
- System confidence: ${status.confidence}%
- Pairs being scanned: ${status.pairs.join(", ")}

Guidelines:
- Be encouraging but realistic
- No fluff, just actionable insight
- Mention the specific volatility condition (high/medium/low)
- End with a single short trading wisdom line
- Keep it under 150 characters total`;

    const response = await ai.models.generateContent({
      model: "gemini-1.5-flash",
      contents: prompt,
    });

    const text = response.text || "";
    return `${status.session.emoji} <b>${status.session.name} Session</b>\n\n${text}`;
  } catch (e) {
    console.error("Failed to generate session message:", e);
    return `${status.session.emoji} **${status.session.name} Session Update**\n\nStay disciplined. Signals coming soon.`;
  }
}

async function sendSessionUpdate(): Promise<void> {
  try {
    const status = generateMarketStatus();
    console.log(`📢 [SESSION] Sending ${status.session.name} session update...`);

    // Generate formatted market visualization + text message
    const visualization = await generateMarketImageBase64(status);
    const messageText = await generateSessionMessage(status);

    // Combine into one comprehensive message
    const fullMessage = visualization + "\n" + messageText;

    // Send to Telegram
    const chatId = process.env.TELEGRAM_DEFAULT_CHAT_ID;
    if (!chatId) {
      console.log("Telegram chat ID not configured, skipping session message");
      return;
    }

    await sendTelegramMessage(fullMessage, chatId);
    console.log(`✅ [SESSION] ${status.session.name} update sent to Telegram`);
  } catch (error) {
    console.error("Failed to send session update:", error);
  }
}

function getNextSessionMessageTime(): number {
  const now = Date.now();
  const currentSession = getCurrentSession();

  if (!currentSession) {
    // No active session, find next one
    return now + 60 * 60 * 1000; // Try again in 1 hour
  }

  // Calculate next message time: 4-6 hours from now, but only during active session
  const nextTime = now + (4 * 60 * 60 * 1000 + Math.random() * 2 * 60 * 60 * 1000);

  // Check if next time is still in active session
  const nextDate = new Date(nextTime);
  const nextHour = nextDate.getUTCHours();

  const isInSession =
    currentSession.startUTC <= currentSession.endUTC
      ? nextHour >= currentSession.startUTC && nextHour < currentSession.endUTC
      : nextHour >= currentSession.startUTC || nextHour < currentSession.endUTC;

  return isInSession ? nextTime : getNextSessionMessageTime(); // Recurse if out of session
}

export function startSessionMessaging(): void {
  console.log("🎯 [SESSION] Session messaging system initialized");
  console.log("📅 [SESSION] Sessions: Asian 22:00-08:00 UTC | BD/Indian 03:00-12:00 UTC | London 08:00-17:00 UTC | NY 13:00-22:00 UTC");

  let nextMessageTime = getNextSessionMessageTime();

  const scheduleNextMessage = () => {
    const now = Date.now();
    const delay = Math.max(0, nextMessageTime - now);

    console.log(`⏰ [SESSION] Next message in ${Math.round(delay / 1000 / 60)} minutes`);

    setTimeout(async () => {
      await sendSessionUpdate();
      nextMessageTime = getNextSessionMessageTime();
      scheduleNextMessage();
    }, delay);
  };

  scheduleNextMessage();
}

// Export for manual testing
export { getCurrentSession, generateMarketStatus, sendSessionUpdate };
