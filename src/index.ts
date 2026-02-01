import type { Env, JobItem, ProcessedJob } from './types';
import { fetchRSSFeed } from './services/rss';
import { scrapeJobPage } from './services/scraper';
import { cleanJobDescription } from './services/cleaner';
import { summarizeJob } from './services/gemini';
import { sendTextMessage, sendPhotoMessage } from './services/telegram';
import { isJobPosted, markJobAsPosted } from './services/storage';
import { formatTelegramMessage, delay } from './utils/format';

const DELAY_BETWEEN_POSTS_MS = 5000; // 5 seconds (12 RPM, under Gemini's 15 RPM free tier limit)
const MAX_JOBS_PER_RUN = 10; // Limit jobs per run to stay within rate limits

/**
 * Process all new jobs from RSS feed.
 */
async function processJobs(env: Env): Promise<{ processed: number; posted: number }> {
  console.log('Starting job processing...');

  let processed = 0;
  let posted = 0;

  try {
    // 1. Fetch RSS feed
    console.log('Fetching RSS feed...');
    const jobs = await fetchRSSFeed(env.RSS_FEED_URL);
    console.log(`Found ${jobs.length} jobs in RSS feed`);

    if (jobs.length === 0) {
      console.log('No jobs found in RSS feed');
      return { processed: 0, posted: 0 };
    }

    // 2. Process each job sequentially (limit to MAX_JOBS_PER_RUN)
    const jobsToProcess = jobs.slice(0, MAX_JOBS_PER_RUN);
    if (jobs.length > MAX_JOBS_PER_RUN) {
      console.log(`Limiting to ${MAX_JOBS_PER_RUN} jobs (${jobs.length - MAX_JOBS_PER_RUN} will be processed next hour)`);
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
        // 4. Scrape job page
        const html = await scrapeJobPage(job.link);

        // 5. Clean HTML
        const description = cleanJobDescription(html);

        // 6. Create processed job object
        const processedJob: ProcessedJob = {
          title: job.title,
          company: job.company,
          link: job.link,
          description,
          imageUrl: job.imageUrl,
        };

        // 7. Get AI summary
        console.log(`Generating AI summary for: ${job.title}`);
        const summary = await summarizeJob(processedJob, env.GEMINI_API_KEY);

        // 8. Format message
        const message = formatTelegramMessage(summary, job.link, job.imageUrl);

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
          await markJobAsPosted(env, job.id, job.title);
          posted++;
          console.log(`Successfully posted: ${job.title}`);
        } else {
          console.error(`Failed to post: ${job.title}`);
          // Don't mark as posted, will retry next hour
        }

        // 11. Rate limit delay
        if (posted < jobs.length) {
          await delay(DELAY_BETWEEN_POSTS_MS);
        }
      } catch (error) {
        console.error(`Error processing job ${job.id}:`, error);
        // Continue with next job
      }
    }
  } catch (error) {
    console.error('Error in processJobs:', error);
    throw error;
  }

  console.log(`Processing complete. Processed: ${processed}, Posted: ${posted}`);
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
      return new Response(
        JSON.stringify({ status: 'triggered', timestamp: new Date().toISOString() }),
        {
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Health check / status
    if (url.pathname === '/health') {
      return new Response(
        JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }),
        {
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Default response
    return new Response(
      JSON.stringify({
        name: 'Yemen HR Bot',
        description: 'Monitors Yemen HR for new jobs and posts to Telegram',
        endpoints: {
          '/__scheduled': 'Manually trigger job processing',
          '/health': 'Health check',
        },
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      }
    );
  },
};
