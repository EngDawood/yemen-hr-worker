/**
 * Per-source AI prompt configuration.
 * Controls what the AI is asked to produce for each job source,
 * preventing hallucination of contact info for sources that don't provide it.
 *
 * Two layers: code defaults (registry) + D1 overrides (sources.ai_prompt_config).
 * D1 values take precedence. Manage via Telegram /prompt command or REST API.
 *
 * To add a new source: add one entry to the registry.
 * Unknown/missing sources get the safe DEFAULT_CONFIG (no howToApply, generic fallback).
 */

import type { Env } from '../types';
import { getAIPromptConfigs, getConfiguredSourceNames } from './sources/registry';
import { getSourceFromDB, getSetting } from './storage';

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

/** Get prompt template. D1 settings override takes precedence over code default. */
export async function getPromptTemplate(env: Env): Promise<string> {
  try {
    const value = await getSetting(env, 'prompt-template');
    if (value) return value;
  } catch {
    // D1 read failed — use code default silently
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
 * Get prompt config for a source. Merges D1 overrides with code defaults.
 * D1 sources.ai_prompt_config takes precedence over code defaults.
 * Falls back to code defaults if D1 read fails or column is NULL.
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
    const dbSource = await getSourceFromDB(env, source);
    if (dbSource?.ai_prompt_config) {
      const dbConfig = JSON.parse(dbSource.ai_prompt_config) as Partial<AIPromptConfig>;
      return { ...codeDefault, ...dbConfig };
    }
  } catch {
    // D1 read failed — use code default silently
  }

  return codeDefault;
}
