-- Sources: metadata for each job source plugin
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,              -- matches JobSource type: 'yemenhr', 'eoi', etc.
  display_name TEXT NOT NULL,       -- human-readable name
  hashtag TEXT NOT NULL,            -- Telegram hashtag: '#YemenHR'
  type TEXT NOT NULL,               -- plugin type: 'rss' | 'scraper' | 'api'
  base_url TEXT NOT NULL,           -- site root URL
  feed_url TEXT,                    -- RSS/API endpoint (null for scrapers)
  enabled INTEGER DEFAULT 0,       -- 1 = active in registry, 0 = disabled
  created_at TEXT DEFAULT (datetime('now'))
);

-- Sources are synced from registry at runtime via syncSourcesTable()

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
  posted_at TEXT,
  scraped_at TEXT DEFAULT (datetime('now')),
  word_count INTEGER,
  has_salary INTEGER DEFAULT 0,
  source TEXT DEFAULT 'rss' REFERENCES sources(id)
);

CREATE INDEX IF NOT EXISTS idx_posted_at ON jobs(posted_at);
CREATE INDEX IF NOT EXISTS idx_company ON jobs(company);
CREATE INDEX IF NOT EXISTS idx_source ON jobs(source);

-- Migrate existing jobs with unknown sources to 'rss' default
UPDATE jobs SET source = 'rss' WHERE source NOT IN (SELECT id FROM sources);
