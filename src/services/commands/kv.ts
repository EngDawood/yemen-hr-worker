/**
 * Data command handlers.
 * D1-based: /jobs, /job, /search, /status, /stats, /runs, /model.
 * KV-based: /clear (dedup layer).
 */

import type { Env, JobStatus } from '../../types';
import type { InlineKeyboardMarkup } from '../../types/telegram';
import {
  // D1 functions
  listJobs, getJobFromDB, getDashboardStats,
  listRuns,
  getSetting, setSetting,
  // KV functions (for /clear only)
  deleteJobFromKV, deleteDedupKey, getPostedJobRecord,
} from '../storage';

/** Command response with optional inline keyboard. */
export interface CommandResult {
  text: string;
  keyboard?: InlineKeyboardMarkup;
}

const DEFAULT_AI_MODEL = '@cf/qwen/qwen3-30b-a3b-fp8';

// ============================================================================
// Keyboard helpers
// ============================================================================

function paginationKeyboard(prefix: string, page: number, totalPages: number, extra?: string): InlineKeyboardMarkup {
  const nav: Array<{ text: string; callback_data: string }> = [];
  const suffix = extra ? `:${extra}` : '';
  if (page > 1) nav.push({ text: '◀️', callback_data: `${prefix}:${page - 1}${suffix}` });
  nav.push({ text: `${page}/${totalPages}`, callback_data: 'noop' });
  if (page < totalPages) nav.push({ text: '▶️', callback_data: `${prefix}:${page + 1}${suffix}` });
  return { inline_keyboard: nav.length > 1 ? [nav] : [] };
}

function jobsKeyboard(page: number, totalPages: number, filter?: string): InlineKeyboardMarkup {
  const pagination = paginationKeyboard('jobs', page, totalPages, filter);
  const filters: Array<{ text: string; callback_data: string }> = [
    { text: filter ? '📋 All' : '• All', callback_data: `jobs:1` },
    { text: filter === 'posted' ? '• Posted' : '✅ Posted', callback_data: `jobs:1:posted` },
    { text: filter === 'failed' ? '• Failed' : '❌ Failed', callback_data: `jobs:1:failed` },
    { text: filter === 'fetched' ? '• Fetched' : '📥 Fetched', callback_data: `jobs:1:fetched` },
  ];
  return { inline_keyboard: [...pagination.inline_keyboard, filters] };
}

// ============================================================================
// D1 command handlers
// ============================================================================

/**
 * Handle /jobs command — list jobs from D1 with pagination.
 */
export async function handleJobsList(env: Env, page = 1, statusFilter?: string): Promise<CommandResult> {
  const opts: { page: number; limit: number; status?: JobStatus } = { page, limit: 8 };
  if (statusFilter && ['posted', 'failed', 'fetched', 'skipped', 'duplicate'].includes(statusFilter)) {
    opts.status = statusFilter as JobStatus;
  }

  const result = await listJobs(env, opts);

  if (result.data.length === 0 && page === 1) {
    return { text: '📭 No jobs found in database.' };
  }

  const filterLabel = opts.status ? ` (${opts.status})` : '';
  const lines = [`📋 <b>Jobs${filterLabel}</b>\n`];
  for (const job of result.data) {
    const status = job.status === 'posted' ? '✅' : job.status === 'failed' ? '❌' : '📥';
    lines.push(`${status} <code>${job.id.substring(0, 20)}</code>`);
    lines.push(`  ${job.title}`);
    if (job.company) lines.push(`  🏢 ${job.company}`);
    lines.push(`  📡 ${job.source} · ${job.posted_at || job.scraped_at}\n`);
  }

  lines.push(`Total: ${result.meta.total} jobs`);
  const keyboard = jobsKeyboard(result.meta.page, result.meta.totalPages, opts.status);
  return { text: lines.join('\n'), keyboard };
}

/**
 * Handle /job <id> command — get full job details from D1.
 */
