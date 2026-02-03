import type { JobItem } from '../../types';
import type { EOIJob, EOIJobDetail, EOIAPIResponse } from './types';
import { parseJobsFromHTML, cleanEOIDescription, extractHowToApply } from './parser';

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
