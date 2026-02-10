import { describe, it, expect, beforeEach } from 'vitest';
import { createRun, completeRun, listRuns, getRunFromDB, getTodayRuns } from '../../src/services/storage';
import { createMockD1, createMockEnv } from '../helpers/mock-d1';
import type { Env } from '../../src/types';

describe('D1 Runs', () => {
  let mock: ReturnType<typeof createMockD1>;
  let env: Env;

  beforeEach(() => {
    mock = createMockD1();
    env = createMockEnv(mock.db);
  });

  describe('createRun', () => {
    it('should insert a run and return its ID', async () => {
      mock.setFirstResult({ id: 42 });

      const id = await createRun(env, 'cron');

      expect(id).toBe(42);
      expect(mock.calls).toHaveLength(1);
      expect(mock.calls[0].sql).toContain('INSERT INTO runs');
      expect(mock.calls[0].params[1]).toBe('cron');
    });

    it('should pass trigger type correctly', async () => {
      mock.setFirstResult({ id: 1 });

      await createRun(env, 'manual');

      expect(mock.calls[0].params[1]).toBe('manual');
    });

    it('should use environment from env', async () => {
      mock.setFirstResult({ id: 1 });
      env.ENVIRONMENT = 'preview';

      await createRun(env, 'webhook');

      expect(mock.calls[0].params[2]).toBe('preview');
    });

    it('should default to production environment', async () => {
      mock.setFirstResult({ id: 1 });

      await createRun(env, 'cron');

      expect(mock.calls[0].params[2]).toBe('production');
    });
  });

  describe('completeRun', () => {
    it('should update run with completed status', async () => {
      await completeRun(env, 5, {
        jobs_fetched: 10,
        jobs_posted: 3,
        jobs_skipped: 6,
        jobs_failed: 1,
      });

      expect(mock.calls).toHaveLength(1);
      expect(mock.calls[0].sql).toContain('UPDATE runs');
      expect(mock.calls[0].params[1]).toBe('completed');
      expect(mock.calls[0].params[2]).toBe(10); // jobs_fetched
      expect(mock.calls[0].params[3]).toBe(3);  // jobs_posted
    });

    it('should set failed status when error is present', async () => {
      await completeRun(env, 5, {
        jobs_fetched: 0, jobs_posted: 0, jobs_skipped: 0, jobs_failed: 0,
        error: 'Network timeout',
      });

      expect(mock.calls[0].params[1]).toBe('failed');
      expect(mock.calls[0].params[7]).toBe('Network timeout');
    });

    it('should serialize source_stats as JSON', async () => {
      await completeRun(env, 5, {
        jobs_fetched: 2, jobs_posted: 2, jobs_skipped: 0, jobs_failed: 0,
        source_stats: { yemenhr: { posted: 1 }, eoi: { posted: 1 } },
      });

      expect(mock.calls[0].params[6]).toBe('{"yemenhr":{"posted":1},"eoi":{"posted":1}}');
    });
  });

  describe('listRuns', () => {
    it('should return paginated results', async () => {
      mock.setFirstResult({ total: 5 });
      mock.setAllResult([{ id: 1 }, { id: 2 }]);

      const result = await listRuns(env, { page: 1, limit: 2 });

      expect(result.meta.total).toBe(5);
      expect(result.meta.totalPages).toBe(3);
      expect(result.data).toHaveLength(2);
    });

    it('should default to page 1, limit 20', async () => {
      mock.setFirstResult({ total: 0 });

      await listRuns(env);

      // First call is COUNT, second is SELECT with LIMIT/OFFSET
      expect(mock.calls).toHaveLength(2);
    });

    it('should clamp limit to max 100', async () => {
      mock.setFirstResult({ total: 0 });

      await listRuns(env, { limit: 200 });

      // The LIMIT param should be 100 (clamped)
      const selectCall = mock.calls[1];
      expect(selectCall.params[0]).toBe(100);
    });
  });

  describe('getRunFromDB', () => {
    it('should return run by ID', async () => {
      const run = { id: 1, status: 'completed' };
      mock.setFirstResult(run);

      const result = await getRunFromDB(env, 1);

      expect(result).toEqual(run);
      expect(mock.calls[0].params[0]).toBe(1);
    });

    it('should return null for missing run', async () => {
      mock.setFirstResult(null);

      const result = await getRunFromDB(env, 999);

      expect(result).toBeNull();
    });
  });

  describe('getTodayRuns', () => {
    it('should return runs from today', async () => {
      const runs = [{ id: 1 }, { id: 2 }];
      mock.setAllResult(runs);

      const result = await getTodayRuns(env);

      expect(result).toEqual(runs);
      expect(mock.calls[0].sql).toContain("date('now')");
    });
  });
});
