import type { JobItem } from '../../../types';
import type { EOIJob } from './types';

/**
 * Parse job listings from EOI API HTML response.
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

/**
 * Fetch jobs from EOI Yemen API.
 * @returns Array of EOI jobs
 */
export async function fetchEOIJobsFromAPI(): Promise<EOIJob[]> {
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

  const data = await response.json() as { table_data?: string; total_data?: number };

  if (!data.table_data) {
    return [];
  }

  return parseJobsFromHTML(data.table_data);
}

/**
 * Convert EOI job to standard JobItem format.
 */
export function convertEOIJobToJobItem(eoiJob: EOIJob): JobItem {
  // Parse DD-MM-YYYY date to ISO format
  let pubDate = new Date().toISOString();
  if (eoiJob.postDate) {
    const [day, month, year] = eoiJob.postDate.split('-');
    if (day && month && year) {
      pubDate = new Date(`${year}-${month}-${day}`).toISOString();
    }
  }

  // Build basic description from EOI metadata
  const descriptionParts: string[] = [];
  if (eoiJob.category) descriptionParts.push(`الفئة: ${eoiJob.category}`);
  if (eoiJob.location) descriptionParts.push(`الموقع: ${eoiJob.location}`);
  if (eoiJob.postDate) descriptionParts.push(`تاريخ النشر: ${eoiJob.postDate}`);
  if (eoiJob.deadline) descriptionParts.push(`آخر موعد للتقديم: ${eoiJob.deadline}`);

  return {
    id: `eoi-${eoiJob.id}`, // Prefix to avoid ID collision with Yemen HR
    title: eoiJob.title,
    company: eoiJob.company,
    link: eoiJob.url,
    pubDate,
    imageUrl: null, // Will be fetched from detail page
    description: descriptionParts.join('\n'),
    source: 'eoi',
  };
}
