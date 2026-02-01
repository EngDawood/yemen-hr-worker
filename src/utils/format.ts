import type { TelegramMessage } from '../types';

const MAX_CAPTION_LENGTH = 1024; // Telegram photo caption limit
const LINKEDIN_URL = 'https://www.linkedin.com/in/eng-dawood-saleh';

/**
 * Format the final Telegram message with footer.
 * Uses compact footer for photos (1024 char limit), full footer for text.
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

  // Compact footer for photos (to fit 1024 char limit)
  const compactFooter = `

━━━━━━━━━━━━━━━━━━━━
🔗 رابط الوظيفة:
${jobLink}

❤️ نتمنى لكم التوفيق! تابعونا للمزيد:
${LINKEDIN_URL}`;

  // Full footer for text messages (4096 char limit)
  const fullFooter = `

━━━━━━━━━━━━━━━━━━━━
🔗 رابط الوظيفة:
${jobLink}

❤️ نتمنى لكم التوفيق! تابعونا للمزيد:
${LINKEDIN_URL}`;

  // Choose footer based on whether we have an image
  const footer = validImageUrl ? compactFooter : fullFooter;
  let fullMessage = cleanedSummary + footer;

  // Truncate for photo captions if needed
  if (validImageUrl && fullMessage.length > MAX_CAPTION_LENGTH) {
    const truncateAt = MAX_CAPTION_LENGTH - compactFooter.length - 10; // Leave room for "..."
    cleanedSummary = cleanedSummary.substring(0, truncateAt).trim() + '...';
    fullMessage = cleanedSummary + compactFooter;
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
