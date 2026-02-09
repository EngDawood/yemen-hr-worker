import type { JobSource } from '../../types';
import type { JobSourcePlugin } from './types';
import { RSSPlugin } from './rss-shared/plugin';
import { yemenhrConfig, reliefwebConfig, ykbankConfig } from './rss-shared/configs';
import { EOIPlugin } from './eoi';
import { ScraperPlugin } from './scraper-shared/plugin';
import { kuraimiConfig, qtbConfig, yldfConfig } from './scraper-shared/configs';

/**
 * Registry of all available job source plugins.
 *
 * RSS sources: Add a config to rss-shared/configs.ts, then add 1 line here.
 * Scraper sources: Add a config to scraper-shared/configs.ts, then add 1 line here.
 * Custom sources: Implement JobSourcePlugin directly (like EOIPlugin).
 */
// Partial — disabled sources are commented out, not all JobSource keys are present
export const SOURCES: Partial<Record<JobSource, JobSourcePlugin>> = {
  yemenhr: new RSSPlugin(yemenhrConfig),
  eoi: new EOIPlugin(),
  // reliefweb: new RSSPlugin(reliefwebConfig), // DISABLED
  // New sources — enable one at a time after testing:
  // ykbank: new RSSPlugin(ykbankConfig),
  // kuraimi: new ScraperPlugin(kuraimiConfig),
  // qtb: new ScraperPlugin(qtbConfig),
  // yldf: new ScraperPlugin(yldfConfig),
};

/**
 * Get a job source plugin by name.
 * @param name - Source identifier ('yemenhr', 'eoi', etc.)
 * @returns The plugin instance
 * @throws Error if source not found
 */
export function getSource(name: JobSource): JobSourcePlugin {
  const plugin = SOURCES[name];
  if (!plugin) {
    throw new Error(`Job source plugin not found: ${name}`);
  }
  return plugin;
}

/**
 * Get all registered source plugins.
 * @returns Array of all plugin instances
 */
export function getAllSources(): JobSourcePlugin[] {
  return Object.values(SOURCES);
}
