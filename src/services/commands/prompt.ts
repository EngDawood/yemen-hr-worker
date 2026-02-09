/**
 * Telegram /prompt command handlers.
 * Manages per-source AI prompt configs stored in KV.
 */

import type { Env, JobSource } from '../../types';
import { CONFIG_KV_KEY, getCodeDefault, getConfiguredSources } from '../ai-prompts';
import type { AIPromptConfig } from '../ai-prompts';

type KVConfigs = Record<string, Partial<AIPromptConfig>>;

async function readKVConfigs(env: Env): Promise<KVConfigs> {
  try {
    return (await env.POSTED_JOBS.get(CONFIG_KV_KEY, 'json') as KVConfigs) || {};
  } catch {
    return {};
  }
}

async function writeKVConfigs(env: Env, configs: KVConfigs): Promise<void> {
  await env.POSTED_JOBS.put(CONFIG_KV_KEY, JSON.stringify(configs));
}

function formatConfig(source: string, config: AIPromptConfig, hasKVOverride: boolean): string {
  const overrideTag = hasKVOverride ? ' 🔧' : '';
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
  const kvConfigs = await readKVConfigs(env);
  const lines: string[] = ['📝 <b>Prompt Configs</b>\n🔧 = KV override\n'];

  for (const source of sources) {
    const codeDefault = getCodeDefault(source);
    const kvOverride = kvConfigs[source];
    const merged = kvOverride ? { ...codeDefault, ...kvOverride } : codeDefault;
    lines.push(formatConfig(source, merged, !!kvOverride));
    lines.push('');
  }

  return lines.join('\n');
}

async function handleGet(env: Env, source: JobSource): Promise<string> {
  const codeDefault = getCodeDefault(source);
  const kvConfigs = await readKVConfigs(env);
  const kvOverride = kvConfigs[source];
  const merged = kvOverride ? { ...codeDefault, ...kvOverride } : codeDefault;

  const lines: string[] = [`📝 <b>${source}</b>\n`];

  // Show merged config
  lines.push(`<b>howToApply:</b> ${merged.includeHowToApply ? '✅ on' : '❌ off'}`);
  lines.push(`<b>hint:</b> ${merged.sourceHint || '(none)'}`);
  lines.push(`<b>fallback:</b> ${merged.applyFallback || '(none)'}`);

  if (kvOverride) {
    lines.push('\n🔧 <b>KV overrides:</b>');
    if (kvOverride.includeHowToApply !== undefined) lines.push(`  howToApply: ${kvOverride.includeHowToApply}`);
    if (kvOverride.sourceHint !== undefined) lines.push(`  hint: ${kvOverride.sourceHint}`);
    if (kvOverride.applyFallback !== undefined) lines.push(`  fallback: ${kvOverride.applyFallback}`);
  }

  return lines.join('\n');
}

async function handleSet(
  env: Env,
  source: string,
  field: string,
  value: string
): Promise<string> {
  const configs = await readKVConfigs(env);
  if (!configs[source]) configs[source] = {};

  switch (field) {
    case 'hint':
      configs[source].sourceHint = value;
      break;
    case 'apply':
      configs[source].applyFallback = value;
      break;
    case 'howtoapply':
      if (value !== 'on' && value !== 'off') {
        return '❌ Usage: /prompt <source> howtoapply on|off';
      }
      configs[source].includeHowToApply = value === 'on';
      break;
    default:
      return `❌ Unknown field: ${field}\nValid fields: hint, apply, howtoapply`;
  }

  await writeKVConfigs(env, configs);
  return `✅ Updated <b>${source}.${field}</b>`;
}

async function handleReset(env: Env, source?: string): Promise<string> {
  if (!source) {
    // Reset all — delete entire KV key
    await env.POSTED_JOBS.delete(CONFIG_KV_KEY);
    return '✅ All KV overrides removed. Using code defaults.';
  }

  const configs = await readKVConfigs(env);
  if (!configs[source]) {
    return `ℹ️ No KV overrides for <b>${source}</b>.`;
  }

  delete configs[source];

  // Clean up: delete entire key if empty
  if (Object.keys(configs).length === 0) {
    await env.POSTED_JOBS.delete(CONFIG_KV_KEY);
  } else {
    await writeKVConfigs(env, configs);
  }

  return `✅ KV overrides for <b>${source}</b> removed. Using code default.`;
}

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

  const source = args[0];

  // Validate source name
  if (!VALID_SOURCES.has(source as JobSource)) {
    const valid = [...VALID_SOURCES].join(', ');
    return `❌ Unknown source: ${source}\nValid sources: ${valid}`;
  }

  // /prompt <source> — show config
  if (args.length === 1) {
    return handleGet(env, source as JobSource);
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
