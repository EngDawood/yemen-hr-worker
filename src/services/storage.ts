import type { Env, PostedJobRecord, ProcessedJob, JobStatus, JobRecord, SourceRecord, RunRecord, PaginatedResponse } from '../types';
import { DEFAULT_SOURCE } from './sources/registry';
import { normalizeJobKey } from './dedup';

const TTL_30_DAYS = 30 * 24 * 60 * 60; // 30 days in seconds
const JOB_KEY_PREFIX = 'job:';

// ============================================================================
// KV — Deduplication (unchanged)
// ============================================================================

/**
 * Check if a job has already been posted.
 */
export async function isJobPosted(env: Env, jobId: string): Promise<boolean> {
  const key = `${JOB_KEY_PREFIX}${jobId}`;
  const value = await env.POSTED_JOBS.get(key);
  return value !== null;
}

/**
 * Mark a job as posted in KV storage.
 */
export async function markJobAsPosted(
  env: Env,
  jobId: string,
  title: string,
  company?: string
): Promise<void> {
  const key = `${JOB_KEY_PREFIX}${jobId}`;
  const record: PostedJobRecord = {
    postedAt: new Date().toISOString(),
    title,
    company,
  };

  await env.POSTED_JOBS.put(key, JSON.stringify(record), {
    expirationTtl: TTL_30_DAYS,
  });
}

/**
 * Check if a job is a cross-source duplicate using title+company.
 */
export async function isDuplicateJob(
  env: Env,
  title: string,
  company: string
): Promise<boolean> {
  const key = normalizeJobKey(title, company);
  const value = await env.POSTED_JOBS.get(key);
  return value !== null;
}

/**
 * Mark a job's dedup key as posted (for cross-source deduplication).
 */
export async function markDedupKey(
  env: Env,
  title: string,
  company: string
): Promise<void> {
  const key = normalizeJobKey(title, company);
  await env.POSTED_JOBS.put(key, new Date().toISOString(), {
    expirationTtl: TTL_30_DAYS,
  });
}

/**
 * Get posted job record (for debugging).
 */
export async function getPostedJob(
  env: Env,
  jobId: string
): Promise<PostedJobRecord | null> {
  const key = `${JOB_KEY_PREFIX}${jobId}`;
  const value = await env.POSTED_JOBS.get(key);

  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as PostedJobRecord;
  } catch {
    return null;
  }
}

// ============================================================================
// D1 — Runs (pipeline execution history)
// ============================================================================

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

// ============================================================================
// D1 — Jobs (enhanced: save all jobs, track status)
// ============================================================================

/**
 * Save a job to D1 on initial fetch (status='fetched').
 * Uses INSERT OR IGNORE — won't overwrite if job already exists from a previous run.
 */
export async function saveJobOnFetch(
  env: Env,
  jobId: string,
  job: ProcessedJob,
  rawDescription: string,
  source: string = DEFAULT_SOURCE,
  runId?: number
): Promise<void> {
  try {
    await env.JOBS_DB.prepare(`
      INSERT OR IGNORE INTO jobs
      (id, title, company, location, description_raw, description_clean,
       image_url, source_url, posted_date, deadline, how_to_apply,
       application_links, category, status, run_id, word_count, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'fetched', ?, ?, ?)
    `).bind(
      jobId,
      job.title,
      job.company || null,
      job.location || null,
      rawDescription || null,
      job.description || null,
      job.imageUrl || null,
      job.link,
      job.postedDate || null,
      job.deadline || null,
      job.howToApply || null,
      job.applicationLinks ? JSON.stringify(job.applicationLinks) : null,
      job.category || null,
      runId || null,
      job.description ? job.description.split(/\s+/).length : null,
      source
    ).run();
  } catch (error) {
    console.error('Failed to save job on fetch:', error);
  }
}

/**
 * Update a job's status and optionally set AI summary, telegram message ID, and posted timestamp.
 */
export async function updateJobStatus(
  env: Env,
  jobId: string,
  status: JobStatus,
  opts?: {
    aiSummary?: string;
    category?: string;
    telegramMessageId?: number | null;
  }
): Promise<void> {
  try {
    if (status === 'posted') {
      await env.JOBS_DB.prepare(`
        UPDATE jobs SET status = ?, ai_summary_ar = ?, category = ?,
          telegram_message_id = ?, posted_at = ?
        WHERE id = ?
      `).bind(
        status,
        opts?.aiSummary || null,
        opts?.category || null,
        opts?.telegramMessageId || null,
        new Date().toISOString(),
        jobId
      ).run();
    } else {
      await env.JOBS_DB.prepare(
        `UPDATE jobs SET status = ? WHERE id = ?`
      ).bind(status, jobId).run();
    }
  } catch (error) {
    console.error(`Failed to update job status to ${status}:`, error);
  }
}

