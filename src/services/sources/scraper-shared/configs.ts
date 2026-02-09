/**
 * Scraper source configurations.
 * Each config defines CSS selectors and extraction logic for an SSR job site.
 */

import type { ScraperSourceConfig } from './types';

/**
 * Kuraimi Bank — jobs.kuraimibank.com
 * SSR site with job cards on /vacancies, full descriptions on /job/{id}.
 */
export const kuraimiConfig: ScraperSourceConfig = {
  sourceName: 'kuraimi',
  getListingUrl: () => 'https://jobs.kuraimibank.com/vacancies',
  baseUrl: 'https://jobs.kuraimibank.com',
  selectors: {
    jobContainer: '.single-job-items',
    title: '.job-tittle h4',
    link: '.job-tittle a',
    // No company/location/deadline on listing page — detail page has them
  },
  idExtractor: (link) => {
    const match = link.match(/\/job\/(\d+)/);
    return match ? `kuraimi-${match[1]}` : `kuraimi-${link}`;
  },
  defaultCompany: 'بنك الكريمي',
  detailPage: {
    descriptionSelector: '.job-post-details',
    // Post-details3 is the overview sidebar (location, deadline, salary) — keep it
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
    descriptionSelector: '.container',
    cleanupSelectors: ['nav', 'footer', 'script', 'style'],
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
  detailPage: {
    descriptionSelector: '.ql-editor.read-mode',
  },
};
