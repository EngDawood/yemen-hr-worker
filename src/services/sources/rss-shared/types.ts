import type { Env, JobItem, ProcessedJob } from '../../../types';

/**
 * Configuration for an RSS-based job source.
 * Adding a new RSS site requires only defining this config.
 */
export interface RSSSourceConfig {
  /** Unique source name. Type safety enforced at registry level via satisfies. */
  sourceName: string;

  /** Get the RSS feed URL. May use env vars (e.g., RSS_FEED_URL). */
  getFeedUrl: (env?: Env) => string;

  /** Base URL of the site (used for resolving relative image URLs) */
  baseUrl: string;

  /** Extract a unique job ID from a job URL */
  idExtractor: (link: string) => string;

  /**
   * Optional: custom job processor.
   * If not provided, the default RSS processor is used (HTML cleaning + metadata extraction).
   */
  processJob?: (job: JobItem) => ProcessedJob;
}
