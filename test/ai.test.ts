/**
 * Tests for AI service.
 * Tests buildJobHeader, buildNoAIFallback, per-source prompt configs, D1 merge, and prompt assembly.
 */

import { describe, it, expect, vi } from 'vitest';
import { buildJobHeader, buildNoAIFallback, summarizeJob } from '../src/services/ai';
import { getPromptConfig, getCodeDefault } from '../src/services/ai-prompts';
import type { ProcessedJob, Env, JobSource } from '../src/types';

function makeJob(overrides: Partial<ProcessedJob> = {}): ProcessedJob {
  return {
    title: 'Software Engineer',
    company: 'Tech Corp',
    link: 'https://yemenhr.com/jobs/test',
    description: 'Build great software',
    imageUrl: null,
    location: 'Sana\'a',
    postedDate: '15 Jan, 2026',
    deadline: '30 Jan, 2026',
    source: 'yemenhr',
    ...overrides,
  };
}

/**
 * Mock D1 database for getPromptConfig tests.
 * Sources map: { sourceId: { ai_prompt_config: JSON string | null } }
 */
function mockD1(sources: Record<string, { ai_prompt_config?: string | null }> = {}): D1Database {
  return {
    prepare: (_sql: string) => ({
      bind: (...params: unknown[]) => ({
        first: async () => {
          // Mock getSourceFromDB: SELECT * FROM sources WHERE id = ?
          if (_sql.includes('sources') && params[0]) {
            const id = params[0] as string;
            if (sources[id]) {
              return { id, ai_prompt_config: sources[id].ai_prompt_config ?? null };
            }
            return null;
          }
          // Mock getSetting: SELECT value FROM settings WHERE key = ?
          return null;
        },
        all: async () => ({ results: [] }),
        run: async () => ({ meta: { changes: 0 } }),
      }),
    }),
    batch: async () => [],
    dump: async () => new ArrayBuffer(0),
    exec: async () => ({ count: 0, duration: 0 }),
  } as unknown as D1Database;
}

function makeEnv(d1Sources: Record<string, { ai_prompt_config?: string | null }> = {}): Env {
  const mockAI = {
    run: async (_model: string, params: Record<string, unknown>) => {
      return { choices: [{ message: { content: '📋 الوصف الوظيفي:\nوظيفة تقنية في شركة' } }] };
    },
  };
  return {
    AI: mockAI,
    AI_MODEL: '@cf/qwen/qwen3-30b-a3b-fp8',
    JOBS_DB: mockD1(d1Sources),
  } as unknown as Env;
}

// Prompt-capturing env for testing prompt assembly
function makeCapturingEnv(d1Sources: Record<string, { ai_prompt_config?: string | null }> = {}): { env: Env; capturedPrompts: string[] } {
  const capturedPrompts: string[] = [];
  const mockAI = {
    run: async (_model: string, params: Record<string, unknown>) => {
      const messages = params.messages as Array<{ content: string }>;
      capturedPrompts.push(messages[0].content);
      return { choices: [{ message: { content: '📋 الوصف الوظيفي:\nوظيفة تقنية في شركة' } }] };
    },
  };
  return {
    env: {
      AI: mockAI,
      AI_MODEL: '@cf/qwen/qwen3-30b-a3b-fp8',
      JOBS_DB: mockD1(d1Sources),
    } as unknown as Env,
    capturedPrompts,
  };
}

describe('buildJobHeader', () => {
  it('should include title, company, location, dates', () => {
    const job = makeJob();
    const header = buildJobHeader(job);

    expect(header).toContain('Software Engineer');
    expect(header).toContain('Tech Corp');
    expect(header).toContain('Sana\'a');
    expect(header).toContain('15 يناير 2026');
    expect(header).toContain('30 يناير 2026');
  });

  it('should show غير محدد for missing fields', () => {
    const job = makeJob({ location: undefined, postedDate: undefined, deadline: undefined });
    const header = buildJobHeader(job);

    expect(header).toContain('غير محدد');
    const matches = header.match(/غير محدد/g);
    expect(matches).toHaveLength(3);
  });

  it('should contain section divider', () => {
    const header = buildJobHeader(makeJob());
    expect(header).toContain('━━━━━━━━━━━━━━━━━━━━');
  });

  it('should contain Arabic labels', () => {
    const header = buildJobHeader(makeJob());
    expect(header).toContain('📋 المسمى الوظيفي:');
    expect(header).toContain('🏢 الجهة:');
    expect(header).toContain('📍 الموقع:');
    expect(header).toContain('📅 تاريخ النشر:');
    expect(header).toContain('⏰ آخر موعد للتقديم:');
  });
});

