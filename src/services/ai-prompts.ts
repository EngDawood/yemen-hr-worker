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

import type { Env } from '../types';
import { getAIPromptConfigs, getConfiguredSourceNames } from './sources/registry';

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

/** Get code-only default for a source (no KV). Used by /prompt command for displaying defaults. */
export function getCodeDefault(source?: string): AIPromptConfig {
  if (!source) return DEFAULT_CONFIG;
  return getAIPromptConfigs()[source] ?? DEFAULT_CONFIG;
}

/** All configured source names (for /prompt list). */
export function getConfiguredSources(): string[] {
  return getConfiguredSourceNames();
}

/**
 * Get prompt config for a source. Merges KV overrides with code defaults.
 * KV values take precedence over code defaults.
 * Falls back to code defaults if KV read fails or key doesn't exist.
 */
export async function getPromptConfig(
  source: string | undefined,
  env: Env
): Promise<AIPromptConfig> {
  const codeDefault = source
    ? (getAIPromptConfigs()[source] ?? DEFAULT_CONFIG)
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
