/**
 * Tests for RSS feed parsing.
 * Run with: npm test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchYemenHRJobs as fetchRSSFeed } from '../src/services/sources/yemenhr/fetcher';

// Sample Atom feed fixtures
const SINGLE_ENTRY_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Yemen HR Jobs</title>
  <entry>
    <id>https://yemenhr.com/jobs/software-engineer</id>
    <title>Software Engineer</title>
    <author><name>Tech Company</name></author>
    <link rel="alternate" type="text/html" href="https://yemenhr.com/jobs/software-engineer"/>
    <link rel="enclosure" type="image/png" href="https://yemenhr.com/images/logo.png"/>
    <published>2025-01-15T10:00:00Z</published>
    <content type="html">Full job description here</content>
  </entry>
</feed>`;

const MULTIPLE_ENTRIES_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Yemen HR Jobs</title>
  <entry>
    <id>https://yemenhr.com/jobs/job-1</id>
    <title>Job One</title>
    <author><name>Company A</name></author>
    <link rel="alternate" href="https://yemenhr.com/jobs/job-1"/>
    <published>2025-01-15T10:00:00Z</published>
  </entry>
  <entry>
    <id>https://yemenhr.com/jobs/job-2</id>
    <title>Job Two</title>
    <author><name>Company B</name></author>
    <link rel="alternate" href="https://yemenhr.com/jobs/job-2"/>
    <published>2025-01-14T10:00:00Z</published>
  </entry>
  <entry>
    <id>https://yemenhr.com/jobs/job-3</id>
    <title>Job Three</title>
    <author><name>Company C</name></author>
    <link rel="alternate" href="https://yemenhr.com/jobs/job-3"/>
    <published>2025-01-13T10:00:00Z</published>
  </entry>
</feed>`;

const EMPTY_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Yemen HR Jobs</title>
</feed>`;

const FEED_WITH_MISSING_FIELDS = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>https://yemenhr.com/jobs/minimal-job</id>
  </entry>
</feed>`;

const FEED_WITH_RELATIVE_IMAGE = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>https://yemenhr.com/jobs/test-job</id>
    <title>Test Job</title>
    <author><name>Test Company</name></author>
    <link rel="alternate" href="https://yemenhr.com/jobs/test-job"/>
    <enclosure url="/images/company-logo.png"/>
    <published>2025-01-15T10:00:00Z</published>
  </entry>
</feed>`;

const FEED_WITH_STRING_LINK = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>https://yemenhr.com/jobs/string-link-job</id>
    <title>String Link Job</title>
    <author>Direct Author</author>
    <link>https://yemenhr.com/jobs/string-link-job</link>
    <published>2025-01-15T10:00:00Z</published>
  </entry>
</feed>`;

describe('fetchRSSFeed', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should parse valid Atom feed with single entry', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(SINGLE_ENTRY_FEED, { status: 200 })
    );

    const jobs = await fetchRSSFeed('https://example.com/feed');

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toEqual({
      id: 'software-engineer',
      title: 'Software Engineer',
      company: 'Tech Company',
      link: 'https://yemenhr.com/jobs/software-engineer',
      pubDate: '2025-01-15T10:00:00Z',
      imageUrl: 'https://yemenhr.com/images/logo.png',
      description: 'Full job description here',
      source: 'yemenhr',
    });
  });

  it('should parse valid Atom feed with multiple entries', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(MULTIPLE_ENTRIES_FEED, { status: 200 })
    );

    const jobs = await fetchRSSFeed('https://example.com/feed');

    expect(jobs).toHaveLength(3);
    expect(jobs[0].id).toBe('job-1');
    expect(jobs[0].title).toBe('Job One');
    expect(jobs[0].company).toBe('Company A');
    expect(jobs[1].id).toBe('job-2');
    expect(jobs[1].title).toBe('Job Two');
    expect(jobs[2].id).toBe('job-3');
    expect(jobs[2].title).toBe('Job Three');
  });

  it('should handle empty feed (no entries)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(EMPTY_FEED, { status: 200 })
    );

    const jobs = await fetchRSSFeed('https://example.com/feed');

    expect(jobs).toHaveLength(0);
  });

  it('should extract job ID from URL slug', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(SINGLE_ENTRY_FEED, { status: 200 })
    );

    const jobs = await fetchRSSFeed('https://example.com/feed');

    // The ID should be the slug from the URL, not the full URL
    expect(jobs[0].id).toBe('software-engineer');
  });

  it('should handle missing fields gracefully', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(FEED_WITH_MISSING_FIELDS, { status: 200 })
    );

    const jobs = await fetchRSSFeed('https://example.com/feed');

    expect(jobs).toHaveLength(1);
    expect(jobs[0].title).toBe('No Title');
    expect(jobs[0].company).toBe('Unknown Company');
    expect(jobs[0].pubDate).toBe('');
    expect(jobs[0].imageUrl).toBeNull();
    expect(jobs[0].description).toBe('');
  });

  it('should convert relative image URLs to absolute', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(FEED_WITH_RELATIVE_IMAGE, { status: 200 })
    );

    const jobs = await fetchRSSFeed('https://example.com/feed');

    expect(jobs[0].imageUrl).toBe('https://yemenhr.com/images/company-logo.png');
  });

  it('should handle string link and author formats', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(FEED_WITH_STRING_LINK, { status: 200 })
    );

    const jobs = await fetchRSSFeed('https://example.com/feed');

    expect(jobs[0].link).toBe('https://yemenhr.com/jobs/string-link-job');
    expect(jobs[0].company).toBe('Direct Author');
  });

  it('should throw error on failed HTTP response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('Not Found', { status: 404, statusText: 'Not Found' })
    );

    await expect(fetchRSSFeed('https://example.com/feed')).rejects.toThrow(
      'RSS fetch failed: 404 Not Found'
    );
  });

  it('should send correct User-Agent header', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(EMPTY_FEED, { status: 200 })
    );

    await fetchRSSFeed('https://example.com/feed');

    expect(fetch).toHaveBeenCalledWith('https://example.com/feed', {
      headers: {
        'User-Agent': 'Yemen-HR-Bot/1.0',
      },
    });
  });
});
