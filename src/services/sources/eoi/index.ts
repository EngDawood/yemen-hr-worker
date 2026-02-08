import type { JobItem, ProcessedJob } from '../../../types';
import type { JobSourcePlugin } from '../types';
import { fetchEOIJobsFromAPI, convertEOIJobToJobItem } from './scraper';
import { fetchEOIJobDetail } from './parser';

/**
 * EOI Yemen job source plugin.
 * Fetches jobs from EOI API and enriches with detail page scraping.
 */
export class EOIPlugin implements JobSourcePlugin {
  readonly name = 'eoi' as const;

  async fetchJobs(): Promise<JobItem[]> {
    const eoiJobs = await fetchEOIJobsFromAPI();
    return eoiJobs.map(convertEOIJobToJobItem);
  }

  async processJob(job: JobItem): Promise<ProcessedJob> {
    // Fetch detail page for full description
    const detail = await fetchEOIJobDetail(job.link);

    if (!detail) {
      // Fallback: Use metadata-only description
      return {
        title: job.title,
        company: job.company,
        link: job.link,
        description: job.description || 'No description available',
        imageUrl: null,
        source: 'eoi',
      };
    }

    // Extract metadata from job.description
    const categoryMatch = job.description?.match(/الفئة:\s*(.+)/);
    const category = categoryMatch ? categoryMatch[1].trim() : '';

    const locationMatch = job.description?.match(/الموقع:\s*(.+)/);
    const location = locationMatch ? locationMatch[1].trim() : '';

    const postedMatch = job.description?.match(/تاريخ النشر:\s*(.+)/);
    const postedDate = postedMatch ? postedMatch[1].trim() : '';

    return {
      title: job.title,
      company: job.company,
      link: job.link,
      description: detail.description || '',
      imageUrl: detail.imageUrl,
      location,
      postedDate,
      deadline: detail.deadline || undefined,
      howToApply: detail.howToApply || undefined,
      applicationLinks: detail.applicationLinks,
      source: 'eoi',
      category,
    };
  }
}
