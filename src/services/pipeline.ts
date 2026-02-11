/**
 * Job processing pipeline.
 * Orchestrates: fetch → dedup → process → AI → format → post → archive.
 */

import type { Env, JobItem } from '../types';
import { sendTextMessage, sendPhotoMessage, sendMessageWithId, editMessageText } from './telegram';
import {
  isJobPosted, markJobAsPosted, isDuplicateJob, markDedupKey,
  createRun, completeRun, saveJobOnFetch, saveSkippedJob, updateJobStatus,
  getTodayRuns,
} from './storage';
import { formatTelegramMessage, delay } from '../utils/format';
import { getEnabledSourcesFromDB, getHashtagsFromDB, getSource, DEFAULT_SOURCE } from './sources/registry';
import { summarizeJob } from './ai';

// Default values (can be overridden via env vars)
const DEFAULT_DELAY_BETWEEN_POSTS_MS = 1000;
const DEFAULT_MAX_JOBS_PER_RUN = 15;

interface SourceStats {
  fetched: number;
  posted: number;
  skipped: number;
  failed: number;
  error?: string;
}

/**
 * Build the hourly summary message from per-source stats.
 */
function buildSummary(
  sourceStats: Map<string, SourceStats>,
  totals: { processed: number; posted: number; skipped: number; failed: number },
  done: boolean,
  environment?: string
): string {
  const envLabel = environment && environment !== 'production' ? ` [${environment}]` : '';
  const header = done ? `📊 <b>Hourly Run Complete</b>${envLabel}` : `⏳ <b>Processing...</b>${envLabel}`;
  const lines = [header, ''];

  for (const [name, s] of sourceStats) {
    if (s.error) {
      lines.push(`❌ ${name}: ${s.error}`);
    } else if (s.fetched === 0) {
      lines.push(`⚠️ ${name}: 0 jobs`);
    } else {
      const parts: string[] = [];
      if (s.posted > 0) parts.push(`${s.posted} posted`);
      if (s.skipped > 0) parts.push(`${s.skipped} skipped`);
      if (s.failed > 0) parts.push(`${s.failed} failed`);
      const detail = parts.length > 0 ? parts.join(', ') : 'pending';
      lines.push(`${s.failed > 0 ? '⚠️' : '✅'} ${name}: ${s.fetched} fetched → ${detail}`);
    }
  }

  lines.push('');
  lines.push(`<b>Total:</b> ${totals.posted} posted, ${totals.skipped} skipped, ${totals.failed} failed`);
  return lines.join('\n');
}

/**
 * Process all new jobs from all registered sources.
 */
