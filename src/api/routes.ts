/**
 * REST API route handlers for D1 database.
 * All endpoints are unauthenticated (public job data).
 */

import type { Env, JobStatus } from '../types';
import { jsonResponse } from '../utils/http';
import {
  listJobs, getJobFromDB,
  getSourcesFromDB, getSourceFromDB, updateSourceInDB, getSourceStats,
  listRuns, getRunFromDB,
  getDashboardStats,
  getSetting, setSetting,
} from '../services/storage';

/**
 * Route API requests. Returns null if path doesn't match any API route.
 */
export async function handleApiRoute(
  request: Request,
  url: URL,
  env: Env
): Promise<Response | null> {
  const path = url.pathname;
  const method = request.method;

  // GET /api/jobs — paginated list with filters
  if (path === '/api/jobs' && method === 'GET') {
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);
    const source = url.searchParams.get('source') || undefined;
    const status = url.searchParams.get('status') as JobStatus | undefined;
    const search = url.searchParams.get('search') || undefined;

    const result = await listJobs(env, { page, limit, source, status, search });
    return jsonResponse(result);
  }

  // GET /api/jobs/:id — single job
  const jobMatch = path.match(/^\/api\/jobs\/(.+)$/);
  if (jobMatch && method === 'GET') {
    const job = await getJobFromDB(env, decodeURIComponent(jobMatch[1]));
    if (!job) return jsonResponse({ error: 'Job not found' }, 404);
    return jsonResponse(job);
  }

  // GET /api/sources — list all sources with job counts
  if (path === '/api/sources' && method === 'GET') {
    const [sources, stats] = await Promise.all([
      getSourcesFromDB(env),
      getSourceStats(env),
    ]);
    const statsMap = new Map(stats.map(s => [s.source, s.job_count]));
    const data = sources.map(s => ({
      ...s,
      ai_prompt_config: s.ai_prompt_config ? JSON.parse(s.ai_prompt_config) : null,
      job_count: statsMap.get(s.id) || 0,
    }));
    return jsonResponse(data);
  }

  // GET /api/sources/:id — single source
  const sourceGetMatch = path.match(/^\/api\/sources\/([a-z0-9_-]+)$/);
  if (sourceGetMatch && method === 'GET') {
    const source = await getSourceFromDB(env, sourceGetMatch[1]);
    if (!source) return jsonResponse({ error: 'Source not found' }, 404);
    return jsonResponse({
      ...source,
      ai_prompt_config: source.ai_prompt_config ? JSON.parse(source.ai_prompt_config) : null,
    });
  }

  // PATCH /api/sources/:id — update source metadata
  const sourcePatchMatch = path.match(/^\/api\/sources\/([a-z0-9_-]+)$/);
  if (sourcePatchMatch && method === 'PATCH') {
    const body = await request.json() as Record<string, unknown>;
    const fields: Record<string, unknown> = {};

    if (body.display_name !== undefined) fields.display_name = body.display_name;
    if (body.hashtag !== undefined) fields.hashtag = body.hashtag;
    if (body.base_url !== undefined) fields.base_url = body.base_url;
    if (body.feed_url !== undefined) fields.feed_url = body.feed_url;
    if (body.enabled !== undefined) fields.enabled = body.enabled ? 1 : 0;
    if (body.ai_prompt_config !== undefined) {
      fields.ai_prompt_config = typeof body.ai_prompt_config === 'string'
        ? body.ai_prompt_config
        : JSON.stringify(body.ai_prompt_config);
    }
    if (body.cron_schedule !== undefined) fields.cron_schedule = body.cron_schedule as string;

    const updated = await updateSourceInDB(env, sourcePatchMatch[1], fields as any);
    if (!updated) return jsonResponse({ error: 'Source not found or no changes' }, 404);

    const source = await getSourceFromDB(env, sourcePatchMatch[1]);
    return jsonResponse(source!);
  }

  // GET /api/runs — paginated run history
  if (path === '/api/runs' && method === 'GET') {
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);
    const result = await listRuns(env, { page, limit });
    // Parse source_stats JSON for each run
    const data = result.data.map(r => ({
      ...r,
      source_stats: r.source_stats ? JSON.parse(r.source_stats) : null,
    }));
    return jsonResponse({ data, meta: result.meta });
  }

  // GET /api/runs/:id — single run
  const runMatch = path.match(/^\/api\/runs\/(\d+)$/);
  if (runMatch && method === 'GET') {
    const run = await getRunFromDB(env, parseInt(runMatch[1], 10));
    if (!run) return jsonResponse({ error: 'Run not found' }, 404);
    return jsonResponse({
      ...run,
      source_stats: run.source_stats ? JSON.parse(run.source_stats) : null,
    });
  }

  // GET /api/stats — dashboard aggregates
  if (path === '/api/stats' && method === 'GET') {
    const stats = await getDashboardStats(env);
    return jsonResponse(stats);
  }

  // GET /api/settings/:key — get a setting
  const settingGetMatch = path.match(/^\/api\/settings\/([a-z0-9_-]+)$/);
  if (settingGetMatch && method === 'GET') {
    const value = await getSetting(env, settingGetMatch[1]);
    if (value === null) return jsonResponse({ error: 'Setting not found' }, 404);
    return jsonResponse({ key: settingGetMatch[1], value });
  }

  // PUT /api/settings/:key — update a setting
  const settingPutMatch = path.match(/^\/api\/settings\/([a-z0-9_-]+)$/);
  if (settingPutMatch && method === 'PUT') {
    const body = await request.json() as { value: string };
    if (!body.value) return jsonResponse({ error: 'value is required' }, 400);
    await setSetting(env, settingPutMatch[1], body.value);
    return jsonResponse({ key: settingPutMatch[1], value: body.value });
  }

  // No match
  return null;
}
