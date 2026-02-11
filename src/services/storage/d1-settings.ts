import type { Env } from '../../types';

/**
 * Get a setting value from D1.
 */
export async function getSetting(env: Env, key: string): Promise<string | null> {
  const row = await env.JOBS_DB.prepare(
    'SELECT value FROM settings WHERE key = ?'
  ).bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

/**
 * Set a setting value in D1 (upsert).
 */
export async function setSetting(env: Env, key: string, value: string): Promise<void> {
  await env.JOBS_DB.prepare(
    `INSERT OR REPLACE INTO settings (key, value, updated_at)
     VALUES (?, ?, datetime('now'))`
  ).bind(key, value).run();
}
