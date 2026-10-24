---
title: v1.5.2 — docs index freshness (issue #29)
tier: reference
domains: [changelog]
audience: [developers, admin]
tags: [v1.5.2, issue-29, watcher, chokidar, stale-index, indexer, frontmatter, hooks, capture-pending, npm-audit]
status: active
last_updated: '2026-10-24'
version: '1.5.2'
purpose: 'What v1.5.2 fixed: stale cached index rebuilt at startup, watcher working under chokidar 5, one bad doc no longer failing the whole index, hooks searching every semantic-* notes path, capture-pending kept per session, and the dependency audit.'
load_priority: 6
---

# v1.5.2 — docs index freshness (issue #29)

In the standard two-server setup (`semantic-vault` → `.claude/.vault`, `semantic-sidekick` → `.documentation --read-only`) the docs half looked installed and healthy but served a week-old snapshot, and the hooks never searched it. [Issue #29](https://github.com/the-glitch-kingdom/semantic-memory/issues/29) reported three causes; testing found a fourth.

## What was wrong, and what changed

| Problem | Cause | Fix (where) |
|---|---|---|
| Stale cached index served forever | `tryLoadCachedIndex()` marks a mismatched cache `stale` but returns `true`; startup reindexed only on `false` | Rebuild in the background when the loaded state is `stale` (`src/mcp/server.ts`) |
| Edits during a session never reindexed | `watch("**/*.md")` is a literal path under chokidar ≥4 | Watch the folder, filter with an `ignored` function plus a `.md` guard (`src/core/watcher.ts`) |
| One bad doc → whole corpus unindexed | `indexAll()` used one `Promise.all`; invalid YAML in any file rejected it | Invalid frontmatter: index the body with empty frontmatter; other per-file errors: skip the file (`src/core/indexer.ts`) |
| Hooks never searched the docs | `findVaultPath()` returned the first `.mcp.json` entry only | Search every `semantic-*` `--notes` folder in parallel, merge by score, label hits by server; writes stay on the first non-`--read-only` path (`hooks/vault-context.js`) |
| A capture cue showed up in another session's Stop prompt | `capture-pending.json` is per project; SessionStart/Stop wiped it whole | Items keyed by `session_id`; each session asks about and clears only its own (`hooks/vault-context.js`) |
| The watcher bug passed CI | Watcher tests caught their own timeout and returned as "events not available" | Tests fail on a timeout; run with polling and native events |

## Behavior to know about

- **Hit labels.** With more than one corpus searched, hits read `` `path` (semantic-sidekick, score: 0.43) ``. With one corpus the block is byte-identical to 1.5.1.
- **`SIDEKICK_VAULT_PATH`** still means exactly one folder, for search and writes.
- **Latency.** Two corpora in parallel: ~0.67 s → ~0.8 s per prompt on a two-server project.
- **Known gap.** Startup staleness is detected by chunk count only; a note edited while no server ran that keeps its chunk count is caught on the next edit or `--reindex`.

## Dependency audit

`npm audit`: 30 findings (1 critical, 19 high; 22 in production) → 3 (1 in production). Several 1.5.1 `overrides` pins had themselves become the vulnerable versions; they were re-pinned to current same-major patches, and in-range updates pulled in `@modelcontextprotocol/sdk` 1.32.2, `@huggingface/transformers` 4.3.1, `onnxruntime-node` 1.30.0 and `vitest` 4.1.12. Still open, with breaking-only fixes: `zod` (all 3.x; the fix is zod 4, which changes the MCP tool schemas in `src/mcp/tools/*`) and dev-only `esbuild`.

## Tests

440 tests green (418 in 1.5.1); every fix has a test that fails on 1.5.1. Build and lint clean; golden retrieval eval unchanged (recall@1 86%, MRR 0.929). End to end: a server started on a cache missing a note rebuilt it within ~7 s, and a live edit reindexed through the watcher.

## See also

- [indices-and-storage.md](../architecture/indices-and-storage.md) — startup rebuild and the watcher
- [what-gets-indexed.md](../architecture/what-gets-indexed.md) — files that fail to parse
- [injection-points.md](../architecture/injection-points.md) — which corpora the hooks search
- [troubleshooting.md](../troubleshooting/troubleshooting.md) — v1.5.2 entries
