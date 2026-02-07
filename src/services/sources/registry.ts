import type { JobSource } from '../../types';
import type { JobSourcePlugin } from './types';
import { RSSPlugin } from './rss-shared/plugin';
import { yemenhrConfig, reliefwebConfig } from './rss-shared/configs';
import { EOIPlugin } from './eoi';

/**
 * Registry of all available job source plugins.
 *
 * RSS sources: Add a config to rss-shared/configs.ts, then add 1 line here.
 * Custom sources: Implement JobSourcePlugin directly (like EOIPlugin).
 */
export const SOURCES: Record<JobSource, JobSourcePlugin> = {
  yemenhr: new RSSPlugin(yemenhrConfig),
  eoi: new EOIPlugin(),
  reliefweb: new RSSPlugin(reliefwebConfig),
} as Record<JobSource, JobSourcePlugin>;

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
