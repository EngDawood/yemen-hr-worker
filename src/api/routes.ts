/**
 * REST API router. Dispatches to domain-specific handlers.
 * Write endpoints (PATCH, PUT) require Bearer token when API_SECRET is configured.
 */

import type { Env } from '../types';
import { handleListJobs, handleGetJob } from './handlers/jobs';
import { handleListSources, handleGetSource, handlePatchSource } from './handlers/sources';
import { handleListRuns, handleGetRun, handleGetStats } from './handlers/runs';
import { handleGetSetting, handlePutSetting } from './handlers/settings';

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

  // Static path routes
  if (path === '/api/jobs' && method === 'GET') return handleListJobs(request, url, env);
  if (path === '/api/sources' && method === 'GET') return handleListSources(request, url, env);
  if (path === '/api/runs' && method === 'GET') return handleListRuns(request, url, env);
  if (path === '/api/stats' && method === 'GET') return handleGetStats(request, url, env);

  // Parameterized routes — match once, dispatch on method
  const jobMatch = path.match(/^\/api\/jobs\/(.+)$/);
  if (jobMatch && method === 'GET') return handleGetJob(request, url, env, jobMatch[1]);

  const sourceMatch = path.match(/^\/api\/sources\/([a-z0-9_-]+)$/);
  if (sourceMatch && method === 'GET') return handleGetSource(request, url, env, sourceMatch[1]);
  if (sourceMatch && method === 'PATCH') return handlePatchSource(request, url, env, sourceMatch[1]);

  const runMatch = path.match(/^\/api\/runs\/(\d+)$/);
  if (runMatch && method === 'GET') return handleGetRun(request, url, env, parseInt(runMatch[1], 10));

  const settingMatch = path.match(/^\/api\/settings\/([a-z0-9_-]+)$/);
  if (settingMatch && method === 'GET') return handleGetSetting(request, url, env, settingMatch[1]);
  if (settingMatch && method === 'PUT') return handlePutSetting(request, url, env, settingMatch[1]);

  return null;
}