describe('buildNoAIFallback', () => {
  it('should include header and description', () => {
    const job = makeJob({ description: 'We need a developer' });
    const fallback = buildNoAIFallback(job);

    expect(fallback).toContain('Software Engineer');
    expect(fallback).toContain('Tech Corp');
    expect(fallback).toContain('We need a developer');
  });

  it('should truncate long descriptions to 600 chars', () => {
    const longDesc = 'A'.repeat(700);
    const job = makeJob({ description: longDesc });
    const fallback = buildNoAIFallback(job);

    expect(fallback).toContain('...');
    expect(fallback.indexOf('A'.repeat(600))).toBe(-1);
  });

  it('should show fallback for no description', () => {
    const job = makeJob({ description: 'No description available' });
    const fallback = buildNoAIFallback(job);

    expect(fallback).toContain('الرجاء زيارة رابط الوظيفة للمزيد من التفاصيل.');
  });

  it('should include how-to-apply with links', () => {
    const job = makeJob({
      howToApply: 'Send your CV to our office',
      applicationLinks: ['hr@example.com', 'https://forms.gle/abc', '+967777123456'],
    });
    const fallback = buildNoAIFallback(job);

    expect(fallback).toContain('📧 كيفية التقديم:');
    expect(fallback).toContain('Send your CV to our office');
    expect(fallback).toContain('📩 إيميل: hr@example.com');
    expect(fallback).toContain('🔗 رابط: https://forms.gle/abc');
    expect(fallback).toContain('📱 واتساب/هاتف: +967777123456');
  });

  it('should truncate long how-to-apply text', () => {
    const longApply = 'B'.repeat(250);
    const job = makeJob({ howToApply: longApply });
    const fallback = buildNoAIFallback(job);

    expect(fallback).toContain('...');
  });

  it('should work without how-to-apply section', () => {
    const job = makeJob({ howToApply: undefined, applicationLinks: undefined });
    const fallback = buildNoAIFallback(job);

    expect(fallback).not.toContain('📧 كيفية التقديم:');
  });
});

describe('getCodeDefault (sync, code-only)', () => {
  it('should return includeHowToApply: true for eoi', () => {
    const config = getCodeDefault('eoi');
    expect(config.includeHowToApply).toBe(true);
    expect(config.sourceHint).toBeDefined();
  });

  it('should return includeHowToApply: true for reliefweb', () => {
    expect(getCodeDefault('reliefweb').includeHowToApply).toBe(true);
  });

  it('should return includeHowToApply: true for yemenhr', () => {
    expect(getCodeDefault('yemenhr').includeHowToApply).toBe(true);
  });

  it('should return includeHowToApply: false for qtb', () => {
    expect(getCodeDefault('qtb').includeHowToApply).toBe(false);
  });

  it('should return safe default for ykbank (not in configs)', () => {
    expect(getCodeDefault('ykbank').includeHowToApply).toBe(false);
    expect(getCodeDefault('ykbank').applyFallback).toBeDefined();
  });

  it('should return includeHowToApply: false for yldf', () => {
    expect(getCodeDefault('yldf').includeHowToApply).toBe(false);
  });

  it('should return includeHowToApply: false for rss', () => {
    expect(getCodeDefault('rss').includeHowToApply).toBe(false);
  });

  it('should return safe default for undefined source', () => {
    expect(getCodeDefault(undefined).includeHowToApply).toBe(false);
  });

  it('should have applyFallback for no-apply sources', () => {
    expect(getCodeDefault('qtb').applyFallback).toContain('بنك القطيبي');
    expect(getCodeDefault('yldf').applyFallback).toContain('YLDF');
    expect(getCodeDefault('yemenhr').applyFallback).toBeUndefined();
  });

  it('should NOT have applyFallback for sources with apply data', () => {
    expect(getCodeDefault('eoi').applyFallback).toBeUndefined();
    expect(getCodeDefault('reliefweb').applyFallback).toBeUndefined();
  });

  it('should include location hints in sourceHint', () => {
    expect(getCodeDefault('qtb').sourceHint).toContain('branch or city');
    expect(getCodeDefault('reliefweb').sourceHint).toContain('multiple countries');
    expect(getCodeDefault('yemenhr').sourceHint).toContain('city');
  });
});

describe('getPromptConfig (async, D1 merge)', () => {
  it('should return code default when D1 has no override', async () => {
    const env = makeEnv();
    const config = await getPromptConfig('qtb', env);
    expect(config.includeHowToApply).toBe(false);
    expect(config.sourceHint).toContain('QTB Bank');
  });

  it('should merge D1 override with code default', async () => {
    const env = makeEnv({
      qtb: { ai_prompt_config: JSON.stringify({ sourceHint: 'Custom hint for QTB' }) },
    });
    const config = await getPromptConfig('qtb', env);

    // D1 override
    expect(config.sourceHint).toBe('Custom hint for QTB');
    // Code default preserved for non-overridden fields
    expect(config.includeHowToApply).toBe(false);
    expect(config.applyFallback).toContain('بنك القطيبي');
  });

  it('should allow D1 to override includeHowToApply', async () => {
    const env = makeEnv({
      qtb: { ai_prompt_config: JSON.stringify({ includeHowToApply: true }) },
    });
    const config = await getPromptConfig('qtb', env);
    expect(config.includeHowToApply).toBe(true);
  });

  it('should fall back to code default when D1 read fails', async () => {
    const failingDB = {
      prepare: () => ({ bind: () => ({ first: async () => { throw new Error('D1 unavailable'); } }) }),
    } as unknown as D1Database;
    const env = { JOBS_DB: failingDB } as unknown as Env;

    const config = await getPromptConfig('eoi', env);
    expect(config.includeHowToApply).toBe(true);
    expect(config.sourceHint).toContain('EOI');
  });

  it('should return default for undefined source even with D1 data', async () => {
    const env = makeEnv({
      qtb: { ai_prompt_config: JSON.stringify({ sourceHint: 'test' }) },
    });
    const config = await getPromptConfig(undefined, env);
    expect(config.includeHowToApply).toBe(false);
  });
});

