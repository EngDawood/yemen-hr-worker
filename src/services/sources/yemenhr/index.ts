import type { Env, JobItem, ProcessedJob } from '../../../types';
import type { JobSourcePlugin, AISummaryResult } from '../types';
import { fetchYemenHRJobs } from './fetcher';
import { processYemenHRJob } from './processor';
import { summarizeJob } from '../../gemini';

/**
 * Yemen HR job source plugin.
 * Fetches jobs from RSS Bridge feed and processes them.
 */
export class YemenHRPlugin implements JobSourcePlugin {
  readonly name = 'yemenhr' as const;

  async fetchJobs(env?: Env): Promise<JobItem[]> {
    if (!env?.RSS_FEED_URL) {
      throw new Error('RSS_FEED_URL not configured');
    }
    return fetchYemenHRJobs(env.RSS_FEED_URL);
  }

  async processJob(job: JobItem): Promise<ProcessedJob> {
    return processYemenHRJob(job);
  }

  async summarize(job: ProcessedJob, env: Env): Promise<AISummaryResult> {
    return summarizeJob(job, env);
  }
}
