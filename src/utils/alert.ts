/**
 * Alert utility for error notifications.
 */

/**
 * Send alert to admin via Telegram.
 */
export async function sendAlert(
  botToken: string,
  adminChatId: string | undefined,
  message: string
): Promise<void> {
  if (!adminChatId) return;

  try {
    const text = `⚠️ *Yemen HR Bot Alert*\n\n${message}\n\n_${new Date().toISOString()}_`;

    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: adminChatId,
        text: text,
        parse_mode: 'Markdown',
      }),
    });
  } catch (error) {
    console.error('Failed to send alert:', error);
  }
}
