/**
 * Tests for AI service (gemini.ts).
 * Tests buildJobHeader, buildNoAIFallback, and extractAIText behavior.
 */

import { describe, it, expect } from 'vitest';
import { buildJobHeader, buildNoAIFallback } from '../src/services/ai';
import type { ProcessedJob } from '../src/types';

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
    // Three occurrences: location, postedDate, deadline
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
    // Description section should be truncated
    expect(fallback.indexOf('A'.repeat(600))).toBe(-1); // Not the full 700
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
