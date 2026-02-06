/**
 * Tests for plugin architecture (registry, plugins).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getAllSources, getSource } from '../src/services/sources/registry';
import { RSSPlugin } from '../src/services/sources/rss-shared/plugin';
import { EOIPlugin } from '../src/services/sources/eoi';
import { fetchYemenHRJobs } from '../src/services/sources/yemenhr/fetcher';
import { processYemenHRJob } from '../src/services/sources/yemenhr/processor';
import type { JobItem } from '../src/types';

// ============================================================================
// Registry Tests
// ============================================================================

describe('Plugin Registry', () => {
  it('getAllSources should return all registered plugins', () => {
    const sources = getAllSources();
    expect(sources).toHaveLength(2);
    expect(sources.map(s => s.name)).toContain('yemenhr');
    expect(sources.map(s => s.name)).toContain('eoi');
  });

  it('getSource should return correct plugin by name', () => {
    const yemenhr = getSource('yemenhr');
    expect(yemenhr).toBeInstanceOf(RSSPlugin);
    expect(yemenhr.name).toBe('yemenhr');

    const eoi = getSource('eoi');
    expect(eoi).toBeInstanceOf(EOIPlugin);
    expect(eoi.name).toBe('eoi');
  });

  it('getSource should throw for unknown source', () => {
    expect(() => getSource('unknown' as any)).toThrow('Job source plugin not found: unknown');
  });
});

// ============================================================================
// Yemen HR Plugin Tests
// ============================================================================

const SAMPLE_ATOM_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Yemen HR Jobs</title>
  <entry>
    <id>https://yemenhr.com/jobs/test-engineer</id>
    <title>Test Engineer</title>
    <author><name>ACME Corp</name></author>
    <link rel="alternate" type="text/html" href="https://yemenhr.com/jobs/test-engineer"/>
    <link rel="enclosure" type="image/png" href="https://yemenhr.com/images/acme.png"/>
    <published>2026-01-15T10:00:00Z</published>
    <content type="html">&lt;p&gt;Job Description We need a test engineer.&lt;/p&gt;&lt;p&gt;Location: Aden&lt;/p&gt;&lt;p&gt;Deadline: 30 Jan, 2026&lt;/p&gt;</content>
  </entry>
</feed>`;

describe('YemenHRPlugin (via RSSPlugin)', () => {
  const plugin = getSource('yemenhr');

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should have correct name', () => {
    expect(plugin.name).toBe('yemenhr');
  });

  it('fetchJobs should throw without RSS_FEED_URL', async () => {
    await expect(plugin.fetchJobs({} as any)).rejects.toThrow('RSS_FEED_URL not configured');
  });

  it('fetchJobs should delegate to fetchYemenHRJobs', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(SAMPLE_ATOM_FEED, { status: 200 })
    );

    const env = { RSS_FEED_URL: 'https://example.com/feed' } as any;
    const jobs = await plugin.fetchJobs(env);

    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe('test-engineer');
    expect(jobs[0].title).toBe('Test Engineer');
    expect(jobs[0].source).toBe('yemenhr');
  });

  it('processJob should clean HTML and extract metadata', async () => {
    const job: JobItem = {
      id: 'test-engineer',
      title: 'Test Engineer',
      company: 'ACME Corp',
      link: 'https://yemenhr.com/jobs/test-engineer',
      pubDate: '2026-01-15T10:00:00Z',
      imageUrl: 'https://yemenhr.com/images/acme.png',
      description: '<p>Job Description We need a test engineer.</p><p>Location: Aden</p><p>Deadline: 30 Jan, 2026</p>',
      source: 'yemenhr',
    };

    const processed = await plugin.processJob(job);

    expect(processed.title).toBe('Test Engineer');
    expect(processed.company).toBe('ACME Corp');
    expect(processed.source).toBe('yemenhr');
    expect(processed.location).toBe('Aden');
    expect(processed.deadline).toBe('30 Jan, 2026');
    expect(processed.description).toContain('test engineer');
  });
});

// ============================================================================
// Yemen HR Fetcher Tests (via plugin sources)
// ============================================================================

describe('fetchYemenHRJobs', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should set source to yemenhr on all jobs', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(SAMPLE_ATOM_FEED, { status: 200 })
    );

    const jobs = await fetchYemenHRJobs('https://example.com/feed');
    expect(jobs.every(j => j.source === 'yemenhr')).toBe(true);
  });
});

// ============================================================================
// Yemen HR Processor Tests
// ============================================================================

describe('processYemenHRJob', () => {
  it('should extract location from HTML', () => {
    const job: JobItem = {
      id: 'test',
      title: 'Test',
      company: 'Co',
      link: 'https://yemenhr.com/jobs/test',
      pubDate: '',
      imageUrl: null,
      description: 'Job Description Location: Sana\'a City\nMore info here',
    };
    const result = processYemenHRJob(job);
    expect(result.location).toBe('Sana\'a City');
    expect(result.source).toBe('yemenhr');
  });

  it('should handle empty description', () => {
    const job: JobItem = {
      id: 'test',
      title: 'Test',
      company: 'Co',
      link: 'https://yemenhr.com/jobs/test',
      pubDate: '',
      imageUrl: null,
      description: '',
    };
    const result = processYemenHRJob(job);
    expect(result.description).toBe('No description available');
  });
});

// ============================================================================
// EOI Plugin Tests
// ============================================================================

const SAMPLE_EOI_API_RESPONSE = JSON.stringify({
  table_data: `<a href="https://eoi-ye.com/jobs/12345/">
    <div class="job-content wow fadeInUpBig">
        <div class="data col-md-1 hidden-sm hidden-xs">
            01-02-2026 </div>
        <div class="data col-md-3">
                            <div>Data Analyst</div>
        </div>
        <div class="data col-md-2">
            <div class="jop-head hidden-lg hidden-md ">فئة:</div>
             تقنية معلومات</div>
        <div class="data col-md-2">
            <div class="jop-head hidden-lg hidden-md ">بواسطة :</div>
             UNICEF</div>
        <div class="data col-md-2">
            <div class="jop-head hidden-lg hidden-md ">المحافظة :</div>
             صنعاء
   </div>
        <div class="data col-md-2">
            <div class="jop-head hidden-lg hidden-md ">الموعد الاخير :</div>
            15-02-2026
                    </div></div>
</a>`,
  total_data: 1,
});

describe('EOIPlugin', () => {
  const plugin = new EOIPlugin();

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should have correct name', () => {
    expect(plugin.name).toBe('eoi');
  });

  it('fetchJobs should return JobItem array from API', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(SAMPLE_EOI_API_RESPONSE, { status: 200 })
    );

    const jobs = await plugin.fetchJobs();

    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe('eoi-12345');
    expect(jobs[0].title).toBe('Data Analyst');
    expect(jobs[0].company).toBe('UNICEF');
    expect(jobs[0].source).toBe('eoi');
  });

  it('processJob should handle missing detail page', async () => {
    // Simulate failed detail page fetch
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('Not Found', { status: 404 })
    );

    const job: JobItem = {
      id: 'eoi-12345',
      title: 'Data Analyst',
      company: 'UNICEF',
      link: 'https://eoi-ye.com/jobs/12345/',
      pubDate: '2026-02-01T00:00:00.000Z',
      imageUrl: null,
      description: 'الفئة: تقنية معلومات\nالموقع: صنعاء',
      source: 'eoi',
    };

    const processed = await plugin.processJob(job);

    expect(processed.title).toBe('Data Analyst');
    expect(processed.company).toBe('UNICEF');
    expect(processed.source).toBe('eoi');
    expect(processed.description).toBeDefined();
  });

  it('processJob should return fallback description when detail page is expired', async () => {
    // Simulate expired page
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('<html><body>هذا الإعلان منتهي</body></html>', { status: 200 })
    );

    const job: JobItem = {
      id: 'eoi-12345',
      title: 'Data Analyst',
      company: 'UNICEF',
      link: 'https://eoi-ye.com/jobs/12345/',
      pubDate: '2026-02-01T00:00:00.000Z',
      imageUrl: null,
      description: 'الفئة: تقنية معلومات\nالموقع: صنعاء\nتاريخ النشر: 01-02-2026',
      source: 'eoi',
    };

    const processed = await plugin.processJob(job);

    // Fallback path: no detail page available, uses basic metadata
    expect(processed.source).toBe('eoi');
    expect(processed.description).toBeDefined();
  });

  it('processJob should extract metadata when detail page is available', async () => {
    const detailHtml = `
    <html><body>
    <img src="https://eoi-ye.com/storage/users/logo.png" alt="Logo">
    <div class="detail-adv">
    <p>We are hiring a Data Analyst for our Sana'a office.</p>
    </div>
    <span class="end_date">الموعد الاخير : 15-02-2026 </span><span> الوقت: 23:59</span>
    </body></html>`;

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(detailHtml, { status: 200 })
    );

    const job: JobItem = {
      id: 'eoi-12345',
      title: 'Data Analyst',
      company: 'UNICEF',
      link: 'https://eoi-ye.com/jobs/12345/',
      pubDate: '2026-02-01T00:00:00.000Z',
      imageUrl: null,
      description: 'الفئة: تقنية معلومات\nالموقع: صنعاء\nتاريخ النشر: 01-02-2026',
      source: 'eoi',
    };

    const processed = await plugin.processJob(job);

    expect(processed.location).toBe('صنعاء');
    expect(processed.category).toBe('تقنية معلومات');
    expect(processed.imageUrl).toBe('https://eoi-ye.com/storage/users/logo.png');
    expect(processed.deadline).toContain('15-02-2026');
  });
});
