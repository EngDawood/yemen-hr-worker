import type { Env, PostedJobRecord, ProcessedJob } from '../types';

const TTL_30_DAYS = 30 * 24 * 60 * 60; // 30 days in seconds

/**
 * Check if a job has already been posted.
 */
export async function isJobPosted(env: Env, jobId: string): Promise<boolean> {
  const key = `job:${jobId}`;
  const value = await env.POSTED_JOBS.get(key);
  return value !== null;
}

/**
 * Mark a job as posted in KV storage.
 */
export async function markJobAsPosted(
  env: Env,
  jobId: string,
  title: string
): Promise<void> {
  const key = `job:${jobId}`;
  const record: PostedJobRecord = {
    postedAt: new Date().toISOString(),
    title,
  };

  await env.POSTED_JOBS.put(key, JSON.stringify(record), {
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
  const key = `job:${jobId}`;
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
  aiSummary: string
): Promise<void> {
  try {
    await env.JOBS_DB.prepare(`
      INSERT OR REPLACE INTO jobs
      (id, title, company, location, description_raw, description_clean,
       ai_summary_ar, image_url, source_url, posted_at, word_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      job.description.split(/\s+/).length
    ).run();
  } catch (error) {
    console.error('Failed to save job to D1:', error);
    // Don't throw - D1 failure shouldn't stop Telegram posting
  }
}
