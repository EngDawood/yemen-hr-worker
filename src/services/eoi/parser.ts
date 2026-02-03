import type { EOIJob } from './types';

/**
 * Parse job listings from HTML string.
 */
export function parseJobsFromHTML(html: string): EOIJob[] {
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
  detail: { description: string; deadline: string | null; howToApply: string; applicationLinks: string[] }
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
