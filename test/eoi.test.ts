/**
 * Tests for EOI Yemen job fetching service.
 * Run with: npm test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchEOIJobs, fetchEOIJobsRaw, generateAtomFeed, generateRSSFeed } from '../src/services/eoi';

// Sample API response fixture
const SAMPLE_API_RESPONSE = {
  table_data: `<a href="https://eoi-ye.com/jobs/21347/">
    <div class="job-content wow fadeInUpBig">
        <div class="data col-md-1 hidden-sm hidden-xs">
            01-02-2026 </div>
        <div class="data col-md-3">
                            <div>Social Worker</div>
        </div>
        <div class="data col-md-2">
            <div class="jop-head hidden-lg hidden-md ">فئة:</div>
             أخرى</div>
        <div class="data col-md-2">
            <div class="jop-head hidden-lg hidden-md ">بواسطة :</div>
             Medecine Sans Frontiers</div>
        <div class="data col-md-2">
            <div class="jop-head hidden-lg hidden-md ">المحافظة :</div>
             عدن , لحج
   </div>
        <div class="data col-md-2">
            <div class="jop-head hidden-lg hidden-md ">الموعد الاخير :</div>
            07-02-2026
                    </div></div>
</a>

<a href="https://eoi-ye.com/jobs/21346/">
    <div class="job-content wow fadeInUpBig">
        <div class="data col-md-1 hidden-sm hidden-xs">
            01-02-2026 </div>
        <div class="data col-md-3">
                            <div>Pharmacy Supervisor</div>
        </div>
        <div class="data col-md-2">
            <div class="jop-head hidden-lg hidden-md ">فئة:</div>
             صيدلة</div>
        <div class="data col-md-2">
            <div class="jop-head hidden-lg hidden-md ">بواسطة :</div>
             Medecine Sans Frontiers</div>
        <div class="data col-md-2">
            <div class="jop-head hidden-lg hidden-md ">المحافظة :</div>
             عدن , لحج
   </div>
        <div class="data col-md-2">
            <div class="jop-head hidden-lg hidden-md ">الموعد الاخير :</div>
            07-02-2026
                    </div></div>
</a>`,
  total_data: 2,
};

describe('fetchEOIJobsRaw', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should fetch and parse jobs from API', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(SAMPLE_API_RESPONSE), { status: 200 })
    );

    const jobs = await fetchEOIJobsRaw();

    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      id: '21347',
      title: 'Social Worker',
      url: 'https://eoi-ye.com/jobs/21347/',
    });
    expect(jobs[1]).toMatchObject({
      id: '21346',
      title: 'Pharmacy Supervisor',
      url: 'https://eoi-ye.com/jobs/21346/',
    });
  });

  it('should send correct headers', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ table_data: '', total_data: 0 }), { status: 200 })
    );

    await fetchEOIJobsRaw();

    expect(fetch).toHaveBeenCalledWith(
      'https://eoi-ye.com/live_search/action1?type=0&title=',
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Requested-With': 'XMLHttpRequest',
        }),
      })
    );
  });

  it('should return empty array for empty response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ table_data: '', total_data: 0 }), { status: 200 })
    );

    const jobs = await fetchEOIJobsRaw();

    expect(jobs).toHaveLength(0);
  });

  it('should throw on HTTP error', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('Internal Server Error', { status: 500, statusText: 'Internal Server Error' })
    );

    await expect(fetchEOIJobsRaw()).rejects.toThrow('EOI API fetch failed: 500');
  });
});

describe('fetchEOIJobs', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should return JobItem array with correct structure', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(SAMPLE_API_RESPONSE), { status: 200 })
    );

    const jobs = await fetchEOIJobs();

    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      id: 'eoi-21347', // Prefixed with 'eoi-'
      title: 'Social Worker',
      company: 'Medecine Sans Frontiers',
      link: 'https://eoi-ye.com/jobs/21347/',
      imageUrl: null, // EOI has no images
      source: 'eoi',
    });
    expect(jobs[0].pubDate).toBeDefined();
    expect(jobs[0].description).toContain('أخرى'); // Category
  });

  it('should set source to eoi', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(SAMPLE_API_RESPONSE), { status: 200 })
    );

    const jobs = await fetchEOIJobs();

    expect(jobs.every(job => job.source === 'eoi')).toBe(true);
  });
});

describe('generateAtomFeed', () => {
  it('should generate valid Atom XML', () => {
    const jobs = [
      {
        id: '123',
        title: 'Test Job',
        company: 'Test Company',
        category: 'IT',
        location: 'Aden',
        postDate: '01-02-2026',
        deadline: '15-02-2026',
        url: 'https://eoi-ye.com/jobs/123/',
      },
    ];

    const feed = generateAtomFeed(jobs);

    expect(feed).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(feed).toContain('<feed xmlns="http://www.w3.org/2005/Atom">');
    expect(feed).toContain('<title>EOI Yemen - الوظائف</title>');
    expect(feed).toContain('<entry>');
    expect(feed).toContain('<title>Test Job</title>');
    expect(feed).toContain('https://eoi-ye.com/jobs/123/');
  });

  it('should escape XML special characters', () => {
    const jobs = [
      {
        id: '123',
        title: 'Test & Job <script>',
        company: 'Company "Test"',
        category: 'IT',
        location: 'Aden',
        postDate: '01-02-2026',
        deadline: '15-02-2026',
        url: 'https://eoi-ye.com/jobs/123/',
      },
    ];

    const feed = generateAtomFeed(jobs);

    expect(feed).toContain('Test &amp; Job &lt;script&gt;');
    expect(feed).toContain('Company &quot;Test&quot;');
  });
});

describe('generateRSSFeed', () => {
  it('should generate valid RSS 2.0 XML', () => {
    const jobs = [
      {
        id: '123',
        title: 'Test Job',
        company: 'Test Company',
        category: 'IT',
        location: 'Aden',
        postDate: '01-02-2026',
        deadline: '15-02-2026',
        url: 'https://eoi-ye.com/jobs/123/',
      },
    ];

    const feed = generateRSSFeed(jobs);

    expect(feed).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(feed).toContain('<rss version="2.0"');
    expect(feed).toContain('<channel>');
    expect(feed).toContain('<title>EOI Yemen - الوظائف</title>');
    expect(feed).toContain('<item>');
    expect(feed).toContain('<title>Test Job - Test Company</title>');
    expect(feed).toContain('<link>https://eoi-ye.com/jobs/123/</link>');
  });
});
