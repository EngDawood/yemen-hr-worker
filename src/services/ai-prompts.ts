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
export const TEMPLATE_KV_KEY = 'config:prompt-template';

// ============================================================================
// Prompt template — code default + KV override for hot-swapping
// ============================================================================

/** Default prompt template with {{placeholder}} variables. Override via KV. */
export const DEFAULT_PROMPT_TEMPLATE = `Translate and summarize this job posting to Arabic.
{{sourceHint}}
Job Description:
{{description}}{{applyContext}}

CRITICAL LENGTH LIMITS - MUST NOT EXCEED:
- Description section: MAXIMUM {{descLimit}} characters (count carefully!){{applyLimitLine}}
- Total output must be under {{totalLimit}} characters to fit Telegram caption limit

CRITICAL RULES:
- DO NOT include any introduction or preamble
- Respond ONLY in Arabic
- BE EXTREMELY CONCISE - use shortest possible wording
- NO markdown formatting (no **, no _, no []())
- Use plain text only
- PRESERVE all URLs, email addresses, and phone numbers EXACTLY as-is (do not translate them)
- Count characters carefully and stay under limits{{noApplyRule}}

Output ONLY this format (nothing else):
{{categorySection}}
📋 الوصف الوظيفي:
[ترجمة مختصرة جداً للوظيفة في 1-2 جملة قصيرة فقط - لا تتجاوز {{descLimit}} حرف]{{applyOutputTemplate}}`;

/** Get prompt template. KV override takes precedence over code default. */
export async function getPromptTemplate(env: Env): Promise<string> {
  try {
    const kv = await env.POSTED_JOBS.get(TEMPLATE_KV_KEY);
    if (kv) return kv;
  } catch {
    // KV read failed — use code default silently
  }
  return DEFAULT_PROMPT_TEMPLATE;
}

/** Render a prompt template by replacing {{placeholders}} with values. */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}

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