/**
 * Save full job data to D1 database (legacy compat — used by pipeline before refactor).
 */
export async function saveJobToDatabase(
  env: Env,
  jobId: string,
  job: ProcessedJob,
  rawDescription: string,
  aiSummary: string,
  source: string = DEFAULT_SOURCE
): Promise<void> {
  try {
    await env.JOBS_DB.prepare(`
      INSERT OR REPLACE INTO jobs
      (id, title, company, location, description_raw, description_clean,
       ai_summary_ar, image_url, source_url, posted_at, word_count, source,
       category, status, posted_date, deadline, how_to_apply, application_links)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'posted', ?, ?, ?, ?)
    `).bind(
      jobId,
      job.title,
      job.company || null,
      job.location || null,
      rawDescription || null,
      job.description,
      aiSummary,
      job.imageUrl || null,
      job.link,
      new Date().toISOString(),
      job.description.split(/\s+/).length,
      source,
      job.category || null,
      job.postedDate || null,
      job.deadline || null,
      job.howToApply || null,
      job.applicationLinks ? JSON.stringify(job.applicationLinks) : null
    ).run();
  } catch (error) {
    console.error('Failed to save job to D1:', error);
  }
}

// ============================================================================
// D1 — Sources
// ============================================================================

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
  fields: Partial<Pick<SourceRecord, 'display_name' | 'hashtag' | 'enabled' | 'ai_prompt_config' | 'base_url' | 'feed_url' | 'cron_schedule'>>
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

// ============================================================================
// D1 — Settings
// ============================================================================

/**
 * Get a setting value from D1.
 */
