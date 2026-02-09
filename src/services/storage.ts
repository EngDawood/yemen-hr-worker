import type { Env, PostedJobRecord, ProcessedJob, JobSource } from '../types';
import { normalizeJobKey } from './dedup';

const TTL_30_DAYS = 30 * 24 * 60 * 60; // 30 days in seconds
const JOB_KEY_PREFIX = 'job:';

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

/**
 * Save full job data to D1 database for ML training.
 */
export async function saveJobToDatabase(
  env: Env,
  jobId: string,
  job: ProcessedJob,
  rawDescription: string,
  aiSummary: string,
  source: JobSource = 'yemenhr'
): Promise<void> {
  try {
    await env.JOBS_DB.prepare(`
      INSERT OR REPLACE INTO jobs
      (id, title, company, location, description_raw, description_clean,
       ai_summary_ar, image_url, source_url, posted_at, word_count, source, category)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      job.category || null
    ).run();
  } catch (error) {
    console.error('Failed to save job to D1:', error);
    // Don't throw - D1 failure shouldn't stop Telegram posting
  }
}

// ============================================================================
// Admin Command Support Functions
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
