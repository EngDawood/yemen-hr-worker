import type { Env } from '../../types';
import { jsonResponse } from '../../utils/http';
import { getSetting, setSetting } from '../../services/storage';
import { requireAuth } from '../auth';

export async function handleGetSetting(_request: Request, _url: URL, env: Env, key: string): Promise<Response> {
  const value = await getSetting(env, key);
  if (value === null) return jsonResponse({ error: 'Setting not found' }, 404);
  return jsonResponse({ key, value });
}

export async function handlePutSetting(request: Request, _url: URL, env: Env, key: string): Promise<Response> {
  const authError = requireAuth(request, env);
  if (authError) return authError;

  const body = await request.json() as { value: string };
  if (!body.value) return jsonResponse({ error: 'value is required' }, 400);
  await setSetting(env, key, body.value);
  return jsonResponse({ key, value: body.value });
}
