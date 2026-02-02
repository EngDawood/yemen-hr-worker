/**
 * EOI Yemen job fetching service.
 * Fetches jobs from eoi-ye.com API and converts to JobItem format.
 */

import type { JobItem } from '../types';

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
