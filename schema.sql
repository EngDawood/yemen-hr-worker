-- Yemen Jobs Bot — D1 Schema
-- 4 tables: sources (metadata), jobs (all fetched jobs), runs (pipeline history), settings (config)

-- ============================================================================
-- Sources: metadata for each job source plugin
-- ============================================================================
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,              -- matches JobSource type: 'yemenhr', 'eoi', etc.
  display_name TEXT NOT NULL,       -- human-readable name
  hashtag TEXT NOT NULL,            -- Telegram hashtag: '#YemenHR'
  type TEXT NOT NULL,               -- plugin type: 'rss' | 'scraper' | 'api'
  base_url TEXT NOT NULL,           -- site root URL
  feed_url TEXT,                    -- RSS/API endpoint (null for scrapers)
  enabled INTEGER DEFAULT 0,       -- 1 = active in registry, 0 = disabled
  ai_prompt_config TEXT,            -- JSON: { includeHowToApply, sourceHint, applyFallback }
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================================
-- Runs: pipeline execution history
-- ============================================================================
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  trigger_type TEXT NOT NULL,       -- 'cron' | 'manual' | 'webhook'
  status TEXT DEFAULT 'running',    -- 'running' | 'completed' | 'failed'
  jobs_fetched INTEGER DEFAULT 0,
  jobs_posted INTEGER DEFAULT 0,
  jobs_skipped INTEGER DEFAULT 0,
  jobs_failed INTEGER DEFAULT 0,
  source_stats TEXT,                -- JSON: per-source breakdown
  error TEXT,
  environment TEXT
);

CREATE INDEX IF NOT EXISTS idx_runs_started_at ON runs(started_at);

-- ============================================================================
-- Jobs: all fetched jobs (posted, skipped, failed, duplicate)
-- ============================================================================
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  company TEXT,
  location TEXT,
  description_raw TEXT,
  description_clean TEXT,
  ai_summary_ar TEXT,
  image_url TEXT,
  source_url TEXT,
  -- Structured metadata from source
  posted_date TEXT,                 -- Original posting date from source
  deadline TEXT,                    -- Application deadline
  how_to_apply TEXT,                -- Application instructions
  application_links TEXT,           -- JSON array of URLs/emails/phones
  category TEXT,                    -- AI-extracted Arabic category
  -- Processing state
  status TEXT DEFAULT 'fetched',    -- 'fetched' | 'posted' | 'skipped' | 'failed' | 'duplicate'
  telegram_message_id INTEGER,      -- For editing/deleting posts later
  run_id INTEGER,                   -- FK → runs(id)
  -- Timestamps
  posted_at TEXT,                   -- When posted to Telegram (null if not posted)
  scraped_at TEXT DEFAULT (datetime('now')),
  -- Computed
  word_count INTEGER,
  source TEXT DEFAULT 'rss' REFERENCES sources(id)
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_posted_at ON jobs(posted_at);
CREATE INDEX IF NOT EXISTS idx_jobs_source ON jobs(source);
CREATE INDEX IF NOT EXISTS idx_jobs_run_id ON jobs(run_id);
CREATE INDEX IF NOT EXISTS idx_jobs_company ON jobs(company);

-- ============================================================================
-- Settings: global config (prompt template, etc.)
-- ============================================================================
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================================
-- Migration: existing jobs default to 'posted' status, unknown sources → 'rss'
-- ============================================================================
UPDATE jobs SET source = 'rss' WHERE source NOT IN (SELECT id FROM sources);
