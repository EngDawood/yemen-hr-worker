import type { Env, JobItem, ProcessedJob, JobSource } from '../../types';

/**
 * Result from AI summarization with category classification.
 */
export interface AISummaryResult {
  summary: string;
  category: string;
}

/**
 * Plugin interface for job sources.
 * Each source (Yemen HR, EOI, etc.) implements this interface.
 */
export interface JobSourcePlugin {
  /** Source identifier (e.g., 'yemenhr', 'eoi') */
  readonly name: JobSource;

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

  /**
   * Generate AI summary and category for a job.
   * @param job - Processed job from processJob()
   * @param ai - Cloudflare Workers AI binding
   * @returns AI-generated summary and category
   */
  summarize(job: ProcessedJob, ai: Ai): Promise<AISummaryResult>;
}
