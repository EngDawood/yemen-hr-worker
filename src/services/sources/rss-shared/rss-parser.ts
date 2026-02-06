/**
 * Shared RSS/Atom feed parser.
 * Parses Atom feeds into a normalized job item structure.
 */

import { XMLParser } from 'fast-xml-parser';
import type { JobItem, JobSource } from '../../../types';

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

/**
 * Fetch and parse an Atom/RSS feed URL into JobItems.
 *
 * @param url - Feed URL
 * @param source - Source name to tag each job with
 * @param baseUrl - Base URL for resolving relative image URLs
 * @param idExtractor - Function to extract a unique ID from a job link
 */
export async function fetchAndParseRSSFeed(
  url: string,
  source: JobSource,
  baseUrl: string,
  idExtractor: (link: string) => string
): Promise<JobItem[]> {
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
