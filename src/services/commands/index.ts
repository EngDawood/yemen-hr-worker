/**
 * Telegram admin command handlers.
 * Supports both text commands and inline keyboard button callbacks.
 */

import type { Env } from '../../types';
import type { TelegramUpdate, ParsedCommand, CallbackQuery, InlineKeyboardMarkup } from '../../types/telegram';
import { sendTextMessage, sendMessageWithKeyboard, editMessageWithKeyboard, answerCallbackQuery } from '../telegram';
import {
  handleJobsList, handleJobDetails, handleSearch, handleClear, handleStatus,
  handleStats, handleRuns, handleModel,
  type CommandResult,
} from './kv';
import { handleTest, handleSourceList, handleSourceDebug, handleSourceToggle } from './pipeline';
import { getSourcesFromDB } from '../storage';
import { handlePrompt } from './prompt';

// ============================================================================
// Help menu with inline keyboard
// ============================================================================

const COMMANDS_HELP = `
📋 <b>Available Commands</b>

<b>Monitoring</b>
/status - Quick bot status
/stats - Detailed dashboard
/jobs - Browse jobs (D1)
/job [id] - Job details
/search [keyword] - Find jobs
/runs - Pipeline run history

<b>Sources</b>
/source - List all sources
/source [name] - Debug a source
/source enable [name] - Enable a source
/source disable [name] - Disable a source

<b>Actions</b>
/run - Trigger job processing
/test - Test pipeline (no writes)
/clear [id] - Remove from KV

<b>Config</b>
/model - View/set AI model
/prompt - AI prompt configs

<i>Admin only.</i>
`.trim();

const HELP_KEYBOARD: InlineKeyboardMarkup = {
  inline_keyboard: [
    [
      { text: '📊 Stats', callback_data: 'stats' },
      { text: '📋 Jobs', callback_data: 'jobs:1' },
    ],
    [
      { text: '🔄 Runs', callback_data: 'runs:1' },
      { text: '📡 Sources', callback_data: 'src' },
    ],
    [
      { text: '🧪 Test', callback_data: 'test' },
      { text: '⚙️ Model', callback_data: 'model' },
    ],
  ],
};

// Telegram bot command menu — registered via /set-commands endpoint
export const BOT_COMMANDS = [
  { command: 'help', description: 'Show available commands' },
  { command: 'status', description: 'Quick bot status' },
  { command: 'stats', description: 'Detailed dashboard stats' },
  { command: 'jobs', description: 'Browse jobs from D1' },
  { command: 'job', description: 'View job details' },
  { command: 'search', description: 'Find jobs by keyword' },
  { command: 'runs', description: 'Pipeline run history' },
  { command: 'source', description: 'List or debug sources' },
  { command: 'run', description: 'Trigger job processing' },
  { command: 'test', description: 'Test pipeline (no writes)' },
  { command: 'clear', description: 'Remove job from KV' },
  { command: 'model', description: 'View/set AI model' },
  { command: 'prompt', description: 'AI prompt configs' },
];

// ============================================================================
// Command parsing
// ============================================================================

/**
 * Parse a Telegram update into a command object.
 */
