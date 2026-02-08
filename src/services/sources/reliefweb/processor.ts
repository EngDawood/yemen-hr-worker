/**
 * ReliefWeb job processor.
 * Extracts structured metadata from ReliefWeb's HTML description content.
 *
 * ReliefWeb descriptions contain structured divs for metadata
 * (organization, country, closing date) followed by HTML job content.
 */

import type { JobItem, ProcessedJob } from '../../../types';
import { decodeHtmlEntities, cleanWhitespace } from '../../../utils/html';

/** ReliefWeb RSS feed logo (256x256 PNG) — fallback when RSS items have no image */
const RELIEFWEB_LOGO_URL =
  'https://reliefweb.int/themes/custom/common_design_subtheme/img/logos/ReliefWeb_RSS_logo.png';

/**
 * Process a ReliefWeb job item.
 * Extracts organization, country, closing date, and how-to-apply from the HTML description.
 *
 * @param job - Raw job from RSS feed with HTML description
 * @returns Processed job ready for AI summarization
 */
export function processReliefWebJob(job: JobItem): ProcessedJob {
  const html = job.description || '';

  // Extract structured metadata from ReliefWeb's tag divs
  const organization = extractTagValue(html, 'source', 'Organization');
  const country = extractTagValue(html, 'country', 'Country');
  const closingDate = extractClosingDate(html);

  // Extract "How to apply" section
  const { howToApply, applicationLinks } = extractHowToApply(html);

  // Clean HTML to plain text
  const description = cleanReliefWebHTML(html);

  return {
    title: job.title,
    company: organization || job.company,
    link: job.link,
    description: description || 'No description available',
    imageUrl: job.imageUrl || RELIEFWEB_LOGO_URL,
    location: country || undefined,
    deadline: closingDate || undefined,
    howToApply: howToApply || undefined,
    applicationLinks: applicationLinks.length > 0 ? applicationLinks : undefined,
    source: 'reliefweb',
  };
}

/**
 * Extract a value from ReliefWeb's structured tag divs.
 * Format: <div class="tag {className}">{label}: {value}</div>
 */
function extractTagValue(html: string, className: string, label: string): string | null {
  const pattern = new RegExp(
    `<div\\s+class="tag\\s+${className}"[^>]*>\\s*${label}:\\s*(.+?)\\s*</div>`,
    'i'
  );
  const match = html.match(pattern);
  return match ? match[1].trim() : null;
}

/**
 * Extract closing date from ReliefWeb's date div.
 * Format: <div class="date closing">Closing date: 20 Feb 2026</div>
 */
function extractClosingDate(html: string): string | null {
  const pattern = /class="date\s+closing"[^>]*>\s*Closing date:\s*(.+?)\s*<\/div>/i;
  const match = html.match(pattern);
  return match ? match[1].trim() : null;
}

/**
 * Extract "How to apply" section and application links from HTML.
 */
function extractHowToApply(html: string): { howToApply: string | null; applicationLinks: string[] } {
  const links: string[] = [];

  // Find content after <h2>How to apply</h2>
  const howToApplyMatch = html.match(/<h2>\s*How to apply\s*<\/h2>([\s\S]*?)$/i);
  if (!howToApplyMatch) {
    return { howToApply: null, applicationLinks: links };
  }

  const section = howToApplyMatch[1];

  // Extract URLs from href attributes
  const hrefMatches = section.matchAll(/href="([^"]+)"/gi);
  for (const m of hrefMatches) {
    const url = m[1];
    if (url.startsWith('http') || url.startsWith('mailto:')) {
      links.push(url);
    }
  }

  // Extract email addresses
  const emailMatches = section.matchAll(/[\w.+-]+@[\w-]+\.[\w.]+/g);
  for (const m of emailMatches) {
    const email = m[0];
    if (!links.includes(email) && !links.includes(`mailto:${email}`)) {
      links.push(email);
    }
  }

  // Clean HTML to text for the howToApply field
  let text = section
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li>/gi, '- ')
    .replace(/<[^>]+>/g, ' ');
  text = decodeHtmlEntities(text);
  text = cleanWhitespace(text);

  return {
    howToApply: text || null,
    applicationLinks: links,
  };
}

/**
 * Clean ReliefWeb HTML description to plain text.
 * Removes metadata divs (tag, date) and converts remaining HTML to text.
 */
function cleanReliefWebHTML(html: string): string {
  let text = html;

  // Remove structured metadata divs (tag source, tag country, date closing)
  text = text.replace(/<div\s+class="(?:tag|date)\s+[^"]*"[^>]*>[^<]*<\/div>/gi, '');

  // Convert HTML to text
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/p>/gi, '\n');
  text = text.replace(/<\/div>/gi, '\n');
  text = text.replace(/<\/li>/gi, '\n');
  text = text.replace(/<li>/gi, '- ');
  text = text.replace(/<\/h[1-6]>/gi, '\n');
  text = text.replace(/<h[1-6][^>]*>/gi, '\n');
  text = text.replace(/<[^>]+>/g, ' ');

  text = decodeHtmlEntities(text);
  text = cleanWhitespace(text);

  return text;
}
