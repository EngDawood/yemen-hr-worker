/**
 * Tests for KV storage operations.
 * Run with: npm test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isJobPosted, markJobAsPosted, getPostedJob } from '../src/services/storage';
import type { Env, PostedJobRecord } from '../src/types';

// Create mock KV namespace
function createMockKV(): KVNamespace {
  const store = new Map<string, string>();

  return {
    get: vi.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    put: vi.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    delete: vi.fn((key: string) => {
      store.delete(key);
      return Promise.resolve();
    }),
    list: vi.fn(),
    getWithMetadata: vi.fn(),
  } as unknown as KVNamespace;
}

// Create mock Env
function createMockEnv(kv: KVNamespace): Env {
  return {
    POSTED_JOBS: kv,
    JOBS_DB: {} as D1Database,
    AI: {} as Ai,
    TELEGRAM_BOT_TOKEN: 'test-token',
    RSS_FEED_URL: 'https://example.com/feed',
    TELEGRAM_CHAT_ID: '-123456789',
  };
}

describe('isJobPosted', () => {
  let mockKV: KVNamespace;
  let mockEnv: Env;

  beforeEach(() => {
    mockKV = createMockKV();
    mockEnv = createMockEnv(mockKV);
  });

  it('should return false for new job', async () => {
    const result = await isJobPosted(mockEnv, 'new-job-123');

    expect(result).toBe(false);
    expect(mockKV.get).toHaveBeenCalledWith('job:new-job-123');
  });

  it('should return true for posted job', async () => {
    // Pre-populate the store
    await mockKV.put('job:existing-job', JSON.stringify({ postedAt: '2025-01-15', title: 'Test' }));

    const result = await isJobPosted(mockEnv, 'existing-job');

    expect(result).toBe(true);
  });
});

describe('markJobAsPosted', () => {
  let mockKV: KVNamespace;
  let mockEnv: Env;

  beforeEach(() => {
    mockKV = createMockKV();
    mockEnv = createMockEnv(mockKV);
  });

  it('should store correct record', async () => {
    const jobId = 'test-job-456';
    const title = 'Software Engineer Position';

    await markJobAsPosted(mockEnv, jobId, title);

    expect(mockKV.put).toHaveBeenCalledWith(
      'job:test-job-456',
      expect.any(String),
      { expirationTtl: 30 * 24 * 60 * 60 }
    );

    // Verify the stored data structure
    const putCall = vi.mocked(mockKV.put).mock.calls[0];
    const storedData = JSON.parse(putCall[1] as string) as PostedJobRecord;
    expect(storedData.title).toBe(title);
    expect(storedData.postedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO date format
  });

  it('should use 30-day TTL', async () => {
    await markJobAsPosted(mockEnv, 'job-id', 'Job Title');

    expect(mockKV.put).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      { expirationTtl: 2592000 } // 30 * 24 * 60 * 60
    );
  });
});

describe('getPostedJob', () => {
  let mockKV: KVNamespace;
  let mockEnv: Env;

  beforeEach(() => {
    mockKV = createMockKV();
    mockEnv = createMockEnv(mockKV);
  });

  it('should return null for missing job', async () => {
    const result = await getPostedJob(mockEnv, 'nonexistent-job');

    expect(result).toBeNull();
    expect(mockKV.get).toHaveBeenCalledWith('job:nonexistent-job');
  });

  it('should return record for existing job', async () => {
    const record: PostedJobRecord = {
      postedAt: '2025-01-15T10:00:00.000Z',
      title: 'Test Job Title',
    };
    await mockKV.put('job:existing-job', JSON.stringify(record));

    const result = await getPostedJob(mockEnv, 'existing-job');

    expect(result).toEqual(record);
  });

  it('should handle invalid JSON gracefully', async () => {
    await mockKV.put('job:corrupt-job', 'not valid json{');

    const result = await getPostedJob(mockEnv, 'corrupt-job');

    expect(result).toBeNull();
  });
});
