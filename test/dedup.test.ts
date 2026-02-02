/**
 * Tests for cross-source deduplication logic.
 * Run with: npm test
 */

import { describe, it, expect } from 'vitest';
import { normalize, normalizeJobKey, areJobsDuplicates } from '../src/services/dedup';

describe('normalize', () => {
  it('should lowercase strings', () => {
    expect(normalize('Hello World')).toBe('hello world');
  });

  it('should remove punctuation', () => {
    expect(normalize('Hello, World!')).toBe('hello world');
  });

  it('should collapse whitespace', () => {
    expect(normalize('Hello   World')).toBe('hello world');
  });

  it('should trim whitespace', () => {
    expect(normalize('  Hello World  ')).toBe('hello world');
  });

  it('should preserve Arabic characters', () => {
    expect(normalize('مهندس برمجيات')).toBe('مهندس برمجيات');
  });

  it('should handle mixed English and Arabic', () => {
    expect(normalize('Software مهندس')).toBe('software مهندس');
  });
});

describe('normalizeJobKey', () => {
  it('should create consistent key from title and company', () => {
    const key = normalizeJobKey('Software Engineer', 'Tech Corp');
    expect(key).toBe('dedup:software engineer:tech corp');
  });

  it('should normalize both title and company', () => {
    const key1 = normalizeJobKey('Social Worker', 'MSF');
    const key2 = normalizeJobKey('  social worker  ', '  msf  ');
    expect(key1).toBe(key2);
  });

  it('should ignore punctuation differences', () => {
    const key1 = normalizeJobKey('Social Worker!', 'MSF, Inc.');
    const key2 = normalizeJobKey('Social Worker', 'MSF Inc');
    expect(key1).toBe(key2);
  });
});

describe('areJobsDuplicates', () => {
  it('should detect identical jobs as duplicates', () => {
    const job1 = { title: 'Software Engineer', company: 'Tech Corp' };
    const job2 = { title: 'Software Engineer', company: 'Tech Corp' };
    expect(areJobsDuplicates(job1, job2)).toBe(true);
  });

  it('should detect jobs with different casing as duplicates', () => {
    const job1 = { title: 'Software Engineer', company: 'Tech Corp' };
    const job2 = { title: 'SOFTWARE ENGINEER', company: 'TECH CORP' };
    expect(areJobsDuplicates(job1, job2)).toBe(true);
  });

  it('should detect jobs with whitespace differences as duplicates', () => {
    const job1 = { title: 'Social Worker', company: 'MSF' };
    const job2 = { title: '  Social  Worker  ', company: '  MSF  ' };
    expect(areJobsDuplicates(job1, job2)).toBe(true);
  });

  it('should not detect different jobs as duplicates', () => {
    const job1 = { title: 'Software Engineer', company: 'Tech Corp' };
    const job2 = { title: 'Data Scientist', company: 'Tech Corp' };
    expect(areJobsDuplicates(job1, job2)).toBe(false);
  });

  it('should not detect same title different company as duplicates', () => {
    const job1 = { title: 'Software Engineer', company: 'Company A' };
    const job2 = { title: 'Software Engineer', company: 'Company B' };
    expect(areJobsDuplicates(job1, job2)).toBe(false);
  });
});
