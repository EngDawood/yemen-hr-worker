/**
 * EOI Yemen job fetching service.
 * Fetches jobs from eoi-ye.com API and converts to JobItem format.
 * Includes detail page scraping for full descriptions, logos, and application info.
 */

import type { JobItem } from '../types';

export interface EOIJobDetail {
  description: string; // Cleaned full description text
  descriptionHtml: string; // Raw HTML from detail-adv div
  imageUrl: string | null; // Company logo URL
  deadline: string | null; // Deadline with time if available
  howToApply: string; // How to apply text
  applicationLinks: string[]; // URLs, emails, phones extracted
}

export interface EOIJob {
  id: string;
  title: string;
  company: string;
  category: string;
  location: string;
  postDate: string;
  deadline: string;
  url: string;
}

interface EOIAPIResponse {
  table_data: string;
  total_data: number;
}

/**
 * Fetch jobs from EOI Yemen API and return as JobItem array.
 */
export async function fetchEOIJobs(): Promise<JobItem[]> {
  const eoiJobs = await fetchEOIJobsRaw();
  return eoiJobs.map(convertToJobItem);
}

/**
 * Fetch raw EOI jobs from API.
 */
export async function fetchEOIJobsRaw(): Promise<EOIJob[]> {
  const response = await fetch('https://eoi-ye.com/live_search/action1?type=0&title=', {
    headers: {
      'X-Requested-With': 'XMLHttpRequest',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json',
      'Referer': 'https://eoi-ye.com/jobs/',
    },
  });

  if (!response.ok) {
    throw new Error(`EOI API fetch failed: ${response.status} ${response.statusText}`);
  }

  const data: EOIAPIResponse = await response.json();

  if (!data.table_data) {
    return [];
  }

  return parseJobsFromHTML(data.table_data);
}

/**
 * Convert EOI job to standard JobItem format.
 */
function convertToJobItem(eoiJob: EOIJob): JobItem {
  // Parse DD-MM-YYYY date to ISO format
  let pubDate = new Date().toISOString();
  if (eoiJob.postDate) {
    const [day, month, year] = eoiJob.postDate.split('-');
    if (day && month && year) {
      pubDate = new Date(`${year}-${month}-${day}`).toISOString();
    }
  }

  // Build description from EOI fields
  const description = buildDescription(eoiJob);

  return {
    id: `eoi-${eoiJob.id}`, // Prefix to avoid ID collision with Yemen HR
    title: eoiJob.title,
    company: eoiJob.company,
    link: eoiJob.url,
    pubDate,
    imageUrl: null, // EOI has no images
    description,
    source: 'eoi',
  };
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Format a DD-MM-YYYY date string to "DD Mon, YYYY" (e.g. "03 Feb, 2026").
 * Preserves any trailing time component (e.g. "03-02-2026 23:59" → "03 Feb, 2026 23:59").
 * Returns the original string if parsing fails.
 */
export function formatEOIDate(dateStr: string): string {
  if (!dateStr) return dateStr;
  const match = dateStr.match(/^(\d{2})-(\d{2})-(\d{4})(.*)$/);
  if (!match) return dateStr;
  const [, day, monthNum, year, rest] = match;
  const monthIdx = parseInt(monthNum, 10) - 1;
  if (monthIdx < 0 || monthIdx > 11) return dateStr;
  return `${day} ${MONTH_NAMES[monthIdx]}, ${year}${rest}`;
}

/**
 * Build a description string from EOI job fields.
 */
function buildDescription(job: EOIJob): string {
  const lines: string[] = [];

  if (job.category) {
    lines.push(`الفئة: ${job.category}`);
  }
  if (job.location) {
    lines.push(`الموقع: ${job.location}`);
  }
  if (job.postDate) {
    lines.push(`تاريخ النشر: ${job.postDate}`);
  }
  if (job.deadline) {
    lines.push(`آخر موعد للتقديم: ${job.deadline}`);
  }

  return lines.join('\n');
}

/**
 * Parse job listings from HTML string.
 */
function parseJobsFromHTML(html: string): EOIJob[] {
  const jobs: EOIJob[] = [];

  // Match each job link block
  const jobRegex = /<a href="(https:\/\/eoi-ye\.com\/jobs\/(\d+)\/)">[\s\S]*?<div class="job-content[^"]*">([\s\S]*?)<\/div><\/div>\s*<\/a>/g;

  let match;
  while ((match = jobRegex.exec(html)) !== null) {
    const url = match[1];
    const id = match[2];
    const content = match[3];

    // Extract data fields
    const dataFields = extractDataFields(content);

    jobs.push({
      id,
      url,
      title: dataFields.title || 'No Title',
      company: dataFields.company || 'Unknown',
      category: dataFields.category || '',
      location: dataFields.location || '',
      postDate: dataFields.postDate || '',
      deadline: dataFields.deadline || '',
    });
  }

  return jobs;
}

/**
 * Extract structured data from job content HTML.
 */
