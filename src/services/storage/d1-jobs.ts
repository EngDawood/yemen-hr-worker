import type { Env, ProcessedJob, JobStatus, JobRecord, RunRecord, PaginatedResponse } from '../../types';
import { DEFAULT_SOURCE } from '../sources/registry';

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
 * Archive a skipped/duplicate job with minimal data (no plugin processing needed).
 * Uses INSERT OR IGNORE — safe to call for jobs that already exist from a previous run.
 */
export async function saveSkippedJob(
  env: Env,
  jobId: string,
  title: string,
  company: string | undefined,
  status: 'skipped' | 'duplicate',
  source: string = DEFAULT_SOURCE,
  runId?: number
): Promise<void> {
  try {
    await env.JOBS_DB.prepare(`
      INSERT OR IGNORE INTO jobs (id, title, company, status, run_id, source)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(jobId, title, company || null, status, runId || null, source).run();
  } catch {
    // Silently ignore — skipped job archival is best-effort
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
