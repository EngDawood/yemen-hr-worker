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
  has_salary INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_posted_at ON jobs(posted_at);
CREATE INDEX IF NOT EXISTS idx_company ON jobs(company);
