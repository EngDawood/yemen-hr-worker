/**
 * Telegram admin command handlers.
 * These commands are only available in the preview environment.
 */

import type { Env } from '../../types';
import type { TelegramUpdate, ParsedCommand } from '../../types/telegram';
import { sendTextMessage } from '../telegram';
import { handleJobsList, handleJobDetails, handleSearch, handleClear, handleStatus } from './kv';
import { handleTest, handleSourceList, handleSourceDebug } from './pipeline';
import { handlePrompt } from './prompt';

const COMMANDS_HELP = `
📋 <b>Available Commands</b>

<b>Monitoring</b>
/status - Bot status info
/jobs - List recent jobs from KV (last 10)
/job [id] - View details of a specific job
/search [keyword] - Find jobs by title/company

<b>Sources</b>
/source - List all registered sources
/source [name] - Fetch and show jobs from a source (live)

<b>Actions</b>
/run - Manually trigger job processing
/test - Test pipeline: 1 job per source (no KV writes)
/test [source] - Test a specific source only
/clear [id] - Remove a job + dedup key from KV
/clear all - Wipe all KV keys (job + dedup + meta)

<b>Config</b>
/prompt - List all AI prompt configs
/prompt [source] - Show config for source
/prompt [source] hint [text] - Set source hint
/prompt [source] apply [text] - Set apply fallback
/prompt [source] howtoapply on|off - Toggle
/prompt [source] reset - Reset KV overrides
/prompt reset - Reset ALL overrides

<i>Preview environment only.</i>
`.trim();

// Telegram bot command menu — registered via /set-commands endpoint
export const BOT_COMMANDS = [
  { command: 'help', description: 'Show available commands' },
  { command: 'status', description: 'Bot status info' },
  { command: 'jobs', description: 'List recent jobs from KV' },
  { command: 'job', description: 'View details of a specific job' },
  { command: 'search', description: 'Find jobs by keyword' },
  { command: 'source', description: 'List or debug job sources' },
  { command: 'run', description: 'Trigger job processing' },
  { command: 'test', description: 'Test pipeline (no KV writes)' },
  { command: 'clear', description: 'Remove job from KV' },
  { command: 'prompt', description: 'Manage AI prompt configs' },
];

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
  let response: string | null;

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
        // await keeps the fetch handler alive — I/O wait doesn't count toward CPU limits
        // (ctx.waitUntil gets killed after ~30s in fetch handlers, not enough for 25 jobs)
        await sendTextMessage(env.TELEGRAM_BOT_TOKEN, String(chatId),
          '⏳ Processing started...');
        try {
          const result = await triggerProcessing();
          response = `✅ <b>Processing Complete</b>\n\nProcessed: ${result.processed}\nPosted: ${result.posted}\nSkipped: ${result.skipped}\nFailed: ${result.failed}`;
        } catch (error) {
          response = `❌ Processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
        break;

      case 'test':
        // ctx.waitUntil returns HTTP 200 immediately (Telegram retries if webhook is slow)
        // handleTest sends live progress updates per source — partial results survive 30s kill
        ctx.waitUntil(handleTest(env, String(chatId), args[0]));
        response = null;
        break;

      case 'source':
        if (args.length === 0) {
          response = await handleSourceList();
        } else {
          response = await handleSourceDebug(args[0], env);
        }
        break;

      case 'prompt':
        response = await handlePrompt(env, args);
        break;

      default:
        response = `❓ Unknown command: /${command}\n\nUse /help to see available commands.`;
    }
  } catch (error) {
    console.error(`Error handling command /${command}:`, error);
    response = `❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }

  // Send response to user (null = handler already sent its own messages)
  if (response !== null) {
    await sendTextMessage(env.TELEGRAM_BOT_TOKEN, String(chatId), response);
  }

  return new Response('OK', { status: 200 });
}
