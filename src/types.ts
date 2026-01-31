export interface Env {
  POSTED_JOBS: KVNamespace;
  GEMINI_API_KEY: string;
  TELEGRAM_BOT_TOKEN: string;
  RSS_FEED_URL: string;
  TELEGRAM_CHAT_ID: string;
}

export interface JobItem {
  id: string;
  title: string;
  company: string;
  link: string;
  pubDate: string;
  imageUrl: string | null;
}

export interface ProcessedJob {
  title: string;
  company: string;
  link: string;
  description: string;
  imageUrl: string | null;
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
