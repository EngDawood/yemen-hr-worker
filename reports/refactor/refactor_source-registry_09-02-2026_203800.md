# REFACTORING ANALYSIS REPORT
**Generated**: 09-02-2026 20:38:00
**Target**: Source registration system (7-9 files with hardcoded source names)
**Problem**: Removing one source (kuraimi) required editing 9 files — classic shotgun surgery
**Report ID**: refactor_source-registry_09-02-2026_203800

## EXECUTIVE SUMMARY

Adding or removing a job source currently requires touching 9 files with hardcoded source names: `types.ts` (type union), `format.ts` (hashtags), `ai-prompts.ts` (AI config), `registry.ts` (plugin), `configs.ts` (scraper/RSS), `schema.sql` (D1 seed), and 3 test files. The registry already acts as the informal source of truth but doesn't carry enough metadata. The fix: extend the registry entry to include all source metadata (hashtag, display name, AI prompt config, D1 metadata), then derive everything else from it.

**Effort**: ~4-6 hours implementation, low risk
**Result**: Adding a source = 1 config object. Removing = delete it. Everything else auto-derives.

## CURRENT STATE: THE SHOTGUN SURGERY PROBLEM

### Hardcoded Touchpoints (9 files)

| # | File | What's Hardcoded | Lines |
|---|------|-----------------|-------|
| 1 | `src/types.ts:18` | `JobSource` type union — manual string literal list | 1 |
| 2 | `src/utils/format.ts:9-17` | `SOURCE_HASHTAGS` — `Record<JobSource, string>` forces ALL sources listed | 9 |
| 3 | `src/services/ai-prompts.ts:38-69` | `SOURCE_PROMPT_CONFIGS` — per-source AI configs | 32 |
| 4 | `src/services/sources/registry.ts:19-27` | `SOURCES` map — plugin instances + enabled flag | 9 |
| 5 | `src/services/sources/scraper-shared/configs.ts` | Scraper config exports (selectors, ID extractors) | varies |
| 6 | `src/services/sources/rss-shared/configs.ts` | RSS config exports (feed URLs, processors) | varies |
| 7 | `schema.sql:14-21` | D1 `INSERT` seed — display_name, hashtag, type, URLs | 8 |
| 8 | `test/sources.test.ts:22-28` | Hardcoded source count + `toContain` per source name | 7 |
| 9 | `test/ai.test.ts:168-220` | Per-source AI config test cases | 50+ |

Files 5-6 (config definitions) are inherently per-source — they stay. The problem is files 1-4 and 7-9 which duplicate metadata that should be derived.

### Dependency Flow (Current)

```
types.ts (JobSource union) ← manually maintained
    ↑ imported by everything
    |
registry.ts (SOURCES map) ← uses JobSource type
    |
format.ts (SOURCE_HASHTAGS) ← uses JobSource, separate Record
ai-prompts.ts (SOURCE_PROMPT_CONFIGS) ← uses JobSource, separate Partial<Record>
schema.sql (D1 seed) ← completely separate, manual SQL
```

Each arrow = a hardcoded list that must stay in sync manually.

## PROPOSED ARCHITECTURE

### Core Idea: Registry Owns All Metadata

```
registry.ts (SOURCES — single source of truth)
    ↓ derives
    ├── JobSource type (keyof typeof SOURCES)
    ├── SOURCE_HASHTAGS (mapped from registry)
    ├── SOURCE_PROMPT_CONFIGS (mapped from registry)
    └── D1 seed (generated from registry at deploy/migrate time)
```

### New SourceDefinition Interface

```typescript
// src/services/sources/registry.ts

import type { AIPromptConfig } from '../ai-prompts';
import type { JobSourcePlugin } from './types';

/** Complete definition of a job source — single place to add/remove sources */
export interface SourceDefinition {
  plugin: JobSourcePlugin;
  enabled: boolean;

  // Telegram metadata
  hashtag: string;
  displayName: string;

  // AI prompt behavior (optional — falls back to safe defaults)
  aiPrompt?: AIPromptConfig;

  // D1 metadata
  type: 'rss' | 'scraper' | 'api';
  baseUrl: string;
  feedUrl?: string;
}
```

