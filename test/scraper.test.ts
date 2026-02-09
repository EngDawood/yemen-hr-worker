/**
 * Tests for ScraperPlugin infrastructure and site configs.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ScraperPlugin } from '../src/services/sources/scraper-shared/plugin';
import { fetchAndParseHTMLJobs } from '../src/services/sources/scraper-shared/fetcher';
import { parseHTML, extractText, extractAttr } from '../src/services/sources/scraper-shared/html-parser';
import { kuraimiConfig, qtbConfig, yldfConfig } from '../src/services/sources/scraper-shared/configs';
import type { JobItem } from '../src/types';

// ============================================================================
// HTML Parser Utility Tests
// ============================================================================

describe('html-parser utilities', () => {
  it('parseHTML should return a queryable document', () => {
    const doc = parseHTML('<div class="test"><p>Hello</p></div>');
    const p = doc.querySelector('.test p');
    expect(p).not.toBeNull();
    expect(p!.textContent).toBe('Hello');
  });

  it('extractText should return trimmed text content', () => {
    const doc = parseHTML('<div><h4>  Job Title  </h4></div>');
    expect(extractText(doc, 'h4')).toBe('Job Title');
  });

  it('extractText should return null for missing selector', () => {
    const doc = parseHTML('<div><p>text</p></div>');
    expect(extractText(doc, 'h4')).toBeNull();
  });

  it('extractText should return null for empty text', () => {
    const doc = parseHTML('<div><h4>   </h4></div>');
    expect(extractText(doc, 'h4')).toBeNull();
  });

  it('extractAttr should return attribute value', () => {
    const doc = parseHTML('<div><a href="/jobs/5">link</a></div>');
    expect(extractAttr(doc, 'a', 'href')).toBe('/jobs/5');
  });

  it('extractAttr should resolve relative URLs', () => {
    const doc = parseHTML('<div><a href="/jobs/5">link</a></div>');
    expect(extractAttr(doc, 'a', 'href', 'https://example.com')).toBe('https://example.com/jobs/5');
  });

  it('extractAttr should not modify absolute URLs', () => {
    const doc = parseHTML('<div><a href="https://other.com/jobs/5">link</a></div>');
    expect(extractAttr(doc, 'a', 'href', 'https://example.com')).toBe('https://other.com/jobs/5');
  });

  it('extractAttr should return null for missing selector', () => {
    const doc = parseHTML('<div><p>text</p></div>');
    expect(extractAttr(doc, 'a', 'href')).toBeNull();
  });

  it('extractAttr should return null for missing attribute', () => {
    const doc = parseHTML('<div><a>no href</a></div>');
    expect(extractAttr(doc, 'a', 'href')).toBeNull();
  });
});

// ============================================================================
// Fetcher Tests
// ============================================================================

const SAMPLE_LISTING_HTML = `
<html><body>
<div class="single-job-items">
  <div class="job-tittle">
    <a href="/job/10"><h4>مهندس صيانة</h4></a>
  </div>
</div>
<div class="single-job-items">
  <div class="job-tittle">
    <a href="/job/11"><h4>خدمة عملاء</h4></a>
  </div>
</div>
</body></html>`;

describe('fetchAndParseHTMLJobs', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should parse job cards from HTML', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(SAMPLE_LISTING_HTML, { status: 200 })
    );

    const jobs = await fetchAndParseHTMLJobs(kuraimiConfig);

    expect(jobs).toHaveLength(2);
    expect(jobs[0].id).toBe('kuraimi-10');
    expect(jobs[0].title).toBe('مهندس صيانة');
    expect(jobs[0].link).toBe('https://jobs.kuraimibank.com/job/10');
    expect(jobs[0].company).toBe('بنك الكريمي');
    expect(jobs[0].source).toBe('kuraimi');
  });

  it('should skip cards without title', async () => {
    const html = `<div class="single-job-items">
      <div class="job-tittle"><a href="/job/1"><h4></h4></a></div>
    </div>
    <div class="single-job-items">
      <div class="job-tittle"><a href="/job/2"><h4>Valid Job</h4></a></div>
    </div>`;

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(html, { status: 200 })
    );

    const jobs = await fetchAndParseHTMLJobs(kuraimiConfig);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].title).toBe('Valid Job');
  });

  it('should skip cards without link', async () => {
    const html = `<div class="single-job-items">
      <div class="job-tittle"><h4>No Link Job</h4></div>
    </div>`;

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(html, { status: 200 })
    );

    const jobs = await fetchAndParseHTMLJobs(kuraimiConfig);
    expect(jobs).toHaveLength(0);
  });

  it('should throw on HTTP error', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('Not Found', { status: 404 })
    );

    await expect(fetchAndParseHTMLJobs(kuraimiConfig)).rejects.toThrow('Scraper fetch failed');
  });

  it('should return empty array when no containers match', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('<html><body><p>No jobs here</p></body></html>', { status: 200 })
    );

    const jobs = await fetchAndParseHTMLJobs(kuraimiConfig);
    expect(jobs).toHaveLength(0);
  });
});

// ============================================================================
// ScraperPlugin Tests
// ============================================================================

describe('ScraperPlugin', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should have correct name from config', () => {
    const plugin = new ScraperPlugin(kuraimiConfig);
    expect(plugin.name).toBe('kuraimi');
  });

  it('fetchJobs should delegate to fetchAndParseHTMLJobs', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(SAMPLE_LISTING_HTML, { status: 200 })
    );

    const plugin = new ScraperPlugin(kuraimiConfig);
    const jobs = await plugin.fetchJobs();

    expect(jobs).toHaveLength(2);
    expect(jobs[0].source).toBe('kuraimi');
  });

  it('processJob should fetch detail page when configured', async () => {
    const detailHtml = `<html><body>
      <div class="job-post-details">
        <p>Full job description with requirements and responsibilities.</p>
      </div>
    </body></html>`;

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(detailHtml, { status: 200 })
    );

    const plugin = new ScraperPlugin(kuraimiConfig);
    const job: JobItem = {
      id: 'kuraimi-10',
      title: 'مهندس صيانة',
      company: 'بنك الكريمي',
      link: 'https://jobs.kuraimibank.com/job/10',
      pubDate: '',
      imageUrl: null,
      source: 'kuraimi',
    };

    const processed = await plugin.processJob(job);

    expect(processed.title).toBe('مهندس صيانة');
    expect(processed.company).toBe('بنك الكريمي');
    expect(processed.description).toContain('Full job description');
    expect(processed.source).toBe('kuraimi');
  });

  it('processJob should fall back when detail page fails', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('Not Found', { status: 404 })
    );

    const plugin = new ScraperPlugin(kuraimiConfig);
    const job: JobItem = {
      id: 'kuraimi-10',
      title: 'مهندس صيانة',
      company: 'بنك الكريمي',
      link: 'https://jobs.kuraimibank.com/job/10',
      pubDate: '',
      imageUrl: null,
      description: 'Location: صنعاء',
      source: 'kuraimi',
    };

    const processed = await plugin.processJob(job);

    expect(processed.title).toBe('مهندس صيانة');
    expect(processed.location).toBe('صنعاء');
    expect(processed.source).toBe('kuraimi');
  });

  it('processJob should work without detail page config', async () => {
    const configNoDetail = { ...kuraimiConfig, detailPage: undefined };
    const plugin = new ScraperPlugin(configNoDetail);
    const job: JobItem = {
      id: 'kuraimi-10',
      title: 'Test',
      company: 'Co',
      link: 'https://example.com/job/10',
      pubDate: '',
      imageUrl: null,
      description: 'Location: Aden\nDeadline: 2026-03-01',
      source: 'kuraimi',
    };

    const processed = await plugin.processJob(job);

    expect(processed.location).toBe('Aden');
    expect(processed.deadline).toBe('2026-03-01');
    expect(processed.description).toContain('Location: Aden');
  });

  it('processJob should apply cleanup selectors on detail page', async () => {
    const detailHtml = `<html><body>
      <nav>Navigation</nav>
      <div class="container">
        <h1>Job Title</h1>
        <p>Real job content here.</p>
      </div>
      <footer>Footer stuff</footer>
      <script>alert('x')</script>
    </body></html>`;

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(detailHtml, { status: 200 })
    );

    const plugin = new ScraperPlugin(qtbConfig);
    const job: JobItem = {
      id: 'qtb-123',
      title: 'خدمة عملاء',
      company: 'بنك القطيبي الإسلامي',
      link: 'https://jobs.qtbbank.com/detals_job?id_job=123',
      pubDate: '',
      imageUrl: null,
      source: 'qtb',
    };

    const processed = await plugin.processJob(job);

    expect(processed.description).toContain('Real job content');
    expect(processed.description).not.toContain('Navigation');
    expect(processed.description).not.toContain('Footer stuff');
  });
});

// ============================================================================
// Kuraimi Config Tests
// ============================================================================

describe('kuraimiConfig', () => {
  it('should extract ID from job URL', () => {
    expect(kuraimiConfig.idExtractor('https://jobs.kuraimibank.com/job/10')).toBe('kuraimi-10');
    expect(kuraimiConfig.idExtractor('https://jobs.kuraimibank.com/job/22')).toBe('kuraimi-22');
  });

  it('should fall back for unexpected URL format', () => {
    expect(kuraimiConfig.idExtractor('https://example.com/other')).toBe('kuraimi-https://example.com/other');
  });

  it('should have correct listing URL', () => {
    expect(kuraimiConfig.getListingUrl()).toBe('https://jobs.kuraimibank.com/vacancies');
  });
});

// ============================================================================
// QTB Config Tests
// ============================================================================

const SAMPLE_QTB_HTML = `
<html><body>
<div class="col-12 col-md-6 col-lg-4 p-3">
  <div class="col-12 px-0">
    <div class="col-12 p-0">
      <div><img src="images/job/job_photo.jpg?v=2" alt="خدمة عملاء"></div>
      <div class="col-12 mb-5 pb-3 px-4 text-center">
        <h4 class="font-3 text-center">خدمة عملاء</h4>
        <h4 class="font-3 text-center">محافظة عدن</h4>
        <div class="font-1 pb-1">وظيفة شاغرة لدى بنك القطيبي الإسلامي</div>
        <div class="col-12 py-3 text-center">
          <a href="detals_job?id_job=627767247" class="d-inline-block">عرض الوظيفة</a>
        </div>
      </div>
    </div>
  </div>
</div>
<div class="col-12 col-md-6 col-lg-4 p-3">
  <div class="col-12 px-0">
    <div class="col-12 p-0">
      <div><img src="images/job/job_photo.jpg?v=2" alt="أخصائي تمويل"></div>
      <div class="col-12 mb-5 pb-3 px-4 text-center">
        <h4 class="font-3 text-center">أخصائي تمويل</h4>
        <h4 class="font-3 text-center">محافظة صنعاء</h4>
        <div class="font-1 pb-1">وظيفة شاغرة</div>
        <div class="col-12 py-3 text-center">
          <a href="detals_job?id_job=211960022" class="d-inline-block">عرض الوظيفة</a>
        </div>
      </div>
    </div>
  </div>
</div>
</body></html>`;

describe('qtbConfig', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should extract ID from query param', () => {
    expect(qtbConfig.idExtractor('https://jobs.qtbbank.com/detals_job?id_job=627767247')).toBe('qtb-627767247');
  });

  it('should parse QTB job cards', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(SAMPLE_QTB_HTML, { status: 200 })
    );

    const jobs = await fetchAndParseHTMLJobs(qtbConfig);

    expect(jobs).toHaveLength(2);
    expect(jobs[0].id).toBe('qtb-627767247');
    expect(jobs[0].title).toBe('خدمة عملاء');
    expect(jobs[0].link).toBe('https://jobs.qtbbank.com/detals_job?id_job=627767247');
    expect(jobs[0].company).toBe('بنك القطيبي الإسلامي');
    expect(jobs[0].source).toBe('qtb');

    expect(jobs[1].id).toBe('qtb-211960022');
    expect(jobs[1].title).toBe('أخصائي تمويل');
  });

  it('should extract image URL', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(SAMPLE_QTB_HTML, { status: 200 })
    );

    const jobs = await fetchAndParseHTMLJobs(qtbConfig);
    expect(jobs[0].imageUrl).toBe('https://jobs.qtbbank.com/images/job/job_photo.jpg?v=2');
  });
});

// ============================================================================
// YLDF Config Tests
// ============================================================================

const SAMPLE_YLDF_HTML = `
<html><body>
<div class="mb-8 col-sm-6">
  <div id="jobs/yldf/advocacy-assistant" name="card" class="card border h-100">
    <div class="p-6">
      <div class="flex mb-5">
        <div class="col-12 col-lg-9 px-0">
          <h4 class="mt-0 mb-1 jobs-page text-truncate" title="Advocacy and Communication Field Assistant">
            Advocacy and Communication Field Assistant
          </h4>
          <div class="text-14">
            <span class="font-weight-bold">Youth Leadership Development Foundation</span>
            <span class="text-secondary"> · 3 weeks ago</span>
          </div>
        </div>
      </div>
      <div class="text-14">
        <div class="mt-3 flex align-items-center">AlMukala -Hadramout</div>
        <div class="mt-3 flex align-items-center">Communication Unit - YLDF</div>
      </div>
    </div>
    <div class="px-4 py-2 job-card-footer mt-auto">
      <div class="row text-12 text-secondary">
        <p class="col-6 text-center mb-0 border-right">Full-time</p>
        <p class="col-6 text-center mb-0">Closes on: <b>1 Feb, 2026</b></p>
      </div>
    </div>
  </div>
</div>
</body></html>`;

describe('yldfConfig', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should extract ID from job path', () => {
    expect(yldfConfig.idExtractor('https://erp.yldf.org/jobs/yldf/advocacy-assistant')).toBe('yldf-advocacy-assistant');
  });

  it('should parse YLDF job cards with id-based links', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(SAMPLE_YLDF_HTML, { status: 200 })
    );

    const jobs = await fetchAndParseHTMLJobs(yldfConfig);

    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe('yldf-advocacy-assistant');
    expect(jobs[0].title).toBe('Advocacy and Communication Field Assistant');
    expect(jobs[0].link).toBe('https://erp.yldf.org/jobs/yldf/advocacy-assistant');
    expect(jobs[0].company).toBe('Youth Leadership Development Foundation');
    expect(jobs[0].source).toBe('yldf');
  });

  it('should extract deadline from footer', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(SAMPLE_YLDF_HTML, { status: 200 })
    );

    const jobs = await fetchAndParseHTMLJobs(yldfConfig);
    // Deadline is in the description metadata
    expect(jobs[0].description).toContain('Deadline: 1 Feb, 2026');
  });

  it('processJob should fetch detail page for full description', async () => {
    const detailHtml = `<html><body>
      <div class="ql-editor read-mode">
        <p>We are looking for a highly motivated person to join our team.</p>
        <ul><li>Experience in advocacy</li><li>Good communication skills</li></ul>
      </div>
    </body></html>`;

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(detailHtml, { status: 200 })
    );

    const plugin = new ScraperPlugin(yldfConfig);
    const job: JobItem = {
      id: 'yldf-advocacy-assistant',
      title: 'Advocacy and Communication Field Assistant',
      company: 'Youth Leadership Development Foundation',
      link: 'https://erp.yldf.org/jobs/yldf/advocacy-assistant',
      pubDate: '',
      imageUrl: null,
      description: 'Location: AlMukala\nDeadline: 1 Feb, 2026',
      source: 'yldf',
    };

    const processed = await plugin.processJob(job);

    expect(processed.description).toContain('highly motivated');
    expect(processed.description).toContain('advocacy');
    expect(processed.source).toBe('yldf');
  });
});

// ============================================================================
// YK Bank RSS Config Tests
// ============================================================================

import { ykbankConfig } from '../src/services/sources/rss-shared/configs';
import { RSSPlugin } from '../src/services/sources/rss-shared/plugin';

const SAMPLE_YKBANK_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:atom="http://www.w3.org/2005/Atom" version="2.0">
<channel>
  <title>Yemen Kuwait Bank (yk-bank) - Careers</title>
  <link>https://yk-bank.zohorecruit.com/jobs/Careers/rss</link>
  <item>
    <title><![CDATA[AI Engineer (LLM & ML)]]></title>
    <link>https://yk-bank.zohorecruit.com/jobs/Careers/796159000000522029/AI-Engineer-LLM-ML?source=RSS</link>
    <description><![CDATA[Category: Banking Location: Sana'a Full description here.]]></description>
    <guid isPermaLink="false">796159000000522029</guid>
    <pubDate>Thu, 26 Dec 2024 12:00:00 PST</pubDate>
  </item>
  <item>
    <title><![CDATA[Data Analyst]]></title>
    <link>https://yk-bank.zohorecruit.com/jobs/Careers/796159000000522030/Data-Analyst?source=RSS</link>
    <description><![CDATA[Category: Banking Location: Aden Analyst role.]]></description>
    <guid isPermaLink="false">796159000000522030</guid>
    <pubDate>Fri, 27 Dec 2024 10:00:00 PST</pubDate>
  </item>
</channel>
</rss>`;

describe('ykbankConfig (via RSSPlugin)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should extract ID from Zoho Recruit URL', () => {
    expect(ykbankConfig.idExtractor('https://yk-bank.zohorecruit.com/jobs/Careers/796159000000522029/AI-Engineer?source=RSS'))
      .toBe('ykbank-796159000000522029');
  });

  it('should have correct feed URL', () => {
    expect(ykbankConfig.getFeedUrl()).toBe('https://yk-bank.zohorecruit.com/jobs/Careers/rss');
  });

  it('should parse YK Bank RSS feed', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(SAMPLE_YKBANK_RSS, { status: 200 })
    );

    const plugin = new RSSPlugin(ykbankConfig);
    const jobs = await plugin.fetchJobs();

    expect(jobs).toHaveLength(2);
    expect(jobs[0].id).toBe('ykbank-796159000000522029');
    expect(jobs[0].title).toBe('AI Engineer (LLM & ML)');
    expect(jobs[0].source).toBe('ykbank');
    expect(jobs[0].link).toContain('zohorecruit.com');
  });

  it('processJob should clean HTML description', async () => {
    const plugin = new RSSPlugin(ykbankConfig);
    const job: JobItem = {
      id: 'ykbank-123',
      title: 'AI Engineer',
      company: 'Unknown Company',
      link: 'https://yk-bank.zohorecruit.com/jobs/Careers/123/AI-Engineer',
      pubDate: 'Thu, 26 Dec 2024 12:00:00 PST',
      imageUrl: null,
      description: '<p>Job Description We need an AI Engineer.</p><p>Location: Sana\'a</p>',
      source: 'ykbank',
    };

    const processed = await plugin.processJob(job);

    expect(processed.title).toBe('AI Engineer');
    expect(processed.source).toBe('ykbank');
    expect(processed.description).toContain('AI Engineer');
  });
});
