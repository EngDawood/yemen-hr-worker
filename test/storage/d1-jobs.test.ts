import { describe, it, expect, beforeEach, vi } from 'vitest';
import { saveJobOnFetch, updateJobStatus, listJobs, getJobFromDB, getDashboardStats } from '../../src/services/storage';
import { createMockD1, createMockEnv } from '../helpers/mock-d1';
import type { Env, ProcessedJob } from '../../src/types';

function makeJob(overrides: Partial<ProcessedJob> = {}): ProcessedJob {
  return {
    title: 'Test Engineer',
    description: 'A test job',
    link: 'https://example.com/job/1',
    company: 'TestCo',
    imageUrl: null,
    source: 'yemenhr',
    ...overrides,
  };
}

describe('D1 Jobs', () => {
  let mock: ReturnType<typeof createMockD1>;
  let env: Env;

  beforeEach(() => {
    mock = createMockD1();
    env = createMockEnv(mock.db);
  });

  describe('saveJobOnFetch', () => {
    it('should insert job with fetched status', async () => {
      await saveJobOnFetch(env, 'job-1', makeJob(), '<p>raw</p>', 'yemenhr', 42);

      expect(mock.calls).toHaveLength(1);
      expect(mock.calls[0].sql).toContain('INSERT OR IGNORE INTO jobs');
      expect(mock.calls[0].params[0]).toBe('job-1'); // id
      expect(mock.calls[0].params[1]).toBe('Test Engineer'); // title
    });

    it('should use default source when not specified', async () => {
      await saveJobOnFetch(env, 'job-2', makeJob(), '');

      // Source is the last param
      const params = mock.calls[0].params;
      expect(params[params.length - 1]).toBe('rss'); // DEFAULT_SOURCE
    });

    it('should not throw on D1 error', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const failDb = {
        prepare: () => ({
          bind: () => ({ run: async () => { throw new Error('D1 fail'); } }),
        }),
      } as unknown as D1Database;
      env.JOBS_DB = failDb;

      await expect(saveJobOnFetch(env, 'job-3', makeJob(), '')).resolves.toBeUndefined();
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should calculate word count from description', async () => {
      await saveJobOnFetch(env, 'job-4', makeJob({ description: 'one two three' }), '');

      // word_count is second-to-last param
      const params = mock.calls[0].params;
      expect(params[params.length - 2]).toBe(3);
    });
  });

  describe('updateJobStatus', () => {
    it('should update to posted with AI summary and message ID', async () => {
      await updateJobStatus(env, 'job-1', 'posted', {
        aiSummary: 'ملخص',
        category: 'تقنية',
        telegramMessageId: 123,
      });

      expect(mock.calls).toHaveLength(1);
      expect(mock.calls[0].sql).toContain('UPDATE jobs SET status');
      expect(mock.calls[0].params[0]).toBe('posted');
      expect(mock.calls[0].params[1]).toBe('ملخص');
    });

    it('should use simple update for non-posted status', async () => {
      await updateJobStatus(env, 'job-2', 'failed');

      expect(mock.calls[0].sql).not.toContain('ai_summary_ar');
      expect(mock.calls[0].params[0]).toBe('failed');
      expect(mock.calls[0].params[1]).toBe('job-2');
    });

    it('should not throw on D1 error', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const failDb = {
        prepare: () => ({
          bind: () => ({ run: async () => { throw new Error('D1 fail'); } }),
        }),
      } as unknown as D1Database;
      env.JOBS_DB = failDb;

      await expect(updateJobStatus(env, 'job-3', 'posted')).resolves.toBeUndefined();
      consoleSpy.mockRestore();
    });
  });

  describe('listJobs', () => {
    it('should return paginated results with defaults', async () => {
      mock.setFirstResult({ total: 50 });
      mock.setAllResult([{ id: 'j1' }, { id: 'j2' }]);

      const result = await listJobs(env);

      expect(result.meta.page).toBe(1);
      expect(result.meta.limit).toBe(20);
      expect(result.meta.total).toBe(50);
      expect(result.meta.totalPages).toBe(3);
    });

    it('should apply source filter', async () => {
      mock.setFirstResult({ total: 0 });

      await listJobs(env, { source: 'eoi' });

      expect(mock.calls[0].sql).toContain('source = ?');
      expect(mock.calls[0].params[0]).toBe('eoi');
    });

    it('should apply search filter', async () => {
      mock.setFirstResult({ total: 0 });

      await listJobs(env, { search: 'engineer' });

      expect(mock.calls[0].sql).toContain('LIKE');
      expect(mock.calls[0].params[0]).toBe('%engineer%');
    });

    it('should clamp page to minimum 1', async () => {
      mock.setFirstResult({ total: 0 });

      const result = await listJobs(env, { page: -5 });

      expect(result.meta.page).toBe(1);
    });
  });

  describe('getJobFromDB', () => {
    it('should return job by ID', async () => {
      const job = { id: 'test-1', title: 'Engineer' };
      mock.setFirstResult(job);

      const result = await getJobFromDB(env, 'test-1');

      expect(result).toEqual(job);
    });

    it('should return null for missing job', async () => {
      mock.setFirstResult(null);

      const result = await getJobFromDB(env, 'nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('getDashboardStats', () => {
    it('should aggregate stats from multiple queries', async () => {
      // getDashboardStats uses Promise.all with 4 parallel queries
      // Our simple mock returns the same result for all, but we verify the shape
      mock.setFirstResult({ total: 100 });
      mock.setAllResult([]);

      const result = await getDashboardStats(env);

      expect(result).toHaveProperty('totalJobs');
      expect(result).toHaveProperty('byStatus');
      expect(result).toHaveProperty('bySource');
      expect(result).toHaveProperty('recentRuns');
    });
  });
});
