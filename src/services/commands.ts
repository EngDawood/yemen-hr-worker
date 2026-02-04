/**
 * Telegram admin command handlers.
 * These commands are only available in the preview environment.
 */

import type { Env, ProcessedJob } from '../types';
import type { TelegramUpdate, ParsedCommand } from '../types/telegram';
import {
  listRecentJobs,
  getJobById,
  deleteJobFromKV,
  deleteDedupKey,
  getPostedJobRecord,
  searchJobsInKV,
} from './storage';
import { sendTextMessage, sendPhotoMessage } from './telegram';
import { fetchEOIJobs, fetchEOIJobDetail, buildEnrichedDescription, formatEOIDate } from './eoi';
import { fetchRSSFeed } from './rss';
import { cleanJobDescription } from './cleaner';
import { summarizeJob, summarizeEOIJob } from './gemini';
import { formatTelegramMessage } from '../utils/format';

const COMMANDS_HELP = `
📋 <b>Available Commands</b>

/help - Show this help message
/jobs - List recent jobs from KV (last 10)
/job [id] - View details of a specific job
/search [keyword] - Find jobs by title/company
/clear [id|all] - Remove job + dedup key from KV
/status - Bot status info
/run - Manually trigger job processing
/test - Test pipeline with 1 job per source (no KV writes)

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
  ctx: ExecutionContext,
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

  // Environment guard: block commands in production
  if (env.ENVIRONMENT === 'production') {
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
          response = '❌ Usage: /clear [id|all]';
        } else {
          response = await handleClear(env, args[0]);
        }
        break;

      case 'status':
        response = await handleStatus(env);
        break;

      case 'run':
        // Respond immediately, process in background
        ctx.waitUntil((async () => {
          try {
            const result = await triggerProcessing();
            await sendTextMessage(env.TELEGRAM_BOT_TOKEN, String(chatId),
              `✅ <b>Processing Complete</b>\n\nProcessed: ${result.processed}\nPosted: ${result.posted}\nSkipped: ${result.skipped}\nFailed: ${result.failed}`);
          } catch (error) {
            await sendTextMessage(env.TELEGRAM_BOT_TOKEN, String(chatId),
              `❌ Processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        })());
        response = '⏳ Processing started... Results will be sent when complete.';
        break;

      case 'test':
        ctx.waitUntil(handleTest(env, String(chatId)));
        response = '🧪 Test started... 1 job from each source will be processed and posted.';
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
 * Handle /clear <id|all> command - remove job + dedup key from KV.
 */
