import type { Env } from './types';
import type { TelegramUpdate } from './types/telegram';
import { sendTextMessage } from './services/telegram';
import { handleWebhook } from './services/commands';
import { processJobs } from './services/pipeline';
import { jsonResponse } from './utils/http';

const DEPLOY_VERSION_KEY = 'meta:deployed_version';

/**
 * Send a deploy notification if this is a new version.
 * Checks KV for the last known version and compares to current.
 */
async function checkDeployNotification(env: Env): Promise<void> {
  try {
    const currentVersion = env.CF_VERSION_METADATA?.id;
    if (!currentVersion) return;

    const lastVersion = await env.POSTED_JOBS.get(DEPLOY_VERSION_KEY);
    if (lastVersion === currentVersion) return;

    // New deploy detected — update KV first to avoid duplicate notifications
    await env.POSTED_JOBS.put(DEPLOY_VERSION_KEY, currentVersion);

    const environment = env.ENVIRONMENT || 'unknown';
    const timestamp = new Date().toISOString();
    const message = `🚀 <b>New Deploy</b>\n\n<b>Environment:</b> ${environment}\n<b>Version:</b> <code>${currentVersion}</code>\n<b>Time:</b> ${timestamp}`;

    if (env.ADMIN_CHAT_ID) {
      await sendTextMessage(env.TELEGRAM_BOT_TOKEN, env.ADMIN_CHAT_ID, message);
    }
  } catch (error) {
    // Don't let deploy notification failures affect normal operation
    console.error('Deploy notification error:', error);
  }
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
    ctx.waitUntil(checkDeployNotification(env));
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

    // Check for new deploy and notify admin
    ctx.waitUntil(checkDeployNotification(env));

    // Telegram webhook endpoint (for admin commands)
    if (url.pathname === '/webhook' && request.method === 'POST') {
      try {
        const update = await request.json() as TelegramUpdate;
        return await handleWebhook(update, env, ctx, () => processJobs(env));
      } catch (error) {
        console.error('Webhook error:', error);
        return new Response('Bad Request', { status: 400 });
      }
    }

    // Manual trigger endpoint — await processing so the worker stays alive
    // (ctx.waitUntil on fetch handlers gets killed after ~30s, not enough for 25 jobs)
    if (url.pathname === '/__scheduled') {
      const result = await processJobs(env);
      return jsonResponse({ status: 'complete', ...result, timestamp: new Date().toISOString() });
    }

    // Clear KV cache (preview only)
    if (url.pathname === '/clear-kv' && env.ENVIRONMENT === 'preview') {
      const jobList = await env.POSTED_JOBS.list({ prefix: 'job:', limit: 1000 });
      const dedupList = await env.POSTED_JOBS.list({ prefix: 'dedup:', limit: 1000 });
      const metaList = await env.POSTED_JOBS.list({ prefix: 'meta:', limit: 100 });
      const allKeys = [...jobList.keys, ...dedupList.keys, ...metaList.keys];
      await Promise.all(allKeys.map(k => env.POSTED_JOBS.delete(k.name)));
      return jsonResponse({ cleared: allKeys.length, keys: allKeys.map(k => k.name) });
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
      description: 'Monitors Yemen HR, EOI Yemen, and ReliefWeb for new jobs and posts to Telegram',
      sources: ['Yemen HR (via RSS Bridge)', 'EOI Yemen (eoi-ye.com)', 'ReliefWeb (reliefweb.int)'],
      endpoints: {
        '/__scheduled': 'Manually trigger job processing',
        '/health': 'Health check',
        '/api/jobs': 'Export all jobs data (JSON)',
        '/webhook': 'Telegram webhook for admin commands (POST)',
      },
    });
  },
};