### New Registry (The Only Place You Touch)

```typescript
const SOURCES = {
  rss: {
    plugin: new RSSPlugin(/* inline or imported config */),
    enabled: true,
    hashtag: '#\u0648\u0638\u0627\u0626\u0641',
    displayName: 'RSS',
    type: 'rss' as const,
    baseUrl: '',
    aiPrompt: { includeHowToApply: false, applyFallback: '\u0631\u0627\u062c\u0639 \u0631\u0627\u0628\u0637 \u0627\u0644\u0648\u0638\u064a\u0641\u0629 \u0623\u062f\u0646\u0627\u0647' },
  },
  yemenhr: {
    plugin: new ScraperPlugin(yemenhrScraperConfig),
    enabled: true,
    hashtag: '#YemenHR',
    displayName: 'Yemen HR',
    type: 'scraper' as const,
    baseUrl: 'https://yemenhr.com',
    aiPrompt: {
      includeHowToApply: false,
      applyFallback: '\u0631\u0627\u062c\u0639 \u0631\u0627\u0628\u0637 \u0627\u0644\u0648\u0638\u064a\u0641\u0629 \u0623\u062f\u0646\u0627\u0647',
      sourceHint: 'This job is from YemenHR.com, a Yemeni job board. Jobs are in Yemen \u2014 location should specify the city. No application contact info is extracted \u2014 do NOT invent any.',
    },
  },
  eoi: {
    plugin: new ScraperPlugin(eoiScraperConfig),
    enabled: true,
    hashtag: '#EOI',
    displayName: 'EOI Yemen',
    type: 'api' as const,
    baseUrl: 'https://eoi-ye.com',
    feedUrl: 'https://eoi-ye.com/live_search/action1?type=0&title=',
    aiPrompt: {
      includeHowToApply: true,
      sourceHint: 'This job is from EOI Yemen (eoi-ye.com)...',
    },
  },
  // ... etc. Adding a source = add one block here. Removing = delete it.
} as const satisfies Record<string, SourceDefinition>;
```

### Deriving JobSource Type

```typescript
// src/types.ts — BEFORE
export type JobSource = 'rss' | 'yemenhr' | 'eoi' | 'reliefweb' | 'ykbank' | 'qtb' | 'yldf';

// src/types.ts — AFTER
// JobSource is now derived from the registry. No manual maintenance.
export type { JobSource } from './services/sources/registry';

// In registry.ts:
export type JobSource = keyof typeof SOURCES;
```

**TypeScript constraint**: `as const satisfies Record<string, SourceDefinition>` preserves literal key types so `keyof typeof SOURCES` produces the correct union.

### Deriving SOURCE_HASHTAGS

```typescript
// src/utils/format.ts — BEFORE (9 hardcoded lines)
const SOURCE_HASHTAGS: Record<JobSource, string> = {
  rss: '#\u0648\u0638\u0627\u0626\u0641', yemenhr: '#YemenHR', eoi: '#EOI', ...
};

// src/utils/format.ts — AFTER (1 line, auto-derived)
import { getHashtags } from '../services/sources/registry';
const SOURCE_HASHTAGS = getHashtags();

// In registry.ts:
export function getHashtags(): Record<JobSource, string> {
  return Object.fromEntries(
    Object.entries(SOURCES).map(([k, v]) => [k, v.hashtag])
  ) as Record<JobSource, string>;
}
```

### Deriving AI Prompt Configs

```typescript
// src/services/ai-prompts.ts — BEFORE (32 hardcoded lines)
const SOURCE_PROMPT_CONFIGS: Partial<Record<JobSource, AIPromptConfig>> = {
  eoi: { includeHowToApply: true, ... },
  yemenhr: { includeHowToApply: false, ... },
  // ...
};

// src/services/ai-prompts.ts — AFTER (1 line, auto-derived)
import { getAIPromptConfigs } from './sources/registry';
const SOURCE_PROMPT_CONFIGS = getAIPromptConfigs();

// In registry.ts:
export function getAIPromptConfigs(): Partial<Record<JobSource, AIPromptConfig>> {
  return Object.fromEntries(
    Object.entries(SOURCES)
      .filter(([_, v]) => v.aiPrompt)
      .map(([k, v]) => [k, v.aiPrompt!])
  ) as Partial<Record<JobSource, AIPromptConfig>>;
}
```

