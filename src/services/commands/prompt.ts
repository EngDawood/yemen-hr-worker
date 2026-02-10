/**
 * Telegram /prompt command handlers.
 * Manages per-source AI prompt configs stored in D1 sources.ai_prompt_config.
 */

import type { Env } from '../../types';
import { DEFAULT_PROMPT_TEMPLATE, getCodeDefault, getConfiguredSources } from '../ai-prompts';
import type { AIPromptConfig } from '../ai-prompts';
import { getSourceFromDB, updateSourceInDB, getSetting, setSetting } from '../storage';

function formatConfig(source: string, config: AIPromptConfig, hasOverride: boolean): string {
  const overrideTag = hasOverride ? ' 🔧' : '';
  const apply = config.includeHowToApply ? '✅' : '❌';
  const hint = config.sourceHint
    ? config.sourceHint.substring(0, 80) + (config.sourceHint.length > 80 ? '...' : '')
    : '(none)';
  const fallback = config.applyFallback || '(none)';

  return `<b>${source}</b>${overrideTag}
  howToApply: ${apply}
  hint: ${hint}
  fallback: ${fallback}`;
}

async function handleList(env: Env): Promise<string> {
  const sources = getConfiguredSources();
  const lines: string[] = ['📝 <b>Prompt Configs</b>\n🔧 = D1 override\n'];

  for (const source of sources) {
    const codeDefault = getCodeDefault(source);
    const dbSource = await getSourceFromDB(env, source);
    const dbConfig = dbSource?.ai_prompt_config
      ? JSON.parse(dbSource.ai_prompt_config) as Partial<AIPromptConfig>
      : null;
    const merged = dbConfig ? { ...codeDefault, ...dbConfig } : codeDefault;
    lines.push(formatConfig(source, merged, !!dbConfig));
    lines.push('');
  }

  return lines.join('\n');
}

async function handleGet(env: Env, source: string): Promise<string> {
  const codeDefault = getCodeDefault(source);
  const dbSource = await getSourceFromDB(env, source);
  const dbConfig = dbSource?.ai_prompt_config
    ? JSON.parse(dbSource.ai_prompt_config) as Partial<AIPromptConfig>
    : null;
  const merged = dbConfig ? { ...codeDefault, ...dbConfig } : codeDefault;

  const lines: string[] = [`📝 <b>${source}</b>\n`];

  lines.push(`<b>howToApply:</b> ${merged.includeHowToApply ? '✅ on' : '❌ off'}`);
  lines.push(`<b>hint:</b> ${merged.sourceHint || '(none)'}`);
  lines.push(`<b>fallback:</b> ${merged.applyFallback || '(none)'}`);

  if (dbConfig) {
    lines.push('\n🔧 <b>D1 overrides:</b>');
    if (dbConfig.includeHowToApply !== undefined) lines.push(`  howToApply: ${dbConfig.includeHowToApply}`);
    if (dbConfig.sourceHint !== undefined) lines.push(`  hint: ${dbConfig.sourceHint}`);
    if (dbConfig.applyFallback !== undefined) lines.push(`  fallback: ${dbConfig.applyFallback}`);
  }

  return lines.join('\n');
}

async function handleSet(
  env: Env,
  source: string,
  field: string,
  value: string
): Promise<string> {
  // Read current D1 config
  const dbSource = await getSourceFromDB(env, source);
  const current = dbSource?.ai_prompt_config
    ? JSON.parse(dbSource.ai_prompt_config) as Partial<AIPromptConfig>
    : {};

  switch (field) {
    case 'hint':
      current.sourceHint = value;
      break;
    case 'apply':
      current.applyFallback = value;
      break;
    case 'howtoapply':
      if (value !== 'on' && value !== 'off') {
        return '❌ Usage: /prompt <source> howtoapply on|off';
      }
      current.includeHowToApply = value === 'on';
      break;
    default:
      return `❌ Unknown field: ${field}\nValid fields: hint, apply, howtoapply`;
  }

  await updateSourceInDB(env, source, { ai_prompt_config: JSON.stringify(current) });
  return `✅ Updated <b>${source}.${field}</b>`;
}

async function handleReset(env: Env, source?: string): Promise<string> {
  if (!source) {
    // Reset all — set ai_prompt_config to null for all sources
    const sources = getConfiguredSources();
    for (const s of sources) {
      await updateSourceInDB(env, s, { ai_prompt_config: null });
    }
    return '✅ All D1 prompt overrides removed. Using code defaults.';
  }

  await updateSourceInDB(env, source, { ai_prompt_config: null });
  return `✅ Prompt config for <b>${source}</b> reset to code default.`;
}

// ============================================================================
// Template subcommands (now uses D1 settings table)
// ============================================================================

async function handleTemplateView(env: Env): Promise<string> {
  try {
    const value = await getSetting(env, 'prompt-template');
    if (value) {
      return `📝 <b>Prompt Template</b> 🔧 D1 override\n\n<code>${escapeHtml(value)}</code>`;
    }
  } catch { /* D1 read failed */ }
  return `📝 <b>Prompt Template</b> (code default)\n\n<code>${escapeHtml(DEFAULT_PROMPT_TEMPLATE)}</code>`;
}

async function handleTemplateSet(env: Env, value: string): Promise<string> {
  if (!value) return '❌ Usage: /prompt template set <template text>';
  await setSetting(env, 'prompt-template', value);
  return '✅ Prompt template updated in D1.';
}

async function handleTemplateReset(env: Env): Promise<string> {
  try {
    await env.JOBS_DB.prepare('DELETE FROM settings WHERE key = ?').bind('prompt-template').run();
  } catch {
    // Ignore if already absent
  }
  return '✅ Prompt template reset to code default.';
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ============================================================================
// Main dispatcher
// ============================================================================

const VALID_SOURCES = new Set(getConfiguredSources());

/**
 * Main /prompt command dispatcher.
 */
export async function handlePrompt(env: Env, args: string[]): Promise<string> {
  // /prompt — list all
  if (args.length === 0) {
    return handleList(env);
  }

  // /prompt reset — reset all
  if (args[0] === 'reset' && args.length === 1) {
    return handleReset(env);
  }

  // /prompt template [set|reset]
  if (args[0] === 'template') {
    if (args.length === 1) return handleTemplateView(env);
    if (args[1] === 'reset') return handleTemplateReset(env);
    if (args[1] === 'set') return handleTemplateSet(env, args.slice(2).join(' '));
    return '❌ Usage: /prompt template [set <text>|reset]';
  }

  const source = args[0];

  // Validate source name
  if (!VALID_SOURCES.has(source)) {
    const valid = [...VALID_SOURCES].join(', ');
    return `❌ Unknown source: ${source}\nValid sources: ${valid}, template`;
  }

  // /prompt <source> — show config
  if (args.length === 1) {
    return handleGet(env, source);
  }

  // /prompt <source> reset — reset source
  if (args[1] === 'reset') {
    return handleReset(env, source);
  }

  // /prompt <source> <field> <value...>
  if (args.length < 3 && args[1] !== 'howtoapply') {
    return `❌ Usage: /prompt ${source} <hint|apply|howtoapply> <value>`;
  }

  const field = args[1];
  const value = args.slice(2).join(' ');

  return handleSet(env, source, field, value);
}
