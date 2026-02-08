import type { EOIJobDetail } from './types';
import { decodeHtmlEntities, cleanWhitespace } from '../../../utils/html';

/**
 * Decode a Cloudflare email-obfuscation hex string.
 * First byte is XOR key, remaining bytes are the encoded email.
 */
function decodeCfEmail(encoded: string): string {
  const key = parseInt(encoded.substring(0, 2), 16);
  let email = '';
  for (let i = 2; i < encoded.length; i += 2) {
    email += String.fromCharCode(parseInt(encoded.substring(i, i + 2), 16) ^ key);
  }
  return email;
}

/**
 * Replace all Cloudflare email-obfuscated tags in HTML with decoded emails.
 * Handles: <a href="/cdn-cgi/l/email-protection#hex"...>[email&#160;protected]</a>
 *          <span class="__cf_email__" data-cfemail="hex">[email&#160;protected]</span>
 */
export function decodeCfEmails(html: string): string {
  // <a href="/cdn-cgi/l/email-protection#hex">...</a>
  html = html.replace(
    /<a[^>]+href="\/cdn-cgi\/l\/email-protection#([0-9a-fA-F]+)"[^>]*>[\s\S]*?<\/a>/g,
    (_, hex) => decodeCfEmail(hex)
  );
  // <span class="__cf_email__" data-cfemail="hex">...</span>
  html = html.replace(
    /<span[^>]+data-cfemail="([0-9a-fA-F]+)"[^>]*>[\s\S]*?<\/span>/g,
    (_, hex) => decodeCfEmail(hex)
  );
  return html;
}

/**
 * Clean EOI HTML description to plain text.
 */
export function cleanEOIDescription(html: string): string {
  if (!html) return '';

  let text = html;

  // Strip MS Word artifacts
  text = text.replace(/<o:p[^>]*>[\s\S]*?<\/o:p>/gi, '');
  text = text.replace(/<!\[if[^>]*>[\s\S]*?<!\[endif\]>/gi, '');
  // Strip base64 embedded images
  text = text.replace(/<img[^>]+src="data:[^"]*"[^>]*>/gi, '');

  // Convert headings to text with newlines
  text = text.replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, '\n$1\n');

  // Convert list items to bullets
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '• $1\n');
  text = text.replace(/<ul[^>]*>|<\/ul>/gi, '\n');
  text = text.replace(/<ol[^>]*>|<\/ol>/gi, '\n');

  // Convert block elements to newlines
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/p>/gi, '\n');
  text = text.replace(/<\/div>/gi, '\n');
  text = text.replace(/<\/tr>/gi, '\n');
  text = text.replace(/<td[^>]*>/gi, ' | ');

  // Preserve link text with URL
  text = text.replace(/<a[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)');

  // Strip remaining tags
  text = text.replace(/<[^>]+>/g, '');

  text = decodeHtmlEntities(text);
  text = cleanWhitespace(text);

  return text;
}

/**
 * Extract "How to Apply" section from EOI job HTML.
 */