function extractDataFields(content: string): {
  title?: string;
  company?: string;
  category?: string;
  location?: string;
  postDate?: string;
  deadline?: string;
} {
  const result: Record<string, string> = {};

  // Extract post date (first col-md-1 div)
  const postDateMatch = content.match(/<div class="data col-md-1[^"]*">\s*([^<]+)\s*<\/div>/);
  if (postDateMatch) {
    result.postDate = postDateMatch[1].trim();
  }

  // Extract title (col-md-3 div with nested div)
  const titleMatch = content.match(/<div class="data col-md-3[^"]*">[\s\S]*?<div>([^<]+)<\/div>/);
  if (titleMatch) {
    result.title = titleMatch[1].trim();
  }

  // Extract all col-md-2 divs
  const colMd2Regex = /<div class="data col-md-2[^"]*">[\s\S]*?<\/div>\s*([^<]+)<\/div>/g;
  const colMd2Matches: string[] = [];
  let colMatch;
  while ((colMatch = colMd2Regex.exec(content)) !== null) {
    colMd2Matches.push(colMatch[1].trim());
  }

  // Order: category, company, location, deadline
  if (colMd2Matches.length >= 1) result.category = colMd2Matches[0];
  if (colMd2Matches.length >= 2) result.company = colMd2Matches[1];
  if (colMd2Matches.length >= 3) result.location = colMd2Matches[2];
  if (colMd2Matches.length >= 4) result.deadline = colMd2Matches[3];

  return result;
}

// ============================================================================
// Detail Page Scraping
// ============================================================================

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

    const html = await response.text();

    // Detect expired/removed pages
    if (html.includes('هذا الإعلان منتهي') || html.includes('هذه الوظيفة لم تعد متاحة') || html.includes('الصفحة غير موجودة')) {
      console.log(`EOI job expired or removed: ${url}`);
      return null;
    }

    // Extract description from detail-adv div (greedy match to end of div)
    const descMatch = html.match(/<div class="detail-adv[^"]*">([\s\S]*?)<\/div>\s*<\/div>/);
    let descriptionHtml = descMatch ? descMatch[1].trim() : '';

    // If first regex fails, try broader match (content between detail-adv and next major section)
    if (!descriptionHtml) {
      const startIdx = html.indexOf('class="detail-adv');
      if (startIdx > -1) {
        const contentStart = html.indexOf('>', startIdx) + 1;
        // Find end by looking for common section boundaries
        const endPatterns = ['class="div-apply"', 'class="panel"', 'class="sidebar"', 'class="col-md-4"'];
        let endIdx = html.length;
        for (const pat of endPatterns) {
          const idx = html.indexOf(pat, contentStart);
          if (idx > -1 && idx < endIdx) endIdx = idx;
        }
        descriptionHtml = html.substring(contentStart, endIdx).trim();
      }
    }

    // Strip MS Word artifacts before processing
    descriptionHtml = descriptionHtml
      .replace(/<o:p[^>]*>[\s\S]*?<\/o:p>/gi, '')
      .replace(/<!\[if[^>]*>[\s\S]*?<!\[endif\]>/gi, '')
      .replace(/class="Mso[^"]*"/gi, '')
      .replace(/style="[^"]*mso-[^"]*"/gi, '');

    // Extract company logo (from storage/users path, skip site logos)
    const logoMatches = [...html.matchAll(/<img[^>]+src="(https:\/\/eoi-ye\.com\/storage\/users\/[^"]+)"/g)];
    const imageUrl = logoMatches.length > 0 ? logoMatches[0][1] : null;

    // Extract deadline: <span class="end_date">الموعد الاخير : DD-MM-YYYY </span><span> الوقت: HH:MM</span>
    const deadlineDateMatch = html.match(/الموعد الاخير\s*:\s*(\d{2}-\d{2}-\d{4})/);
    const deadlineTimeMatch = html.match(/الوقت:\s*(\d{2}:\d{2})/);
    let deadline: string | null = null;
    if (deadlineDateMatch) {
      deadline = deadlineDateMatch[1];
      if (deadlineTimeMatch) {
        deadline += ' ' + deadlineTimeMatch[1];
      }
    }

    // Extract how-to-apply info
    const applyData = extractHowToApply(descriptionHtml);

    // Clean description
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

  // Decode HTML entities
  text = text.replace(/&#x2F;/g, '/');
  text = text.replace(/&#x27;/g, "'");
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&[a-z]+;/gi, ' ');

  // Clean whitespace
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n\s*\n\s*\n/g, '\n\n');
  text = text.trim();

  return text;
}

/**
 * Extract "How to Apply" section from EOI job HTML.
 */
