# Yemen HR Bot

A Cloudflare Worker that monitors [Yemen HR](https://yemenhr.com) for new job listings and posts them to Telegram with Arabic translation.

## Features

- Hourly RSS feed monitoring via RSS Bridge
- HTML content extraction from RSS feed
- AI-powered Arabic translation using Google Gemini 1.5 Flash (v1 API)
- Automatic posting to Telegram channel [@yemenjobss](https://t.me/yemenjobss)
- Duplicate detection using KV storage
- Rate limiting with exponential backoff (5s delay, 12 RPM)

## Architecture

```
Cron (hourly) → Fetch RSS → Check KV → Clean HTML → Gemini AI → Telegram → Mark Posted
```

### Services

| Service | File | Purpose |
|---------|------|---------|
| RSS | `src/services/rss.ts` | Fetch job listings from RSS Bridge |
| Scraper | `src/services/scraper.ts` | Fetch full job HTML from Yemen HR |
| Cleaner | `src/services/cleaner.ts` | Extract clean text from HTML |
| Gemini | `src/services/gemini.ts` | AI translation to Arabic |
| Telegram | `src/services/telegram.ts` | Post to Telegram channel |
| Storage | `src/services/storage.ts` | Track posted jobs in KV |

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

2. Set secrets:
```bash
wrangler secret put GEMINI_API_KEY
wrangler secret put TELEGRAM_BOT_TOKEN
```

3. Update `wrangler.toml` with your KV namespace ID.

## Development

```bash
# Local development
npm run dev

# Test scheduled trigger locally
npm run dev:scheduled

# Type checking
npm run typecheck

# Run tests
npm test
```

## Deployment

```bash
npm run deploy
```

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `/` | Bot info and available endpoints |
| `/health` | Health check |
| `/__scheduled` | Manually trigger job processing |

## Environment Variables

| Variable | Type | Description |
|----------|------|-------------|
| `RSS_FEED_URL` | var | RSS Bridge URL for Yemen HR |
| `TELEGRAM_CHAT_ID` | var | Telegram channel (@yemenjobss) |
| `GEMINI_API_KEY` | secret | Google Gemini API key |
| `TELEGRAM_BOT_TOKEN` | secret | Telegram Bot token |

## License

MIT
