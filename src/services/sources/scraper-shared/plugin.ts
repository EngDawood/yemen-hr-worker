/**
 * Generic HTML scraper-based job source plugin.
 * Config-driven: new SSR sites only need a ScraperSourceConfig.
 */

import type { Env, JobItem, ProcessedJob } from '../../../types';
import type { JobSourcePlugin } from '../types';
import type { ScraperSourceConfig } from './types';
import { fetchAndParseHTMLJobs } from './fetcher';
import { parseHTML, extractText, extractAttr } from './html-parser';
import { htmlToText, cleanWhitespace } from '../../../utils/html';

export class ScraperPlugin implements JobSourcePlugin {
  readonly name;
  private config: ScraperSourceConfig;

  constructor(config: ScraperSourceConfig) {
    this.name = config.sourceName;
    this.config = config;
  }

  async fetchJobs(env?: Env): Promise<JobItem[]> {
    return fetchAndParseHTMLJobs(this.config);
  }

  async processJob(job: JobItem, env?: Env): Promise<ProcessedJob> {
    // Custom processor override
    if (this.config.processJob) {
      return this.config.processJob(job);
    }

    let description = job.description || '';
    let imageUrl = job.imageUrl;

    // Parse structured metadata from listing-page description BEFORE detail page overwrites it
    const locMatch = description.match(/Location:\s*(.+)/i);
    const location = locMatch ? locMatch[1].trim() : undefined;
    const pdMatch = description.match(/PostedDate:\s*(.+)/i);
    const postedDate = pdMatch ? pdMatch[1].trim() : undefined;
    const dlMatch = description.match(/Deadline:\s*(.+)/i);
    const deadline = dlMatch ? dlMatch[1].trim() : undefined;
    const catMatch = description.match(/Category:\s*(.+)/i);
    const category = catMatch ? catMatch[1].trim() : undefined;

    // Fetch detail page for full description if configured
    if (this.config.detailPage) {
      try {
        let detailHtml = await this.fetchDetailPage(job.link);
        if (detailHtml) {
          if (this.config.detailPage.htmlTransform) {
            detailHtml = this.config.detailPage.htmlTransform(detailHtml);
          }
          const doc = parseHTML(detailHtml);

          // Remove cleanup elements before extracting description
          if (this.config.detailPage.cleanupSelectors) {
            for (const sel of this.config.detailPage.cleanupSelectors) {
              for (const el of doc.querySelectorAll(sel)) {
                el.remove();
              }
            }
          }

          const descEl = doc.querySelector(this.config.detailPage.descriptionSelector);
          if (descEl) {
            description = cleanWhitespace(htmlToText(descEl.innerHTML));
          }

          // Extract image from detail page if configured and no listing-page image
          if (this.config.detailPage.imageSelector && !imageUrl) {
            imageUrl = extractAttr(doc, this.config.detailPage.imageSelector, 'src', this.config.baseUrl);
          }
        }
      } catch (err) {
        // Detail page fetch failed — fall back to listing-page description
        console.warn(`[${this.config.sourceName}] Detail page fetch failed for ${job.link}: ${err}`);
      }
    }

    // Fall back to default image if no per-job image found
    if (!imageUrl && this.config.defaultImage) {
      imageUrl = this.config.defaultImage;
    }

    return {
      title: job.title,
      company: job.company,
      link: job.link,
      description: description || 'No description available',
      imageUrl,
      location,
      postedDate,
      deadline,
      category,
      source: this.config.sourceName,
    };
  }

  private async fetchDetailPage(url: string): Promise<string | null> {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Yemen-Jobs-Bot/1.0' },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) return null;
    return response.text();
  }
}
