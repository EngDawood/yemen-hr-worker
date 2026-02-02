export interface Env {
  POSTED_JOBS: KVNamespace;
  JOBS_DB: D1Database;
  AI: Ai;
  TELEGRAM_BOT_TOKEN: string;
  RSS_FEED_URL: string;
  TELEGRAM_CHAT_ID: string;
  // Optional configuration (with defaults)
  ADMIN_CHAT_ID?: string;
  MAX_JOBS_PER_RUN?: string;
  DELAY_BETWEEN_POSTS_MS?: string;
  LINKEDIN_URL?: string;
}

export interface JobItem {
  id: string;
  title: string;
  company: string;
  link: string;
  pubDate: string;
  imageUrl: string | null;
  description?: string; // Full job description from expanded RSS feed
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
}

export interface TelegramMessage {
  fullMessage: string;
  imageUrl: string | null;
  hasImage: boolean;
}

export interface PostedJobRecord {
  postedAt: string;
  title: string;
}