export async function getSetting(env: Env, key: string): Promise<string | null> {
  const row = await env.JOBS_DB.prepare(
    'SELECT value FROM settings WHERE key = ?'
  ).bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

/**
 * Set a setting value in D1 (upsert).
 */
export async function setSetting(env: Env, key: string, value: string): Promise<void> {
  await env.JOBS_DB.prepare(
    `INSERT OR REPLACE INTO settings (key, value, updated_at)
     VALUES (?, ?, datetime('now'))`
  ).bind(key, value).run();
}

// ============================================================================
// D1 — Paginated Queries (for API)
// ============================================================================

/**
 * List jobs with pagination and optional filters.
 */
export async function listJobs(
  env: Env,
  opts: {
    page?: number;
    limit?: number;
    source?: string;
    status?: JobStatus;
    search?: string;
  } = {}
): Promise<PaginatedResponse<JobRecord>> {
  const page = Math.max(1, opts.page || 1);
  const limit = Math.min(100, Math.max(1, opts.limit || 20));
  const offset = (page - 1) * limit;

  const where: string[] = [];
  const params: unknown[] = [];

  if (opts.source) { where.push('source = ?'); params.push(opts.source); }
  if (opts.status) { where.push('status = ?'); params.push(opts.status); }
  if (opts.search) { where.push('(title LIKE ? OR company LIKE ?)'); params.push(`%${opts.search}%`, `%${opts.search}%`); }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  // Count total
  const countResult = await env.JOBS_DB.prepare(
    `SELECT COUNT(*) as total FROM jobs ${whereClause}`
  ).bind(...params).first<{ total: number }>();
  const total = countResult?.total || 0;

  // Fetch page
  const dataResult = await env.JOBS_DB.prepare(
    `SELECT * FROM jobs ${whereClause} ORDER BY scraped_at DESC LIMIT ? OFFSET ?`
  ).bind(...params, limit, offset).all<JobRecord>();

  return {
    data: dataResult.results,
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

/**
 * Get a single job by ID from D1.
 */
export async function getJobFromDB(env: Env, jobId: string): Promise<JobRecord | null> {
  return env.JOBS_DB.prepare(
    'SELECT * FROM jobs WHERE id = ?'
  ).bind(jobId).first<JobRecord>();
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
 * Get dashboard stats.
 */
export async function getDashboardStats(env: Env): Promise<{
  totalJobs: number;
  byStatus: Record<string, number>;
  bySource: Array<{ source: string; count: number }>;
  recentRuns: RunRecord[];
}> {
  const [totalResult, statusResult, sourceResult, runsResult] = await Promise.all([
    env.JOBS_DB.prepare('SELECT COUNT(*) as total FROM jobs').first<{ total: number }>(),
    env.JOBS_DB.prepare(
      'SELECT status, COUNT(*) as count FROM jobs GROUP BY status'
    ).all<{ status: string; count: number }>(),
    env.JOBS_DB.prepare(
      'SELECT source, COUNT(*) as count FROM jobs GROUP BY source ORDER BY count DESC'
    ).all<{ source: string; count: number }>(),
    env.JOBS_DB.prepare(
      'SELECT * FROM runs ORDER BY started_at DESC LIMIT 5'
    ).all<RunRecord>(),
  ]);

  const byStatus: Record<string, number> = {};
  for (const row of statusResult.results) {
    byStatus[row.status] = row.count;
  }

  return {
    totalJobs: totalResult?.total || 0,
    byStatus,
    bySource: sourceResult.results,
    recentRuns: runsResult.results,
  };
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

// ============================================================================
// KV — Admin Command Support Functions (unchanged)
// ============================================================================

export interface KVJobEntry {
  id: string;
  title: string;
  postedAt: string;
}

/**
 * List recent jobs from KV storage.
 * Note: KV list() returns keys in lexicographic order, not by time.
 */
export async function listRecentJobs(env: Env, limit: number = 10): Promise<KVJobEntry[]> {
  const jobs: KVJobEntry[] = [];

  // List all job keys (those starting with job:)
  const list = await env.POSTED_JOBS.list({ prefix: JOB_KEY_PREFIX, limit: 100 });

  for (const key of list.keys) {
    const value = await env.POSTED_JOBS.get(key.name);
    if (value) {
      try {
        const record = JSON.parse(value) as PostedJobRecord;
        jobs.push({
          id: key.name.replace(JOB_KEY_PREFIX, ''),
          title: record.title,
          postedAt: record.postedAt,
        });
      } catch {
        // Skip malformed entries
      }
    }
  }

  // Sort by postedAt descending (newest first)
  jobs.sort((a, b) => new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime());

  return jobs.slice(0, limit);
}

/**
 * Get a job by ID from KV storage.
 */
export async function getJobById(env: Env, jobId: string): Promise<KVJobEntry | null> {
  const key = `${JOB_KEY_PREFIX}${jobId}`;
  const value = await env.POSTED_JOBS.get(key);

  if (!value) {
    return null;
  }

  try {
    const record = JSON.parse(value) as PostedJobRecord;
    return {
      id: jobId,
      title: record.title,
      postedAt: record.postedAt,
    };
  } catch {
    return null;
  }
}

/**
 * Delete a job from KV storage (allows re-posting).
 */
export async function deleteJobFromKV(env: Env, jobId: string): Promise<void> {
  const key = `${JOB_KEY_PREFIX}${jobId}`;
  await env.POSTED_JOBS.delete(key);
}

/**
 * Delete a dedup key from KV storage (for cross-source deduplication cleanup).
 */
export async function deleteDedupKey(env: Env, title: string, company: string): Promise<void> {
  const key = normalizeJobKey(title, company);
  await env.POSTED_JOBS.delete(key);
}

/**
 * Get the raw PostedJobRecord for a job (includes company for dedup cleanup).
 */
export async function getPostedJobRecord(env: Env, jobId: string): Promise<PostedJobRecord | null> {
  const key = `${JOB_KEY_PREFIX}${jobId}`;
  const value = await env.POSTED_JOBS.get(key);
  if (!value) return null;
  try {
    return JSON.parse(value) as PostedJobRecord;
  } catch {
    return null;
  }
}

/**
 * Search jobs in KV by keyword (matches against title).
 */
export async function searchJobsInKV(env: Env, keyword: string): Promise<KVJobEntry[]> {
  const allJobs = await listRecentJobs(env, 100);
  const lowerKeyword = keyword.toLowerCase();

  return allJobs.filter(job =>
    job.title.toLowerCase().includes(lowerKeyword)
  );
}

export interface ClearKVResult {
  jobKeys: number;
  dedupKeys: number;
  metaKeys: number;
  total: number;
  keyNames: string[];
}

/**
 * Clear all job:, dedup:, and meta: keys from KV.
 * Shared by /clear all command and /clear-kv HTTP endpoint.
 */
export async function clearAllKV(env: Env): Promise<ClearKVResult> {
  const [jobList, dedupList, metaList] = await Promise.all([
    env.POSTED_JOBS.list({ prefix: 'job:', limit: 1000 }),
    env.POSTED_JOBS.list({ prefix: 'dedup:', limit: 1000 }),
    env.POSTED_JOBS.list({ prefix: 'meta:', limit: 100 }),
  ]);

  const allKeys = [...jobList.keys, ...dedupList.keys, ...metaList.keys];
  await Promise.all(allKeys.map(k => env.POSTED_JOBS.delete(k.name)));

  return {
    jobKeys: jobList.keys.length,
    dedupKeys: dedupList.keys.length,
    metaKeys: metaList.keys.length,
    total: allKeys.length,
    keyNames: allKeys.map(k => k.name),
  };
}
