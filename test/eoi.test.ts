/**
 * Tests for EOI Yemen job fetching service.
 * Run with: npm test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchEOIJobsFromAPI, convertEOIJobToJobItem } from '../src/services/sources/eoi/scraper';
import { fetchEOIJobDetail, cleanEOIDescription, extractHowToApply } from '../src/services/sources/eoi/parser';

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

describe('fetchEOIJobsFromAPI', () => {
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

    const jobs = await fetchEOIJobsFromAPI();

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

    await fetchEOIJobsFromAPI();

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

    const jobs = await fetchEOIJobsFromAPI();

    expect(jobs).toHaveLength(0);
  });

  it('should throw on HTTP error', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('Internal Server Error', { status: 500, statusText: 'Internal Server Error' })
    );

    await expect(fetchEOIJobsFromAPI()).rejects.toThrow('EOI API fetch failed: 500');
  });
});

describe('convertEOIJobToJobItem', () => {
  it('should convert EOI job to JobItem with correct structure', () => {
    const eoiJob = {
      id: '21347',
      title: 'Social Worker',
      company: 'Medecine Sans Frontiers',
      category: 'أخرى',
      location: 'عدن , لحج',
      postDate: '01-02-2026',
      deadline: '07-02-2026',
      url: 'https://eoi-ye.com/jobs/21347/',
    };

    const jobItem = convertEOIJobToJobItem(eoiJob);

    expect(jobItem).toMatchObject({
      id: 'eoi-21347', // Prefixed with 'eoi-'
      title: 'Social Worker',
      company: 'Medecine Sans Frontiers',
      link: 'https://eoi-ye.com/jobs/21347/',
      imageUrl: null, // EOI has no images
      source: 'eoi',
    });
    expect(jobItem.pubDate).toBeDefined();
    expect(jobItem.description).toContain('أخرى'); // Category
  });

  it('should set source to eoi', () => {
    const eoiJob = {
      id: '21347',
      title: 'Social Worker',
      company: 'MSF',
      category: '',
      location: '',
      postDate: '01-02-2026',
      deadline: '',
      url: 'https://eoi-ye.com/jobs/21347/',
    };

    const jobItem = convertEOIJobToJobItem(eoiJob);
    expect(jobItem.source).toBe('eoi');
  });
});

// ============================================================================
// Detail Page Scraping Tests
// ============================================================================

const SAMPLE_DETAIL_HTML = `
<html>
<body>
<img src="https://eoi-ye.com/storage/users/company-logo.png" alt="Logo">
<div class="detail-adv">
<h2>Job Description</h2>
<p>We are looking for a qualified Social Worker to join our team in Aden.</p>
<ul>
<li>Minimum 3 years experience</li>
<li>Bachelor's degree in Social Work</li>
</ul>
<h3>How to Apply</h3>
<p>Please send your CV to <a href="mailto:hr@example.org">hr@example.org</a></p>
<p>Or apply through: <a href="https://forms.gle/abc123">Google Form</a></p>
<p>WhatsApp: +967 777 123 456</p>
</div>
<div class="list-meta">
<span>الموعد الاخير</span><span>15-02-2026 23:59</span>
</div>
</body>
</html>`;

const EXPIRED_PAGE_HTML = `
<html><body>
<div class="alert">هذا الإعلان منتهي</div>
</body></html>`;

describe('fetchEOIJobDetail', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should parse detail page HTML correctly', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(SAMPLE_DETAIL_HTML, { status: 200 })
    );

    const detail = await fetchEOIJobDetail('https://eoi-ye.com/jobs/123/');

    expect(detail).not.toBeNull();
    expect(detail!.description).toContain('Social Worker');
    expect(detail!.description).toContain('3 years experience');
    expect(detail!.imageUrl).toBe('https://eoi-ye.com/storage/users/company-logo.png');
  });

  it('should extract how-to-apply data', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(SAMPLE_DETAIL_HTML, { status: 200 })
    );

    const detail = await fetchEOIJobDetail('https://eoi-ye.com/jobs/123/');

    expect(detail).not.toBeNull();
    expect(detail!.applicationLinks).toEqual(
      expect.arrayContaining([
        expect.stringContaining('forms.gle'),
        'hr@example.org',
      ])
    );
  });

  it('should detect expired pages', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(EXPIRED_PAGE_HTML, { status: 200 })
    );

    const detail = await fetchEOIJobDetail('https://eoi-ye.com/jobs/999/');

    expect(detail).toBeNull();
  });

  it('should return null on HTTP error', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('Not Found', { status: 404 })
    );

    const detail = await fetchEOIJobDetail('https://eoi-ye.com/jobs/999/');

    expect(detail).toBeNull();
  });

  it('should return null on fetch error', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('Network error'));

    const detail = await fetchEOIJobDetail('https://eoi-ye.com/jobs/123/');

    expect(detail).toBeNull();
  });
});

describe('cleanEOIDescription', () => {
  it('should convert HTML headings to text', () => {
    const result = cleanEOIDescription('<h2>Job Title</h2><p>Description here</p>');
    expect(result).toContain('Job Title');
    expect(result).toContain('Description here');
  });

  it('should convert list items to bullets', () => {
    const result = cleanEOIDescription('<ul><li>Item 1</li><li>Item 2</li></ul>');
    expect(result).toContain('• Item 1');
    expect(result).toContain('• Item 2');
  });

  it('should decode HTML entities', () => {
    const result = cleanEOIDescription('Tom &amp; Jerry &lt;strong&gt;');
    expect(result).toContain('Tom & Jerry <strong>');
  });

  it('should strip remaining HTML tags', () => {
    const result = cleanEOIDescription('<span class="highlight">Important</span> text');
    expect(result).toContain('Important');
    expect(result).not.toContain('<span');
  });

  it('should return empty string for empty input', () => {
    expect(cleanEOIDescription('')).toBe('');
  });

  it('should preserve link URLs in text', () => {
    const result = cleanEOIDescription('<a href="https://example.com">Click here</a>');
    expect(result).toContain('Click here');
    expect(result).toContain('https://example.com');
  });
});

describe('extractHowToApply', () => {
  it('should extract Google Forms links', () => {
    const html = '<p>Apply here: <a href="https://forms.gle/abc123">Form</a></p>';
    const result = extractHowToApply(html);
    expect(result.links).toContain('https://forms.gle/abc123');
  });

  it('should extract email addresses', () => {
    const html = '<p>Send CV to hr@example.org or jobs@ngo.com</p>';
    const result = extractHowToApply(html);
    expect(result.emails).toContain('hr@example.org');
    expect(result.emails).toContain('jobs@ngo.com');
  });

  it('should extract Yemeni phone numbers', () => {
    const html = '<p>WhatsApp: +967 777 123 456</p>';
    const result = extractHowToApply(html);
    expect(result.phones.length).toBeGreaterThan(0);
    expect(result.phones[0]).toMatch(/967/);
  });

  it('should find How to Apply section', () => {
    const html = `
      <p>Job description text here</p>
      <h3>How to Apply</h3>
      <p>Send your resume to apply@org.com</p>
    `;
    const result = extractHowToApply(html);
    expect(result.emails).toContain('apply@org.com');
    expect(result.text).toContain('resume');
  });

  it('should return empty results for HTML with no apply info', () => {
    const html = '<p>Just a regular job description with no contact info</p>';
    const result = extractHowToApply(html);
    expect(result.links).toHaveLength(0);
    expect(result.emails).toHaveLength(0);
    expect(result.phones).toHaveLength(0);
  });

  it('should not duplicate URLs', () => {
    const html = `
      <a href="https://forms.gle/abc">Apply</a>
      <p>Link: https://forms.gle/abc</p>
    `;
    const result = extractHowToApply(html);
    const formLinks = result.links.filter(l => l.includes('forms.gle/abc'));
    expect(formLinks).toHaveLength(1);
  });
});
