import type { Env, PostedJobRecord } from '../../types';
import { normalizeJobKey } from '../dedup';

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