export function extractHowToApply(html: string): { text: string; links: string[]; emails: string[]; phones: string[] } {
  const links: string[] = [];
  const emails: string[] = [];
  const phones: string[] = [];

  // Find how-to-apply section
  const applyMatch = html.match(/(?:How(?:\s|<[^>]*>)*to(?:\s|<[^>]*>)*Apply|طريقة\s+التقديم|Application\s+(?:Information|Process)|كيفية\s+التقديم)([\s\S]*?)$/i);
  const applyHtml = applyMatch ? applyMatch[1] : '';

  // Always search full HTML for application links
  const searchHtml = html;

  // Extract URLs (Google Forms, websites)
  const urlRegex = /https?:\/\/[^\s"'<>)]+/g;
  const urlMatches = searchHtml.match(urlRegex);
  if (urlMatches) {
    for (const url of urlMatches) {
      // Only include application-relevant URLs
      if (url.includes('forms.gle') || url.includes('forms.google') ||
          url.includes('docs.google.com/forms') || url.includes('apply') ||
          url.includes('recruitment') || url.includes('careers') ||
          url.includes('jobs') || url.includes('submit') ||
          url.includes('smartsheet') || url.includes('surveymonkey') ||
          url.includes('kobo') || url.includes('reliefweb')) {
        if (!links.includes(url)) links.push(url);
      }
    }
  }

  // Extract email addresses
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const emailMatches = searchHtml.match(emailRegex);
  if (emailMatches) {
    for (const email of emailMatches) {
      if (!emails.includes(email)) emails.push(email);
    }
  }

  // Extract phone/WhatsApp numbers
  const phoneRegex = /(?:\+?967|00967)[\s-]?\d[\s-]?\d{2,3}[\s-]?\d{3,4}[\s-]?\d{0,3}/g;
  const phoneMatches = searchHtml.match(phoneRegex);
  if (phoneMatches) {
    for (const phone of phoneMatches) {
      const cleaned = phone.replace(/[\s-]/g, '');
      if (!phones.includes(cleaned)) phones.push(cleaned);
    }
  }

  // Build text summary
  let text = '';
  if (applyHtml) {
    text = cleanEOIDescription(applyHtml);
  }

  return { text, links, emails, phones };
}

/**
 * Extract description HTML from the detail-adv div.
 * Tries a precise regex first, then falls back to a broader boundary-based match.
 */
function extractDescriptionHtml(html: string): string {
  const descMatch = html.match(/<div class="detail-adv[^"]*">([\s\S]*?)<\/div>\s*<\/div>/);
  if (descMatch) return descMatch[1].trim();

  const startIdx = html.indexOf('class="detail-adv');
  if (startIdx === -1) return '';

  const contentStart = html.indexOf('>', startIdx) + 1;
  const endPatterns = ['class="div-apply"', 'class="panel"', 'class="sidebar"', 'class="col-md-4"'];
  let endIdx = html.length;
  for (const pat of endPatterns) {
    const idx = html.indexOf(pat, contentStart);
    if (idx > -1 && idx < endIdx) endIdx = idx;
  }
  return html.substring(contentStart, endIdx).trim();
}

/**
 * Strip MS Word artifacts (Office XML, Mso classes/styles) from HTML.
 */
function stripMSWordArtifacts(html: string): string {
  return html
    .replace(/<o:p[^>]*>[\s\S]*?<\/o:p>/gi, '')
    .replace(/<!\[if[^>]*>[\s\S]*?<!\[endif\]>/gi, '')
    .replace(/class="Mso[^"]*"/gi, '')
    .replace(/style="[^"]*mso-[^"]*"/gi, '');
}

/**
 * Extract deadline date and optional time from EOI page HTML.
 */
function extractDeadline(html: string): string | null {
  const dateMatch = html.match(/الموعد الاخير\s*:\s*(\d{2}-\d{2}-\d{4})/);
  if (!dateMatch) return null;

  let deadline = dateMatch[1];
  const timeMatch = html.match(/الوقت:\s*(\d{2}:\d{2})/);
  if (timeMatch) {
    deadline += ' ' + timeMatch[1];
  }
  return deadline;
}

/**
 * Extract company logo URL from EOI page HTML.
 */
function extractLogoUrl(html: string): string | null {
  const logoMatches = [...html.matchAll(/<img[^>]+src="(https:\/\/eoi-ye\.com\/storage\/users\/[^"]+)"/g)];
  return logoMatches.length > 0 ? logoMatches[0][1] : null;
}

/**
 * Fetch and parse a single EOI job detail page.
 * Returns null on any failure (HTTP error, timeout, expired page).
 */
export async function fetchEOIJobDetail(url: string): Promise<EOIJobDetail | null> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html',
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      console.error(`EOI detail fetch failed: ${response.status} for ${url}`);
      return null;
    }

    let html = await response.text();

    // Decode Cloudflare email obfuscation before any processing
    html = decodeCfEmails(html);

    // Detect expired/removed pages
    if (html.includes('هذا الإعلان منتهي') || html.includes('هذه الوظيفة لم تعد متاحة') || html.includes('الصفحة غير موجودة')) {
      console.log(`EOI job expired or removed: ${url}`);
      return null;
    }

    let descriptionHtml = extractDescriptionHtml(html);
    descriptionHtml = stripMSWordArtifacts(descriptionHtml);

    const imageUrl = extractLogoUrl(html);
    const deadline = extractDeadline(html);
    const applyData = extractHowToApply(descriptionHtml);
    const description = cleanEOIDescription(descriptionHtml);

    return {
      description,
      descriptionHtml,
      imageUrl,
      deadline,
      howToApply: applyData.text,
      applicationLinks: [...applyData.links, ...applyData.emails, ...applyData.phones],
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      console.error(`EOI detail fetch timed out: ${url}`);
    } else {
      console.error(`EOI detail fetch error for ${url}:`, error);
    }
    return null;
  }
}
