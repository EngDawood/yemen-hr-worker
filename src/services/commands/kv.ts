/**
 * KV storage command handlers (/jobs, /job, /search, /clear, /status).
 */

import type { Env } from '../../types';
import {
  listRecentJobs,
  getJobById,
  deleteJobFromKV,
  deleteDedupKey,
  getPostedJobRecord,
  searchJobsInKV,
  clearAllKV,
} from '../storage';

/**
 * Handle /jobs command - list recent jobs.
 */
export async function handleJobsList(env: Env): Promise<string> {
  const jobs = await listRecentJobs(env, 10);

  if (jobs.length === 0) {
    return '📭 No jobs found in KV storage.';
  }

  const lines = ['📋 <b>Recent Jobs</b>\n'];
  for (const job of jobs) {
    lines.push(`• <code>${job.id}</code>`);
    lines.push(`  ${job.title}`);
    lines.push(`  <i>${job.postedAt}</i>\n`);
  }

  lines.push(`Total: ${jobs.length} jobs`);
  return lines.join('\n');
}

/**
 * Handle /job <id> command - get job details.
 */
export async function handleJobDetails(env: Env, jobId: string): Promise<string> {
  const job = await getJobById(env, jobId);

  if (!job) {
    return `❌ Job not found: <code>${jobId}</code>`;
  }

  return `📄 <b>Job Details</b>

<b>ID:</b> <code>${jobId}</code>
<b>Title:</b> ${job.title}
<b>Posted:</b> ${job.postedAt}`;
}

/**
 * Handle /search <keyword> command.
 */
export async function handleSearch(env: Env, keyword: string): Promise<string> {
  const jobs = await searchJobsInKV(env, keyword);

  if (jobs.length === 0) {
    return `🔍 No jobs found matching: "${keyword}"`;
  }

  const lines = [`🔍 <b>Search Results for "${keyword}"</b>\n`];
  for (const job of jobs.slice(0, 10)) {
    lines.push(`• <code>${job.id}</code>`);
    lines.push(`  ${job.title}\n`);
  }

  if (jobs.length > 10) {
    lines.push(`<i>...and ${jobs.length - 10} more</i>`);
  }

  return lines.join('\n');
}

/**
 * Handle /clear <id|all> command - remove job + dedup key from KV.
 */
export async function handleClear(env: Env, target: string): Promise<string> {
  if (target === 'all') {
    const result = await clearAllKV(env);
    return `✅ Cleared all KV keys.\n\nDeleted: ${result.jobKeys} job + ${result.dedupKeys} dedup + ${result.metaKeys} meta keys.`;
  }

  // Clear single job by ID
  const record = await getPostedJobRecord(env, target);

  if (!record) {
    return `❌ Job not found: <code>${target}</code>`;
  }

  // Delete the job key
  await deleteJobFromKV(env, target);

  // Also delete the dedup key if we have company info
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
 * Handle /status command.
 */
export async function handleStatus(env: Env): Promise<string> {
  const jobs = await listRecentJobs(env, 100);
  const environment = env.ENVIRONMENT || 'unknown';

  return `🤖 <b>Yemen Jobs Bot Status</b>

<b>Environment:</b> ${environment}
<b>Jobs in KV:</b> ${jobs.length}+
<b>Chat ID:</b> ${env.TELEGRAM_CHAT_ID}

<i>Use /run to manually trigger processing.</i>`;
}
