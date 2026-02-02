/**
 * Basic tests for Yemen HR Worker.
 * Run with: npm test
 */

import { describe, it, expect } from 'vitest';
import { cleanJobDescription } from '../src/services/cleaner';
import { formatTelegramMessage } from '../src/utils/format';

describe('cleanJobDescription', () => {
  it('should remove HTML tags from job content', () => {
    const html = 'Job Description <div>Hello <strong>World</strong></div>';
    const result = cleanJobDescription(html);
    expect(result.description).not.toContain('<div>');
    expect(result.description).not.toContain('<strong>');
    expect(result.description).toContain('Hello');
    expect(result.description).toContain('World');
  });

  it('should decode HTML entities in job content', () => {
    const html = 'Job Description Hello &amp; World &quot;test&quot;';
    const result = cleanJobDescription(html);
    expect(result.description).toContain('Hello & World "test"');
  });

  it('should remove unwanted sections', () => {
    const html = 'Job Description details here Important Notes some notes to remove';
    const result = cleanJobDescription(html);
    expect(result.description).not.toContain('Important Notes');
    expect(result.description).not.toContain('some notes to remove');
  });

  it('should convert br tags to newlines in job content', () => {
    const html = 'Job Description Line 1<br>Line 2<br/>Line 3';
    const result = cleanJobDescription(html);
    expect(result.description).toContain('\n');
  });

  it('should return fallback for empty input', () => {
    const result = cleanJobDescription('');
    expect(result.description).toBe('No description available');
  });

  it('should return fallback when no job content markers found', () => {
    const html = 'Random content without job markers';
    const result = cleanJobDescription(html);
    expect(result.description).toBe('No description available');
  });

  it('should extract content starting from job markers', () => {
    const html = 'Header stuff Vacancy id: 12345 This is the actual job content';
    const result = cleanJobDescription(html);
    expect(result.description).toContain('Vacancy id');
    expect(result.description).toContain('12345');
  });

  it('should extract location from content', () => {
    const html = 'Job Description Location: Aden, Yemen\nSome other content';
    const result = cleanJobDescription(html);
    expect(result.location).toBe('Aden, Yemen');
  });

  it('should extract deadline from content', () => {
    const html = 'Job Description Deadline: 15 Feb, 2026\nSome other content';
    const result = cleanJobDescription(html);
    expect(result.deadline).toBe('15 Feb, 2026');
  });
});

describe('formatTelegramMessage', () => {
  it('should add footer with job link', () => {
    const result = formatTelegramMessage(
      'Test summary',
      'https://yemenhr.com/jobs/test',
      null
    );
    expect(result.fullMessage).toContain('https://yemenhr.com/jobs/test');
    expect(result.fullMessage).toContain('رابط الوظيفة:');
  });

  it('should detect valid image URL', () => {
    const result = formatTelegramMessage(
      'Test summary',
      'https://yemenhr.com/jobs/test',
      'https://yemenhr.com/images/logo.png'
    );
    expect(result.hasImage).toBe(true);
    expect(result.imageUrl).toBe('https://yemenhr.com/images/logo.png');
  });

  it('should reject invalid image URL', () => {
    const result = formatTelegramMessage(
      'Test summary',
      'https://yemenhr.com/jobs/test',
      '/relative/path.png'
    );
    expect(result.hasImage).toBe(false);
    expect(result.imageUrl).toBeNull();
  });

  it('should clean markdown from summary', () => {
    const result = formatTelegramMessage(
      'Test **bold** and _italic_',
      'https://yemenhr.com/jobs/test',
      null
    );
    expect(result.fullMessage).not.toContain('**');
    expect(result.fullMessage).toContain('Test bold and italic');
  });
});
