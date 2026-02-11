import { describe, it, expect, beforeEach } from 'vitest';
import { getSourcesFromDB, getSourceFromDB, updateSourceInDB, getSourceStats } from '../../src/services/storage';
import { createMockD1, createMockEnv } from '../helpers/mock-d1';
import type { Env } from '../../src/types';

describe('D1 Sources', () => {
  let mock: ReturnType<typeof createMockD1>;
  let env: Env;

  beforeEach(() => {
    mock = createMockD1();
    env = createMockEnv(mock.db);
  });

  describe('getSourcesFromDB', () => {
    it('should return all sources ordered by enabled', async () => {
      const sources = [
        { id: 'yemenhr', enabled: 1 },
        { id: 'qtb', enabled: 0 },
      ];
      mock.setAllResult(sources);

      const result = await getSourcesFromDB(env);

      expect(result).toEqual(sources);
      expect(mock.calls[0].sql).toContain('ORDER BY enabled DESC');
    });

    it('should return empty array when no sources', async () => {
      mock.setAllResult([]);

      const result = await getSourcesFromDB(env);

      expect(result).toEqual([]);
    });
  });

  describe('getSourceFromDB', () => {
    it('should return source by ID', async () => {
      const source = { id: 'eoi', display_name: 'EOI Yemen', enabled: 1 };
      mock.setFirstResult(source);

      const result = await getSourceFromDB(env, 'eoi');

      expect(result).toEqual(source);
      expect(mock.calls[0].params[0]).toBe('eoi');
    });

    it('should return null for missing source', async () => {
      mock.setFirstResult(null);

      const result = await getSourceFromDB(env, 'nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('updateSourceInDB', () => {
    it('should update display_name', async () => {
      const result = await updateSourceInDB(env, 'eoi', { display_name: 'New Name' });

      expect(result).toBe(true);
      expect(mock.calls[0].sql).toContain('display_name = ?');
      expect(mock.calls[0].params[0]).toBe('New Name');
    });

    it('should update multiple fields', async () => {
      await updateSourceInDB(env, 'eoi', {
        hashtag: '#EOI',
        enabled: 0,
        cron_schedule: '0 */6 * * *',
      });

      expect(mock.calls[0].sql).toContain('hashtag = ?');
      expect(mock.calls[0].sql).toContain('enabled = ?');
      expect(mock.calls[0].sql).toContain('cron_schedule = ?');
    });

    it('should allow setting ai_prompt_config to null', async () => {
      await updateSourceInDB(env, 'eoi', { ai_prompt_config: null });

      expect(mock.calls[0].sql).toContain('ai_prompt_config = ?');
      expect(mock.calls[0].params[0]).toBeNull();
    });

    it('should return false when no fields provided', async () => {
      const result = await updateSourceInDB(env, 'eoi', {});

      expect(result).toBe(false);
      expect(mock.calls).toHaveLength(0);
    });

    it('should return false when no rows changed', async () => {
      mock.setRunResult(0);

      const result = await updateSourceInDB(env, 'nonexistent', { enabled: 1 });

      expect(result).toBe(false);
    });

    it('should always set updated_at', async () => {
      await updateSourceInDB(env, 'eoi', { enabled: 1 });

      expect(mock.calls[0].sql).toContain("updated_at = datetime('now')");
    });
  });

  describe('getSourceStats', () => {
    it('should return source job counts', async () => {
      const stats = [
        { source: 'yemenhr', job_count: 50 },
        { source: 'eoi', job_count: 20 },
      ];
      mock.setAllResult(stats);

      const result = await getSourceStats(env);

      expect(result).toEqual(stats);
      expect(mock.calls[0].sql).toContain('LEFT JOIN jobs');
    });
  });
});
