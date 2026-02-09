/**
 * Tests for YK Bank (Zoho Recruit) job processor.
 */

import { describe, it, expect } from 'vitest';
import { processYKBankJob, deduplicateLocation } from '../src/services/sources/ykbank/processor';
import type { JobItem } from '../src/types';

// Real Zoho RSS description (simplified from actual feed)
const ZOHO_DESCRIPTION = `Category: Banking <br><br>Location: Sana&#x27;a Sana&#x27;a Yemen <br><br><br><span id="spandesc"><p>Are you an experienced AI Engineer passionate about productionizing ML solutions?</p><h3>Responsibilities</h3><ul><li><span>Work with peers to identify use cases for Gen AI.</span></li><li><span>Drive NLP and computer vision implementation.</span></li></ul></span><br /><span id="spanreq"><h3>Requirements</h3><ul><li><span><b>Education:</b> Bachelor's in CS or related field</span></li><li><span><b>Experience:</b> At least 1 year LLM-based apps</span></li></ul></span><br /><span id="spanben"><h3>Benefits</h3><div>Why Explore a Career at YKB Data AI</div></span><br><br><a href='https://yk-bank.zohorecruit.com/jobs/Careers/796159000000522029/AI-Engineer-LLM-ML?source=RSS'>Details</a>`;

function makeJob(overrides: Partial<JobItem> = {}): JobItem {
  return {
    id: 'ykbank-796159000000522029',
    title: 'AI Engineer &#x28;LLM &amp; ML&#x29;',
    company: 'Unknown Company',
    link: 'https://yk-bank.zohorecruit.com/jobs/Careers/796159000000522029/AI-Engineer-LLM-ML?source=RSS',
    pubDate: 'Thu, 26 Dec 2024 12:00:00 PST',
    imageUrl: null,
    description: ZOHO_DESCRIPTION,
    source: 'ykbank',
    ...overrides,
  };
}

describe('processYKBankJob', () => {
  it('should decode HTML entities in title', () => {
    const result = processYKBankJob(makeJob());
    expect(result.title).toBe('AI Engineer (LLM & ML)');
  });

  it('should set company to Yemen Kuwait Bank', () => {
    const result = processYKBankJob(makeJob());
    expect(result.company).toBe('Yemen Kuwait Bank');
  });

  it('should extract and deduplicate location', () => {
    const result = processYKBankJob(makeJob());
    // "Sana'a Sana'a Yemen" → "Sana'a, Yemen"
    expect(result.location).toBe("Sana'a, Yemen");
  });

  it('should extract category', () => {
    const result = processYKBankJob(makeJob());
    expect(result.category).toBe('Banking');
  });

  it('should use pubDate from RSS item', () => {
    const result = processYKBankJob(makeJob());
    expect(result.postedDate).toBe('Thu, 26 Dec 2024 12:00:00 PST');
  });

  it('should extract description from spandesc span', () => {
    const result = processYKBankJob(makeJob());
    expect(result.description).toContain('AI Engineer passionate about');
    expect(result.description).toContain('Responsibilities');
  });

  it('should extract requirements from spanreq span', () => {
    const result = processYKBankJob(makeJob());
    expect(result.description).toContain('Requirements');
    expect(result.description).toContain("Bachelor's in CS");
  });

  it('should NOT include benefits section', () => {
    const result = processYKBankJob(makeJob());
    expect(result.description).not.toContain('Why Explore a Career');
  });

  it('should set source to ykbank', () => {
    const result = processYKBankJob(makeJob());
    expect(result.source).toBe('ykbank');
  });

  it('should preserve job link', () => {
    const result = processYKBankJob(makeJob());
    expect(result.link).toContain('zohorecruit.com');
  });

  it('should handle missing description', () => {
    const result = processYKBankJob(makeJob({ description: '' }));
    expect(result.description).toBe('No description available');
  });

  it('should handle description without spans (fallback)', () => {
    const result = processYKBankJob(makeJob({
      description: 'Category: IT <br><br>Location: Aden Aden Yemen <br><br>Simple job text without spans',
    }));
    expect(result.description).toContain('Simple job text');
    expect(result.category).toBe('IT');
    expect(result.location).toBe('Aden, Yemen');
  });

  it('should handle missing pubDate', () => {
    const result = processYKBankJob(makeJob({ pubDate: '' }));
    expect(result.postedDate).toBeUndefined();
  });
});

describe('deduplicateLocation', () => {
  it('should deduplicate identical adjacent words', () => {
    expect(deduplicateLocation("Sana'a Sana'a Yemen")).toBe("Sana'a, Yemen");
  });

  it('should keep different adjacent words', () => {
    expect(deduplicateLocation('Aden Lahij Yemen')).toBe('Aden, Lahij, Yemen');
  });

  it('should handle single word', () => {
    expect(deduplicateLocation('Yemen')).toBe('Yemen');
  });

  it('should be case-insensitive for dedup', () => {
    expect(deduplicateLocation('sana SANA Yemen')).toBe('sana, Yemen');
  });
});
