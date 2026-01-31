import { XMLParser } from 'fast-xml-parser';
import type { JobItem } from '../types';

interface AtomEntry {
  id?: string;
  title?: string;
  author?: { name?: string } | string;
  link?: { '@_href'?: string } | string;
  published?: string;
  updated?: string;
  enclosure?: { '@_url'?: string } | string;
}

interface AtomFeed {
  feed?: {
    entry?: AtomEntry | AtomEntry[];
  };
}

export async function fetchRSSFeed(url: string): Promise<JobItem[]> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Yemen-HR-Bot/1.0',
    },
  });

  if (!response.ok) {
    throw new Error(`RSS fetch failed: ${response.status} ${response.statusText}`);
  }

  const xml = await response.text();

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
  });

  const result: AtomFeed = parser.parse(xml);

  if (!result.feed?.entry) {
    return [];
  }

  const entries = Array.isArray(result.feed.entry)
    ? result.feed.entry
    : [result.feed.entry];

  return entries.map((entry): JobItem => {
    // Extract link URL
    let link = '';
    if (typeof entry.link === 'string') {
      link = entry.link;
    } else if (entry.link?.['@_href']) {
      link = entry.link['@_href'];
    }

    // Extract author/company
    let company = 'Unknown Company';
    if (typeof entry.author === 'string') {
      company = entry.author;
    } else if (entry.author?.name) {
      company = entry.author.name;
    }

    // Extract image URL from enclosure
    let imageUrl: string | null = null;
    if (typeof entry.enclosure === 'string') {
      imageUrl = entry.enclosure;
    } else if (entry.enclosure?.['@_url']) {
      imageUrl = entry.enclosure['@_url'];
    }

    // Convert relative URL to absolute
    if (imageUrl && imageUrl.startsWith('/')) {
      imageUrl = 'https://yemenhr.com' + imageUrl;
    }

    // Generate ID from link (slug)
    const id = link ? extractJobId(link) : entry.id || '';

    return {
      id,
      title: entry.title || 'No Title',
      company,
      link,
      pubDate: entry.published || entry.updated || '',
      imageUrl,
    };
  });
}

function extractJobId(link: string): string {
  // Extract job slug from URL like https://yemenhr.com/jobs/job-slug
  const match = link.match(/\/jobs\/([^/?#]+)/);
  return match ? match[1] : link;
}
