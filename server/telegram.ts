export async function sendTelegramMessage(message: string, chatId?: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const defaultChatId = process.env.TELEGRAM_DEFAULT_CHAT_ID;
  const targetChatId = chatId || defaultChatId;

  if (!token || !targetChatId) {
    console.log("Telegram bot token or chat ID not configured. Skipping message:", message);
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

    if (!response.ok) {
        throw new Error(`Telegram API Error: ${response.status} ${response.statusText}`);
    }
    return true;
  } catch (error) {
    console.error("Failed to send Telegram message:", error);
    return false;
  }
}
