/**
 * Job processing pipeline.
 * Orchestrates: fetch → dedup → process → AI → format → post → archive.
 */

import type { Env, JobItem } from '../types';
import { sendTextMessage, sendPhotoMessage, sendMessageWithId, editMessageText } from './telegram';
import { isJobPosted, markJobAsPosted, saveJobToDatabase, isDuplicateJob, markDedupKey } from './storage';
import { formatTelegramMessage, delay } from '../utils/format';
import { getEnabledSources, getSource, DEFAULT_SOURCE } from './sources/registry';
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
export async function processJobs(env: Env): Promise<{ processed: number; posted: number; skipped: number; failed: number }> {
  console.log('Starting job processing...');

  // Read configuration from env vars with defaults
  const maxJobs = parseInt(env.MAX_JOBS_PER_RUN || String(DEFAULT_MAX_JOBS_PER_RUN), 10);
  const delayMs = parseInt(env.DELAY_BETWEEN_POSTS_MS || String(DEFAULT_DELAY_BETWEEN_POSTS_MS), 10);

  let processed = 0;
  let posted = 0;
  let skipped = 0;  // Jobs skipped (already posted or duplicate)
  let failed = 0;   // Jobs that failed to post

  // Per-source tracking
  const sourceStats: Map<string, SourceStats> = new Map();

  // Send initial summary message to admin (will be edited with progress)
  const adminMsgId = env.ADMIN_CHAT_ID
    ? await sendMessageWithId(env.TELEGRAM_BOT_TOKEN, env.ADMIN_CHAT_ID, '⏳ <b>Hourly run starting...</b>')
    : null;

  const updateAdmin = async (done: boolean) => {
    if (!adminMsgId || !env.ADMIN_CHAT_ID) return;
    await editMessageText(
      env.TELEGRAM_BOT_TOKEN, env.ADMIN_CHAT_ID, adminMsgId,
      buildSummary(sourceStats, { processed, posted, skipped, failed }, done, env.ENVIRONMENT)
    );
  };

  try {
    // 1. Fetch jobs from all registered sources in parallel
    const plugins = getEnabledSources();
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
        // Find which source failed by matching the rejection
        // Promise.allSettled preserves order, so use index
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
    await updateAdmin(false);

    if (allJobs.length === 0) {
      console.log('No jobs found from any source');
      await updateAdmin(true);
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
        skipped++;
        if (stats) stats.skipped++;
        continue;
      }

      // 4. Check cross-source deduplication (title+company)
      const isDuplicate = await isDuplicateJob(env, job.title, job.company);
      if (isDuplicate) {
        console.log(`Skipping duplicate job: "${job.title}" at "${job.company}" (${source})`);
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

        // 7. Generate AI summary and category
        console.log(`Generating AI summary for: ${job.title}`);
        const { summary, category } = await summarizeJob(processedJob, env);

        // Update category in processed job
        processedJob.category = category;

        // 8. Format message
        const message = formatTelegramMessage(summary, job.link, processedJob.imageUrl, env.LINKEDIN_URL, source, category);

        // 9. Send to Telegram
        console.log(`Sending to Telegram: ${job.title}`);
        let success: boolean;

        if (message.hasImage && message.imageUrl) {
          success = await sendPhotoMessage(
            env.TELEGRAM_BOT_TOKEN,
            env.TELEGRAM_CHAT_ID,
            message.imageUrl,
            message.fullMessage
          );
        } else {
          success = await sendTextMessage(
            env.TELEGRAM_BOT_TOKEN,
            env.TELEGRAM_CHAT_ID,
            message.fullMessage
          );
        }

        // 10. Mark as posted only if successful
        if (success) {
          // Mark source-specific ID
          await markJobAsPosted(env, job.id, job.title, job.company);
          // Mark dedup key (title+company) for cross-source deduplication
          await markDedupKey(env, job.title, job.company);
          // Save full job data to D1 for ML training (skip in preview to avoid contamination)
          if (env.ENVIRONMENT !== 'preview') {
            await saveJobToDatabase(env, job.id, processedJob, job.description || '', summary, source);
          }
          posted++;
          if (stats) stats.posted++;
          console.log(`Successfully posted: ${job.title} (${source})`);
        } else {
          console.error(`Failed to post: ${job.title}`);
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
        failed++;
        if (stats) stats.failed++;
        // Continue with next job
      }
    }
  } catch (error) {
    console.error('Error in processJobs:', error);
    // Send critical error alert
    if (env.ADMIN_CHAT_ID) {
      await sendTextMessage(env.TELEGRAM_BOT_TOKEN, env.ADMIN_CHAT_ID,
        `❌ <b>Critical error in processJobs</b>\n\n${error instanceof Error ? error.message : String(error)}\n\n<i>${new Date().toISOString()}</i>`);
    }
    throw error;
  }

  console.log(`Processing complete. Processed: ${processed}, Posted: ${posted}, Skipped: ${skipped}, Failed: ${failed}`);

  // Final summary edit with complete stats
  await updateAdmin(true);

  return { processed, posted, skipped, failed };
}
