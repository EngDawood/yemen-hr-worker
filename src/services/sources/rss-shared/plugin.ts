/**
 * Generic RSS-based job source plugin.
 * Config-driven: new RSS sources only need an RSSSourceConfig.
 */

import type { Env, JobItem, ProcessedJob } from '../../../types';
import type { JobSourcePlugin } from '../types';
import type { RSSSourceConfig } from './types';
import { fetchAndParseRSSFeed } from './rss-parser';
import { cleanJobDescription } from '../yemenhr/processor';

/**
 * Generic plugin for RSS-based job sources.
 * Uses shared RSS parser and a default job processor (HTML cleaning + metadata extraction).
 * Custom processing can be overridden via config.processJob.
 */
export class RSSPlugin implements JobSourcePlugin {
  readonly name;
  private config: RSSSourceConfig;

  constructor(config: RSSSourceConfig) {
    this.name = config.sourceName;
    this.config = config;
  }

  async fetchJobs(env?: Env): Promise<JobItem[]> {
    const feedUrl = this.config.getFeedUrl(env);
    return fetchAndParseRSSFeed(feedUrl, this.config.sourceName, this.config.baseUrl, this.config.idExtractor);
  }

  async processJob(job: JobItem): Promise<ProcessedJob> {
    // Use custom processor if provided
    if (this.config.processJob) {
      return this.config.processJob(job);
    }

    // Default: clean HTML and extract metadata
    const cleaned = cleanJobDescription(job.description || '');
    return {
      title: job.title,
      company: job.company,
      link: job.link,
      description: cleaned.description,
      imageUrl: job.imageUrl,
      location: cleaned.location,
      postedDate: cleaned.postedDate,
      deadline: cleaned.deadline,
      source: this.config.sourceName,
    };
  }
}
