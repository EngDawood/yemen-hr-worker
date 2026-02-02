import type { Env, JobItem, ProcessedJob } from './types';
import type { TelegramUpdate } from './types/telegram';
import { fetchRSSFeed } from './services/rss';
import { fetchEOIJobs } from './services/eoi';
import { cleanJobDescription } from './services/cleaner';
import { summarizeJob } from './services/gemini';
import { sendTextMessage, sendPhotoMessage } from './services/telegram';
import { isJobPosted, markJobAsPosted, saveJobToDatabase, isDuplicateJob, markDedupKey } from './services/storage';
import { handleWebhook } from './services/commands';
import { formatTelegramMessage, delay } from './utils/format';
import { jsonResponse } from './utils/http';
import { sendAlert } from './utils/alert';

// Default values (can be overridden via env vars)
const DEFAULT_DELAY_BETWEEN_POSTS_MS = 1000;
const DEFAULT_MAX_JOBS_PER_RUN = 15; // Increased to handle both sources

/**
 * Process all new jobs from both Yemen HR and EOI sources.
 */
async function processJobs(env: Env): Promise<{ processed: number; posted: number; skipped: number; failed: number }> {
  console.log('Starting job processing...');

  // Read configuration from env vars with defaults
  const maxJobs = parseInt(env.MAX_JOBS_PER_RUN || String(DEFAULT_MAX_JOBS_PER_RUN), 10);
  const delayMs = parseInt(env.DELAY_BETWEEN_POSTS_MS || String(DEFAULT_DELAY_BETWEEN_POSTS_MS), 10);

  let processed = 0;
  let posted = 0;
  let skipped = 0;  // Jobs skipped (already posted or duplicate)
  let failed = 0;   // Jobs that failed to post

  try {
    // 1. Fetch jobs from both sources in parallel
    console.log('Fetching jobs from Yemen HR and EOI...');
    const [yemenHRResult, eoiResult] = await Promise.allSettled([
      fetchRSSFeed(env.RSS_FEED_URL),
      fetchEOIJobs(),
    ]);

    // Extract jobs, handling failures gracefully
    const yemenHRJobs: JobItem[] = yemenHRResult.status === 'fulfilled' ? yemenHRResult.value : [];
    const eoiJobs: JobItem[] = eoiResult.status === 'fulfilled' ? eoiResult.value : [];

    // Log fetch results
    if (yemenHRResult.status === 'rejected') {
      console.error('Failed to fetch Yemen HR jobs:', yemenHRResult.reason);
    } else {
      console.log(`Found ${yemenHRJobs.length} jobs from Yemen HR`);
    }
    if (eoiResult.status === 'rejected') {
      console.error('Failed to fetch EOI jobs:', eoiResult.reason);
    } else {
      console.log(`Found ${eoiJobs.length} jobs from EOI`);
    }

    // Tag Yemen HR jobs with source (EOI jobs already have source set)
    const taggedYemenHRJobs = yemenHRJobs.map(job => ({ ...job, source: 'yemenhr' as const }));

    // Merge all jobs
    const allJobs = [...taggedYemenHRJobs, ...eoiJobs];
    console.log(`Total jobs from all sources: ${allJobs.length}`);

    if (allJobs.length === 0) {
      console.log('No jobs found from any source');
      await sendAlert(env.TELEGRAM_BOT_TOKEN, env.ADMIN_CHAT_ID,
        'No jobs found from any source. Check if Yemen HR, EOI, or RSS Bridge is down.');
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
      const source = job.source || 'yemenhr';

      // 3. Check if already posted by source-specific ID
      const alreadyPosted = await isJobPosted(env, job.id);
      if (alreadyPosted) {
        console.log(`Job already posted: ${job.id} (${source})`);
        skipped++;
        continue;
      }

      // 4. Check cross-source deduplication (title+company)
      const isDuplicate = await isDuplicateJob(env, job.title, job.company);
      if (isDuplicate) {
        console.log(`Skipping duplicate job: "${job.title}" at "${job.company}" (${source})`);
        // Mark the source-specific ID so we don't check again
        await markJobAsPosted(env, job.id, job.title);
        skipped++;
        continue;
      }

      console.log(`Processing new job: ${job.title} (${job.id}) from ${source}`);

      try {
        // 5. Clean HTML and extract structured data
        const extractedData = cleanJobDescription(job.description || '');

        // 6. Create processed job object with extracted data
        const processedJob: ProcessedJob = {
          title: job.title,
          company: job.company,
          link: job.link,
          description: extractedData.description || job.description || '',
          imageUrl: job.imageUrl,
          location: extractedData.location,
          postedDate: extractedData.postedDate,
          deadline: extractedData.deadline,
        };

        // 7. Get AI summary
        console.log(`Generating AI summary for: ${job.title}`);
        const summary = await summarizeJob(processedJob, env.AI);

        // 8. Format message
        const message = formatTelegramMessage(summary, job.link, job.imageUrl, env.LINKEDIN_URL);

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
          await markJobAsPosted(env, job.id, job.title);
          // Mark dedup key (title+company) for cross-source deduplication
          await markDedupKey(env, job.title, job.company);
          // Save full job data to D1 for ML training
          await saveJobToDatabase(env, job.id, processedJob, job.description || '', summary, source);
          posted++;
          console.log(`Successfully posted: ${job.title} (${source})`);
        } else {
          console.error(`Failed to post: ${job.title}`);
          failed++;
          // Don't mark as posted, will retry next hour
        }

        // 11. Rate limit delay
        if (posted < jobsToProcess.length) {
          await delay(delayMs);
        }
      } catch (error) {
        console.error(`Error processing job ${job.id}:`, error);
        // Continue with next job
      }
    }
  } catch (error) {
    console.error('Error in processJobs:', error);
    // Send alert for critical errors
    await sendAlert(env.TELEGRAM_BOT_TOKEN, env.ADMIN_CHAT_ID,
      `Critical error in processJobs: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }

  console.log(`Processing complete. Processed: ${processed}, Posted: ${posted}, Skipped: ${skipped}, Failed: ${failed}`);

  // Alert only if there were actual failures (not just skipped/duplicate jobs)
  if (failed > 0) {
    await sendAlert(env.TELEGRAM_BOT_TOKEN, env.ADMIN_CHAT_ID,
      `Failed to post ${failed} job(s). Processed: ${processed}, Skipped: ${skipped}, Posted: ${posted}`);
  }

  return { processed, posted, skipped, failed };
}

export default {
  /**
   * Scheduled handler - runs on cron trigger.
   */
  async scheduled(
    event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    console.log(`Cron triggered at ${new Date().toISOString()}`);
    ctx.waitUntil(processJobs(env));
  },

  /**
   * HTTP handler - for manual triggers, health checks, and webhook.
   */
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    // Telegram webhook endpoint (for admin commands)
    if (url.pathname === '/webhook' && request.method === 'POST') {
      try {
        const update = await request.json() as TelegramUpdate;
        return await handleWebhook(update, env, () => processJobs(env));
      } catch (error) {
        console.error('Webhook error:', error);
        return new Response('Bad Request', { status: 400 });
      }
    }

    // Manual trigger endpoint
    if (url.pathname === '/__scheduled') {
      ctx.waitUntil(processJobs(env));
      return jsonResponse({ status: 'triggered', timestamp: new Date().toISOString() });
    }

    // Health check / status
    if (url.pathname === '/health') {
      return jsonResponse({ status: 'ok', timestamp: new Date().toISOString() });
    }

    // Export jobs data for ML training
    if (url.pathname === '/api/jobs') {
      const { results } = await env.JOBS_DB.prepare(
        'SELECT * FROM jobs ORDER BY posted_at DESC'
      ).all();
      return jsonResponse(results);
    }

    // Default response
    return jsonResponse({
      name: 'Yemen Jobs Bot',
      description: 'Monitors Yemen HR and EOI Yemen for new jobs and posts to Telegram',
      sources: ['Yemen HR (via RSS Bridge)', 'EOI Yemen (eoi-ye.com)'],
      endpoints: {
        '/__scheduled': 'Manually trigger job processing',
        '/health': 'Health check',
        '/api/jobs': 'Export all jobs data (JSON)',
        '/webhook': 'Telegram webhook for admin commands (POST)',
      },
    });
  },
};
