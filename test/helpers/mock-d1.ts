/**
 * Shared D1 mock for storage tests.
 * Provides an in-memory D1 database that tracks SQL operations.
 */

import { vi } from 'vitest';

export interface MockD1Call {
  sql: string;
  params: unknown[];
}

/**
 * Create a mock D1Database that records all calls and returns configurable results.
 * Tracks calls for assertion in tests.
 */
export function createMockD1() {
  const calls: MockD1Call[] = [];
  let nextFirstResult: unknown = null;
  let nextAllResult: { results: unknown[] } = { results: [] };
  let nextRunResult = { meta: { changes: 1 } };

  const mock = {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...params: unknown[]) => {
        calls.push({ sql, params });
        return {
          first: vi.fn(async () => nextFirstResult),
          all: vi.fn(async () => nextAllResult),
          run: vi.fn(async () => nextRunResult),
        };
      }),
      // Unbound versions (for queries with no params)
      first: vi.fn(async () => {
        calls.push({ sql, params: [] });
        return nextFirstResult;
      }),
      all: vi.fn(async () => {
        calls.push({ sql, params: [] });
        return nextAllResult;
      }),
      run: vi.fn(async () => {
        calls.push({ sql, params: [] });
        return nextRunResult;
      }),
    })),
    batch: vi.fn(async () => []),
    dump: vi.fn(async () => new ArrayBuffer(0)),
    exec: vi.fn(async () => ({ count: 0, duration: 0 })),
  } as unknown as D1Database;

  return {
    db: mock,
    calls,
    /** Set what first() returns on the next call */
    setFirstResult(result: unknown) { nextFirstResult = result; },
    /** Set what all() returns on the next call */
    setAllResult(results: unknown[]) { nextAllResult = { results }; },
    /** Set what run() returns on the next call */
    setRunResult(changes: number) { nextRunResult = { meta: { changes } }; },
    /** Reset all state */
    reset() {
      calls.length = 0;
      nextFirstResult = null;
      nextAllResult = { results: [] };
      nextRunResult = { meta: { changes: 1 } };
    },
  };
}

/** Create a minimal mock Env with a mock D1 */
export function createMockEnv(d1: D1Database): import('../../src/types').Env {
  return {
    POSTED_JOBS: {} as KVNamespace,
    JOBS_DB: d1,
    AI: {} as Ai,
    CF_VERSION_METADATA: { id: 'test' },
    TELEGRAM_BOT_TOKEN: 'test-token',
    RSS_FEED_URL: 'https://example.com/feed',
    TELEGRAM_CHAT_ID: '-123456789',
  };
}
