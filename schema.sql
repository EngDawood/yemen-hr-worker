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

-- Seed sources: 'rss' is the catch-all default for unknown sources
INSERT OR IGNORE INTO sources (id, display_name, hashtag, type, base_url, feed_url, enabled) VALUES
  ('rss',       'RSS',           '#RSS',          'rss',     '',                                   NULL, 1),
  ('yemenhr',   'Yemen HR',      '#YemenHR',      'rss',     'https://yemenhr.com',                NULL, 1),
  ('eoi',       'EOI Yemen',     '#EOI',          'api',     'https://eoi-ye.com',                 'https://eoi-ye.com/live_search/action1?type=0&title=', 1),
  ('reliefweb', 'ReliefWeb',     '#ReliefWeb',    'rss',     'https://reliefweb.int',              'https://reliefweb.int/jobs/rss.xml?advanced-search=%28C255%29', 1),
  ('ykbank',    'YK Bank',       '#YKBank',       'rss',     'https://yk-bank.zohorecruit.com',    'https://yk-bank.zohorecruit.com/jobs/Careers/rss', 0),
  ('kuraimi',   'Kuraimi Bank',  '#KuraimiBank',  'scraper', 'https://jobs.kuraimibank.com',       NULL, 0),
  ('qtb',       'QTB Bank',      '#QTBBank',      'scraper', 'https://jobs.qtbbank.com',           NULL, 0),
  ('yldf',      'YLDF',          '#YLDF',         'scraper', 'https://erp.yldf.org',               NULL, 0);

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
