export interface Env {
  POSTED_JOBS: KVNamespace;
  JOBS_DB: D1Database;
  AI: Ai;
  CF_VERSION_METADATA: { id: string; tag?: string };
  TELEGRAM_BOT_TOKEN: string;
  RSS_FEED_URL: string;
  TELEGRAM_CHAT_ID: string;
  // Optional configuration (with defaults)
  ENVIRONMENT?: string; // "production" | "preview"
  ADMIN_CHAT_ID?: string;
  MAX_JOBS_PER_RUN?: string;
  DELAY_BETWEEN_POSTS_MS?: string;
  LINKEDIN_URL?: string;
  AI_MODEL?: string; // Workers AI model ID (default: @cf/qwen/qwen3-30b-a3b-fp8)
  API_SECRET?: string; // Bearer token for write API endpoints (PATCH, PUT)
}

export type { JobSource } from './services/sources/registry';

export interface JobItem {
  id: string;
  title: string;
  company: string;
  link: string;
  pubDate: string;
  imageUrl: string | null;
  description?: string; // Full job description from expanded RSS feed
  source?: string; // Job source identifier (validated at registry level)
  howToApply?: string; // How to apply instructions
  applicationLinks?: string[]; // Application URLs, emails, phones
}

export interface ProcessedJob {
  title: string;
  company: string;
  link: string;
  description: string;
  imageUrl: string | null;
  location?: string;
  postedDate?: string;
  deadline?: string;
  howToApply?: string; // How to apply instructions
  applicationLinks?: string[]; // Application URLs, emails, phones
  source?: string; // Job source identifier (validated at registry level)
  category?: string;
}

export interface TelegramMessage {
  fullMessage: string;
  imageUrl: string | null;
  hasImage: boolean;
}

export interface PostedJobRecord {
  postedAt: string;
  title: string;
  company?: string;
}

// ============================================================================
// D1 Database Records
// ============================================================================

export type JobStatus = 'fetched' | 'posted' | 'skipped' | 'failed' | 'duplicate';

/** Result from Telegram send operations */
export interface TelegramSendResult {
  success: boolean;
  messageId: number | null;
}

/** D1 runs table row */
export interface RunRecord {
  id: number;
  started_at: string;
  completed_at: string | null;
  trigger_type: 'cron' | 'manual' | 'webhook';
  status: 'running' | 'completed' | 'failed';
  jobs_fetched: number;
  jobs_posted: number;
  jobs_skipped: number;
  jobs_failed: number;
  source_stats: string | null; // JSON
  error: string | null;
  environment: string | null;
}

/** D1 sources table row */
export interface SourceRecord {
  id: string;
  display_name: string;
  hashtag: string;
  type: 'rss' | 'scraper' | 'api';
  base_url: string;
  feed_url: string | null;
  enabled: number; // 0 or 1
  ai_prompt_config: string | null; // JSON
  cron_schedule: string; // cron expression: '0 * * * *', '0 */6 * * *', '0 0 * * *'
  created_at: string;
  updated_at: string;
}

/** D1 jobs table row */
export interface JobRecord {
  id: string;
  title: string;
  company: string | null;
  location: string | null;
  description_raw: string | null;
  description_clean: string | null;
  ai_summary_ar: string | null;
  image_url: string | null;
  source_url: string | null;
  posted_date: string | null;
  deadline: string | null;
  how_to_apply: string | null;
  application_links: string | null; // JSON array
  category: string | null;
  status: JobStatus;
  telegram_message_id: number | null;
  run_id: number | null;
  posted_at: string | null;
  scraped_at: string;
  word_count: number | null;
  source: string;
}

/** D1 settings table row */
export interface SettingRecord {
  key: string;
  value: string;
  updated_at: string;
}

/** Paginated API response */
export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
