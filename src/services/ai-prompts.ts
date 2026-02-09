/**
 * Per-source AI prompt configuration.
 * Controls what the AI is asked to produce for each job source,
 * preventing hallucination of contact info for sources that don't provide it.
 *
 * Two layers: code defaults (SOURCE_PROMPT_CONFIGS) + KV overrides (config:ai-prompts).
 * KV values take precedence. Manage via Telegram /prompt command or wrangler CLI.
 *
 * To add a new source: add one entry to SOURCE_PROMPT_CONFIGS.
 * Unknown/missing sources get the safe DEFAULT_CONFIG (no howToApply, generic fallback).
 */

import type { JobSource, Env } from '../types';

export interface AIPromptConfig {
  /** Whether the AI should output a "how to apply" section.
   * true  = source provides howToApply/applicationLinks data
   * false = source has no apply data; omit from AI prompt (prevents hallucination) */
  includeHowToApply: boolean;

  /** Source-specific context injected into the prompt.
   * Gives AI guidance about the source's data shape, language, and location rules. */
  sourceHint?: string;

  /** Static fallback text for how-to-apply when includeHowToApply is false.
   * Appended to AI output so the section isn't empty. Omit to skip the section entirely. */
  applyFallback?: string;
}

export const CONFIG_KV_KEY = 'config:ai-prompts';

// Conservative default: no how-to-apply, generic fallback
const DEFAULT_CONFIG: AIPromptConfig = {
  includeHowToApply: false,
  applyFallback: 'راجع رابط الوظيفة أدناه',
};

const SOURCE_PROMPT_CONFIGS: Partial<Record<JobSource, AIPromptConfig>> = {
  // --- Sources WITH how-to-apply data ---
  eoi: {
    includeHowToApply: true,
    sourceHint: 'This job is from EOI Yemen (eoi-ye.com), a Yemeni job aggregator. Application contacts (emails, URLs, phones) are provided — preserve them exactly. Jobs are always in Yemen — location should specify the city.',
  },
  reliefweb: {
    includeHowToApply: true,
    sourceHint: 'This job is from ReliefWeb, an international humanitarian job board. Application instructions and links are extracted — preserve them exactly. Jobs may cover Yemen only or multiple countries. If location includes countries beyond Yemen, mention that (e.g., اليمن ودول أخرى).',
  },

  // --- Sources WITHOUT how-to-apply data ---
  yemenhr: {
    includeHowToApply: false,
    applyFallback: 'راجع رابط الوظيفة أدناه',
    sourceHint: 'This job is from YemenHR.com, a Yemeni job board. Jobs are in Yemen — location should specify the city. No application contact info is extracted — do NOT invent any.',
  },
  kuraimi: {
    includeHowToApply: false,
    applyFallback: 'قدّم عبر صفحة الوظيفة في موقع بنك الكريمي',
    sourceHint: 'This job is from Kuraimi Bank (jobs.kuraimibank.com). The bank posts its own jobs only. Description and requirements are in Arabic. Location should specify the branch or city in Yemen. No application contact info is extracted — do NOT invent any.',
  },
  qtb: {
    includeHowToApply: false,
    applyFallback: 'قدّم عبر صفحة الوظيفة في موقع بنك القطيبي',
    sourceHint: 'This job is from QTB Bank (Al-Qatibi Islamic Bank, qtbbank.com). The bank posts its own jobs only. Description is in Arabic. Location should specify the branch or city in Yemen. No application contact info is available — do NOT invent any.',
  },
  yldf: {
    includeHowToApply: false,
    applyFallback: 'قدّم عبر صفحة الوظيفة في موقع YLDF',
    sourceHint: 'This job is from YLDF (Youth Leadership Development Foundation, erp.yldf.org). YLDF posts its own jobs only. Detail page has responsibilities, qualifications, and policies. Descriptions may be in English — translate to Arabic. Location is always in Yemen — specify the city. No application contact info is extracted — do NOT invent any.',
  },
  rss: {
    includeHowToApply: false,
    applyFallback: 'راجع رابط الوظيفة أدناه',
  },
};

/** Get code-only default for a source (no KV). Used by /prompt command for displaying defaults. */
export function getCodeDefault(source?: JobSource): AIPromptConfig {
  if (!source) return DEFAULT_CONFIG;
  return SOURCE_PROMPT_CONFIGS[source] ?? DEFAULT_CONFIG;
}

/** All configured source names (for /prompt list). */
export function getConfiguredSources(): JobSource[] {
  return Object.keys(SOURCE_PROMPT_CONFIGS) as JobSource[];
}

/**
 * Get prompt config for a source. Merges KV overrides with code defaults.
 * KV values take precedence over code defaults.
 * Falls back to code defaults if KV read fails or key doesn't exist.
 */
export async function getPromptConfig(
  source: JobSource | undefined,
  env: Env
): Promise<AIPromptConfig> {
  const codeDefault = source
    ? (SOURCE_PROMPT_CONFIGS[source] ?? DEFAULT_CONFIG)
    : DEFAULT_CONFIG;

  if (!source) return codeDefault;

  try {
    const raw = await env.POSTED_JOBS.get(CONFIG_KV_KEY, 'json') as Record<string, Partial<AIPromptConfig>> | null;
    if (raw && raw[source]) {
      // KV override merges on top of code default
      return { ...codeDefault, ...raw[source] };
    }
  } catch {
    // KV read failed — use code default silently
  }

  return codeDefault;
}
