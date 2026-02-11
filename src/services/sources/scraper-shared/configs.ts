/**
 * Scraper source configurations.
 * Each config defines CSS selectors and extraction logic for an SSR job site.
 * Also handles JSON API sources via responseExtractor (e.g., EOI).
 */

import type { ScraperSourceConfig } from './types';

/**
 * Yemen HR — yemenhr.com/jobs
 * SSR table layout. Replaces RSS Bridge (eliminates external dependency).
 */
export const yemenhrScraperConfig: ScraperSourceConfig = {
  sourceName: 'yemenhr',
  getListingUrl: () => 'https://yemenhr.com/jobs',
  baseUrl: 'https://yemenhr.com',
  selectors: {
    jobContainer: 'tbody tr',
    title: 'td:nth-child(3) a',
    link: 'td:nth-child(3) a',
    company: 'td:nth-child(2) a',
    image: 'td:nth-child(2) img',
    location: 'td:nth-child(4)',
    postedDate: 'td:nth-child(1)',
    deadline: 'td:nth-child(5)',
  },
  idExtractor: (link) => {
    // URL: https://yemenhr.com/jobs/some-job-slug-abcd1234
    const match = link.match(/\/jobs\/([^/?#]+)/);
    return match ? match[1] : link;
  },
  detailPage: {
    descriptionSelector: '.job-description-container',
    cleanupSelectors: ['script', 'style', 'svg', '.no-print', '.countdown-timer'],
  },
};

/**
 * EOI Yemen — eoi-ye.com
 * JSON API returning HTML fragment. Uses responseExtractor to unwrap.
 */
export const eoiScraperConfig: ScraperSourceConfig = {
  sourceName: 'eoi',
  getListingUrl: () => 'https://eoi-ye.com/live_search/action1?type=0&title=',
  baseUrl: 'https://eoi-ye.com',
  selectors: {
    // Each job is an <a> wrapping .job-content — container IS the link
    jobContainer: 'a',
    title: '.col-md-3 div',
    link: 'a', // falls back to container's own href
    company: '.col-md-2:nth-of-type(4)',
    location: '.col-md-2:nth-of-type(5)',
    deadline: '.col-md-2:nth-of-type(6)',
    category: '.col-md-2:nth-of-type(3)',
  },
  // Remove Arabic label headers (بواسطة :, فئة:, etc.) before extracting text
  listingCleanupSelectors: ['.jop-head'],
  idExtractor: (link) => {
    // URL: https://eoi-ye.com/jobs/21270/
    const match = link.match(/\/jobs\/(\d+)/);
    return match ? `eoi-${match[1]}` : link;
  },
  fetchHeaders: {
    'X-Requested-With': 'XMLHttpRequest',
    'Accept': 'application/json',
    'Referer': 'https://eoi-ye.com/jobs',
  },
  responseExtractor: (body) => {
    const data = JSON.parse(body) as { table_data?: string };
    return data.table_data || '';
  },
  detailPage: {
    descriptionSelector: '.detail-adv',
    cleanupSelectors: ['script', 'style', 'o\\:p'],
    imageSelector: 'img.img-responsive.thumbnail',
  },
};

/**
 * QTB Bank — jobs.qtbbank.com
 * SSR site with job cards on main page, detail pages at /detals_job?id_job={id}.
 * Listing page cards contain inline description in data attributes.
 */
export const qtbConfig: ScraperSourceConfig = {
  sourceName: 'qtb',
  getListingUrl: () => 'https://jobs.qtbbank.com',
  baseUrl: 'https://jobs.qtbbank.com',
  selectors: {
    jobContainer: '.col-12.col-md-6.col-lg-4.p-3',
    title: 'h4.font-3',
    link: 'a[href*="detals_job"]',
    location: 'h4.font-3:nth-of-type(2)',
    image: 'img',
  },
  idExtractor: (link) => {
    const match = link.match(/id_job=(\d+)/);
    return match ? `qtb-${match[1]}` : `qtb-${link}`;
  },
  defaultCompany: 'بنك القطيبي الإسلامي',
  detailPage: {
    descriptionSelector: '.container[dir="rtl"]',
    cleanupSelectors: ['nav', 'footer', 'script', 'style', '#alert-message', '#pre-loader', '.w-nav', '.section.no-padding'],
    // QTB has malformed HTML: <h1>...</h2> — fix before parsing
    htmlTransform: (html) => html.replace(/<\/h2>/g, '</h1>'),
  },
};

/**
 * YLDF — erp.yldf.org/jobs
 * Frappe/ERPNext job board. Cards use [name="card"] with id attr as the link path.
 * Full descriptions on detail pages in .ql-editor.read-mode.
 */
export const yldfConfig: ScraperSourceConfig = {
  sourceName: 'yldf',
  getListingUrl: () => 'https://erp.yldf.org/jobs',
  baseUrl: 'https://erp.yldf.org',
  selectors: {
    jobContainer: '[name="card"]',
    title: 'h4.jobs-page',
    // Link is the card's own 'id' attribute, not an <a> href
    link: '[name="card"]',
    linkAttr: 'id',
    company: '.font-weight-bold',
    location: '.text-14 > div.mt-3:first-child',
    deadline: '.job-card-footer .col-6:last-child b',
  },
  idExtractor: (link) => {
    // Link is like https://erp.yldf.org/jobs/yldf/some-job-slug
    const match = link.match(/jobs\/[^/]+\/(.+)/);
    return match ? `yldf-${match[1]}` : `yldf-${link}`;
  },
  defaultCompany: 'Youth Leadership Development Foundation',
  defaultImage: 'https://erp.yldf.org/files/yldflogo96974f111f45.jpg',
  detailPage: {
    descriptionSelector: '.ql-editor.read-mode',
  },
};