export async function handleJobDetails(env: Env, jobId: string): Promise<string> {
  const job = await getJobFromDB(env, jobId);

  if (!job) {
    return `❌ Job not found: <code>${jobId}</code>`;
  }

  const lines = [
    `📄 <b>Job Details</b>\n`,
    `<b>ID:</b> <code>${job.id}</code>`,
    `<b>Title:</b> ${job.title}`,
  ];
  if (job.company) lines.push(`<b>Company:</b> ${job.company}`);
  if (job.location) lines.push(`<b>Location:</b> ${job.location}`);
  lines.push(`<b>Source:</b> ${job.source}`);
  lines.push(`<b>Status:</b> ${job.status}`);
  if (job.category) lines.push(`<b>Category:</b> ${job.category}`);
  if (job.posted_at) lines.push(`<b>Posted:</b> ${job.posted_at}`);
  if (job.deadline) lines.push(`<b>Deadline:</b> ${job.deadline}`);
  if (job.telegram_message_id) lines.push(`<b>Telegram Msg:</b> ${job.telegram_message_id}`);
  if (job.word_count) lines.push(`<b>Word Count:</b> ${job.word_count}`);
  if (job.ai_summary_ar) {
    const summary = job.ai_summary_ar.length > 200
      ? job.ai_summary_ar.substring(0, 200) + '...'
      : job.ai_summary_ar;
    lines.push(`\n<b>AI Summary:</b>\n${summary}`);
  }

  return lines.join('\n');
}

/**
 * Handle /search <keyword> command — SQL search on title + company.
 */
export async function handleSearch(env: Env, keyword: string, page = 1): Promise<CommandResult> {
  const result = await listJobs(env, { search: keyword, page, limit: 8 });

  if (result.data.length === 0) {
    return { text: `🔍 No jobs found matching: "${keyword}"` };
  }

  const lines = [`🔍 <b>Search: "${keyword}"</b>\n`];
  for (const job of result.data) {
    const status = job.status === 'posted' ? '✅' : job.status === 'failed' ? '❌' : '📥';
    lines.push(`${status} <code>${job.id.substring(0, 20)}</code>`);
    lines.push(`  ${job.title}`);
    if (job.company) lines.push(`  🏢 ${job.company}\n`);
  }

  lines.push(`Total: ${result.meta.total} results`);
  const keyboard = paginationKeyboard('search', result.meta.page, result.meta.totalPages, keyword);
  return { text: lines.join('\n'), keyboard };
}

/**
 * Handle /clear <id|all> command — remove job + dedup key from KV.
 */
export async function handleClear(env: Env, target: string): Promise<string> {
  const record = await getPostedJobRecord(env, target);
  if (!record) {
    return `❌ Job not found in KV: <code>${target}</code>`;
  }

  await deleteJobFromKV(env, target);

  let dedupCleared = false;
  if (record.company) {
    await deleteDedupKey(env, record.title, record.company);
    dedupCleared = true;
  }

  const dedupNote = dedupCleared
    ? '\nAlso cleared dedup key (title+company).'
    : '\n<i>No company stored — dedup key not cleared (old record).</i>';

  return `✅ Cleared job from KV: <code>${target}</code>${dedupNote}\n\nThis job can now be re-posted.`;
}

/**
 * Handle /status command — quick bot status from D1.
 */
export async function handleStatus(env: Env): Promise<string> {
  const stats = await getDashboardStats(env);
  const environment = env.ENVIRONMENT || 'unknown';

  const statusParts: string[] = [];
  for (const [status, count] of Object.entries(stats.byStatus)) {
    statusParts.push(`${status}: ${count}`);
  }

  return `🤖 <b>Yemen Jobs Bot</b>

<b>Environment:</b> ${environment}
<b>Total Jobs:</b> ${stats.totalJobs}
<b>By Status:</b> ${statusParts.join(', ') || 'none'}
<b>Recent Runs:</b> ${stats.recentRuns.length}

<i>Use /stats for detailed breakdown.</i>`;
}

/**
 * Handle /stats command — detailed D1 dashboard.
 */