async function handleClear(env: Env, target: string): Promise<string> {
  if (target === 'all') {
    // Clear all job: and dedup: prefixed keys
    const jobList = await env.POSTED_JOBS.list({ prefix: 'job:', limit: 1000 });
    const dedupList = await env.POSTED_JOBS.list({ prefix: 'dedup:', limit: 1000 });

    const deletePromises = [
      ...jobList.keys.map(k => env.POSTED_JOBS.delete(k.name)),
      ...dedupList.keys.map(k => env.POSTED_JOBS.delete(k.name)),
    ];
    await Promise.all(deletePromises);

    return `✅ Cleared all KV keys.\n\nDeleted: ${jobList.keys.length} job keys + ${dedupList.keys.length} dedup keys.`;
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
async function handleStatus(env: Env): Promise<string> {
  const jobs = await listRecentJobs(env, 100);
  const environment = env.ENVIRONMENT || 'unknown';

  return `🤖 <b>Yemen Jobs Bot Status</b>

<b>Environment:</b> ${environment}
<b>Jobs in KV:</b> ${jobs.length}+
<b>Chat ID:</b> ${env.TELEGRAM_CHAT_ID}

<i>Use /run to manually trigger processing.</i>`;
}

/**
 * Handle /test command - process 1 job from each source through full pipeline.
 * No KV checks, no KV writes. Pure output test.
 */
async function handleTest(env: Env, adminChatId: string): Promise<void> {
  const results: string[] = [];

  try {
    // Fetch jobs from both sources in parallel
    const [yemenHRResult, eoiResult] = await Promise.allSettled([
      fetchRSSFeed(env.RSS_FEED_URL),
      fetchEOIJobs(),
    ]);

    // Process 1 Yemen HR job
    if (yemenHRResult.status === 'fulfilled' && yemenHRResult.value.length > 0) {
      const job = yemenHRResult.value[0];
      try {
        const extracted = cleanJobDescription(job.description || '');
        const processedJob: ProcessedJob = {
          title: job.title,
          company: job.company,
          link: job.link,
          description: extracted.description || job.description || '',
          imageUrl: job.imageUrl,
          location: extracted.location,
          postedDate: extracted.postedDate,
          deadline: extracted.deadline,
          source: 'yemenhr',
        };

        const aiResult = await summarizeJob(processedJob, env);
        processedJob.category = aiResult.category;
        const message = formatTelegramMessage(aiResult.summary, job.link, processedJob.imageUrl, env.LINKEDIN_URL, processedJob.source, processedJob.category);

        let success: boolean;
        if (message.hasImage && message.imageUrl) {
          success = await sendPhotoMessage(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, message.imageUrl, message.fullMessage);
        } else {
          success = await sendTextMessage(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, message.fullMessage);
        }

        results.push(`Yemen HR: ${success ? '✅' : '❌'} "${job.title}"`);
      } catch (error) {
        results.push(`Yemen HR: ❌ Error - ${error instanceof Error ? error.message : 'Unknown'}`);
      }
    } else {
      const reason = yemenHRResult.status === 'rejected' ? yemenHRResult.reason : 'No jobs found';
      results.push(`Yemen HR: ⚠️ ${reason}`);
    }

    // Process 1 EOI job
    if (eoiResult.status === 'fulfilled' && eoiResult.value.length > 0) {
      const job = eoiResult.value[0];
      try {
        // Parse metadata
        const metaLines = (job.description || '').split('\n');
        const metaMap: Record<string, string> = {};
        for (const line of metaLines) {
          const [key, ...vals] = line.split(': ');
          if (key && vals.length > 0) metaMap[key.trim()] = vals.join(': ').trim();
        }

        // Fetch detail page
        const detail = await fetchEOIJobDetail(job.link);

        let processedJob: ProcessedJob;
        if (detail) {
          const enrichedDesc = buildEnrichedDescription(
            {
              category: metaMap['الفئة'],
              location: metaMap['الموقع'],
              postDate: metaMap['تاريخ النشر'],
              deadline: metaMap['آخر موعد للتقديم'],
            },
            detail
          );
          processedJob = {
            title: job.title,
            company: job.company,
            link: job.link,
            description: enrichedDesc,
            imageUrl: detail.imageUrl || job.imageUrl,
            location: metaMap['الموقع'],
            postedDate: formatEOIDate(metaMap['تاريخ النشر']),
            deadline: formatEOIDate(detail.deadline || metaMap['آخر موعد للتقديم']),
            howToApply: detail.howToApply,
            applicationLinks: detail.applicationLinks,
            source: 'eoi',
            category: metaMap['الفئة'] || '',
          };
        } else {
          processedJob = {
            title: job.title,
            company: job.company,
            link: job.link,
            description: job.description || '',
            imageUrl: job.imageUrl,
            location: metaMap['الموقع'],
            postedDate: formatEOIDate(metaMap['تاريخ النشر']),
            deadline: formatEOIDate(metaMap['آخر موعد للتقديم']),
            source: 'eoi',
            category: metaMap['الفئة'] || '',
          };
        }

        const eoiAIResult = await summarizeEOIJob(processedJob, env);
        const message = formatTelegramMessage(eoiAIResult.summary, job.link, processedJob.imageUrl, env.LINKEDIN_URL, processedJob.source, processedJob.category);

        let success: boolean;
        if (message.hasImage && message.imageUrl) {
          success = await sendPhotoMessage(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, message.imageUrl, message.fullMessage);
        } else {
          success = await sendTextMessage(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, message.fullMessage);
        }

        results.push(`EOI: ${success ? '✅' : '❌'} "${job.title}"`);
      } catch (error) {
        results.push(`EOI: ❌ Error - ${error instanceof Error ? error.message : 'Unknown'}`);
      }
    } else {
      const reason = eoiResult.status === 'rejected' ? eoiResult.reason : 'No jobs found';
      results.push(`EOI: ⚠️ ${reason}`);
    }

    // Send summary to admin
    await sendTextMessage(env.TELEGRAM_BOT_TOKEN, adminChatId,
      `🧪 <b>Test Complete</b>\n\n${results.join('\n')}\n\n<i>No KV writes were made.</i>`);
  } catch (error) {
    await sendTextMessage(env.TELEGRAM_BOT_TOKEN, adminChatId,
      `🧪 Test failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
