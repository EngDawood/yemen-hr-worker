/**
 * Telegram admin command handlers.
 * These commands are only available in the preview environment.
 */

import type { Env } from '../types';
import type { TelegramUpdate, ParsedCommand } from '../types/telegram';
import {
  listRecentJobs,
  getJobById,
  deleteJobFromKV,
  searchJobsInKV,
} from './storage';
import { sendTextMessage } from './telegram';
import { fetchEOIJobs } from './eoi';
import { fetchRSSFeed } from './rss';

const COMMANDS_HELP = `
📋 <b>Available Commands</b>

/help - Show this help message
/jobs - List recent jobs from KV (last 10)
/job [id] - View details of a specific job
/search [keyword] - Find jobs by title/company
/clear [id] - Remove job from KV (allows re-posting)
/status - Bot status info
/run - Manually trigger job processing

<b>Debug Commands:</b>
/eoi - Fetch and show EOI jobs (live)
/yemenhr - Fetch and show Yemen HR jobs (live)

<i>Note: Commands only work in preview environment.</i>
`.trim();

/**
 * Parse a Telegram update into a command object.
 */
export function parseCommand(update: TelegramUpdate): ParsedCommand | null {
  const message = update.message;
  if (!message?.text || !message.from) {
    return null;
  }

  // Check if message starts with /
  const text = message.text.trim();
  if (!text.startsWith('/')) {
    return null;
  }

  // Parse command and args
  const parts = text.split(/\s+/);
  // Remove leading / and bot username suffix (e.g., /help@botname -> help)
  const command = parts[0].toLowerCase().replace('/', '').split('@')[0];
  const args = parts.slice(1);

  return {
    command,
    args,
    chatId: message.chat.id,
    userId: message.from.id,
  };
}

/**
 * Check if the user is authorized to use admin commands.
 * Only allows private messages from the admin user.
 */
function isAuthorized(
  userId: number,
  chatId: number,
  chatType: string,
  adminChatId: string | undefined
): boolean {
  if (!adminChatId) {
    return false;
  }
  // Only respond in private chats from the admin
  if (chatType !== 'private') {
    return false;
  }
  return String(userId) === adminChatId && String(chatId) === adminChatId;
}

/**
 * Handle incoming Telegram webhook updates.
 */
