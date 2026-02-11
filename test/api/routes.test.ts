/**
 * Tests for API routes.
 * Verifies routing dispatch, handler behavior, and auth guard.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleApiRoute } from '../../src/api/routes';
import { createMockD1, createMockEnv } from '../helpers/mock-d1';
import type { Env } from '../../src/types';

function makeRequest(path: string, method = 'GET', body?: object, headers?: Record<string, string>): [Request, URL] {
  const url = new URL(`https://example.com${path}`);
  const init: RequestInit = { method, headers: { 'Content-Type': 'application/json', ...headers } };
  if (body) init.body = JSON.stringify(body);
  return [new Request(url.toString(), init), url];
}

describe('API Routes', () => {
  let mock: ReturnType<typeof createMockD1>;
  let env: Env;

  beforeEach(() => {
    mock = createMockD1();
    env = createMockEnv(mock.db);
  });

  describe('routing', () => {
    it('should return null for unknown paths', async () => {
      const [req, url] = makeRequest('/api/unknown');
      const result = await handleApiRoute(req, url, env);
      expect(result).toBeNull();
    });

    it('should return null for non-API paths', async () => {
      const [req, url] = makeRequest('/health');
      const result = await handleApiRoute(req, url, env);
      expect(result).toBeNull();
    });
  });

  describe('GET /api/jobs', () => {
    it('should return paginated jobs', async () => {
      mock.setFirstResult({ total: 1 });
      mock.setAllResult([{ id: 'job-1', title: 'Test' }]);

      const [req, url] = makeRequest('/api/jobs');
      const res = await handleApiRoute(req, url, env);

      expect(res).not.toBeNull();
      expect(res!.status).toBe(200);
      const data = await res!.json();
      expect(data).toHaveProperty('data');
      expect(data).toHaveProperty('meta');
    });
  });

  describe('GET /api/jobs/:id', () => {
    it('should return job by ID', async () => {
      mock.setFirstResult({ id: 'job-1', title: 'Engineer' });

      const [req, url] = makeRequest('/api/jobs/job-1');
      const res = await handleApiRoute(req, url, env);

      expect(res!.status).toBe(200);
    });

    it('should return 404 for missing job', async () => {
      mock.setFirstResult(null);

      const [req, url] = makeRequest('/api/jobs/nonexistent');
      const res = await handleApiRoute(req, url, env);

      expect(res!.status).toBe(404);
    });
  });

  describe('GET /api/sources', () => {
    it('should return sources with job counts', async () => {
      mock.setAllResult([{ id: 'yemenhr', ai_prompt_config: null, enabled: 1 }]);

      const [req, url] = makeRequest('/api/sources');
      const res = await handleApiRoute(req, url, env);

      expect(res!.status).toBe(200);
    });
  });

  describe('GET /api/sources/:id', () => {
    it('should return source by ID', async () => {
      mock.setFirstResult({ id: 'eoi', ai_prompt_config: null });

      const [req, url] = makeRequest('/api/sources/eoi');
      const res = await handleApiRoute(req, url, env);

      expect(res!.status).toBe(200);
    });

    it('should return 404 for missing source', async () => {
      mock.setFirstResult(null);

      const [req, url] = makeRequest('/api/sources/nonexistent');
      const res = await handleApiRoute(req, url, env);

      expect(res!.status).toBe(404);
    });
  });

  describe('PATCH /api/sources/:id', () => {
    it('should update source without auth when no secret configured', async () => {
      mock.setRunResult(1);
      mock.setFirstResult({ id: 'eoi', display_name: 'Updated' });

      const [req, url] = makeRequest('/api/sources/eoi', 'PATCH', { display_name: 'Updated' });
      const res = await handleApiRoute(req, url, env);

      expect(res!.status).toBe(200);
    });

    it('should return 401 when API_SECRET is set but no auth header', async () => {
      env.API_SECRET = 'my-secret';

      const [req, url] = makeRequest('/api/sources/eoi', 'PATCH', { enabled: true });
      const res = await handleApiRoute(req, url, env);

      expect(res!.status).toBe(401);
    });

    it('should allow access with correct Bearer token', async () => {
      env.API_SECRET = 'my-secret';
      mock.setRunResult(1);
      mock.setFirstResult({ id: 'eoi', display_name: 'EOI' });

      const [req, url] = makeRequest('/api/sources/eoi', 'PATCH', { enabled: true }, {
        Authorization: 'Bearer my-secret',
      });
      const res = await handleApiRoute(req, url, env);

      expect(res!.status).toBe(200);
    });
  });

  describe('GET /api/runs', () => {
    it('should return paginated runs', async () => {
      mock.setFirstResult({ total: 0 });
      mock.setAllResult([]);

      const [req, url] = makeRequest('/api/runs');
      const res = await handleApiRoute(req, url, env);

      expect(res!.status).toBe(200);
    });
  });

  describe('GET /api/runs/:id', () => {
    it('should return run by ID', async () => {
      mock.setFirstResult({ id: 1, source_stats: null });

      const [req, url] = makeRequest('/api/runs/1');
      const res = await handleApiRoute(req, url, env);

      expect(res!.status).toBe(200);
    });

    it('should return 404 for missing run', async () => {
      mock.setFirstResult(null);

      const [req, url] = makeRequest('/api/runs/999');
      const res = await handleApiRoute(req, url, env);

      expect(res!.status).toBe(404);
    });
  });

  describe('GET /api/stats', () => {
    it('should return dashboard stats', async () => {
      mock.setFirstResult({ total: 0 });
      mock.setAllResult([]);

      const [req, url] = makeRequest('/api/stats');
      const res = await handleApiRoute(req, url, env);

      expect(res!.status).toBe(200);
    });
  });

  describe('GET /api/settings/:key', () => {
    it('should return setting value', async () => {
      mock.setFirstResult({ value: 'test-value' });

      const [req, url] = makeRequest('/api/settings/ai-model');
      const res = await handleApiRoute(req, url, env);

      expect(res!.status).toBe(200);
      const data = await res!.json() as { key: string; value: string };
      expect(data.key).toBe('ai-model');
      expect(data.value).toBe('test-value');
    });

    it('should return 404 for missing setting', async () => {
      mock.setFirstResult(null);

      const [req, url] = makeRequest('/api/settings/nonexistent');
      const res = await handleApiRoute(req, url, env);

      expect(res!.status).toBe(404);
    });
  });

  describe('PUT /api/settings/:key', () => {
    it('should update setting without auth when no secret', async () => {
      const [req, url] = makeRequest('/api/settings/ai-model', 'PUT', { value: 'new-model' });
      const res = await handleApiRoute(req, url, env);

      expect(res!.status).toBe(200);
    });

    it('should return 401 when API_SECRET is set but no auth', async () => {
      env.API_SECRET = 'secret';

      const [req, url] = makeRequest('/api/settings/ai-model', 'PUT', { value: 'x' });
      const res = await handleApiRoute(req, url, env);

      expect(res!.status).toBe(401);
    });

    it('should return 400 when value is missing', async () => {
      const [req, url] = makeRequest('/api/settings/ai-model', 'PUT', {});
      const res = await handleApiRoute(req, url, env);

      expect(res!.status).toBe(400);
    });
  });
});