export function extractHowToApply(html: string): { text: string; links: string[]; emails: string[]; phones: string[] } {
  const links: string[] = [];
  const emails: string[] = [];
  const phones: string[] = [];

  // Find how-to-apply section (various possible headings, tolerant of HTML tags between words but not arbitrary text)
  const applyMatch = html.match(/(?:How(?:\s|<[^>]*>)*to(?:\s|<[^>]*>)*Apply|طريقة\s+التقديم|Application\s+(?:Information|Process)|كيفية\s+التقديم)([\s\S]*?)$/i);
  const applyHtml = applyMatch ? applyMatch[1] : '';

  // Always search full HTML for application links (they may appear outside the apply section)
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
 * Build an enriched description combining metadata and detail page content.
 */
export function buildEnrichedDescription(
  job: { category?: string; location?: string; postDate?: string; deadline?: string },
  detail: EOIJobDetail
): string {
  const lines: string[] = [];

  if (job.category) lines.push(`Category: ${job.category}`);
  if (job.location) lines.push(`Location: ${job.location}`);
  if (job.postDate) lines.push(`Posted: ${job.postDate}`);
  if (detail.deadline || job.deadline) lines.push(`Deadline: ${detail.deadline || job.deadline}`);

  if (detail.description) {
    lines.push('');
    lines.push(detail.description);
  }

  if (detail.howToApply) {
    lines.push('');
    lines.push('How to Apply:');
    lines.push(detail.howToApply);
  }

  if (detail.applicationLinks.length > 0) {
    lines.push('');
    lines.push('Application Links:');
    for (const link of detail.applicationLinks) {
      lines.push(link);
    }
  }

  return lines.join('\n');
}

// ============================================================================
// RSS Feed Generation (preserved for /rss/eoi-ye endpoints)
// ============================================================================

/**
 * Escape XML special characters.
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Generate Atom feed XML from jobs.
 */
export function generateAtomFeed(jobs: EOIJob[]): string {
  const now = new Date().toISOString();

  const entries = jobs.map((job) => {
    // Parse date (DD-MM-YYYY format)
    let pubDate = now;
    if (job.postDate) {
      const [day, month, year] = job.postDate.split('-');
      if (day && month && year) {
        pubDate = new Date(`${year}-${month}-${day}`).toISOString();
      }
    }

    const description = `
<p><strong>المسمى الوظيفي:</strong> ${escapeXml(job.title)}</p>
<p><strong>الجهة:</strong> ${escapeXml(job.company)}</p>
<p><strong>الفئة:</strong> ${escapeXml(job.category)}</p>
<p><strong>الموقع:</strong> ${escapeXml(job.location)}</p>
<p><strong>تاريخ النشر:</strong> ${escapeXml(job.postDate)}</p>
<p><strong>آخر موعد:</strong> ${escapeXml(job.deadline)}</p>
    `.trim();

    return `
  <entry>
    <id>${escapeXml(job.url)}</id>
    <title>${escapeXml(job.title)}</title>
    <author><name>${escapeXml(job.company)}</name></author>
    <link rel="alternate" type="text/html" href="${escapeXml(job.url)}"/>
    <published>${pubDate}</published>
    <updated>${pubDate}</updated>
    <content type="html"><![CDATA[${description}]]></content>
    <category term="${escapeXml(job.category)}"/>
  </entry>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>EOI Yemen - الوظائف</title>
  <subtitle>Latest job listings from eoi-ye.com</subtitle>
  <link rel="self" type="application/atom+xml" href="https://eoi-ye.com/jobs"/>
  <link rel="alternate" type="text/html" href="https://eoi-ye.com/jobs"/>
  <id>https://eoi-ye.com/jobs</id>
  <updated>${now}</updated>
  <generator>EOI Yemen RSS Generator</generator>
${entries}
</feed>`;
}

/**
 * Generate RSS 2.0 feed XML from jobs.
 */
export function generateRSSFeed(jobs: EOIJob[]): string {
  const now = new Date().toUTCString();

  const items = jobs.map((job) => {
    // Parse date (DD-MM-YYYY format)
    let pubDate = now;
    if (job.postDate) {
      const [day, month, year] = job.postDate.split('-');
      if (day && month && year) {
        pubDate = new Date(`${year}-${month}-${day}`).toUTCString();
      }
    }

    const description = `
المسمى الوظيفي: ${job.title}
الجهة: ${job.company}
الفئة: ${job.category}
الموقع: ${job.location}
تاريخ النشر: ${job.postDate}
آخر موعد: ${job.deadline}
    `.trim();

    return `
    <item>
      <title>${escapeXml(job.title)} - ${escapeXml(job.company)}</title>
      <link>${escapeXml(job.url)}</link>
      <guid isPermaLink="true">${escapeXml(job.url)}</guid>
      <pubDate>${pubDate}</pubDate>
      <description><![CDATA[${description}]]></description>
      <category>${escapeXml(job.category)}</category>
      <author>${escapeXml(job.company)}</author>
    </item>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>EOI Yemen - الوظائف</title>
    <description>Latest job listings from eoi-ye.com</description>
    <link>https://eoi-ye.com/jobs</link>
    <language>ar</language>
    <lastBuildDate>${now}</lastBuildDate>
    <atom:link href="https://eoi-ye.com/jobs" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>`;
}
