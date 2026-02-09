/**
 * YK Bank (Zoho Recruit) job processor.
 *
 * Zoho RSS description format:
 *   Category: {cat} <br><br>Location: {city} {gov} {country} <br><br>
 *   <span id="spandesc">...description...</span>
 *   <span id="spanreq">...requirements...</span>
 *   <span id="spanben">...benefits (boilerplate)...</span>
 *   <a href='...'>Details</a>
 */

import { parse as parseHTML } from 'node-html-parser';
import type { JobItem, ProcessedJob } from '../../../types';
import { decodeHtmlEntities, htmlToText, cleanWhitespace } from '../../../utils/html';

const DEFAULT_COMPANY = 'Yemen Kuwait Bank';

export function processYKBankJob(job: JobItem): ProcessedJob {
  const html = job.description || '';
  const title = decodeHtmlEntities(job.title);

  // Extract category and location from the plain-text prefix before first span
  const category = extractPrefix(html, 'Category');
  const rawLocation = extractPrefix(html, 'Location');
  const location = rawLocation
    ? deduplicateLocation(decodeHtmlEntities(rawLocation))
    : undefined;

  // Parse HTML to extract structured spans
  const root = parseHTML(`<div>${html}</div>`);
  const descEl = root.querySelector('#spandesc');
  const reqEl = root.querySelector('#spanreq');

  const descText = descEl ? cleanWhitespace(htmlToText(descEl.innerHTML)) : '';
  const reqText = reqEl ? cleanWhitespace(htmlToText(reqEl.innerHTML)) : '';

  let fullDescription = descText;
  if (reqText) fullDescription += (fullDescription ? '\n\n' : '') + reqText;

  // Fallback: clean entire HTML if spans not found
  if (!fullDescription) {
    fullDescription = cleanWhitespace(htmlToText(html));
  }

  return {
    title,
    company: DEFAULT_COMPANY,
    link: job.link,
    description: fullDescription || 'No description available',
    imageUrl: job.imageUrl,
    location,
    postedDate: job.pubDate || undefined,
    source: 'ykbank',
    category: category || undefined,
  };
}

/**
 * Extract "Label: value" from Zoho's prefix lines (before the span sections).
 */
function extractPrefix(html: string, label: string): string | null {
  const pattern = new RegExp(`${label}:\\s*(.+?)\\s*<br`, 'i');
  const match = html.match(pattern);
  if (!match) return null;
  const value = match[1].replace(/<[^>]+>/g, '').trim();
  return value || null;
}

/**
 * Deduplicate adjacent identical words in location string.
 * "Sana'a Sana'a Yemen" → "Sana'a, Yemen"
 */
export function deduplicateLocation(location: string): string {
  const parts = location.split(/\s+/);
  const deduped: string[] = [];
  for (const part of parts) {
    if (deduped.length === 0 || deduped[deduped.length - 1].toLowerCase() !== part.toLowerCase()) {
      deduped.push(part);
    }
  }
  return deduped.join(', ');
}
