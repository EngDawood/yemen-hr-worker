/**
 * Centralized source registry — the SINGLE source of truth for all job sources.
 *
 * Adding a source:  1 config object + 1 entry here. Everything else auto-derives.
 * Removing a source: delete the entry. TypeScript catches remaining references.
 *
 * Exports: JobSource type, DEFAULT_SOURCE, plugin accessors, metadata derivation helpers.
 */

import type { JobSourcePlugin } from './types';
import type { AIPromptConfig } from '../ai-prompts';
import type { Env } from '../../types';
import { RSSPlugin } from './rss-shared/plugin';
import { reliefwebConfig } from './rss-shared/configs';
import { ScraperPlugin } from './scraper-shared/plugin';
import { yemenhrScraperConfig, eoiScraperConfig, qtbConfig, yldfConfig } from './scraper-shared/configs';

// ============================================================================
// Source Definition
// ============================================================================

export interface SourceDefinition {
  /** Plugin instance (omit for catch-all sources like 'rss' that have no fetcher) */
  plugin?: JobSourcePlugin;
  enabled: boolean;

  // Telegram metadata
  hashtag: string;
  displayName: string;

  // AI prompt behavior (omit → safe defaults: no howToApply, generic fallback)
  aiPrompt?: AIPromptConfig;

  // D1 metadata
  type: 'rss' | 'scraper' | 'api';
  baseUrl: string;
  feedUrl?: string;
}

// ============================================================================
// Registry — add/remove sources HERE, everything else auto-derives
// ============================================================================

const SOURCES = {
  rss: {
    // Catch-all default for unknown/generic sources. No plugin — never fetched.
    enabled: true,
    hashtag: '#وظائف',
    displayName: 'RSS',
    aiPrompt: { includeHowToApply: false, applyFallback: 'راجع رابط الوظيفة أدناه' },
    type: 'rss' as const,
    baseUrl: '',
  },
  yemenhr: {
    plugin: new ScraperPlugin(yemenhrScraperConfig),
    enabled: true,
    hashtag: '#YemenHR',
    displayName: 'Yemen HR',
    aiPrompt: {
      includeHowToApply: false,
      applyFallback: 'راجع رابط الوظيفة أدناه',
      sourceHint: 'This job is from YemenHR.com, a Yemeni job board. Jobs are in Yemen — location should specify the city. No application contact info is extracted — do NOT invent any.',
    },
    type: 'scraper' as const,
    baseUrl: 'https://yemenhr.com',
  },
  eoi: {
    plugin: new ScraperPlugin(eoiScraperConfig),
    enabled: true,
    hashtag: '#EOI',
    displayName: 'EOI Yemen',
    aiPrompt: {
      includeHowToApply: true,
      sourceHint: 'This job is from EOI Yemen (eoi-ye.com), a Yemeni job aggregator. Application contacts (emails, URLs, phones) are provided — preserve them exactly. Jobs are always in Yemen — location should specify the city.',
    },
    type: 'api' as const,
    baseUrl: 'https://eoi-ye.com',
    feedUrl: 'https://eoi-ye.com/live_search/action1?type=0&title=',
  },
  reliefweb: {
    plugin: new RSSPlugin(reliefwebConfig),
    enabled: true,
    hashtag: '#ReliefWeb',
    displayName: 'ReliefWeb',
    aiPrompt: {
      includeHowToApply: true,
      sourceHint: 'This job is from ReliefWeb, an international humanitarian job board. Application instructions and links are extracted — preserve them exactly. Jobs may cover Yemen only or multiple countries. If location includes countries beyond Yemen, mention that (e.g., اليمن ودول أخرى).',
    },
    type: 'rss' as const,
    baseUrl: 'https://reliefweb.int',
    feedUrl: 'https://reliefweb.int/jobs/rss.xml?advanced-search=%28C255%29',
  },
  ykbank: {
    // Disabled — last job posted Dec 2024, feed appears stale
    enabled: false,
    hashtag: '#YKBank',
    displayName: 'YK Bank',
    type: 'rss' as const,
    baseUrl: 'https://yk-bank.zohorecruit.com',
    feedUrl: 'https://yk-bank.zohorecruit.com/jobs/Careers/rss',
  },
  qtb: {
    plugin: new ScraperPlugin(qtbConfig),
    enabled: false,
    hashtag: '#QTBBank',
    displayName: 'QTB Bank',
    aiPrompt: {
      includeHowToApply: false,
      applyFallback: 'قدّم عبر صفحة الوظيفة في موقع بنك القطيبي',
      sourceHint: 'This job is from QTB Bank (Al-Qatibi Islamic Bank, qtbbank.com). The bank posts its own jobs only. Description is in Arabic. Location should specify the branch or city in Yemen. No application contact info is available — do NOT invent any.',
    },
    type: 'scraper' as const,
    baseUrl: 'https://jobs.qtbbank.com',
  },
  yldf: {
    plugin: new ScraperPlugin(yldfConfig),
    enabled: false,
    hashtag: '#YLDF',
    displayName: 'YLDF',
    aiPrompt: {
      includeHowToApply: false,
      applyFallback: 'قدّم عبر صفحة الوظيفة في موقع YLDF',
      sourceHint: 'This job is from YLDF (Youth Leadership Development Foundation, erp.yldf.org). YLDF posts its own jobs only. Detail page has responsibilities, qualifications, and policies. Descriptions may be in English — translate to Arabic. Location is always in Yemen — specify the city. No application contact info is extracted — do NOT invent any.',
    },
    type: 'scraper' as const,
    baseUrl: 'https://erp.yldf.org',
  },
} satisfies Record<string, SourceDefinition>;

