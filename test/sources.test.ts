/**
 * Tests for plugin architecture (registry, plugins).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getAllSources, getSource } from '../src/services/sources/registry';
import { RSSPlugin } from '../src/services/sources/rss-shared/plugin';
import { ScraperPlugin } from '../src/services/sources/scraper-shared/plugin';
import { fetchAndParseRSSFeed } from '../src/services/sources/rss-shared/rss-parser';
import { processYemenHRJob } from '../src/services/sources/yemenhr/processor';
import { processReliefWebJob } from '../src/services/sources/reliefweb/processor';
import { reliefwebConfig } from '../src/services/sources/rss-shared/configs';
import type { JobItem } from '../src/types';

// ============================================================================
// Registry Tests
// ============================================================================

describe('Plugin Registry', () => {
  it('getAllSources should return all registered (active) plugins', () => {
    const sources = getAllSources();
    expect(sources).toHaveLength(5); // ykbank + kuraimi removed
    const names = sources.map(s => s.name);
    expect(names).toContain('yemenhr');
    expect(names).toContain('eoi');
    expect(names).toContain('reliefweb');
    expect(names).toContain('qtb');
    expect(names).toContain('yldf');
  });

  it('getSource should return correct plugin by name', () => {
    const yemenhr = getSource('yemenhr');
    expect(yemenhr).toBeInstanceOf(ScraperPlugin);
    expect(yemenhr.name).toBe('yemenhr');

    const eoi = getSource('eoi');
    expect(eoi).toBeInstanceOf(ScraperPlugin);
    expect(eoi.name).toBe('eoi');

    const reliefweb = getSource('reliefweb');
    expect(reliefweb).toBeInstanceOf(RSSPlugin);
    expect(reliefweb.name).toBe('reliefweb');
  });

  it('getSource should throw for unknown source', () => {
    expect(() => getSource('unknown' as any)).toThrow('Job source plugin not found: unknown');
  });
});

// ============================================================================
// Yemen HR Plugin Tests (via ScraperPlugin)
// ============================================================================

const SAMPLE_YEMENHR_HTML = `
<html><body>
<table>
<tbody>
  <tr class="hover:bg-blue-50/50">
    <td>08 Feb, 26</td>
    <td>
      <img src="/storage/logos/ACTED.jpg" alt="ACTED">
      <a href="#" class="hover:text-yemenhr-yellow">ACTED</a>
    </td>
    <td>
      <a href="https://yemenhr.com/jobs/project-manager-acted-sanaa-14c38515" class="text-gray-700">
        Project Manager
      </a>
    </td>
    <td>
      <a href="#">Sana'a</a>
    </td>
    <td>22 Feb, 26</td>
  </tr>
</tbody>
</table>
</body></html>`;

describe('YemenHRPlugin (via ScraperPlugin)', () => {
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

  it('fetchJobs should parse HTML table into JobItems', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(SAMPLE_YEMENHR_HTML, { status: 200 })
    );

    const jobs = await plugin.fetchJobs();

    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe('project-manager-acted-sanaa-14c38515');
    expect(jobs[0].title).toBe('Project Manager');
    expect(jobs[0].company).toBe('ACTED');
    expect(jobs[0].link).toBe('https://yemenhr.com/jobs/project-manager-acted-sanaa-14c38515');
    expect(jobs[0].imageUrl).toBe('https://yemenhr.com/storage/logos/ACTED.jpg');
    expect(jobs[0].source).toBe('yemenhr');
    // Listing metadata should include postedDate and deadline
    expect(jobs[0].description).toContain('PostedDate: 08 Feb, 26');
    expect(jobs[0].description).toContain('Deadline: 22 Feb, 26');
  });

  it('fetchJobs should throw on HTTP error', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('Server Error', { status: 500, statusText: 'Internal Server Error' })
    );

    await expect(plugin.fetchJobs()).rejects.toThrow('Scraper fetch failed');
  });

  it('processJob should fetch detail page and extract description', async () => {
    const detailHtml = `<html><body>
      <div class="job-description-container">
        <p>We need a Project Manager with 5 years experience.</p>
      </div>
    </body></html>`;

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(detailHtml, { status: 200 })
    );

    const job: JobItem = {
      id: 'project-manager-acted-sanaa-14c38515',
      title: 'Project Manager',
      company: 'ACTED',
      link: 'https://yemenhr.com/jobs/project-manager-acted-sanaa-14c38515',
      pubDate: '',
      imageUrl: 'https://yemenhr.com/storage/logos/ACTED.jpg',
      description: "Location: Sana'a\nPostedDate: 08 Feb, 26\nDeadline: 22 Feb, 26",
      source: 'yemenhr',
    };

    const processed = await plugin.processJob(job);

    expect(processed.title).toBe('Project Manager');
    expect(processed.company).toBe('ACTED');
    expect(processed.source).toBe('yemenhr');
    expect(processed.description).toContain('Project Manager');
    expect(processed.imageUrl).toBe('https://yemenhr.com/storage/logos/ACTED.jpg');
    expect(processed.postedDate).toBe('08 Feb, 26');
    expect(processed.deadline).toBe('22 Feb, 26');
  });

  it('processJob should fallback to listing metadata when detail page fails', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('Not Found', { status: 404 })
    );

    const job: JobItem = {
      id: 'test-job',
      title: 'Test Engineer',
      company: 'Test Co',
      link: 'https://yemenhr.com/jobs/test-job',
      pubDate: '',
      imageUrl: null,
      description: 'Location: Aden\nPostedDate: 01 Feb, 26\nDeadline: 30 Jan, 2026',
      source: 'yemenhr',
    };

    const processed = await plugin.processJob(job);

    expect(processed.location).toBe('Aden');
    expect(processed.postedDate).toBe('01 Feb, 26');
    expect(processed.deadline).toBe('30 Jan, 2026');
  });
});

// ============================================================================
// Yemen HR Fetcher Tests (via shared RSS parser — legacy tests still valid)
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

describe('fetchAndParseRSSFeed (Yemen HR Atom)', () => {
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

    const idExtractor = (link: string) => {
      const match = link.match(/\/jobs\/([^/?#]+)/);
      return match ? match[1] : link;
    };
    const jobs = await fetchAndParseRSSFeed('https://example.com/feed', 'yemenhr', 'https://yemenhr.com', idExtractor);
    expect(jobs.every(j => j.source === 'yemenhr')).toBe(true);
  });
});

// ============================================================================
// Yemen HR Processor Tests (legacy processor still works)
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
// ReliefWeb Plugin Tests
// ============================================================================

const SAMPLE_RSS_FEED = `<?xml version="1.0" encoding="utf-8"?>
<rss xmlns:atom="http://www.w3.org/2005/Atom" version="2.0">
  <channel>
    <title>ReliefWeb - Yemen Jobs</title>
    <item>
      <title>Humanitarian Adviser Yemen</title>
      <link>https://reliefweb.int/job/4197376/humanitarian-adviser-yemen</link>
      <guid isPermaLink="true">https://reliefweb.int/job/4197376/humanitarian-adviser-yemen</guid>
      <pubDate>Thu, 05 Feb 2026 19:42:44 +0000</pubDate>
      <description>&lt;div class="tag country"&gt;Country: Yemen&lt;/div&gt;&lt;div class="tag source"&gt;Organization: Norwegian Refugee Council&lt;/div&gt;&lt;div class="date closing"&gt;Closing date: 20 Feb 2026&lt;/div&gt;&lt;p&gt;We are looking for a Humanitarian Adviser.&lt;/p&gt;&lt;h2&gt;How to apply&lt;/h2&gt;&lt;p&gt;Apply &lt;a href="https://example.com/apply/20107"&gt;here&lt;/a&gt;&lt;/p&gt;</description>
      <category>Yemen</category>
      <category>Norwegian Refugee Council</category>
      <category>Program/Project Management</category>
      <author>Norwegian Refugee Council</author>
    </item>
  </channel>
</rss>`;

describe('ReliefWebPlugin (via RSSPlugin)', () => {
  const plugin = new RSSPlugin(reliefwebConfig);

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should have correct name', () => {
    expect(plugin.name).toBe('reliefweb');
  });

  it('fetchJobs should parse RSS 2.0 feed', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(SAMPLE_RSS_FEED, { status: 200 })
    );

    const jobs = await plugin.fetchJobs();

    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe('rw-4197376');
    expect(jobs[0].title).toBe('Humanitarian Adviser Yemen');
    expect(jobs[0].company).toBe('Norwegian Refugee Council');
    expect(jobs[0].link).toBe('https://reliefweb.int/job/4197376/humanitarian-adviser-yemen');
    expect(jobs[0].source).toBe('reliefweb');
    expect(jobs[0].pubDate).toBe('Thu, 05 Feb 2026 19:42:44 +0000');
  });

  it('fetchJobs should not require env vars', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(SAMPLE_RSS_FEED, { status: 200 })
    );

    // ReliefWeb feed URL is hardcoded, no env vars needed
    const jobs = await plugin.fetchJobs();
    expect(jobs).toHaveLength(1);
  });

  it('processJob should extract metadata from description HTML', async () => {
    const job: JobItem = {
      id: 'rw-4197376',
      title: 'Humanitarian Adviser Yemen',
      company: 'Norwegian Refugee Council',
      link: 'https://reliefweb.int/job/4197376/humanitarian-adviser-yemen',
      pubDate: 'Thu, 05 Feb 2026 19:42:44 +0000',
      imageUrl: null,
      description: '<div class="tag country">Country: Yemen</div><div class="tag source">Organization: Norwegian Refugee Council</div><div class="date closing">Closing date: 20 Feb 2026</div><p>We are looking for a Humanitarian Adviser.</p><h2>How to apply</h2><p>Apply <a href="https://example.com/apply/20107">here</a></p>',
      source: 'reliefweb',
    };

    const processed = await plugin.processJob(job);

    expect(processed.title).toBe('Humanitarian Adviser Yemen');
    expect(processed.company).toBe('Norwegian Refugee Council');
    expect(processed.source).toBe('reliefweb');
    expect(processed.location).toBe('Yemen');
    expect(processed.deadline).toBe('20 Feb 2026');
    expect(processed.description).toContain('Humanitarian Adviser');
    expect(processed.howToApply).toBeDefined();
    expect(processed.applicationLinks).toContain('https://example.com/apply/20107');
  });
});

// ============================================================================
// ReliefWeb Processor Tests
// ============================================================================

describe('processReliefWebJob', () => {
  it('should extract organization from tag div', () => {
    const job: JobItem = {
      id: 'rw-123',
      title: 'Test Job',
      company: 'Fallback Org',
      link: 'https://reliefweb.int/job/123/test',
      pubDate: '',
      imageUrl: null,
      description: '<div class="tag source">Organization: UNICEF</div><p>Job details here.</p>',
      source: 'reliefweb',
    };

    const result = processReliefWebJob(job);
    expect(result.company).toBe('UNICEF');
  });

  it('should fall back to job.company when no organization tag', () => {
    const job: JobItem = {
      id: 'rw-123',
      title: 'Test Job',
      company: 'Fallback Org',
      link: 'https://reliefweb.int/job/123/test',
      pubDate: '',
      imageUrl: null,
      description: '<p>Job details without tags.</p>',
      source: 'reliefweb',
    };

    const result = processReliefWebJob(job);
    expect(result.company).toBe('Fallback Org');
  });

  it('should extract closing date', () => {
    const job: JobItem = {
      id: 'rw-123',
      title: 'Test Job',
      company: 'Org',
      link: 'https://reliefweb.int/job/123/test',
      pubDate: '',
      imageUrl: null,
      description: '<div class="date closing">Closing date: 15 Mar 2026</div><p>Details</p>',
      source: 'reliefweb',
    };

    const result = processReliefWebJob(job);
    expect(result.deadline).toBe('15 Mar 2026');
  });

  it('should extract country as location', () => {
    const job: JobItem = {
      id: 'rw-123',
      title: 'Test Job',
      company: 'Org',
      link: 'https://reliefweb.int/job/123/test',
      pubDate: '',
      imageUrl: null,
      description: '<div class="tag country">Country: Yemen</div><p>Details</p>',
      source: 'reliefweb',
    };

    const result = processReliefWebJob(job);
    expect(result.location).toBe('Yemen');
  });

  it('should extract how-to-apply section and application links', () => {
    const job: JobItem = {
      id: 'rw-123',
      title: 'Test Job',
      company: 'Org',
      link: 'https://reliefweb.int/job/123/test',
      pubDate: '',
      imageUrl: null,
      description: '<p>Job description here.</p><h2>How to apply</h2><p>Apply at <a href="https://careers.org/apply/456">this link</a> or email jobs@org.com</p>',
      source: 'reliefweb',
    };

    const result = processReliefWebJob(job);
    expect(result.howToApply).toContain('Apply at');
    expect(result.applicationLinks).toContain('https://careers.org/apply/456');
    expect(result.applicationLinks).toContain('jobs@org.com');
  });

  it('should handle description without how-to-apply section', () => {
    const job: JobItem = {
      id: 'rw-123',
      title: 'Test Job',
      company: 'Org',
      link: 'https://reliefweb.int/job/123/test',
      pubDate: '',
      imageUrl: null,
      description: '<p>Just a simple job description.</p>',
      source: 'reliefweb',
    };

    const result = processReliefWebJob(job);
    expect(result.howToApply).toBeUndefined();
    expect(result.applicationLinks).toBeUndefined();
  });

  it('should handle empty description', () => {
    const job: JobItem = {
      id: 'rw-123',
      title: 'Test Job',
      company: 'Org',
      link: 'https://reliefweb.int/job/123/test',
      pubDate: '',
      imageUrl: null,
      description: '',
      source: 'reliefweb',
    };

    const result = processReliefWebJob(job);
    expect(result.description).toBe('No description available');
    expect(result.source).toBe('reliefweb');
  });

  it('should clean HTML and remove metadata divs from description', () => {
    const job: JobItem = {
      id: 'rw-123',
      title: 'Test Job',
      company: 'Org',
      link: 'https://reliefweb.int/job/123/test',
      pubDate: '',
      imageUrl: null,
      description: '<div class="tag country">Country: Yemen</div><div class="tag source">Organization: UNICEF</div><div class="date closing">Closing date: 20 Feb 2026</div><p>We need a <strong>senior analyst</strong>.</p><ul><li>Experience required</li><li>Good communication</li></ul>',
      source: 'reliefweb',
    };

    const result = processReliefWebJob(job);
    // Metadata divs should be removed from description text
    expect(result.description).not.toContain('Country: Yemen');
    expect(result.description).not.toContain('Organization: UNICEF');
    expect(result.description).not.toContain('Closing date:');
    // Job content should remain
    expect(result.description).toContain('senior analyst');
    expect(result.description).toContain('Experience required');
  });
});

// ============================================================================
// EOI Plugin Tests (via ScraperPlugin with responseExtractor)
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

describe('EOIPlugin (via ScraperPlugin)', () => {
  const plugin = getSource('eoi');

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should have correct name', () => {
    expect(plugin.name).toBe('eoi');
  });

  it('fetchJobs should return JobItem array from API via responseExtractor', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(SAMPLE_EOI_API_RESPONSE, { status: 200 })
    );

    const jobs = await plugin.fetchJobs();

    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe('eoi-12345');
    expect(jobs[0].title).toBe('Data Analyst');
    expect(jobs[0].company).toBe('UNICEF');
    expect(jobs[0].link).toBe('https://eoi-ye.com/jobs/12345/');
    expect(jobs[0].source).toBe('eoi');
  });

  it('processJob should handle missing detail page', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('Not Found', { status: 404 })
    );

    const job: JobItem = {
      id: 'eoi-12345',
      title: 'Data Analyst',
      company: 'UNICEF',
      link: 'https://eoi-ye.com/jobs/12345/',
      pubDate: '',
      imageUrl: null,
      description: 'Location: صنعاء\nDeadline: 15-02-2026\nCategory: تقنية معلومات',
      source: 'eoi',
    };

    const processed = await plugin.processJob(job);

    expect(processed.title).toBe('Data Analyst');
    expect(processed.company).toBe('UNICEF');
    expect(processed.source).toBe('eoi');
    expect(processed.location).toBe('صنعاء');
    expect(processed.deadline).toBe('15-02-2026');
    expect(processed.category).toBe('تقنية معلومات');
  });

  it('processJob should extract description from detail page', async () => {
    const detailHtml = `
    <html><body>
    <img class="img-responsive thumbnail" src="https://eoi-ye.com/storage/users/logo.png" alt="Logo">
    <div class="detail-adv">
      <p>We are hiring a Data Analyst for our Sana'a office.</p>
      <p>Requirements: 3 years experience in data analysis.</p>
    </div>
    </body></html>`;

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(detailHtml, { status: 200 })
    );

    const job: JobItem = {
      id: 'eoi-12345',
      title: 'Data Analyst',
      company: 'UNICEF',
      link: 'https://eoi-ye.com/jobs/12345/',
      pubDate: '',
      imageUrl: null,
      description: 'Location: صنعاء\nDeadline: 15-02-2026',
      source: 'eoi',
    };

    const processed = await plugin.processJob(job);

    expect(processed.description).toContain('Data Analyst');
    expect(processed.description).toContain('3 years experience');
    expect(processed.imageUrl).toBe('https://eoi-ye.com/storage/users/logo.png');
  });
});
