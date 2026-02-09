/**
 * RSS source configurations.
 * Each config defines how to fetch and process jobs from an RSS-based source.
 */

import type { RSSSourceConfig } from './types';
import { processReliefWebJob } from '../reliefweb/processor';

/**
 * Yemen HR configuration.
 * Jobs fetched via RSS Bridge from yemenhr.com.
 */
export const yemenhrConfig: RSSSourceConfig = {
  sourceName: 'yemenhr',
  getFeedUrl: (env) => {
    if (!env?.RSS_FEED_URL) {
      throw new Error('RSS_FEED_URL not configured');
    }
    return env.RSS_FEED_URL;
  },
  baseUrl: 'https://yemenhr.com',
  idExtractor: (link) => {
    const match = link.match(/\/jobs\/([^/?#]+)/);
    return match ? match[1] : link;
  },
};

/**
 * ReliefWeb Yemen configuration.
 * Jobs fetched from ReliefWeb's public RSS 2.0 feed filtered for Yemen (C255).
 */
export const reliefwebConfig: RSSSourceConfig = {
  sourceName: 'reliefweb',
  getFeedUrl: () => 'https://reliefweb.int/jobs/rss.xml?advanced-search=%28C255%29',
  baseUrl: 'https://reliefweb.int',
  idExtractor: (link) => {
    const match = link.match(/\/job\/(\d+)/);
    return match ? `rw-${match[1]}` : link;
  },
  processJob: processReliefWebJob,
};