### Deriving D1 Seed SQL

Two approaches:

**Option A (recommended): Generate SQL from registry at build time**
```typescript
// scripts/generate-schema-seed.ts (or inline in schema.sql generation)
export function generateSourcesSeed(): string {
  const rows = Object.entries(SOURCES).map(([id, s]) =>
    `  ('${id}', '${s.displayName}', '${s.hashtag}', '${s.type}', '${s.baseUrl}', ${s.feedUrl ? `'${s.feedUrl}'` : 'NULL'}, ${s.enabled ? 1 : 0})`
  );
  return `INSERT OR IGNORE INTO sources (id, display_name, hashtag, type, base_url, feed_url, enabled) VALUES\n${rows.join(',\n')};`;
}
```

**Option B: Sync at runtime via scheduled handler**
```typescript
// In pipeline or index.ts scheduled handler:
async function syncSourcesTable(env: Env) {
  for (const [id, def] of Object.entries(SOURCES)) {
    await env.JOBS_DB.prepare(
      'INSERT OR REPLACE INTO sources (id, display_name, hashtag, type, base_url, feed_url, enabled) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(id, def.displayName, def.hashtag, def.type, def.baseUrl, def.feedUrl ?? null, def.enabled ? 1 : 0).run();
  }
}
```

Option B is simpler and self-healing — D1 always matches the registry. Run once per deploy or on scheduled trigger.

### Default Source Constant

```typescript
// registry.ts
export const DEFAULT_SOURCE: JobSource = 'rss';

// storage.ts:94 — BEFORE
source: JobSource = 'rss'
// storage.ts:94 — AFTER
source: JobSource = DEFAULT_SOURCE

// pipeline.ts:152 — BEFORE
const source = job.source || 'rss';
// pipeline.ts:152 — AFTER
const source = job.source || DEFAULT_SOURCE;
```

## IMPACT ON EXISTING FILES

### Files That Change

| File | Change | Effort |
|------|--------|--------|
| `registry.ts` | Extend `SourceEntry` → `SourceDefinition`, add metadata, export derivation functions, export `JobSource` type | Medium |
| `types.ts` | Replace manual `JobSource` union with re-export from registry | Trivial |
| `format.ts` | Replace `SOURCE_HASHTAGS` literal with `getHashtags()` call | Trivial |
| `ai-prompts.ts` | Replace `SOURCE_PROMPT_CONFIGS` literal with `getAIPromptConfigs()` call | Trivial |
| `storage.ts` | Import `DEFAULT_SOURCE` instead of hardcoded `'rss'` | Trivial |
| `pipeline.ts` | Import `DEFAULT_SOURCE` instead of hardcoded `'rss'` | Trivial |
| `schema.sql` | Remove seed INSERT (moved to runtime sync or build script) | Trivial |

### Files That DON'T Change

| File | Why |
|------|-----|
| `scraper-shared/configs.ts` | Config objects are inherently per-source — they define the scraping logic |
| `rss-shared/configs.ts` | Same — feed URLs and processors are per-source |
| `scraper-shared/types.ts` | Interface definition, no hardcoding |
| `rss-shared/types.ts` | Interface definition, no hardcoding |
| `pipeline.ts` (most of it) | Already uses `getEnabledSources()` dynamically |

### Test Changes

| Test File | Change |
|-----------|--------|
| `test/sources.test.ts` | Replace hardcoded count/names with dynamic: `const sources = getAllSources(); expect(sources.length).toBeGreaterThan(0);` |
| `test/ai.test.ts` | Table-driven tests: iterate over `getConfiguredSources()` instead of per-source `it()` blocks |
| `test/scraper.test.ts` | No source name hardcoding needed — tests use imported config objects directly |

## CIRCULAR DEPENDENCY RISK

