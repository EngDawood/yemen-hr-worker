/**
 * Shared RSS/Atom feed parser.
 * Parses both Atom feeds (<feed><entry>) and RSS 2.0 feeds (<rss><channel><item>)
 * into a normalized job item structure.
 */

import { XMLParser } from 'fast-xml-parser';
import type { JobItem } from '../../../types';

// ============================================================================
// Atom feed types
// ============================================================================

interface AtomLink {
  '@_rel'?: string;
  '@_type'?: string;
  '@_href'?: string;
}

interface AtomEntry {
  id?: string;
  title?: string | { '#text'?: string };
  author?: { name?: string } | string;
  link?: AtomLink | AtomLink[] | string;
  published?: string;
  updated?: string;
  enclosure?: { '@_url'?: string } | string;
  content?: string | { '#text'?: string; '@_type'?: string };
}

interface AtomFeed {
  feed?: {
    entry?: AtomEntry | AtomEntry[];
  };
}

// ============================================================================
// RSS 2.0 feed types
// ============================================================================

interface RSSItem {
  title?: string;
  link?: string;
  guid?: string | { '#text'?: string; '@_isPermaLink'?: string };
  pubDate?: string;
  author?: string | string[];
  description?: string;
  category?: string | string[];
  enclosure?: { '@_url'?: string; '@_type'?: string } | string;
}

interface RSSFeed {
  rss?: {
    channel?: {
      item?: RSSItem | RSSItem[];
    };
  };
}

// Combined parse result
type ParsedFeed = AtomFeed & RSSFeed;

// ============================================================================
// Atom entry parsing
// ============================================================================

function parseAtomEntries(
  entries: AtomEntry[],
  source: string,
  baseUrl: string,
  idExtractor: (link: string) => string
): JobItem[] {
  return entries.map((entry): JobItem => {
    // Extract title (may be string or object with #text)
    let title = 'No Title';
    if (typeof entry.title === 'string') {
      title = entry.title;
    } else if (entry.title?.['#text']) {
      title = entry.title['#text'];
    }

    // Extract link URL (handle array of links)
    let link = '';
    let imageUrl: string | null = null;

    if (typeof entry.link === 'string') {
      link = entry.link;
    } else if (Array.isArray(entry.link)) {
      // Multiple links - find alternate for job URL, enclosure for image
      for (const l of entry.link) {
        if (l['@_rel'] === 'alternate' && l['@_href']) {
          link = l['@_href'];
        } else if (l['@_rel'] === 'enclosure' && l['@_href']) {
          imageUrl = l['@_href'];
        }
      }
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

    // Fallback: Extract image URL from enclosure element if not found in links
    if (!imageUrl) {
      if (typeof entry.enclosure === 'string') {
        imageUrl = entry.enclosure;
      } else if (entry.enclosure?.['@_url']) {
        imageUrl = entry.enclosure['@_url'];
      }
    }

    // Convert relative URL to absolute
    if (imageUrl && imageUrl.startsWith('/')) {
      imageUrl = baseUrl + imageUrl;
    }

    // Use entry.id if link extraction failed
    if (!link && entry.id) {
      link = entry.id;
    }

    // Generate ID from link
    const id = link ? idExtractor(link) : (typeof entry.id === 'string' ? entry.id : '');

    // Extract content/description
    let description = '';
    if (typeof entry.content === 'string') {
      description = entry.content;
    } else if (entry.content?.['#text']) {
      description = entry.content['#text'];
    }

    return {
      id,
      title,
      company,
      link,
      pubDate: entry.published || entry.updated || '',
      imageUrl,
      description,
      source,
    };
  });
}

// ============================================================================
// RSS 2.0 item parsing
// ============================================================================

function parseRSSItems(
  items: RSSItem[],
  source: string,
  baseUrl: string,
  idExtractor: (link: string) => string
): JobItem[] {
  return items.map((item): JobItem => {
    const title = item.title || 'No Title';
    const link = item.link || '';

    // Extract author (first if multiple)
    let company = 'Unknown Company';
    if (typeof item.author === 'string') {
      company = item.author;
    } else if (Array.isArray(item.author) && item.author.length > 0) {
      company = item.author[0];
    }

    // Extract image from enclosure
    let imageUrl: string | null = null;
    if (typeof item.enclosure === 'string') {
      imageUrl = item.enclosure;
    } else if (item.enclosure?.['@_url']) {
      imageUrl = item.enclosure['@_url'];
    }

    // Convert relative URL to absolute
    if (imageUrl && imageUrl.startsWith('/')) {
      imageUrl = baseUrl + imageUrl;
    }

    // Generate ID from link
    const id = link ? idExtractor(link) : '';

    const description = item.description || '';

    // Extract RSS <category> tags (may be single string or array)
    const categories = item.category
      ? (Array.isArray(item.category) ? item.category : [item.category])
      : undefined;

    return {
      id,
      title,
      company,
      link,
      pubDate: item.pubDate || '',
      imageUrl,
      description,
      source,
      categories,
    };
  });
}

// ============================================================================
// Main parser
// ============================================================================

/**
 * Fetch and parse an Atom or RSS 2.0 feed URL into JobItems.
 *
 * Detects feed format automatically:
 * - Atom: `<feed><entry>` elements
 * - RSS 2.0: `<rss><channel><item>` elements
 *
 * @param url - Feed URL
 * @param source - Source name to tag each job with
 * @param baseUrl - Base URL for resolving relative image URLs
 * @param idExtractor - Function to extract a unique ID from a job link
 */
export async function fetchAndParseRSSFeed(
  url: string,
  source: string,
  baseUrl: string,
  idExtractor: (link: string) => string
): Promise<JobItem[]> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Yemen-HR-Bot/1.0',
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`RSS fetch failed: ${response.status} ${response.statusText}`);
  }

  const xml = await response.text();

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
  });

  const result: ParsedFeed = parser.parse(xml);

  // Detect RSS 2.0 format: <rss><channel><item>
  if (result.rss?.channel?.item) {
    const items = Array.isArray(result.rss.channel.item)
      ? result.rss.channel.item
      : [result.rss.channel.item];
    return parseRSSItems(items, source, baseUrl, idExtractor);
  }

  // Detect Atom format: <feed><entry>
  if (result.feed?.entry) {
    const entries = Array.isArray(result.feed.entry)
      ? result.feed.entry
      : [result.feed.entry];
    return parseAtomEntries(entries, source, baseUrl, idExtractor);
  }

  return [];
}
