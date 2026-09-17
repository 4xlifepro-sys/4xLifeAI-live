export async function sendTelegramMessage(message: string, chatId?: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const defaultChatId = process.env.TELEGRAM_DEFAULT_CHAT_ID || '@forxlife3';
  const targetChatId = defaultChatId;

  if (!token) {
    console.error("[TELEGRAM] TELEGRAM_BOT_TOKEN is missing");
    return false;
  }
  if (!targetChatId) {
    console.error("[TELEGRAM] Telegram chat ID is missing");
    return false;
  }

  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: targetChatId,
        text: message,
        parse_mode: 'HTML',
      }),
    });

    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.ok) {
      console.error("[TELEGRAM] Send failed:", result?.description || response.statusText);
      return false;
    }
    return true;
  } catch (error) {
    console.error("Failed to send Telegram message:", error);
    return false;
  }
}
