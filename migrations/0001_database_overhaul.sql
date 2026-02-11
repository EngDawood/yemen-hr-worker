-- Migration: D1 Database Overhaul
-- Adds: runs table, settings table, enhanced jobs columns, enhanced sources columns
-- Safe to run multiple times (IF NOT EXISTS / ADD COLUMN ignores duplicates in SQLite)

-- ============================================================================
-- New tables
-- ============================================================================

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

-- ============================================================================
-- Enhance sources table
-- ============================================================================

ALTER TABLE sources ADD COLUMN ai_prompt_config TEXT;
ALTER TABLE sources ADD COLUMN cron_schedule TEXT DEFAULT '0 * * * *';
ALTER TABLE sources ADD COLUMN updated_at TEXT DEFAULT (datetime('now'));

-- ============================================================================
-- Enhance jobs table
-- ============================================================================

ALTER TABLE jobs ADD COLUMN posted_date TEXT;
ALTER TABLE jobs ADD COLUMN deadline TEXT;
ALTER TABLE jobs ADD COLUMN how_to_apply TEXT;
ALTER TABLE jobs ADD COLUMN application_links TEXT;
ALTER TABLE jobs ADD COLUMN category TEXT;
ALTER TABLE jobs ADD COLUMN status TEXT DEFAULT 'posted';
ALTER TABLE jobs ADD COLUMN telegram_message_id INTEGER;
ALTER TABLE jobs ADD COLUMN run_id INTEGER;

-- New indexes
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_run_id ON jobs(run_id);
