import type { JobSource } from '../../types';
import type { JobSourcePlugin } from './types';
import { YemenHRPlugin } from './yemenhr';
import { EOIPlugin } from './eoi';

/**
 * Registry of all available job source plugins.
 * Add new sources here to enable them in the worker.
 */
export const SOURCES: Record<JobSource, JobSourcePlugin> = {
  yemenhr: new YemenHRPlugin(),
  eoi: new EOIPlugin(),
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