**Potential issue**: `registry.ts` imports from `scraper-shared/configs.ts` and `rss-shared/configs.ts`. If those configs import `JobSource` from `types.ts`, and `types.ts` re-exports from `registry.ts`, we get a cycle.

**Solution**: The config types (`ScraperSourceConfig`, `RSSSourceConfig`) use `sourceName: JobSource`. After refactoring, `JobSource` comes from `registry.ts`. But configs are imported BY registry, creating:

```
registry.ts → configs.ts → types.ts → registry.ts  (CYCLE!)
```

**Fix**: Change `sourceName` in config types from `JobSource` to `string`. The registry enforces type safety at registration time via `satisfies Record<string, SourceDefinition>`. The configs themselves don't need the type constraint — they're just data.

```typescript
// scraper-shared/types.ts — BEFORE
sourceName: JobSource;

// scraper-shared/types.ts — AFTER
sourceName: string;  // Type safety enforced at registry level
```

This is actually cleaner — configs are pure data, registry enforces the contract.

## RISK ASSESSMENT

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Circular dependency | High (if not handled) | Build failure | Change config `sourceName` to `string` |
| `as const satisfies` TS version | Low | Build failure | Requires TS 4.9+ (project already uses 5.x) |
| Runtime sync missing sources in D1 | Low | Fallback to 'rss' | Sync on every scheduled trigger |
| Test breakage from type changes | Medium | Test failures | Run tests after each step |

## IMPLEMENTATION PLAN

### Step 1: Create SourceDefinition Interface (10 min)
Add `SourceDefinition` interface in `registry.ts` with all metadata fields. Keep existing `SourceEntry` temporarily.

### Step 2: Extend Registry Entries (20 min)
Add `hashtag`, `displayName`, `aiPrompt`, `type`, `baseUrl`, `feedUrl` to each entry in SOURCES. Use `as const satisfies`.

### Step 3: Export Derivation Functions (15 min)
Add `getHashtags()`, `getAIPromptConfigs()`, `DEFAULT_SOURCE`, `generateSourcesSeed()` to registry.

### Step 4: Export JobSource Type from Registry (10 min)
Add `export type JobSource = keyof typeof SOURCES;` in registry. Update `types.ts` to re-export.

### Step 5: Break Circular Dependency (5 min)
Change `sourceName` from `JobSource` to `string` in `ScraperSourceConfig` and `RSSSourceConfig`.

### Step 6: Update Consumers (15 min)
- `format.ts`: Use `getHashtags()`
- `ai-prompts.ts`: Use `getAIPromptConfigs()`
- `storage.ts` + `pipeline.ts`: Use `DEFAULT_SOURCE`

### Step 7: Add D1 Sync Function (15 min)
Add `syncSourcesTable()` to registry. Call from scheduled handler. Remove hardcoded INSERT from `schema.sql`.

### Step 8: Fix Tests (30 min)
- Replace hardcoded counts with dynamic assertions
- Convert per-source test cases to table-driven
- Run full test suite

### Step 9: Typecheck + Full Test Run (10 min)
```bash
npm run typecheck && npm test
```

**Total Estimated Time**: ~2-3 hours

## AFTER STATE: ADD/REMOVE A SOURCE

### Adding a New Source
1. Create config in `scraper-shared/configs.ts` or `rss-shared/configs.ts` (inherently required)
2. Add one entry to `SOURCES` in `registry.ts` with all metadata
3. Done. TypeScript, hashtags, AI config, D1 — all auto-derived.

### Removing a Source
1. Delete the entry from `SOURCES` in `registry.ts`
2. Optionally delete the config file
3. Done. TypeScript catches any remaining references at compile time.

**Before**: 9 files, ~20 edits, test count updates, SQL updates
**After**: 1-2 files, 1 edit (registry entry), zero manual sync

## SUCCESS METRICS

| Metric | Before | After |
|--------|--------|-------|
| Files to touch (add source) | 7-9 | 1-2 |
| Files to touch (remove source) | 7-9 | 1 |
| Manual sync points | 6 | 0 |
| Risk of desync | High | Zero (compile-time) |
| D1 seed maintenance | Manual SQL | Auto-sync |

---
*This report is analysis only. No code was modified.*
