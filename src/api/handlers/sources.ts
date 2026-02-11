import type { Env } from '../../types';
import { jsonResponse } from '../../utils/http';
import { getSourcesFromDB, getSourceFromDB, updateSourceInDB, getSourceStats } from '../../services/storage';
import { requireAuth } from '../auth';

export async function handleListSources(_request: Request, _url: URL, env: Env): Promise<Response> {
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

export async function handleGetSource(_request: Request, _url: URL, env: Env, sourceId: string): Promise<Response> {
  const source = await getSourceFromDB(env, sourceId);
  if (!source) return jsonResponse({ error: 'Source not found' }, 404);
  return jsonResponse({
    ...source,
    ai_prompt_config: source.ai_prompt_config ? JSON.parse(source.ai_prompt_config) : null,
  });
}

export async function handlePatchSource(request: Request, _url: URL, env: Env, sourceId: string): Promise<Response> {
  const authError = requireAuth(request, env);
  if (authError) return authError;

  const body = await request.json() as Record<string, unknown>;
  const fields: Parameters<typeof updateSourceInDB>[2] = {};

  if (body.display_name !== undefined) fields.display_name = body.display_name as string;
  if (body.hashtag !== undefined) fields.hashtag = body.hashtag as string;
  if (body.base_url !== undefined) fields.base_url = body.base_url as string;
  if (body.feed_url !== undefined) fields.feed_url = body.feed_url as string | null;
  if (body.enabled !== undefined) fields.enabled = body.enabled ? 1 : 0;
  if (body.ai_prompt_config !== undefined) {
    fields.ai_prompt_config = typeof body.ai_prompt_config === 'string'
      ? body.ai_prompt_config
      : body.ai_prompt_config === null ? null : JSON.stringify(body.ai_prompt_config);
  }
  if (body.cron_schedule !== undefined) fields.cron_schedule = body.cron_schedule as string;

  const updated = await updateSourceInDB(env, sourceId, fields);
  if (!updated) return jsonResponse({ error: 'Source not found or no changes' }, 404);

  const source = await getSourceFromDB(env, sourceId);
  return jsonResponse(source!);
}
