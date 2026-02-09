/**
 * Tests for AI service.
 * Tests buildJobHeader, buildNoAIFallback, per-source prompt configs, KV merge, and prompt assembly.
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

// Mock KV namespace for async getPromptConfig tests
function mockKV(data: Record<string, unknown> = {}): KVNamespace {
  return {
    get: async (key: string, type?: string) => {
      const val = data[key];
      if (val === undefined) return null;
      if (type === 'json') return val;
      return JSON.stringify(val);
    },
    put: async () => {},
    delete: async () => {},
    list: async () => ({ keys: [], list_complete: true, cacheStatus: null }),
    getWithMetadata: async () => ({ value: null, metadata: null, cacheStatus: null }),
  } as unknown as KVNamespace;
}

function makeEnv(kvData: Record<string, unknown> = {}): Env {
  const mockAI = {
    run: async (_model: string, params: Record<string, unknown>) => {
      return { choices: [{ message: { content: '📋 الوصف الوظيفي:\nوظيفة تقنية في شركة' } }] };
    },
  };
  return {
    AI: mockAI,
    AI_MODEL: '@cf/qwen/qwen3-30b-a3b-fp8',
    POSTED_JOBS: mockKV(kvData),
  } as unknown as Env;
}

// Prompt-capturing env for testing prompt assembly
function makeCapturingEnv(kvData: Record<string, unknown> = {}): { env: Env; capturedPrompts: string[] } {
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
      POSTED_JOBS: mockKV(kvData),
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
    expect(header).toContain('15 Jan, 2026');
    expect(header).toContain('30 Jan, 2026');
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

  it('should return includeHowToApply: false for yemenhr', () => {
    expect(getCodeDefault('yemenhr').includeHowToApply).toBe(false);
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
    expect(getCodeDefault('yemenhr').applyFallback).toBeDefined();
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

describe('getPromptConfig (async, KV merge)', () => {
  it('should return code default when KV is empty', async () => {
    const env = makeEnv();
    const config = await getPromptConfig('qtb', env);
    expect(config.includeHowToApply).toBe(false);
    expect(config.sourceHint).toContain('QTB Bank');
  });

  it('should merge KV override with code default', async () => {
    const env = makeEnv({
      'config:ai-prompts': {
        qtb: { sourceHint: 'Custom hint for QTB' },
      },
    });
    const config = await getPromptConfig('qtb', env);

    // KV override
    expect(config.sourceHint).toBe('Custom hint for QTB');
    // Code default preserved for non-overridden fields
    expect(config.includeHowToApply).toBe(false);
    expect(config.applyFallback).toContain('بنك القطيبي');
  });

  it('should allow KV to override includeHowToApply', async () => {
    const env = makeEnv({
      'config:ai-prompts': {
        qtb: { includeHowToApply: true },
      },
    });
    const config = await getPromptConfig('qtb', env);
    expect(config.includeHowToApply).toBe(true);
  });

  it('should fall back to code default when KV read fails', async () => {
    const failingKV = {
      get: async () => { throw new Error('KV unavailable'); },
    } as unknown as KVNamespace;
    const env = { POSTED_JOBS: failingKV } as unknown as Env;

    const config = await getPromptConfig('eoi', env);
    expect(config.includeHowToApply).toBe(true);
    expect(config.sourceHint).toContain('EOI');
  });

  it('should return default for undefined source even with KV data', async () => {
    const env = makeEnv({ 'config:ai-prompts': { qtb: { sourceHint: 'test' } } });
    const config = await getPromptConfig(undefined, env);
    expect(config.includeHowToApply).toBe(false);
  });
});

describe('summarizeJob prompt assembly', () => {
  it('should NOT include apply template for yemenhr source', async () => {
    const { env, capturedPrompts } = makeCapturingEnv();
    await summarizeJob(makeJob({ source: 'yemenhr' }), env);

    expect(capturedPrompts[0]).not.toContain('📧 كيفية التقديم:');
    expect(capturedPrompts[0]).toContain('DO NOT include any how-to-apply section');
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

  it('should use higher description limit for no-apply sources', async () => {
    const { env, capturedPrompts } = makeCapturingEnv();
    await summarizeJob(makeJob({ source: 'yemenhr' }), env);
    expect(capturedPrompts[0]).toContain('MAXIMUM 350 characters');
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

  it('should use KV-overridden hint in prompt', async () => {
    const { env, capturedPrompts } = makeCapturingEnv({
      'config:ai-prompts': {
        qtb: { sourceHint: 'CUSTOM KV HINT' },
      },
    });
    await summarizeJob(makeJob({ source: 'qtb' }), env);
    expect(capturedPrompts[0]).toContain('CUSTOM KV HINT');
  });
});
