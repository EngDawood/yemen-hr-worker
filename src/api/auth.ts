import type { Env } from '../types';
import { jsonResponse } from '../utils/http';

/**
 * Check if request is authenticated for write operations.
 * No-op when API_SECRET is not configured (dev/preview mode).
 */
export function requireAuth(request: Request, env: Env): Response | null {
  const secret = env.API_SECRET;
  if (!secret) return null; // No secret configured — allow all

  const auth = request.headers.get('Authorization');
  if (auth === `Bearer ${secret}`) return null; // Authenticated

  return jsonResponse({ error: 'Unauthorized' }, 401);
}