export async function handleWebhook(
  update: TelegramUpdate,
  env: Env,
  triggerProcessing: () => Promise<{ processed: number; posted: number; skipped: number; failed: number }>
): Promise<Response> {
  const parsed = parseCommand(update);

  // Ignore non-command messages
  if (!parsed) {
    return new Response('OK', { status: 200 });
  }

  // Security: Only respond to authorized admin in private chat
  const chatType = update.message?.chat.type || 'unknown';
  if (!isAuthorized(parsed.userId, parsed.chatId, chatType, env.ADMIN_CHAT_ID)) {
    return new Response('OK', { status: 200 });
  }

  const { command, args, chatId } = parsed;
  let response: string;

  try {
    switch (command) {
      case 'help':
      case 'start':
        response = COMMANDS_HELP;
        break;

      case 'jobs':
        response = await handleJobsList(env);
        break;

      case 'job':
        if (args.length === 0) {
          response = '❌ Usage: /job [id]';
        } else {
          response = await handleJobDetails(env, args[0]);
        }
        break;

      case 'search':
        if (args.length === 0) {
          response = '❌ Usage: /search [keyword]';
        } else {
          response = await handleSearch(env, args.join(' '));
        }
        break;

      case 'clear':
        if (args.length === 0) {
          response = '❌ Usage: /clear [id]';
        } else {
          response = await handleClear(env, args[0]);
        }
        break;

      case 'status':
        response = await handleStatus(env);
        break;

      case 'run':
        response = await handleRun(triggerProcessing);
        break;

      case 'eoi':
        response = await handleEOIJobs();
        break;

      case 'yemenhr':
        response = await handleYemenHRJobs(env);
        break;

      default:
        response = `❓ Unknown command: /${command}\n\nUse /help to see available commands.`;
    }
  } catch (error) {
    console.error(`Error handling command /${command}:`, error);
    response = `❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }

  // Send response to user
  await sendTextMessage(env.TELEGRAM_BOT_TOKEN, String(chatId), response);

  return new Response('OK', { status: 200 });
}

/**
 * Handle /jobs command - list recent jobs.
 */
async function handleJobsList(env: Env): Promise<string> {
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
async function handleJobDetails(env: Env, jobId: string): Promise<string> {
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
async function handleSearch(env: Env, keyword: string): Promise<string> {
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
 * Handle /clear <id> command - remove job from KV.
 */
async function handleClear(env: Env, jobId: string): Promise<string> {
  const job = await getJobById(env, jobId);

  if (!job) {
    return `❌ Job not found: <code>${jobId}</code>`;
  }

  await deleteJobFromKV(env, jobId);
  return `✅ Cleared job from KV: <code>${jobId}</code>\n\nThis job can now be re-posted.`;
}

/**
 * Handle /status command.
 */
async function handleStatus(env: Env): Promise<string> {
  const jobs = await listRecentJobs(env, 100);

  return `🤖 <b>Yemen Jobs Bot Status</b>

<b>Environment:</b> Preview
<b>Jobs in KV:</b> ${jobs.length}+
<b>Chat ID:</b> ${env.TELEGRAM_CHAT_ID}

<i>Use /run to manually trigger processing.</i>`;
}

/**
 * Handle /run command - trigger job processing.
 */
async function handleRun(
  triggerProcessing: () => Promise<{ processed: number; posted: number; skipped: number; failed: number }>
): Promise<string> {
  try {
    const result = await triggerProcessing();
    return `✅ <b>Processing Complete</b>

Processed: ${result.processed}
Posted: ${result.posted}
Skipped: ${result.skipped}
Failed: ${result.failed}`;
  } catch (error) {
    return `❌ Processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}

/**
 * Handle /eoi command - fetch and display EOI jobs.
 */
async function handleEOIJobs(): Promise<string> {
  try {
    const jobs = await fetchEOIJobs();

    if (jobs.length === 0) {
      return '📭 No jobs found from EOI.';
    }

    const lines = [`🌐 <b>EOI Jobs (Live Fetch)</b>\n`];
    lines.push(`Total: ${jobs.length} jobs\n`);

    for (const job of jobs.slice(0, 10)) {
      lines.push(`• <code>${job.id}</code>`);
      lines.push(`  ${job.title}`);
      lines.push(`  ${job.company}`);
      lines.push(`  <i>${job.pubDate}</i>\n`);
    }

    if (jobs.length > 10) {
      lines.push(`<i>...and ${jobs.length - 10} more</i>`);
    }

    return lines.join('\n');
  } catch (error) {
    return `❌ Failed to fetch EOI jobs: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}

/**
 * Handle /yemenhr command - fetch and display Yemen HR jobs.
 */
async function handleYemenHRJobs(env: Env): Promise<string> {
  try {
    const jobs = await fetchRSSFeed(env.RSS_FEED_URL);

    if (jobs.length === 0) {
      return '📭 No jobs found from Yemen HR.';
    }

    const lines = [`🇾🇪 <b>Yemen HR Jobs (Live Fetch)</b>\n`];
    lines.push(`Total: ${jobs.length} jobs\n`);

    for (const job of jobs.slice(0, 10)) {
      lines.push(`• <code>${job.id}</code>`);
      lines.push(`  ${job.title}`);
      lines.push(`  ${job.company}`);
      lines.push(`  <i>${job.pubDate}</i>\n`);
    }

    if (jobs.length > 10) {
      lines.push(`<i>...and ${jobs.length - 10} more</i>`);
    }

    return lines.join('\n');
  } catch (error) {
    return `❌ Failed to fetch Yemen HR jobs: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}
