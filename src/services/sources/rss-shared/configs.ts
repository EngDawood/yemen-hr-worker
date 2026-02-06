/**
 * RSS source configurations.
 * Each config defines how to fetch and process jobs from an RSS-based source.
 */

import type { RSSSourceConfig } from './types';

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
