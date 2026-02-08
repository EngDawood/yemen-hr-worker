/**
 * Tests for RSS feed parsing (Atom and RSS 2.0).
 * Run with: npm test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchYemenHRJobs as fetchRSSFeed } from '../src/services/sources/yemenhr/fetcher';
import { fetchAndParseRSSFeed } from '../src/services/sources/rss-shared/rss-parser';

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

// ============================================================================
// RSS 2.0 Feed Parsing Tests
// ============================================================================

const RSS2_SINGLE_ITEM = `<?xml version="1.0" encoding="utf-8"?>
<rss xmlns:atom="http://www.w3.org/2005/Atom" version="2.0">
  <channel>
    <title>ReliefWeb - Yemen Jobs</title>
    <item>
      <title>Program Manager</title>
      <link>https://reliefweb.int/job/4197376/program-manager</link>
      <guid isPermaLink="true">https://reliefweb.int/job/4197376/program-manager</guid>
      <pubDate>Thu, 05 Feb 2026 19:42:44 +0000</pubDate>
      <description>Job description content here</description>
      <author>UNICEF</author>
      <category>Yemen</category>
    </item>
  </channel>
</rss>`;

const RSS2_MULTIPLE_ITEMS = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0">
  <channel>
    <title>Test Feed</title>
    <item>
      <title>Job Alpha</title>
      <link>https://reliefweb.int/job/100/alpha</link>
      <pubDate>Mon, 03 Feb 2026 10:00:00 +0000</pubDate>
      <author>Org A</author>
    </item>
    <item>
      <title>Job Beta</title>
      <link>https://reliefweb.int/job/200/beta</link>
      <pubDate>Tue, 04 Feb 2026 10:00:00 +0000</pubDate>
      <author>Org B</author>
    </item>
  </channel>
</rss>`;

const RSS2_EMPTY_CHANNEL = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0">
  <channel>
    <title>Empty Feed</title>
  </channel>
</rss>`;

const RSS2_MISSING_FIELDS = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0">
  <channel>
    <item>
      <link>https://reliefweb.int/job/999/minimal</link>
    </item>
  </channel>
</rss>`;

const RSS2_WITH_ENCLOSURE = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title>Job With Image</title>
      <link>https://reliefweb.int/job/555/with-image</link>
      <author>Test Org</author>
      <enclosure url="/images/logo.png" type="image/png"/>
    </item>
  </channel>
</rss>`;

const idExtractor = (link: string) => {
  const match = link.match(/\/job\/(\d+)/);
  return match ? `rw-${match[1]}` : link;
};

describe('fetchAndParseRSSFeed (RSS 2.0)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should parse RSS 2.0 feed with single item', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(RSS2_SINGLE_ITEM, { status: 200 })
    );

    const jobs = await fetchAndParseRSSFeed(
      'https://example.com/rss', 'reliefweb', 'https://reliefweb.int', idExtractor
    );

    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe('rw-4197376');
    expect(jobs[0].title).toBe('Program Manager');
    expect(jobs[0].company).toBe('UNICEF');
    expect(jobs[0].link).toBe('https://reliefweb.int/job/4197376/program-manager');
    expect(jobs[0].pubDate).toBe('Thu, 05 Feb 2026 19:42:44 +0000');
    expect(jobs[0].description).toBe('Job description content here');
    expect(jobs[0].source).toBe('reliefweb');
    expect(jobs[0].imageUrl).toBeNull();
  });

  it('should parse RSS 2.0 feed with multiple items', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(RSS2_MULTIPLE_ITEMS, { status: 200 })
    );

    const jobs = await fetchAndParseRSSFeed(
      'https://example.com/rss', 'reliefweb', 'https://reliefweb.int', idExtractor
    );

    expect(jobs).toHaveLength(2);
    expect(jobs[0].id).toBe('rw-100');
    expect(jobs[0].title).toBe('Job Alpha');
    expect(jobs[0].company).toBe('Org A');
    expect(jobs[1].id).toBe('rw-200');
    expect(jobs[1].title).toBe('Job Beta');
    expect(jobs[1].company).toBe('Org B');
  });

  it('should handle empty RSS 2.0 channel (no items)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(RSS2_EMPTY_CHANNEL, { status: 200 })
    );

    const jobs = await fetchAndParseRSSFeed(
      'https://example.com/rss', 'reliefweb', 'https://reliefweb.int', idExtractor
    );

    expect(jobs).toHaveLength(0);
  });

  it('should handle missing fields in RSS 2.0 items', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(RSS2_MISSING_FIELDS, { status: 200 })
    );

    const jobs = await fetchAndParseRSSFeed(
      'https://example.com/rss', 'reliefweb', 'https://reliefweb.int', idExtractor
    );

    expect(jobs).toHaveLength(1);
    expect(jobs[0].title).toBe('No Title');
    expect(jobs[0].company).toBe('Unknown Company');
    expect(jobs[0].pubDate).toBe('');
    expect(jobs[0].description).toBe('');
  });

  it('should convert relative enclosure URLs to absolute in RSS 2.0', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(RSS2_WITH_ENCLOSURE, { status: 200 })
    );

    const jobs = await fetchAndParseRSSFeed(
      'https://example.com/rss', 'reliefweb', 'https://reliefweb.int', idExtractor
    );

    expect(jobs[0].imageUrl).toBe('https://reliefweb.int/images/logo.png');
  });

  it('should still parse Atom feeds correctly (regression)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(SINGLE_ENTRY_FEED, { status: 200 })
    );

    const atomIdExtractor = (link: string) => {
      const match = link.match(/\/jobs\/([^/?#]+)/);
      return match ? match[1] : link;
    };

    const jobs = await fetchAndParseRSSFeed(
      'https://example.com/feed', 'yemenhr', 'https://yemenhr.com', atomIdExtractor
    );

    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe('software-engineer');
    expect(jobs[0].title).toBe('Software Engineer');
    expect(jobs[0].source).toBe('yemenhr');
  });
});