describe('summarizeJob prompt assembly', () => {
  it('should include apply template for yemenhr source', async () => {
    const { env, capturedPrompts } = makeCapturingEnv();
    await summarizeJob(makeJob({ source: 'yemenhr' }), env);

    expect(capturedPrompts[0]).toContain('📧 كيفية التقديم:');
    expect(capturedPrompts[0]).not.toContain('DO NOT include any how-to-apply section');
  });

  it('should include apply template for eoi source', async () => {
    const { env, capturedPrompts } = makeCapturingEnv();
    const job = makeJob({
      source: 'eoi',
      howToApply: 'Send CV to hr@example.com',
      applicationLinks: ['hr@example.com'],
    });
    await summarizeJob(job, env);

    expect(capturedPrompts[0]).toContain('📧 كيفية التقديم:');
    expect(capturedPrompts[0]).toContain('hr@example.com');
    expect(capturedPrompts[0]).not.toContain('DO NOT include any how-to-apply section');
  });

  it('should include apply template for reliefweb source', async () => {
    const { env, capturedPrompts } = makeCapturingEnv();
    const job = makeJob({
      source: 'reliefweb',
      howToApply: 'Apply at https://apply.example.org',
      applicationLinks: ['https://apply.example.org'],
    });
    await summarizeJob(job, env);

    expect(capturedPrompts[0]).toContain('📧 كيفية التقديم:');
    expect(capturedPrompts[0]).toContain('https://apply.example.org');
  });

  it('should include source hint for configured sources', async () => {
    const { env, capturedPrompts } = makeCapturingEnv();
    await summarizeJob(makeJob({ source: 'qtb' }), env);
    expect(capturedPrompts[0]).toContain('SOURCE CONTEXT:');
    expect(capturedPrompts[0]).toContain('QTB Bank');
  });

  it('should use standard description limit for yemenhr (apply-enabled)', async () => {
    const { env, capturedPrompts } = makeCapturingEnv();
    await summarizeJob(makeJob({ source: 'yemenhr' }), env);
    expect(capturedPrompts[0]).toContain('MAXIMUM 250 characters');
  });

  it('should use standard description limit for apply sources', async () => {
    const { env, capturedPrompts } = makeCapturingEnv();
    await summarizeJob(makeJob({ source: 'eoi' }), env);
    expect(capturedPrompts[0]).toContain('MAXIMUM 250 characters');
  });

  it('should not include apply context in input for no-apply sources', async () => {
    const { env, capturedPrompts } = makeCapturingEnv();
    const job = makeJob({
      source: 'ykbank',
      applicationLinks: ['fake@example.com'],
    });
    await summarizeJob(job, env);
    expect(capturedPrompts[0]).not.toContain('fake@example.com');
    expect(capturedPrompts[0]).not.toContain('Application links/contacts');
  });

  it('should return summary and category', async () => {
    const { env } = makeCapturingEnv();
    const result = await summarizeJob(makeJob({ source: 'yemenhr' }), env);
    expect(result.summary).toBeDefined();
    expect(result.category).toBeDefined();
  });

  it('should append source-specific fallback for qtb', async () => {
    const { env } = makeCapturingEnv();
    const result = await summarizeJob(makeJob({ source: 'qtb' }), env);

    expect(result.summary).toContain('📧 كيفية التقديم:');
    expect(result.summary).toContain('بنك القطيبي');
  });

  it('should NOT append fallback for eoi (has real apply data)', async () => {
    const { env } = makeCapturingEnv();
    const job = makeJob({
      source: 'eoi',
      howToApply: 'Send CV to hr@org.com',
      applicationLinks: ['hr@org.com'],
    });
    const result = await summarizeJob(job, env);

    expect(result.summary).not.toContain('راجع رابط الوظيفة');
    expect(result.summary).not.toContain('قدّم عبر');
  });

  it('should use D1-overridden hint in prompt', async () => {
    const { env, capturedPrompts } = makeCapturingEnv({
      qtb: { ai_prompt_config: JSON.stringify({ sourceHint: 'CUSTOM D1 HINT' }) },
    });
    await summarizeJob(makeJob({ source: 'qtb' }), env);
    expect(capturedPrompts[0]).toContain('CUSTOM D1 HINT');
  });
});
