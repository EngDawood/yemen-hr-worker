import type { Env, PostedJobRecord } from '../../types';
import { normalizeJobKey } from '../dedup';

const JOB_KEY_PREFIX = 'job:';

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
