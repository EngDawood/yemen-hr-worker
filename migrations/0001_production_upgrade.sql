-- Production migration: upgrade old schema to D1 overhaul
-- Safe: all operations are additive (no drops, no deletes)

-- 1. New tables
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  hashtag TEXT NOT NULL,
  type TEXT NOT NULL,
  base_url TEXT NOT NULL,
  feed_url TEXT,
  enabled INTEGER DEFAULT 0,
  ai_prompt_config TEXT,
  cron_schedule TEXT DEFAULT '0 * * * *',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  trigger_type TEXT NOT NULL,
  status TEXT DEFAULT 'running',
  jobs_fetched INTEGER DEFAULT 0,
  jobs_posted INTEGER DEFAULT 0,
  jobs_skipped INTEGER DEFAULT 0,
  jobs_failed INTEGER DEFAULT 0,
  source_stats TEXT,
  error TEXT,
  environment TEXT
);

CREATE INDEX IF NOT EXISTS idx_runs_started_at ON runs(started_at);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 2. Add missing columns to jobs (ALTER TABLE ADD COLUMN is safe — no-op if exists in newer SQLite, errors caught by D1)
ALTER TABLE jobs ADD COLUMN status TEXT DEFAULT 'posted';
ALTER TABLE jobs ADD COLUMN telegram_message_id INTEGER;
ALTER TABLE jobs ADD COLUMN run_id INTEGER;
ALTER TABLE jobs ADD COLUMN posted_date TEXT;
ALTER TABLE jobs ADD COLUMN deadline TEXT;
ALTER TABLE jobs ADD COLUMN how_to_apply TEXT;
ALTER TABLE jobs ADD COLUMN application_links TEXT;

-- 3. Existing 75 jobs are all posted — mark them
UPDATE jobs SET status = 'posted' WHERE status IS NULL;

-- 4. Default unknown sources to 'rss'
UPDATE jobs SET source = 'rss' WHERE source IS NULL;

-- 5. Indices on jobs
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_posted_at ON jobs(posted_at);
CREATE INDEX IF NOT EXISTS idx_jobs_source ON jobs(source);
CREATE INDEX IF NOT EXISTS idx_jobs_run_id ON jobs(run_id);
CREATE INDEX IF NOT EXISTS idx_jobs_company ON jobs(company);
