export async function sendTelegramMessage(message: string, chatId?: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const defaultChatId = process.env.TELEGRAM_VIP_CHAT_ID || process.env.TELEGRAM_DEFAULT_CHAT_ID || '@4xlife_signal_vip';
  const targetChatId = chatId || defaultChatId;
  console.log('[TELEGRAM] sendMessage target', {
    target: targetChatId,
    source: chatId ? 'explicit argument' : process.env.TELEGRAM_FREE_CHAT_ID ? 'TELEGRAM_FREE_CHAT_ID' : process.env.TELEGRAM_DEFAULT_CHAT_ID ? 'TELEGRAM_DEFAULT_CHAT_ID' : 'fallback @forxlife3',
  });

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
  } catch (error: any) {
    console.error("[TELEGRAM] sendMessage exception:", error?.stack || error);
    return false;
  }
}

export async function sendTelegramToVipAndFree(message: string) {
  const targets = [
    ['VIP', process.env.TELEGRAM_VIP_CHAT_ID],
    ['FREE', process.env.TELEGRAM_FREE_CHAT_ID],
  ] as const;
  const results = await Promise.all(targets.map(async ([channel, chatId]) => {
    if (!chatId) {
      console.error(`[TELEGRAM] ${channel} channel is not configured`);
      return false;
    }
    const sent = await sendTelegramMessage(message, chatId);
    console.log(`[TELEGRAM] ${channel} outcome message ${sent ? 'sent' : 'failed'}`);
    return sent;
  }));
  return results.every(Boolean);
}

export async function sendTelegramOutcomeToVipAndFree(vipMessage: string, freeMessage: string) {
  const results = await Promise.all([
    sendTelegramMessage(vipMessage, process.env.TELEGRAM_VIP_CHAT_ID || undefined),
    sendTelegramMessage(freeMessage, process.env.TELEGRAM_FREE_CHAT_ID || undefined),
  ]);
  return results.every(Boolean);
}

export function formatFreeTpHitMessage(pair: string, direction: string, level: string, price: unknown, entry?: unknown) {
  return `✅ <b>TP HIT — ${pair} (${direction})</b>\n`
    + `Entry: ${entry ?? 'N/A'}\n`
    + `${level}: ${price} ✅\n\n`
    + `You're seeing the result after the move.\n`
    + `VIP members get the signal before it happens, with the full execution plan.\n\n`
    + `🔥 <b>Member Benefits</b>\n`
    + `- Trade ideas with clear scenarios 📊\n`
    + `- Entry / SL / TP levels 📍\n`
    + `- Real-time updates 🔔\n`
    + `- Risk management framework 🛡️\n`
    + `- Market insights 🧠\n\n`
    + `📩 <b>Contact / Access:</b>\n`
    + `Message: @TOFIFX1`;
}
