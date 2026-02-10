import type { Env, RunRecord, PaginatedResponse } from '../../types';

/**
 * Create a new run record. Returns the run ID.
 */
export async function createRun(
  env: Env,
  triggerType: 'cron' | 'manual' | 'webhook'
): Promise<number> {
  const result = await env.JOBS_DB.prepare(
    `INSERT INTO runs (started_at, trigger_type, environment)
     VALUES (?, ?, ?)
     RETURNING id`
  ).bind(
    new Date().toISOString(),
    triggerType,
    env.ENVIRONMENT || 'production'
  ).first<{ id: number }>();

  return result!.id;
}

/**
 * Complete a run with final stats.
 */
export async function completeRun(
  env: Env,
  runId: number,
  stats: {
    jobs_fetched: number;
    jobs_posted: number;
    jobs_skipped: number;
    jobs_failed: number;
    source_stats?: Record<string, unknown>;
    error?: string;
  }
): Promise<void> {
  const status = stats.error ? 'failed' : 'completed';
  await env.JOBS_DB.prepare(
    `UPDATE runs SET
       completed_at = ?, status = ?,
       jobs_fetched = ?, jobs_posted = ?, jobs_skipped = ?, jobs_failed = ?,
       source_stats = ?, error = ?
     WHERE id = ?`
  ).bind(
    new Date().toISOString(),
    status,
    stats.jobs_fetched,
    stats.jobs_posted,
    stats.jobs_skipped,
    stats.jobs_failed,
    stats.source_stats ? JSON.stringify(stats.source_stats) : null,
    stats.error || null,
    runId
  ).run();
}

/**
 * List runs with pagination.
 */
export async function listRuns(
  env: Env,
  opts: { page?: number; limit?: number } = {}
): Promise<PaginatedResponse<RunRecord>> {
  const page = Math.max(1, opts.page || 1);
  const limit = Math.min(100, Math.max(1, opts.limit || 20));
  const offset = (page - 1) * limit;

  const countResult = await env.JOBS_DB.prepare(
    'SELECT COUNT(*) as total FROM runs'
  ).first<{ total: number }>();
  const total = countResult?.total || 0;

  const dataResult = await env.JOBS_DB.prepare(
    'SELECT * FROM runs ORDER BY started_at DESC LIMIT ? OFFSET ?'
  ).bind(limit, offset).all<RunRecord>();

  return {
    data: dataResult.results,
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

/**
 * Get a single run by ID from D1.
 */
export async function getRunFromDB(env: Env, runId: number): Promise<RunRecord | null> {
  return env.JOBS_DB.prepare(
    'SELECT * FROM runs WHERE id = ?'
  ).bind(runId).first<RunRecord>();
}

/**
 * Get all runs from today (UTC) for daily summary.
 */
export async function getTodayRuns(env: Env): Promise<RunRecord[]> {
  const result = await env.JOBS_DB.prepare(
    `SELECT * FROM runs WHERE started_at >= date('now') ORDER BY started_at ASC`
  ).all<RunRecord>();
  return result.results;
}
