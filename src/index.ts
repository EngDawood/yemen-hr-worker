import type { Env, JobItem, ProcessedJob } from './types';
import { fetchRSSFeed } from './services/rss';
import { cleanJobDescription } from './services/cleaner';
import { summarizeJob } from './services/gemini';
import { sendTextMessage, sendPhotoMessage } from './services/telegram';
import { isJobPosted, markJobAsPosted, saveJobToDatabase } from './services/storage';
import { formatTelegramMessage, delay } from './utils/format';
import { jsonResponse } from './utils/http';
import { sendAlert } from './utils/alert';

// Default values (can be overridden via env vars)
const DEFAULT_DELAY_BETWEEN_POSTS_MS = 1000;
const DEFAULT_MAX_JOBS_PER_RUN = 10;

/**
 * Process all new jobs from RSS feed.
 */
async function processJobs(env: Env): Promise<{ processed: number; posted: number }> {
  console.log('Starting job processing...');

  // Read configuration from env vars with defaults
  const maxJobs = parseInt(env.MAX_JOBS_PER_RUN || String(DEFAULT_MAX_JOBS_PER_RUN), 10);
  const delayMs = parseInt(env.DELAY_BETWEEN_POSTS_MS || String(DEFAULT_DELAY_BETWEEN_POSTS_MS), 10);

  let processed = 0;
  let posted = 0;

  try {
    // 1. Fetch RSS feed
    console.log('Fetching RSS feed...');
    const jobs = await fetchRSSFeed(env.RSS_FEED_URL);
    console.log(`Found ${jobs.length} jobs in RSS feed`);

    if (jobs.length === 0) {
      console.log('No jobs found in RSS feed');
      // Alert on empty RSS feed (might indicate scraping issue)
      await sendAlert(env.TELEGRAM_BOT_TOKEN, env.ADMIN_CHAT_ID,
        'RSS feed returned 0 jobs. Check if YemenHR or RSS Bridge is down.');
      return { processed: 0, posted: 0 };
    }

    // 2. Process each job sequentially (limit to maxJobs)
    // Reverse to post oldest jobs first (queue order, not stack)
    const jobsToProcess = jobs.slice(0, maxJobs).reverse();
    if (jobs.length > maxJobs) {
      console.log(`Limiting to ${maxJobs} jobs (${jobs.length - maxJobs} will be processed next hour)`);
    }

    for (const job of jobsToProcess) {
      processed++;

      // 3. Check if already posted
      const alreadyPosted = await isJobPosted(env, job.id);
      if (alreadyPosted) {
        console.log(`Job already posted: ${job.id}`);
        continue;
      }

      console.log(`Processing new job: ${job.title} (${job.id})`);

      try {
        // 4. Clean HTML from RSS content and extract structured data
        const extractedData = cleanJobDescription(job.description || '');

        // 5. Create processed job object with extracted data
        const processedJob: ProcessedJob = {
          title: job.title,
          company: job.company,
          link: job.link,
          description: extractedData.description,
          imageUrl: job.imageUrl,
          location: extractedData.location,
          postedDate: extractedData.postedDate,
          deadline: extractedData.deadline,
        };

        // 6. Get AI summary
        console.log(`Generating AI summary for: ${job.title}`);
        const summary = await summarizeJob(processedJob, env.AI);

        // 7. Format message
        const message = formatTelegramMessage(summary, job.link, job.imageUrl, env.LINKEDIN_URL);

        // 8. Send to Telegram
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

        // 9. Mark as posted only if successful
        if (success) {
          await markJobAsPosted(env, job.id, job.title);
          // Save full job data to D1 for ML training
          await saveJobToDatabase(env, job.id, processedJob, job.description || '', summary);
          posted++;
          console.log(`Successfully posted: ${job.title}`);
        } else {
          console.error(`Failed to post: ${job.title}`);
          // Don't mark as posted, will retry next hour
        }

        // 10. Rate limit delay
        if (posted < jobs.length) {
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

  console.log(`Processing complete. Processed: ${processed}, Posted: ${posted}`);

  // Alert if all jobs failed to post
  if (posted === 0 && processed > 0) {
    await sendAlert(env.TELEGRAM_BOT_TOKEN, env.ADMIN_CHAT_ID,
      `Failed to post any jobs. Processed: ${processed}`);
  }

  return { processed, posted };
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
   * HTTP handler - for manual triggers and health checks.
   */
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

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
      name: 'Yemen HR Bot',
      description: 'Monitors Yemen HR for new jobs and posts to Telegram',
      endpoints: {
        '/__scheduled': 'Manually trigger job processing',
        '/health': 'Health check',
        '/api/jobs': 'Export all jobs data (JSON)',
      },
    });
  },
};
