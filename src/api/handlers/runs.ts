import type { Env } from '../../types';
import { jsonResponse } from '../../utils/http';
import { listRuns, getRunFromDB, getDashboardStats } from '../../services/storage';

export async function handleListRuns(_request: Request, url: URL, env: Env): Promise<Response> {
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

export async function handleGetRun(_request: Request, _url: URL, env: Env, runId: number): Promise<Response> {
  const run = await getRunFromDB(env, runId);
  if (!run) return jsonResponse({ error: 'Run not found' }, 404);
  return jsonResponse({
    ...run,
    source_stats: run.source_stats ? JSON.parse(run.source_stats) : null,
  });
}

export async function handleGetStats(_request: Request, _url: URL, env: Env): Promise<Response> {
  const stats = await getDashboardStats(env);
  return jsonResponse(stats);
}
