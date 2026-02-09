import type { JobSource } from '../../types';
import type { JobSourcePlugin } from './types';
import { RSSPlugin } from './rss-shared/plugin';
import { reliefwebConfig, ykbankConfig } from './rss-shared/configs';
import { ScraperPlugin } from './scraper-shared/plugin';
import { yemenhrScraperConfig, eoiScraperConfig, kuraimiConfig, qtbConfig, yldfConfig } from './scraper-shared/configs';

interface SourceEntry {
  plugin: JobSourcePlugin;
  enabled: boolean;
}

/**
 * Registry of all available job source plugins.
 *
 * enabled: true  → used by cron/run pipeline
 * enabled: false → skipped by pipeline, still available via /test
 */
const SOURCES: Partial<Record<JobSource, SourceEntry>> = {
  yemenhr:   { plugin: new ScraperPlugin(yemenhrScraperConfig), enabled: true },
  eoi:       { plugin: new ScraperPlugin(eoiScraperConfig),     enabled: true },
  reliefweb: { plugin: new RSSPlugin(reliefwebConfig),          enabled: true },
  // ykbank: disabled — last job posted Dec 2024, feed appears stale
  // ykbank:    { plugin: new RSSPlugin(ykbankConfig),             enabled: false },
  kuraimi:   { plugin: new ScraperPlugin(kuraimiConfig),        enabled: false },
  qtb:       { plugin: new ScraperPlugin(qtbConfig),            enabled: false },
  yldf:      { plugin: new ScraperPlugin(yldfConfig),           enabled: false },
};

/**
 * Get a job source plugin by name (enabled or disabled).
 * @throws Error if source not found
 */
export function getSource(name: JobSource): JobSourcePlugin {
  const entry = SOURCES[name];
  if (!entry) {
    throw new Error(`Job source plugin not found: ${name}`);
  }
  return entry.plugin;
}

/**
 * Get enabled source plugins only (for cron/run pipeline).
 */
export function getEnabledSources(): JobSourcePlugin[] {
  return Object.values(SOURCES)
    .filter((e): e is SourceEntry => !!e && e.enabled)
    .map(e => e.plugin);
}

/**
 * Get ALL registered source plugins (for /test command).
 */
export function getAllSources(): JobSourcePlugin[] {
  return Object.values(SOURCES)
    .filter((e): e is SourceEntry => !!e)
    .map(e => e.plugin);
}

/**
 * Get all source entries with name and enabled status (for /source list).
 */
export function getSourceEntries(): { name: string; enabled: boolean }[] {
  return Object.entries(SOURCES)
    .filter((e): e is [string, SourceEntry] => !!e[1])
    .map(([name, entry]) => ({ name, enabled: entry.enabled }));
}
