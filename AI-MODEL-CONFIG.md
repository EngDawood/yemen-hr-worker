# Configurable AI Model

## Summary
Made the Workers AI model configurable via environment variable instead of hardcoding it in the code. This allows easy model switching without code changes.

## Changes Made

### 1. Types (`src/types.ts`)
Added `AI_MODEL` as optional environment variable:
```typescript
AI_MODEL?: string; // Workers AI model ID (default: @cf/qwen/qwen3-30b-a3b-fp8)
```

### 2. Gemini Service (`src/services/gemini.ts`)
- Added `DEFAULT_AI_MODEL` constant: `'@cf/qwen/qwen3-30b-a3b-fp8'`
- Updated `callWorkersAI()` to accept `aiModel` parameter with default fallback
- Updated `summarizeJob()` and `summarizeEOIJob()` to:
  - Accept `env: Env` instead of just `ai: Ai`
  - Extract AI model from `env.AI_MODEL` with fallback to default
  - Pass model to `callWorkersAI()`

### 3. Plugin Interface (`src/services/sources/types.ts`)
Updated `summarize()` method signature:
```typescript
// Before
summarize(job: ProcessedJob, ai: Ai): Promise<AISummaryResult>;

// After
summarize(job: ProcessedJob, env: Env): Promise<AISummaryResult>;
```

### 4. Plugin Implementations
Updated both plugins to pass `env` instead of `ai`:
- `src/services/sources/yemenhr/index.ts`
- `src/services/sources/eoi/index.ts`

### 5. Main Pipeline (`src/index.ts`)
Updated plugin call to pass full `env`:
```typescript
// Before
const { summary, category } = await plugin.summarize(processedJob, env.AI);

// After
const { summary, category } = await plugin.summarize(processedJob, env);
```

### 6. Admin Commands (`src/services/commands.ts`)
Updated preview command handlers to pass `env` instead of `env.AI`:
```typescript
const aiResult = await summarizeJob(processedJob, env);
const eoiAIResult = await summarizeEOIJob(processedJob, env);
```

### 7. Configuration (`wrangler.toml`)
Added `AI_MODEL` to both production and preview environments:
```toml
[vars]
AI_MODEL = "@cf/qwen/qwen3-30b-a3b-fp8"  # Workers AI model for translation/summarization

[env.preview.vars]
AI_MODEL = "@cf/qwen/qwen3-30b-a3b-fp8"  # Workers AI model for translation/summarization
```

## Usage

### Changing the Model

Edit `wrangler.toml` and update the `AI_MODEL` variable:

```toml
# Example: Switch to Llama 3.3 70B
AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast"

# Example: Switch to Gemma 2 9B
AI_MODEL = "@cf/google/gemma-2-9b-it"

# Example: Switch to Mistral 7B
AI_MODEL = "@cf/mistral/mistral-7b-instruct-v0.2-lora"
```

Then deploy:
```bash
npm run deploy --env preview  # Deploy to preview
npm run deploy                # Deploy to production
```

### Testing Different Models

Test in preview environment first:
```bash
# 1. Update wrangler.toml [env.preview.vars] AI_MODEL
# 2. Deploy to preview
npx wrangler deploy --env preview

# 3. Trigger manually
curl https://yemen-hr-worker-preview.your-subdomain.workers.dev/__scheduled

# 4. Check logs
npx wrangler tail --env preview
```

### Available Models

See Cloudflare Workers AI catalog:
- https://developers.cloudflare.com/workers-ai/models/

Popular models for translation/summarization:
- `@cf/qwen/qwen3-30b-a3b-fp8` (current, good quality)
- `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (larger, better quality)
- `@cf/google/gemma-2-9b-it` (smaller, faster)
- `@cf/mistral/mistral-7b-instruct-v0.2-lora` (alternative)

## Default Behavior

If `AI_MODEL` is not set in `wrangler.toml`, the default model is used:
```typescript
const DEFAULT_AI_MODEL = '@cf/qwen/qwen3-30b-a3b-fp8';
```

## Benefits

✅ **No code changes** - Change model by editing config file only
✅ **Environment-specific** - Use different models for preview vs production
✅ **Easy testing** - Test new models in preview before production
✅ **Backward compatible** - Falls back to default if not configured
✅ **Type-safe** - TypeScript validates the configuration

## Rollback

If a new model doesn't work well:
1. Edit `wrangler.toml` and revert `AI_MODEL` to previous value
2. Redeploy: `npm run deploy`
3. Old model is restored

## Performance Considerations

Different models have different trade-offs:
- **Quality**: Larger models (70B) produce better translations but are slower
- **Speed**: Smaller models (7B-9B) are faster but may have lower quality
- **Cost**: Larger models use more compute units
- **Tokens**: Models have different context limits

**Recommendation**: Test in preview environment and compare:
- Translation quality (Arabic fluency)
- Response time (should be < 5s)
- Error rate (AI failures)
- Token usage (check Workers AI dashboard)
