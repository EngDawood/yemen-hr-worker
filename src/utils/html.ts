/**
 * Shared HTML cleaning utilities.
 * Used by all source processors (Yemen HR, EOI, ReliefWeb) for HTML-to-text conversion.
 */

/**
 * Decode common HTML entities to their characters.
 */
export function decodeHtmlEntities(text: string): string {
  // Decode numeric entities first: &#x28; → (, &#39; → '
  text = text.replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  text = text.replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)));
  // Named entities
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&[a-z]+;/gi, ' ');
  return text;
}

/**
 * Convert HTML block elements to text with newlines, then strip remaining tags.
 * Does NOT decode entities — call decodeHtmlEntities() separately if needed.
 */
export function htmlToText(html: string): string {
  let text = html;
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/p>/gi, '\n');
  text = text.replace(/<\/div>/gi, '\n');
  text = text.replace(/<\/li>/gi, '\n');
  text = text.replace(/<li[^>]*>/gi, '- ');
  text = text.replace(/<\/h[1-6]>/gi, '\n');
  text = text.replace(/<h[1-6][^>]*>/gi, '\n');
  // Strip remaining HTML tags
  text = text.replace(/<[^>]+>/g, '');
  return decodeHtmlEntities(text);
}

/**
 * Collapse whitespace: multiple spaces to single, 3+ newlines to 2, then trim.
 */
export function cleanWhitespace(text: string): string {
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n\s*\n\s*\n/g, '\n\n');
  return text.trim();
}

/**
 * Strip markdown formatting (bold, italic, links).
 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*/g, '')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1: $2')
    .replace(/_([^_]+)_/g, '$1');
}