export async function processJobs(
  env: Env,
  triggerType: 'cron' | 'manual' | 'webhook' = 'manual',
  cron?: string
): Promise<{ processed: number; posted: number; skipped: number; failed: number }> {
  console.log('Starting job processing...');

  // Read configuration from env vars with defaults
  const maxJobs = parseInt(env.MAX_JOBS_PER_RUN || String(DEFAULT_MAX_JOBS_PER_RUN), 10);
  const delayMs = parseInt(env.DELAY_BETWEEN_POSTS_MS || String(DEFAULT_DELAY_BETWEEN_POSTS_MS), 10);

  let processed = 0;
  let posted = 0;
  let skipped = 0;  // Jobs skipped (already posted or duplicate)
  let failed = 0;   // Jobs that failed to post

  // Create run record in D1
  let runId: number | undefined;
  try {
    runId = await createRun(env, triggerType);
  } catch (error) {
    console.error('Failed to create run record:', error);
  }

  // Per-source tracking
  const sourceStats: Map<string, SourceStats> = new Map();

  // Admin message: only created when there are posted jobs or errors (reduces noise)
  let adminMsgId: number | null = null;

  const sendOrUpdateAdmin = async (done: boolean) => {
    if (!env.ADMIN_CHAT_ID) return;
    // Only notify admin when there's actual activity (posted or failed jobs)
    if (posted === 0 && failed === 0) return;
    const text = buildSummary(sourceStats, { processed, posted, skipped, failed }, done, env.ENVIRONMENT);
    if (adminMsgId) {
      await editMessageText(env.TELEGRAM_BOT_TOKEN, env.ADMIN_CHAT_ID, adminMsgId, text);
    } else {
      adminMsgId = await sendMessageWithId(env.TELEGRAM_BOT_TOKEN, env.ADMIN_CHAT_ID, text);
    }
  };

  try {
    // 1. Fetch jobs from all registered sources in parallel
    const [plugins, hashtagMap] = await Promise.all([
      getEnabledSourcesFromDB(env, cron),
      getHashtagsFromDB(env),
    ]);
    console.log(`Fetching jobs from ${plugins.length} sources: ${plugins.map(p => p.name).join(', ')}...`);

    // Init stats for all sources
    for (const p of plugins) {
      sourceStats.set(p.name, { fetched: 0, posted: 0, skipped: 0, failed: 0 });
    }

    const fetchResults = await Promise.allSettled(
      plugins.map(plugin =>
        plugin.fetchJobs(env).then(jobs => ({ plugin, jobs }))
      )
    );

    // Extract jobs, handling failures gracefully
    const allJobs: JobItem[] = [];
    for (const result of fetchResults) {
      if (result.status === 'fulfilled') {
        const { plugin, jobs } = result.value;
        console.log(`Found ${jobs.length} jobs from ${plugin.name}`);
        const stats = sourceStats.get(plugin.name)!;
        stats.fetched = jobs.length;
        allJobs.push(...jobs);
      } else {
        console.error('Failed to fetch jobs from source:', result.reason);
      }
    }

    // Mark fetch errors by matching allSettled order to plugins array
    for (let i = 0; i < fetchResults.length; i++) {
      const result = fetchResults[i];
      if (result.status === 'rejected') {
        const name = plugins[i].name;
        const stats = sourceStats.get(name)!;
        stats.error = result.reason instanceof Error ? result.reason.message : String(result.reason);
      }
    }

    console.log(`Total jobs from all sources: ${allJobs.length}`);
    await sendOrUpdateAdmin(false);

    if (allJobs.length === 0) {
      console.log('No jobs found from any source');
      await sendOrUpdateAdmin(true);
      if (runId) {
        await completeRun(env, runId, {
          jobs_fetched: 0, jobs_posted: 0, jobs_skipped: 0, jobs_failed: 0,
          source_stats: Object.fromEntries(sourceStats),
        });
      }
      return { processed: 0, posted: 0, skipped: 0, failed: 0 };
    }

    // 2. Sort by date (oldest first for FIFO) and limit
    const sortedJobs = allJobs.sort((a, b) =>
      new Date(a.pubDate).getTime() - new Date(b.pubDate).getTime()
    );
    const jobsToProcess = sortedJobs.slice(0, maxJobs);

    if (allJobs.length > maxJobs) {
      console.log(`Limiting to ${maxJobs} jobs (${allJobs.length - maxJobs} will be processed next hour)`);
    }

    for (const job of jobsToProcess) {
      processed++;
      const source = job.source || DEFAULT_SOURCE;
      const stats = sourceStats.get(source);

      // 3. Check if already posted by source-specific ID
      const alreadyPosted = await isJobPosted(env, job.id);
      if (alreadyPosted) {
        console.log(`Job already posted: ${job.id} (${source})`);
        await saveSkippedJob(env, job.id, job.title, job.company, 'skipped', source, runId);
        skipped++;
        if (stats) stats.skipped++;
        continue;
      }

      // 4. Check cross-source deduplication (title+company)
      const isDuplicate = await isDuplicateJob(env, job.title, job.company);
      if (isDuplicate) {
        console.log(`Skipping duplicate job: "${job.title}" at "${job.company}" (${source})`);
        await saveSkippedJob(env, job.id, job.title, job.company, 'duplicate', source, runId);
        // Mark the source-specific ID so we don't check again
        await markJobAsPosted(env, job.id, job.title, job.company);
        skipped++;
        if (stats) stats.skipped++;
        continue;
      }

      console.log(`Processing new job: ${job.title} (${job.id}) from ${source}`);

      try {
        // 5. Get the plugin for this job's source
        const plugin = getSource(source);

        // 6. Process job (clean HTML, fetch details if needed)
        console.log(`Processing job with ${source} plugin: ${job.title}`);
        const processedJob = await plugin.processJob(job, env);

        // 6.5 Save job to D1 on fetch (status='fetched')
        await saveJobOnFetch(env, job.id, processedJob, job.description || '', source, runId);

        // 7. Generate AI summary and category
        console.log(`Generating AI summary for: ${job.title}`);
        const { summary, category } = await summarizeJob(processedJob, env);

        // Update category in processed job
        processedJob.category = category;

        // 8. Format message
        const message = formatTelegramMessage(summary, job.link, processedJob.imageUrl, env.LINKEDIN_URL, source, category, hashtagMap[source]);

        // 9. Send to Telegram
        console.log(`Sending to Telegram: ${job.title}`);
        let sendResult;

        if (message.hasImage && message.imageUrl) {
          sendResult = await sendPhotoMessage(
            env.TELEGRAM_BOT_TOKEN,
            env.TELEGRAM_CHAT_ID,
            message.imageUrl,
            message.fullMessage
          );
        } else {
          sendResult = await sendTextMessage(
            env.TELEGRAM_BOT_TOKEN,
            env.TELEGRAM_CHAT_ID,
            message.fullMessage
          );
        }

        // 10. Mark as posted only if successful
        if (sendResult.success) {
          // Mark source-specific ID
          await markJobAsPosted(env, job.id, job.title, job.company);
          // Mark dedup key (title+company) for cross-source deduplication
          await markDedupKey(env, job.title, job.company);
          // Update job status in D1 with AI summary and telegram message ID
          await updateJobStatus(env, job.id, 'posted', {
            aiSummary: summary,
            category,
            telegramMessageId: sendResult.messageId,
          });
          posted++;
          if (stats) stats.posted++;
          console.log(`Successfully posted: ${job.title} (${source})`);
        } else {
          console.error(`Failed to post: ${job.title}`);
          await updateJobStatus(env, job.id, 'failed');
          failed++;
          if (stats) stats.failed++;
          // Don't mark as posted, will retry next hour
        }

        // 11. Rate limit delay
        if (posted < jobsToProcess.length) {
          await delay(delayMs);
        }
      } catch (error) {
        console.error(`Error processing job ${job.id}:`, error);
        try { await updateJobStatus(env, job.id, 'failed'); } catch { /* job may not exist in D1 yet */ }
        failed++;
        if (stats) stats.failed++;
        // Continue with next job
      }
    }
  } catch (error) {
    console.error('Error in processJobs:', error);
    // Complete run with error
    if (runId) {
      await completeRun(env, runId, {
        jobs_fetched: processed, jobs_posted: posted, jobs_skipped: skipped, jobs_failed: failed,
        source_stats: Object.fromEntries(sourceStats),
        error: error instanceof Error ? error.message : String(error),
      });
    }
    // Send critical error alert
    if (env.ADMIN_CHAT_ID) {
      await sendTextMessage(env.TELEGRAM_BOT_TOKEN, env.ADMIN_CHAT_ID,
        `❌ <b>Critical error in processJobs</b>\n\n${error instanceof Error ? error.message : String(error)}\n\n<i>${new Date().toISOString()}</i>`);
    }
    throw error;
  }

  console.log(`Processing complete. Processed: ${processed}, Posted: ${posted}, Skipped: ${skipped}, Failed: ${failed}`);

  // Complete run record in D1
  if (runId) {
    await completeRun(env, runId, {
      jobs_fetched: processed,
      jobs_posted: posted,
      jobs_skipped: skipped,
      jobs_failed: failed,
      source_stats: Object.fromEntries(sourceStats),
    });
  }

  // Final summary edit with complete stats
  await sendOrUpdateAdmin(true);

  return { processed, posted, skipped, failed };
}

