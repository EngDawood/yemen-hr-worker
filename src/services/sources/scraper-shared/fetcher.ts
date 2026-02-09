/**
 * HTML scraping logic: fetch a listing page, parse job cards via CSS selectors.
 */

import type { JobItem } from '../../../types';
import type { ScraperSourceConfig } from './types';
import { parseHTML, extractText, extractAttr } from './html-parser';

/**
 * Fetch an HTML listing page and extract job items using CSS selectors.
 */
export async function fetchAndParseHTMLJobs(
  config: ScraperSourceConfig
): Promise<JobItem[]> {
  const url = config.getListingUrl();
  const { baseUrl, selectors, idExtractor, defaultCompany } = config;

  const headers: Record<string, string> = {
    'User-Agent': 'Yemen-Jobs-Bot/1.0',
    ...config.fetchHeaders,
  };

  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(`Scraper fetch failed for ${config.sourceName}: ${response.status} ${response.statusText}`);
  }

  const body = await response.text();

  // Extract HTML from response body (e.g., JSON API wrapping HTML in a field)
  const html = config.responseExtractor ? config.responseExtractor(body) : body;

  const doc = parseHTML(html);
  const containers = doc.querySelectorAll(selectors.jobContainer);

  if (containers.length === 0) {
    console.warn(`[${config.sourceName}] No job containers found with selector: ${selectors.jobContainer}`);
    return [];
  }

  const jobs: JobItem[] = [];

  for (const container of containers) {
    // Remove noise elements (e.g., EOI's .jop-head labels) before extracting fields
    if (config.listingCleanupSelectors) {
      for (const sel of config.listingCleanupSelectors) {
        for (const el of container.querySelectorAll(sel)) {
          el.remove();
        }
      }
    }

    const title = extractText(container, selectors.title);
    if (!title) continue;

    // Extract link — supports custom attribute (e.g., 'id' for YLDF cards)
    const linkAttr = selectors.linkAttr || 'href';
    let link: string | null = null;

    if (linkAttr === 'href') {
      // Try selector inside container first, then fall back to container itself
      // (handles case where container IS the <a> element, e.g., EOI)
      link = extractAttr(container, selectors.link, 'href', baseUrl);
      if (!link) {
        const rawHref = container.getAttribute('href');
        if (rawHref) {
          const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
          link = rawHref.startsWith('http') ? rawHref : `${base}${rawHref.startsWith('/') ? '' : '/'}${rawHref}`;
        }
      }
    } else {
      // Custom attribute (like 'id') — read raw value and resolve against baseUrl.
      // querySelector can't match the container itself, so fall back to container
      // if the selector matches the container's own attributes.
      const el = container.querySelector(selectors.link) || container;
      const rawValue = el?.getAttribute(linkAttr);
      if (rawValue) {
        const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
        link = rawValue.startsWith('http') ? rawValue : `${base}/${rawValue}`;
      }
    }

    if (!link) continue;

    const id = idExtractor(link, title);
    if (!id) continue;

    const company = (selectors.company ? extractText(container, selectors.company) : null) || defaultCompany || 'Unknown Company';
    const imageUrl = selectors.image ? extractAttr(container, selectors.image, 'src', baseUrl) : null;
    const location = selectors.location ? extractText(container, selectors.location) : undefined;
    const postedDate = selectors.postedDate ? extractText(container, selectors.postedDate) : undefined;
    const deadline = selectors.deadline ? extractText(container, selectors.deadline) : undefined;
    const category = selectors.category ? extractText(container, selectors.category) : undefined;

    // Build description from available listing-page metadata
    const parts: string[] = [];
    if (location) parts.push(`Location: ${location}`);
    if (postedDate) parts.push(`PostedDate: ${postedDate}`);
    if (deadline) parts.push(`Deadline: ${deadline}`);
    if (category) parts.push(`Category: ${category}`);

    jobs.push({
      id,
      title,
      company,
      link,
      pubDate: '',
      imageUrl,
      description: parts.join('\n') || undefined,
      source: config.sourceName,
    });
  }

  return jobs;
}
