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
}

export type JobSource = 'yemenhr' | 'eoi';

export interface JobItem {
  id: string;
  title: string;
  company: string;
  link: string;
  pubDate: string;
  imageUrl: string | null;
  description?: string; // Full job description from expanded RSS feed
  source?: JobSource; // Job source for cross-source deduplication
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
