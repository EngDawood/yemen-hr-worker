import type { Env, JobItem, ProcessedJob } from '../../types';

/**
 * Plugin interface for job sources.
 * Each source (Yemen HR, EOI, etc.) implements this interface.
 * AI summarization is handled by the pipeline, not by plugins.
 */
export interface JobSourcePlugin {
  /** Source identifier (e.g., 'yemenhr', 'eoi'). Type safety enforced at registry level. */
  readonly name: string;

  /**
   * Fetch jobs from this source.
   * @param env - Cloudflare environment bindings
   * @returns Array of raw job items
   */
  fetchJobs(env?: Env): Promise<JobItem[]>;

  /**
   * Process a single job item (e.g., clean HTML, fetch details).
   * @param job - Raw job item from fetchJobs()
   * @param env - Cloudflare environment bindings
   * @returns Processed job ready for AI summarization
   */
  processJob(job: JobItem, env?: Env): Promise<ProcessedJob>;
}
