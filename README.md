# Yemen HR Bot

A Cloudflare Worker that monitors [Yemen HR](https://yemenhr.com) for new job listings and posts them to Telegram with Arabic translation.

## Features

- Hourly RSS feed monitoring via RSS Bridge
- HTML content extraction and cleaning
- AI-powered Arabic translation using Cloudflare Workers AI
- Automatic posting to Telegram channel [@hr_yemen](https://t.me/hr_yemen)
- Duplicate detection using KV storage (30-day TTL)
- D1 database for permanent job archival (ML training data)
- FIFO ordering (oldest jobs posted first for chronological feed)
- Rate limiting with configurable delays
- Error alerting via Telegram

## Architecture

```
Cron (hourly) → Fetch RSS → Check KV → Clean HTML → Workers AI → Telegram → KV Mark → D1 Archive
```

### Services

| Service | File | Purpose |
|---------|------|---------|
| RSS | `src/services/rss.ts` | Fetch job listings from RSS Bridge |
| Cleaner | `src/services/cleaner.ts` | Extract clean text from HTML |
| Gemini | `src/services/gemini.ts` | AI translation via Workers AI |
| Telegram | `src/services/telegram.ts` | Post to Telegram channel |
| Storage | `src/services/storage.ts` | KV deduplication + D1 archival |

### Utilities

| Utility | File | Purpose |
|---------|------|---------|
| Format | `src/utils/format.ts` | Message formatting |
| Alert | `src/utils/alert.ts` | Error notifications |
| HTTP | `src/utils/http.ts` | HTTP helpers |

## Setup

### Prerequisites

- Node.js 18+
- Cloudflare account
- Wrangler CLI

### Installation

```bash
npm install
```

### Configuration

1. Create KV namespace:
```bash
wrangler kv:namespace create POSTED_JOBS
```

2. Create D1 database:
```bash
wrangler d1 create yemen-jobs
wrangler d1 execute yemen-jobs --file=schema.sql
```

3. Set secrets:
```bash
wrangler secret put TELEGRAM_BOT_TOKEN
```

4. Update `wrangler.toml` with your KV namespace ID and D1 database ID.

## Development

```bash
# Local development
npm run dev

# Type checking
npm run typecheck

# Run tests
npm test
```

## Deployment

```bash
# Deploy to production
npm run deploy

# Deploy to preview environment
npm run deploy -- --env preview
```

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `/` | Bot info and available endpoints |
| `/health` | Health check |
| `/api/jobs` | Export archived jobs as JSON |
| `/__scheduled` | Manually trigger job processing |

## Environment Variables

| Variable | Type | Description |
|----------|------|-------------|
| `RSS_FEED_URL` | var | RSS Bridge URL for Yemen HR |
| `TELEGRAM_CHAT_ID` | var | Telegram channel ID |
| `MAX_JOBS_PER_RUN` | var | Max jobs to process per run (default: 10) |
| `DELAY_BETWEEN_POSTS_MS` | var | Delay between posts in ms (default: 1000) |
| `TELEGRAM_BOT_TOKEN` | secret | Telegram Bot token |

## D1 Database Schema

The `yemen-jobs` D1 database stores full job data for ML training:

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT | Job ID (primary key) |
| `title` | TEXT | Job title |
| `company` | TEXT | Company name |
| `location` | TEXT | Job location |
| `description_raw` | TEXT | Original HTML description |
| `description_clean` | TEXT | Cleaned text description |
| `ai_summary_ar` | TEXT | Arabic AI summary |
| `image_url` | TEXT | Company logo URL |
| `source_url` | TEXT | Yemen HR job link |
| `posted_at` | TEXT | When posted to Telegram |
| `scraped_at` | TEXT | When archived to D1 |
| `word_count` | INTEGER | Description word count |

## Processing Limits

| Setting | Value | Reason |
|---------|-------|--------|
| `MAX_JOBS_PER_RUN` | 10 | Stay within rate limits |
| `DELAY_BETWEEN_POSTS_MS` | 1000 | Configurable post delay |
| Cron trigger | `0 * * * *` | Every hour at minute 0 |

## License

MIT
