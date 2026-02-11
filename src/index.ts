import type { Env } from './types';
import type { TelegramUpdate } from './types/telegram';
import { sendTextMessage, setMyCommands } from './services/telegram';
import { handleWebhook, BOT_COMMANDS } from './services/commands';
import { processJobs, sendDailySummary } from './services/pipeline';
import { syncSourcesTable } from './services/sources/registry';
import { jsonResponse } from './utils/http';
import { handleApiRoute } from './api/routes';

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
    const cron = (event as unknown as { cron: string }).cron;
    console.log(`Cron triggered: ${cron} at ${new Date().toISOString()}`);
    ctx.waitUntil(checkDeployNotification(env));
    ctx.waitUntil(syncSourcesTable(env));

    // Daily summary cron — sends end-of-day digest instead of processing jobs
    if (cron === '0 23 * * *') {
      ctx.waitUntil(sendDailySummary(env));
      return;
    }

    // All other crons — process jobs for matching sources
    ctx.waitUntil(processJobs(env, 'cron', cron));
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
        return await handleWebhook(update, env, ctx, () => processJobs(env, 'webhook'));
      } catch (error) {
        console.error('Webhook error:', error);
        return new Response('Bad Request', { status: 400 });
      }
    }

    // Manual trigger endpoint — await processing so the worker stays alive
    // (ctx.waitUntil on fetch handlers gets killed after ~30s, not enough for 25 jobs)
    if (url.pathname === '/__scheduled') {
      const cron = url.searchParams.get('cron') || undefined;

      // Manual daily summary trigger
      if (cron === '0 23 * * *') {
        await sendDailySummary(env);
        return jsonResponse({ status: 'complete', action: 'daily_summary', timestamp: new Date().toISOString() });
      }

      const result = await processJobs(env, 'manual', cron);
      return jsonResponse({ status: 'complete', cron: cron || 'all', ...result, timestamp: new Date().toISOString() });
    }

    // Register bot command menu with Telegram (one-time setup)
    if (url.pathname === '/set-commands') {
      const ok = await setMyCommands(env.TELEGRAM_BOT_TOKEN, BOT_COMMANDS, env.ADMIN_CHAT_ID);
      return jsonResponse({ ok, commands: BOT_COMMANDS.length });
    }

    // Health check / status
    if (url.pathname === '/health') {
      return jsonResponse({ status: 'ok', timestamp: new Date().toISOString() });
    }

    // REST API routes (/api/*)
    if (url.pathname.startsWith('/api/')) {
      const apiResponse = await handleApiRoute(request, url, env);
      if (apiResponse) return apiResponse;
    }

    // Default response
    return jsonResponse({
      name: 'Yemen Jobs Bot',
      description: 'Monitors Yemen HR, EOI Yemen, and ReliefWeb for new jobs and posts to Telegram',
      endpoints: {
        '/__scheduled': 'Manually trigger job processing',
        '/health': 'Health check',
        '/api/jobs': 'List jobs (paginated, filterable)',
        '/api/jobs/:id': 'Get single job',
        '/api/sources': 'List sources with job counts',
        '/api/sources/:id': 'Get/update source (GET/PATCH)',
        '/api/runs': 'Run history (paginated)',
        '/api/runs/:id': 'Get single run',
        '/api/stats': 'Dashboard statistics',
        '/api/settings/:key': 'Get/update settings (GET/PUT)',
        '/webhook': 'Telegram webhook for admin commands (POST)',
        '/set-commands': 'Register bot command menu',
      },
    });
  },
};