// ============================================================================
// Derived types and constants
// ============================================================================

/** Job source identifier — auto-derived from registry keys. */
export type JobSource = keyof typeof SOURCES;

/** Default source for unknown/generic jobs. */
export const DEFAULT_SOURCE: JobSource = 'rss';

// Widened view for iteration helpers (satisfies preserves literal types which complicates Object.values)
const DEFS: Record<string, SourceDefinition> = SOURCES;

// ============================================================================
// Plugin accessors (same API as before)
// ============================================================================

/**
 * Get a job source plugin by name (enabled or disabled).
 * @throws Error if source not found or has no plugin
 */
export function getSource(name: string): JobSourcePlugin {
  const entry = DEFS[name];
  if (!entry?.plugin) {
    throw new Error(`Job source plugin not found: ${name}`);
  }
  return entry.plugin;
}

/** Get enabled source plugins only (for cron/run pipeline). */
export function getEnabledSources(): JobSourcePlugin[] {
  return Object.values(DEFS)
    .filter((e): e is SourceDefinition & { plugin: JobSourcePlugin } => !!e.plugin && e.enabled)
    .map(e => e.plugin);
}

/** Get ALL registered source plugins (for /test command). */
export function getAllSources(): JobSourcePlugin[] {
  return Object.values(DEFS)
    .filter((e): e is SourceDefinition & { plugin: JobSourcePlugin } => !!e.plugin)
    .map(e => e.plugin);
}

/** Get all source entries with name and enabled status (for /source list). */
export function getSourceEntries(): { name: string; enabled: boolean }[] {
  return Object.entries(DEFS).map(([name, entry]) => ({ name, enabled: entry.enabled }));
}

// ============================================================================
// Metadata derivation helpers — consumers call these instead of hardcoding
// ============================================================================

/** Hashtag map derived from registry. Used by format.ts. */
export function getHashtags(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(DEFS).map(([k, v]) => [k, v.hashtag])
  );
}

/** AI prompt configs derived from registry. Used by ai-prompts.ts. */
export function getAIPromptConfigs(): Record<string, AIPromptConfig> {
  return Object.fromEntries(
    Object.entries(DEFS)
      .filter(([_, v]) => v.aiPrompt)
      .map(([k, v]) => [k, v.aiPrompt!])
  );
}

/** All source names that have AI prompt configs. */
export function getConfiguredSourceNames(): string[] {
  return Object.entries(DEFS)
    .filter(([_, v]) => v.aiPrompt)
    .map(([k]) => k);
}

/** Get the source definition for a given name. */
export function getSourceDefinition(name: string): SourceDefinition | undefined {
  return DEFS[name];
}

// ============================================================================
// D1 sync — keeps sources table in sync with registry
// ============================================================================

/** Sync all registry sources to D1 sources table. Run on each scheduled trigger. */
export async function syncSourcesTable(env: Env): Promise<void> {
  try {
    const stmt = env.JOBS_DB.prepare(
      'INSERT OR REPLACE INTO sources (id, display_name, hashtag, type, base_url, feed_url, enabled) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    await env.JOBS_DB.batch(
      Object.entries(DEFS).map(([id, def]) =>
        stmt.bind(id, def.displayName, def.hashtag, def.type, def.baseUrl, def.feedUrl ?? null, def.enabled ? 1 : 0)
      )
    );
  } catch (error) {
    console.error('Failed to sync sources table:', error);
  }
}
