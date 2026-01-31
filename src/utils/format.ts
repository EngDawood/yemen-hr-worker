import type { TelegramMessage } from '../types';

/**
 * Format the final Telegram message with footer.
 * Ported from n8n "Prepare Telegram Message" node.
 */
export function formatTelegramMessage(
  summary: string,
  jobLink: string,
  imageUrl: string | null
): TelegramMessage {
  // Clean any markdown formatting from summary
  let cleanedSummary = summary
    .replace(/\*\*/g, '') // Remove bold
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1: $2') // Convert [text](url) to text: url
    .replace(/_([^_]+)_/g, '$1'); // Remove italic

  // Add footer with plain text social links (no markdown)
  const footer = `

━━━━━━━━━━━━━━━━━━━━
🔗 رابط الوظيفة في YemenHR:
${jobLink}

تابعونا على:
Facebook: https://facebook.com/dawo5d
Instagram: https://instagram.com/dawo5d`;

  const fullMessage = cleanedSummary + footer;

  // Validate image URL
  let validImageUrl: string | null = null;
  if (
    imageUrl &&
    typeof imageUrl === 'string' &&
    imageUrl.length > 0 &&
    imageUrl.startsWith('http')
  ) {
    validImageUrl = imageUrl;
  }

  return {
    fullMessage,
    imageUrl: validImageUrl,
    hasImage: validImageUrl !== null,
  };
}

/**
 * Delay execution for rate limiting.
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
