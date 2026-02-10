/**
 * Pipeline test/debug command handlers (/test, /eoi, /yemenhr).
 */

import type { Env } from '../../types';
import { sendTextMessage, sendPhotoMessage, sendMessageWithId, editMessageText } from '../telegram';
import { getAllSources, getSource, getSourceEntries } from '../sources/registry';
import { summarizeJob } from '../ai';
import { formatTelegramMessage } from '../../utils/format';

/**
 * Handle /test command - process 1 job from each source through full pipeline.
 * Uses the plugin architecture: fetch → process → summarize → format → post.
 * No KV checks, no KV writes. Pure output test.
 *
 * Sends a live-updating progress message to admin:
 * ⏳ pending → ✅ success / ⚠️ no jobs / ❌ error per source.
 */
export async function handleTest(env: Env, adminChatId: string, sourceName?: string): Promise<void> {
  const allPlugins = getAllSources();

  // Filter to specific source if requested
  if (sourceName) {
    const validNames = allPlugins.map(p => p.name) as string[];
    if (!validNames.includes(sourceName)) {
      await sendTextMessage(env.TELEGRAM_BOT_TOKEN, adminChatId,
        `❌ Unknown source: <code>${sourceName}</code>\n\nAvailable: ${validNames.map(n => `<code>${n}</code>`).join(', ')}`);
      return;
    }
  }

  const plugins = sourceName
    ? allPlugins.filter(p => p.name === sourceName)
    : allPlugins;

  // Track status per source: null = pending, string = result line
  const statuses: Map<string, string | null> = new Map();
  for (const p of plugins) statuses.set(p.name, null);

  // Build progress message text from current statuses
  const buildProgress = (header: string, footer?: string) => {
    const lines = [`${header}\n`];
    for (const [name, status] of statuses) {
      lines.push(status ?? `⏳ ${name}`);
    }
    if (footer) lines.push(`\n${footer}`);
    return lines.join('\n');
  };

  // Send initial progress message
  const msgId = await sendMessageWithId(
    env.TELEGRAM_BOT_TOKEN, adminChatId,
    buildProgress('🧪 <b>Test started...</b> 1 job from each source will be processed and posted.')
  );

  // Helper to edit the progress message (no-op if initial send failed)
  const updateProgress = async (header: string, footer?: string) => {
    if (!msgId) return;
    await editMessageText(
      env.TELEGRAM_BOT_TOKEN, adminChatId, msgId,
      buildProgress(header, footer)
    );
  };

  const header = '🧪 <b>Testing...</b>';

  // Process each source sequentially so admin sees live updates
  for (const plugin of plugins) {
    try {
      const jobs = await plugin.fetchJobs(env);

      if (jobs.length === 0) {
        statuses.set(plugin.name, `⚠️ ${plugin.name}: No jobs found`);
        await updateProgress(header);
        continue;
      }

      const job = jobs[0];
      const processedJob = await plugin.processJob(job, env);
      const aiResult = await summarizeJob(processedJob, env);
      processedJob.category = aiResult.category;

      const message = formatTelegramMessage(
        aiResult.summary, job.link, processedJob.imageUrl,
        env.LINKEDIN_URL, processedJob.source, processedJob.category
      );

      let sendResult;
      if (message.hasImage && message.imageUrl) {
        sendResult = await sendPhotoMessage(
          env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID,
          message.imageUrl, message.fullMessage
        );
      } else {
        sendResult = await sendTextMessage(
          env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID,
          message.fullMessage
        );
      }
      const success = sendResult.success;

      statuses.set(plugin.name, `${success ? '✅' : '❌'} ${plugin.name}: "${job.title}"`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown';
      statuses.set(plugin.name, `❌ ${plugin.name}: ${reason}`);
    }

    await updateProgress(header);
  }

  // Final update
  await updateProgress('🧪 <b>Test Complete</b>', '<i>No KV writes were made.</i>');
}

/**
 * Handle /source with no args — list all registered sources with enabled status.
 */
export async function handleSourceList(): Promise<string> {
  const entries = getSourceEntries();
  const lines = ['📋 <b>Registered Sources</b>\n'];
  for (const { name, enabled } of entries) {
    lines.push(`${enabled ? '✅' : '⏸️'} <code>${name}</code>${enabled ? '' : ' (disabled)'}`);
  }
  lines.push(`\nUsage: /source [name]`);
  return lines.join('\n');
}

/**
 * Handle /source [name] debug command - fetch and display jobs from any registered source.
 */
export async function handleSourceDebug(sourceName: string, env: Env): Promise<string> {
  // Validate source name against registry
  const allPlugins = getAllSources();
  const validNames = allPlugins.map(p => p.name) as string[];

  if (!validNames.includes(sourceName)) {
    return `❌ Unknown source: <code>${sourceName}</code>\n\nAvailable: ${validNames.map(n => `<code>${n}</code>`).join(', ')}`;
  }

  try {
    const plugin = getSource(sourceName);
    const jobs = await plugin.fetchJobs(env);

    if (jobs.length === 0) {
      return `📭 No jobs found from <b>${sourceName}</b>.`;
    }

    const lines = [`🔍 <b>${sourceName} Jobs (Live Fetch)</b>\n`];
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
    return `❌ Failed to fetch ${sourceName} jobs: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}
