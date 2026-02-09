import type { Env, JobItem, JobSource, ProcessedJob } from '../../../types';

/**
 * Configuration for an HTML scraper-based job source.
 * Adding a new SSR site requires only defining this config + 1 registry line.
 */
export interface ScraperSourceConfig {
  /** Unique source name (must match JobSource type) */
  sourceName: JobSource;

  /** Get the listing page URL. May use env vars. */
  getListingUrl: (env?: Env) => string;

  /** Base URL of the site (used for resolving relative URLs) */
  baseUrl: string;

  /** CSS selectors for extracting job data from the listing page */
  selectors: {
    /** CSS selector for each job card container */
    jobContainer: string;
    /** Title element selector (relative to container) */
    title: string;
    /** Link element selector (relative to container). Extracts href by default. */
    link: string;
    /** Attribute to extract the link from. Defaults to 'href'. */
    linkAttr?: string;
    /** Company element selector (relative to container) */
    company?: string;
    /** Image element selector (relative to container). Extracts src. */
    image?: string;
    /** Location element selector (relative to container) */
    location?: string;
    /** Posted date element selector (relative to container) */
    postedDate?: string;
    /** Deadline element selector (relative to container) */
    deadline?: string;
    /** Category element selector (relative to container) */
    category?: string;
  };

  /** CSS selectors for elements to remove from each container before extracting fields */
  listingCleanupSelectors?: string[];

  /** Extract a unique job ID from a link URL or path */
  idExtractor: (link: string, title?: string) => string;

  /** Default company name when not extractable from the page */
  defaultCompany?: string;

  /** Optional detail page config — fetch individual job pages for full descriptions */
  detailPage?: {
    /** CSS selector for the main description content on the detail page */
    descriptionSelector: string;
    /** CSS selectors for elements to remove before extracting description */
    cleanupSelectors?: string[];
    /** CSS selector for image on the detail page (extracts src). Overrides listing-page image. */
    imageSelector?: string;
  };

  /** Custom HTTP headers for the listing page request */
  fetchHeaders?: Record<string, string>;

  /** Extract HTML from a non-HTML response (e.g., JSON API returning {table_data: "<html>"}) */
  responseExtractor?: (body: string) => string;

  /** Optional custom job processor override */
  processJob?: (job: JobItem) => ProcessedJob;
}
