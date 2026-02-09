import type { TelegramMessage, JobSource } from '../types';
import { stripMarkdown } from './html';

const MAX_CAPTION_LENGTH = 1024; // Telegram photo caption limit (visible text after entities parsing)
const MAX_TEXT_LENGTH = 4096; // Telegram text message limit (visible text after entities parsing)
const SEPARATOR = '━━━━━━━━━━━━━━━━━━━━';
const DEFAULT_LINKEDIN_URL = 'https://www.linkedin.com/in/eng-dawood-saleh';

const SOURCE_HASHTAGS: Record<JobSource, string> = {
  yemenhr: '#YemenHR',
  eoi: '#EOI',
  reliefweb: '#ReliefWeb',
  ykbank: '#YKBank',
  kuraimi: '#KuraimiBank',
  qtb: '#QTBBank',
  yldf: '#YLDF',
};

/**
 * Escape HTML special characters as required by Telegram HTML parse_mode.
 * Per Telegram docs: all <, > and & that are not part of a tag must be escaped.
 */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Calculate visible text length after HTML entities/tags are stripped.
 * This is what Telegram counts toward the character limit.
 */
export function visibleLength(html: string): number {
  return html
    .replace(/<[^>]+>/g, '')       // Strip HTML tags (visible text of <a> links remains)
    .replace(/&amp;/g, '&')        // Each entity counts as 1 char
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .length;
}

/**
 * Truncate text to fit within maxVisibleLength, cutting at the last separator (━━━)
 * that keeps us under the limit. If no separator fits, cut at last newline.
 * Uses visible length (after HTML entity decoding) for measurement.
 */
function truncateAtSeparator(text: string, maxVisibleLength: number): string {
  if (visibleLength(text) <= maxVisibleLength) return text;

  // Find all separator positions
  let pos = 0;
  let lastFittingSep = -1;
  while (true) {
    const idx = text.indexOf(SEPARATOR, pos);
    if (idx === -1) break;
    const candidate = text.substring(0, idx);
    if (visibleLength(candidate) > maxVisibleLength) break;
    lastFittingSep = idx;
    pos = idx + SEPARATOR.length;
  }

  // Cut at the last separator that fits
  if (lastFittingSep > 0) {
    return text.substring(0, lastFittingSep).trim();
  }

  // No separator fits — cut at last newline within limit
  // Use raw position as approximation, then verify
  const cut = text.lastIndexOf('\n', maxVisibleLength + 50);
  if (cut > 0) {
    const candidate = text.substring(0, cut).trim() + '...';
    if (visibleLength(candidate) <= maxVisibleLength) return candidate;
  }
  // Hard cut — walk back to find a length that fits
  let end = Math.min(text.length, maxVisibleLength + 50);
  while (end > 0 && visibleLength(text.substring(0, end) + '...') > maxVisibleLength) {
    end -= 20;
  }
  return text.substring(0, Math.max(end, 50)).trim() + '...';
}

/**
 * Format the final Telegram message with footer.
 * - Escapes HTML special chars in content
 * - Uses <a> tags for links (URLs in href don't count toward char limit)
 * - Enforces Telegram limits: 1024 for photo captions, 4096 for text
 * - Falls back to text-only if caption limit cannot be met
 */
export function formatTelegramMessage(
  summary: string,
  jobLink: string,
  imageUrl: string | null,
  linkedinUrl?: string,
  source?: JobSource,
  category?: string
): TelegramMessage {
  const LINKEDIN_URL = linkedinUrl || DEFAULT_LINKEDIN_URL;

  // Clean markdown formatting, then escape HTML special chars
  let cleanedSummary = stripMarkdown(summary);
  cleanedSummary = escapeHtml(cleanedSummary);

  // Validate image URL
  let validImageUrl: string | null = null;
  if (
    imageUrl &&
    typeof imageUrl === 'string' &&
    imageUrl.length > 0 &&
    imageUrl.startsWith('http')
  ) {
    validImageUrl = imageUrl;
  } else {
    console.log(`[DEBUG] Missing/invalid imageUrl for job. Received:`, imageUrl);
  }

  // Build metadata line: #YemenHR | #تطوير
  let metadataLine = '';
  if (source) {
    const hashtag = SOURCE_HASHTAGS[source];
    const categoryHashtag = category ? `#${category.replace(/\s+/g, '_')}` : '';
    metadataLine = categoryHashtag ? `${hashtag} | ${categoryHashtag}` : hashtag;
  }

  const footer = `

━━━━━━━━━━━━━━━━━━━━
${metadataLine ? metadataLine + '\n\n' : ''}🔗 رابط الوظيفة
${jobLink}
━━━━━━━
وظائف اليمن
https://t.me/hr_yemen
━━━━━━━
تابعونا على linkedin
${LINKEDIN_URL}
━━━━━━━
نتمنى لكم التوفيق! ❤️`;

  let fullMessage = cleanedSummary + footer;
  const limit = validImageUrl ? MAX_CAPTION_LENGTH : MAX_TEXT_LENGTH;
  const currentVisible = visibleLength(fullMessage);

  console.log(`[FORMAT] Visible chars: ${currentVisible}/${limit} (raw: ${fullMessage.length})${currentVisible > limit ? ` — OVER by ${currentVisible - limit}` : ''}`);

  // Enforce limit using visible length
  if (currentVisible > limit) {
    const footerVisible = visibleLength(footer);
    const maxSummaryVisible = limit - footerVisible - 4;
    cleanedSummary = truncateAtSeparator(cleanedSummary, maxSummaryVisible);
    fullMessage = cleanedSummary + footer;
    console.log(`[FORMAT] After truncation: ${visibleLength(fullMessage)}/${limit}`);
  }

  // If photo caption still over 1024 after truncation, fall back to text-only
  if (validImageUrl && visibleLength(fullMessage) > MAX_CAPTION_LENGTH) {
    console.log(`[FORMAT] Caption ${visibleLength(fullMessage)} > ${MAX_CAPTION_LENGTH}, falling back to text-only`);
    validImageUrl = null;

    // Re-expand summary for text (4096 limit)
    cleanedSummary = escapeHtml(stripMarkdown(summary));
    fullMessage = cleanedSummary + footer;

    // Truncate for text limit if needed
    if (visibleLength(fullMessage) > MAX_TEXT_LENGTH) {
      const footerVisible = visibleLength(footer);
      const maxSummaryVisible = MAX_TEXT_LENGTH - footerVisible - 4;
      cleanedSummary = truncateAtSeparator(cleanedSummary, maxSummaryVisible);
      fullMessage = cleanedSummary + footer;
    }
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