export async function handleStats(env: Env): Promise<CommandResult> {
  const stats = await getDashboardStats(env);

  const lines = ['📊 <b>Dashboard Stats</b>\n'];
  lines.push(`<b>Total Jobs:</b> ${stats.totalJobs}\n`);

  // By status
  lines.push('<b>By Status:</b>');
  for (const [status, count] of Object.entries(stats.byStatus)) {
    const icon = status === 'posted' ? '✅' : status === 'failed' ? '❌' : status === 'fetched' ? '📥' : '⏭️';
    lines.push(`  ${icon} ${status}: ${count}`);
  }

  // By source
  lines.push('\n<b>By Source:</b>');
  for (const { source, count } of stats.bySource) {
    lines.push(`  📡 ${source}: ${count}`);
  }

  // Recent runs
  if (stats.recentRuns.length > 0) {
    lines.push('\n<b>Recent Runs:</b>');
    for (const run of stats.recentRuns.slice(0, 3)) {
      const icon = run.status === 'completed' ? '✅' : run.status === 'failed' ? '❌' : '⏳';
      const time = run.started_at.substring(11, 16); // HH:MM
      lines.push(`  ${icon} ${time} — ${run.jobs_posted}p/${run.jobs_skipped}s/${run.jobs_failed}f (${run.trigger_type})`);
    }
  }

  const keyboard: InlineKeyboardMarkup = {
    inline_keyboard: [[{ text: '🔄 Refresh', callback_data: 'stats' }]],
  };
  return { text: lines.join('\n'), keyboard };
}

/**
 * Handle /runs command — pipeline run history from D1.
 */
export async function handleRuns(env: Env, page = 1): Promise<CommandResult> {
  const result = await listRuns(env, { page, limit: 5 });

  if (result.data.length === 0 && page === 1) {
    return { text: '📭 No pipeline runs found.' };
  }

  const lines = ['🔄 <b>Pipeline Runs</b>\n'];
  for (const run of result.data) {
    const icon = run.status === 'completed' ? '✅' : run.status === 'failed' ? '❌' : '⏳';
    const date = run.started_at.substring(0, 10);
    const time = run.started_at.substring(11, 16);
    lines.push(`${icon} <b>#${run.id}</b> ${date} ${time}`);
    lines.push(`  ${run.trigger_type} — ${run.jobs_posted} posted, ${run.jobs_skipped} skipped, ${run.jobs_failed} failed`);
    if (run.error) lines.push(`  ❌ ${run.error.substring(0, 60)}`);
    lines.push('');
  }

  lines.push(`Total: ${result.meta.total} runs`);
  const keyboard = paginationKeyboard('runs', result.meta.page, result.meta.totalPages);
  return { text: lines.join('\n'), keyboard };
}

/**
 * Handle /model command — view or set AI model.
 */
export async function handleModel(env: Env, args: string[]): Promise<string> {
  if (args.length === 0) {
    // View current model
    let d1Model: string | null = null;
    try {
      d1Model = await getSetting(env, 'ai-model');
    } catch { /* D1 read failed */ }

    const envModel = env.AI_MODEL;
    const activeModel = d1Model || envModel || DEFAULT_AI_MODEL;
    const source = d1Model ? 'D1 settings' : envModel ? 'env var' : 'code default';

    return `⚙️ <b>AI Model</b>

<b>Active:</b> <code>${activeModel}</code>
<b>Source:</b> ${source}

<i>Set: /model [model-id]
Reset: /model reset</i>`;
  }

  if (args[0] === 'reset') {
    try {
      await env.JOBS_DB.prepare('DELETE FROM settings WHERE key = ?').bind('ai-model').run();
    } catch { /* ignore */ }
    const fallback = env.AI_MODEL || DEFAULT_AI_MODEL;
    return `✅ AI model reset. Now using: <code>${fallback}</code>`;
  }

  // Set new model
  const model = args[0];
  await setSetting(env, 'ai-model', model);
  return `✅ AI model set to: <code>${model}</code>`;
}
