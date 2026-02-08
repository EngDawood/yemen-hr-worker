/**
 * Telegram admin command handlers.
 * These commands are only available in the preview environment.
 */

import type { Env } from '../../types';
import type { TelegramUpdate, ParsedCommand } from '../../types/telegram';
import { sendTextMessage } from '../telegram';
import { handleJobsList, handleJobDetails, handleSearch, handleClear, handleStatus } from './kv';
import { handleTest, handleSourceDebug } from './pipeline';

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
        response = await handleSourceDebug('eoi');
        break;

      case 'yemenhr':
        response = await handleSourceDebug('yemenhr', env);
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
