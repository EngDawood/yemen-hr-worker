import type { Env, JobStatus } from '../../types';
import { jsonResponse } from '../../utils/http';
import { listJobs, getJobFromDB } from '../../services/storage';

export async function handleListJobs(_request: Request, url: URL, env: Env): Promise<Response> {
  const page = parseInt(url.searchParams.get('page') || '1', 10);
  const limit = parseInt(url.searchParams.get('limit') || '20', 10);
  const source = url.searchParams.get('source') || undefined;
  const status = url.searchParams.get('status') as JobStatus | undefined;
  const search = url.searchParams.get('search') || undefined;

  const result = await listJobs(env, { page, limit, source, status, search });
  return jsonResponse(result);
}

export async function handleGetJob(_request: Request, _url: URL, env: Env, jobId: string): Promise<Response> {
  const job = await getJobFromDB(env, decodeURIComponent(jobId));
  if (!job) return jsonResponse({ error: 'Job not found' }, 404);
  return jsonResponse(job);
}
