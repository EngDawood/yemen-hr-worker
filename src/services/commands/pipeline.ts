/**
 * Pipeline test/debug command handlers (/test, /eoi, /yemenhr).
 */

import type { Env, JobSource } from '../../types';
import { sendTextMessage, sendPhotoMessage } from '../telegram';
import { getAllSources, getSource } from '../sources/registry';
import { summarizeJob } from '../ai';
import { formatTelegramMessage } from '../../utils/format';

/**
 * Handle /test command - process 1 job from each source through full pipeline.
 * Uses the plugin architecture: fetch → process → summarize → format → post.
 * No KV checks, no KV writes. Pure output test.
 */
export async function handleTest(env: Env, adminChatId: string): Promise<void> {
  const results: string[] = [];

  try {
    const plugins = getAllSources();

    // Fetch jobs from all sources in parallel
    const fetchResults = await Promise.allSettled(
      plugins.map(plugin =>
        plugin.fetchJobs(env).then(jobs => ({ plugin, jobs }))
      )
    );

    // Process 1 job from each source
    for (const result of fetchResults) {
      if (result.status !== 'fulfilled') {
        results.push(`❌ Fetch failed: ${result.reason}`);
        continue;
      }

      const { plugin, jobs } = result.value;
      if (jobs.length === 0) {
        results.push(`${plugin.name}: ⚠️ No jobs found`);
        continue;
      }

      const job = jobs[0];
      try {
        // Process job using plugin (clean HTML, fetch details, etc.)
        const processedJob = await plugin.processJob(job, env);

        // Generate AI summary
        const aiResult = await summarizeJob(processedJob, env);
        processedJob.category = aiResult.category;

        // Format and send to Telegram
        const message = formatTelegramMessage(
          aiResult.summary, job.link, processedJob.imageUrl,
          env.LINKEDIN_URL, processedJob.source, processedJob.category
        );

        let success: boolean;
        if (message.hasImage && message.imageUrl) {
          success = await sendPhotoMessage(
            env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID,
            message.imageUrl, message.fullMessage
          );
        } else {
          success = await sendTextMessage(
            env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID,
            message.fullMessage
          );
        }

        results.push(`${plugin.name}: ${success ? '✅' : '❌'} "${job.title}"`);
      } catch (error) {
        results.push(`${plugin.name}: ❌ Error - ${error instanceof Error ? error.message : 'Unknown'}`);
      }
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
 * Handle /eoi and /yemenhr debug commands - fetch and display jobs from a source.
 * Uses the plugin architecture for fetching.
 */
export async function handleSourceDebug(sourceName: JobSource, env?: Env): Promise<string> {
  try {
    const plugin = getSource(sourceName);
    const jobs = await plugin.fetchJobs(env);

    if (jobs.length === 0) {
      return `📭 No jobs found from ${sourceName}.`;
    }

    const emoji = sourceName === 'yemenhr' ? '🇾🇪' : '🌐';
    const label = sourceName === 'yemenhr' ? 'Yemen HR' : 'EOI';
    const lines = [`${emoji} <b>${label} Jobs (Live Fetch)</b>\n`];
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