/**
 * Send end-of-day digest to admin with aggregated stats from today's runs.
 * Triggered by the daily summary cron (0 23 * * *).
 */
export async function sendDailySummary(env: Env): Promise<void> {
  if (!env.ADMIN_CHAT_ID) return;

  try {
    const runs = await getTodayRuns(env);

    if (runs.length === 0) {
      await sendTextMessage(env.TELEGRAM_BOT_TOKEN, env.ADMIN_CHAT_ID,
        '📊 <b>Daily Summary</b>\n\nNo pipeline runs today.');
      return;
    }

    let totalPosted = 0;
    let totalSkipped = 0;
    let totalFailed = 0;
    const errors: string[] = [];
    const perSource: Record<string, { posted: number; skipped: number; failed: number }> = {};

    for (const run of runs) {
      totalPosted += run.jobs_posted;
      totalSkipped += run.jobs_skipped;
      totalFailed += run.jobs_failed;
      if (run.error) errors.push(run.error);

      // Aggregate per-source stats
      if (run.source_stats) {
        try {
          const stats = JSON.parse(run.source_stats) as Record<string, { posted?: number; skipped?: number; failed?: number }>;
          for (const [source, s] of Object.entries(stats)) {
            if (!perSource[source]) perSource[source] = { posted: 0, skipped: 0, failed: 0 };
            perSource[source].posted += s.posted || 0;
            perSource[source].skipped += s.skipped || 0;
            perSource[source].failed += s.failed || 0;
          }
        } catch { /* ignore malformed JSON */ }
      }
    }

    const envLabel = env.ENVIRONMENT && env.ENVIRONMENT !== 'production' ? ` [${env.ENVIRONMENT}]` : '';
    const lines = [`📊 <b>Daily Summary</b>${envLabel}`, ''];

    // Per-source breakdown
    for (const [source, s] of Object.entries(perSource)) {
      const parts: string[] = [];
      if (s.posted > 0) parts.push(`${s.posted} posted`);
      if (s.skipped > 0) parts.push(`${s.skipped} skipped`);
      if (s.failed > 0) parts.push(`${s.failed} failed`);
      const detail = parts.length > 0 ? parts.join(', ') : 'no activity';
      lines.push(`${s.failed > 0 ? '⚠️' : '✅'} ${source}: ${detail}`);
    }

    lines.push('');
    lines.push(`<b>Total:</b> ${totalPosted} posted, ${totalSkipped} skipped, ${totalFailed} failed`);
    lines.push(`<b>Runs:</b> ${runs.length}`);

    if (errors.length > 0) {
      lines.push('');
      lines.push(`❌ <b>Errors:</b>`);
      for (const err of errors.slice(0, 3)) {
        lines.push(`  • ${err.substring(0, 100)}`);
      }
    }

    await sendTextMessage(env.TELEGRAM_BOT_TOKEN, env.ADMIN_CHAT_ID, lines.join('\n'));
  } catch (error) {
    console.error('Failed to send daily summary:', error);
  }
}
