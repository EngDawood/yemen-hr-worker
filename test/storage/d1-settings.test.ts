import { describe, it, expect, beforeEach } from 'vitest';
import { getSetting, setSetting } from '../../src/services/storage';
import { createMockD1, createMockEnv } from '../helpers/mock-d1';
import type { Env } from '../../src/types';

describe('D1 Settings', () => {
  let mock: ReturnType<typeof createMockD1>;
  let env: Env;

  beforeEach(() => {
    mock = createMockD1();
    env = createMockEnv(mock.db);
  });

  describe('getSetting', () => {
    it('should return setting value', async () => {
      mock.setFirstResult({ value: '@cf/qwen/qwen3-30b-a3b-fp8' });

      const result = await getSetting(env, 'ai-model');

      expect(result).toBe('@cf/qwen/qwen3-30b-a3b-fp8');
      expect(mock.calls[0].params[0]).toBe('ai-model');
    });

    it('should return null for missing setting', async () => {
      mock.setFirstResult(null);

      const result = await getSetting(env, 'nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('setSetting', () => {
    it('should upsert setting value', async () => {
      await setSetting(env, 'ai-model', 'new-model');

      expect(mock.calls).toHaveLength(1);
      expect(mock.calls[0].sql).toContain('INSERT OR REPLACE INTO settings');
      expect(mock.calls[0].params[0]).toBe('ai-model');
      expect(mock.calls[0].params[1]).toBe('new-model');
    });
  });
});