export function parseCommand(update: TelegramUpdate): ParsedCommand | null {
  const message = update.message;
  if (!message?.text || !message.from) {
    return null;
  }

  const text = message.text.trim();
  if (!text.startsWith('/')) {
    return null;
  }

  const parts = text.split(/\s+/);
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
 */
function isAuthorized(
  userId: number,
  chatId: number,
  chatType: string,
  adminChatId: string | undefined
): boolean {
  if (!adminChatId) return false;
  if (chatType !== 'private') return false;
  return String(userId) === adminChatId && String(chatId) === adminChatId;
}

// ============================================================================
// Response sender — handles both string and CommandResult
// ============================================================================

async function sendResponse(
  botToken: string,
  chatId: string,
  response: string | CommandResult
): Promise<void> {
  if (typeof response === 'string') {
    await sendTextMessage(botToken, chatId, response);
  } else if (response.keyboard) {
    await sendMessageWithKeyboard(botToken, chatId, response.text, response.keyboard);
  } else {
    await sendTextMessage(botToken, chatId, response.text);
  }
}

// ============================================================================
// Callback query handler (inline keyboard button presses)
// ============================================================================

async function handleCallbackQuery(
  query: CallbackQuery,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const chatId = query.message?.chat.id;
  const messageId = query.message?.message_id;
  const chatType = query.message?.chat.type || 'unknown';

  if (!chatId || !messageId) {
    return new Response('OK', { status: 200 });
  }

  // Auth guard
  if (!isAuthorized(query.from.id, chatId, chatType, env.ADMIN_CHAT_ID)) {
    return new Response('OK', { status: 200 });
  }

  // Acknowledge callback (dismiss loading spinner)
  await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, query.id);

  const data = query.data || '';

  try {
    let text: string;
    let keyboard: InlineKeyboardMarkup | undefined;

    if (data === 'help') {
      text = COMMANDS_HELP;
      keyboard = HELP_KEYBOARD;
    } else if (data === 'stats') {
      const result = await handleStats(env);
      text = result.text;
      keyboard = result.keyboard;
    } else if (data.startsWith('jobs:')) {
      const parts = data.split(':');
      const page = parseInt(parts[1]) || 1;
      const filter = parts[2];
      const result = await handleJobsList(env, page, filter);
      text = result.text;
      keyboard = result.keyboard;
    } else if (data.startsWith('runs:')) {
      const page = parseInt(data.split(':')[1]) || 1;
      const result = await handleRuns(env, page);
      text = result.text;
      keyboard = result.keyboard;
    } else if (data === 'src') {
      const result = await handleSourceList(env);
      text = typeof result === 'string' ? result : result.text;
      keyboard = typeof result === 'string' ? undefined : result.keyboard;
    } else if (data.startsWith('src:toggle:')) {
      const sourceName = data.split(':')[2];
      // Check current state and flip it
      const dbSources = await getSourcesFromDB(env);
      const source = dbSources.find(s => s.id === sourceName);
      if (source) {
        const action = source.enabled ? 'disable' : 'enable';
        text = await handleSourceToggle(env, action, sourceName);
      } else {
        text = `❌ Source not found: ${sourceName}`;
      }
    } else if (data.startsWith('src:')) {
      const sourceName = data.split(':')[1];
      text = await handleSourceDebug(sourceName, env);
    } else if (data === 'model') {
      text = await handleModel(env, []);
    } else if (data === 'test') {
      ctx.waitUntil(handleTest(env, String(chatId)));
      text = '🧪 Test started...';
    } else if (data.startsWith('search:')) {
      const parts = data.split(':');
      const page = parseInt(parts[1]) || 1;
      const keyword = parts.slice(2).join(':');
      const result = await handleSearch(env, keyword, page);
      text = result.text;
      keyboard = result.keyboard;
    } else if (data === 'noop') {
      return new Response('OK', { status: 200 });
    } else {
      text = `❓ Unknown action: ${data}`;
    }

    // Edit the message in-place
    await editMessageWithKeyboard(env.TELEGRAM_BOT_TOKEN, String(chatId), messageId, text, keyboard);
  } catch (error) {
    console.error(`Error handling callback ${data}:`, error);
    await editMessageWithKeyboard(
      env.TELEGRAM_BOT_TOKEN, String(chatId), messageId,
      `❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }

  return new Response('OK', { status: 200 });
}

// ============================================================================
// Main webhook handler
// ============================================================================

/**
 * Handle incoming Telegram webhook updates.
 */
export async function handleWebhook(
  update: TelegramUpdate,
  env: Env,
  ctx: ExecutionContext,
  triggerProcessing: () => Promise<{ processed: number; posted: number; skipped: number; failed: number }>
): Promise<Response> {
  // Handle callback queries (button presses)
  if (update.callback_query) {
    return handleCallbackQuery(update.callback_query, env, ctx);
  }

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
  let response: string | CommandResult | null;

  try {
    switch (command) {
      case 'help':
      case 'start':
        response = { text: COMMANDS_HELP, keyboard: HELP_KEYBOARD };
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

      case 'stats':
        response = await handleStats(env);
        break;

      case 'runs':
        response = await handleRuns(env);
        break;

      case 'model':
        response = await handleModel(env, args);
        break;

      case 'run':
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
        ctx.waitUntil(handleTest(env, String(chatId), args[0]));
        response = null;
        break;

      case 'source':
        if (args.length === 0) {
          response = await handleSourceList(env);
        } else if ((args[0] === 'enable' || args[0] === 'disable') && args[1]) {
          response = await handleSourceToggle(env, args[0], args[1]);
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

  // Send response (null = handler already sent its own messages)
  if (response !== null) {
    await sendResponse(env.TELEGRAM_BOT_TOKEN, String(chatId), response);
  }

  return new Response('OK', { status: 200 });
}
