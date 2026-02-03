interface TelegramResponse {
  ok: boolean;
  description?: string;
  result?: unknown;
}

/**
 * Send a text message to Telegram.
 */
export async function sendTextMessage(
  botToken: string,
  chatId: string,
  text: string
): Promise<boolean> {
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: chatId,
          text: text,
          parse_mode: 'HTML',
          disable_web_page_preview: false,
        }),
      }
    );

    const data: TelegramResponse = await response.json();

    if (!data.ok) {
      console.error('Telegram sendMessage error:', data.description);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error sending Telegram message:', error);
    return false;
  }
}

/**
 * Send a photo with caption to Telegram.
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

  const text = `⚠️ <b>Yemen HR Bot Alert</b>\n\n${message}\n\n<i>${new Date().toISOString()}</i>`;
  await sendTextMessage(botToken, String(adminChatId), text);
}

/**
 * Send a photo with caption to Telegram.
 */
export async function sendPhotoMessage(
  botToken: string,
  chatId: string,
  imageUrl: string,
  caption: string
): Promise<boolean> {
  try {
    // First, try to fetch the image
    const imageResponse = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    if (!imageResponse.ok) {
      console.error(`Failed to fetch image: ${imageResponse.status}`);
      // Fallback to text-only message
      return sendTextMessage(botToken, chatId, caption);
    }

    const imageBlob = await imageResponse.blob();

    // Create FormData for multipart upload
    const formData = new FormData();
    formData.append('chat_id', chatId);
    formData.append('caption', caption);
    formData.append('photo', imageBlob, 'photo.jpg');

    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/sendPhoto`,
      {
        method: 'POST',
        body: formData,
      }
    );

    const data: TelegramResponse = await response.json();

    if (!data.ok) {
      console.error('Telegram sendPhoto error:', data.description);
      // Fallback to text-only message
      return sendTextMessage(botToken, chatId, caption);
    }

    return true;
  } catch (error) {
    console.error('Error sending Telegram photo:', error);
    // Fallback to text-only message
    return sendTextMessage(botToken, chatId, caption);
  }
}
