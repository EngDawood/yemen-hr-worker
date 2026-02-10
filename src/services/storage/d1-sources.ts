import type { Env, SourceRecord } from '../../types';

/**
 * Get all sources from D1 (with metadata and AI prompt config).
 */
export async function getSourcesFromDB(env: Env): Promise<SourceRecord[]> {
  const result = await env.JOBS_DB.prepare(
    'SELECT * FROM sources ORDER BY enabled DESC, id ASC'
  ).all<SourceRecord>();
  return result.results;
}

/**
 * Get a single source by ID from D1.
 */
export async function getSourceFromDB(env: Env, sourceId: string): Promise<SourceRecord | null> {
  return env.JOBS_DB.prepare(
    'SELECT * FROM sources WHERE id = ?'
  ).bind(sourceId).first<SourceRecord>();
}

/**
 * Update source metadata in D1.
 */
export async function updateSourceInDB(
  env: Env,
  sourceId: string,
  fields: Partial<Pick<SourceRecord, 'display_name' | 'hashtag' | 'enabled' | 'base_url' | 'feed_url' | 'cron_schedule'>> & {
    ai_prompt_config?: string | null;
  }
): Promise<boolean> {
  const sets: string[] = [];
  const values: unknown[] = [];

  if (fields.display_name !== undefined) { sets.push('display_name = ?'); values.push(fields.display_name); }
  if (fields.hashtag !== undefined) { sets.push('hashtag = ?'); values.push(fields.hashtag); }
  if (fields.enabled !== undefined) { sets.push('enabled = ?'); values.push(fields.enabled); }
  if (fields.ai_prompt_config !== undefined) { sets.push('ai_prompt_config = ?'); values.push(fields.ai_prompt_config); }
  if (fields.base_url !== undefined) { sets.push('base_url = ?'); values.push(fields.base_url); }
  if (fields.feed_url !== undefined) { sets.push('feed_url = ?'); values.push(fields.feed_url); }
  if (fields.cron_schedule !== undefined) { sets.push('cron_schedule = ?'); values.push(fields.cron_schedule); }

  if (sets.length === 0) return false;

  sets.push("updated_at = datetime('now')");
  values.push(sourceId);

  const result = await env.JOBS_DB.prepare(
    `UPDATE sources SET ${sets.join(', ')} WHERE id = ?`
  ).bind(...values).run();
  return result.meta.changes > 0;
}

/**
 * Get job count per source (uses D1 JOIN).
 */
export async function getSourceStats(env: Env): Promise<Array<{ source: string; job_count: number }>> {
  const result = await env.JOBS_DB.prepare(`
    SELECT s.id AS source, COUNT(j.id) AS job_count
    FROM sources s
    LEFT JOIN jobs j ON j.source = s.id
    GROUP BY s.id
    ORDER BY job_count DESC
  `).all<{ source: string; job_count: number }>();
  return result.results;
}
