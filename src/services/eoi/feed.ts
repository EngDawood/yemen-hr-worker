import type { EOIJob } from './types';

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
