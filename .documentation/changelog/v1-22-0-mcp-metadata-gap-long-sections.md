---
title: v1.22.0 - MCP metadata gap and long sections
tier: reference
domains:
  - changelog
audience:
  - developers
  - admin
tags:
  - v1.22.0
  - mcp
  - chunking
  - gate
status: active
last_updated: '2026-11-09'
version: 1.22.0
purpose: What v1.22.0 changed for issue
load_priority: 5
estimated_read_time: 3 minutes
sources:
  - src/mcp/context.ts
  - src/core/indexer.ts
  - src/core/code-graph.ts
  - src/core/retrieval-eval/runner.ts
  - scripts/gate-release.sh
  - scripts/eval-against-release.sh
  - package.json
  - .planning/mcp-metadata-gap-long-sections/notes.md
  - test/retrieval-eval/baseline.json
word_count: 461
last_validated: '2026-11-09'
backlinks: []
---

# v1.22.0 - MCP metadata gap and long sections

Issue #73. Three claims: the MCP server answered before doc metadata was installed, long sections ranked worse than in 1.15.0, and neither the eval nor the gate could see the first.

## What changed

- **Doc metadata never lags the index.** Docs, titles, `load_priority`, decay, the `generated`/`status`/`tier`/`domain` filters and doc-only `related` are installed in the same step as the vector index (`src/mcp/context.ts`). The code graph (grounding, code edges, the entity card) loads in the background; until it lands, answers carry `_meta.stale`.
- **Cheaper code fallback.** `gitLastChanged` is one `git log --since=365.days`, filtered in JS (was one full-history log per 500 paths). Files untouched for over 365 days are undated, so the opt-in `drift_penalty` and `code_drift` never see them. `get_stats` reports `codeGraph: { source, loadMs }`.
- **Chunk windows.** Chunks are 1000 characters (about 256 tokens, MiniLM's trained length) with one sentence of overlap, instead of 2000. Index schema 11: a one-time full re-embed. Characters stand in for tokens, so 231 of 1326 chunks on the measured tree still exceed 256 tokens.
- **The eval and gate measure the MCP path.** `eval --via mcp` (`--server`, `--cwd`, `--settle`, `--wait-for-ready`) and `npm run gate:release` now run the stdio server as the plugin launches it. See the [retrieval eval guide](../operational/retrieval-eval-guide.md#mcp-path-v122) and [release process](../deployment/release-process.md).

## Measured

Same run, clone of this repo plus both long-section fixtures (156 docs), 129 answerable questions, hybrid @1, no export / export:

| | 1.15.0 | 1.21.0 | 1.22.0 |
|---|---|---|---|
| all eight sets | 95 / 95 | 90 / 94 | 97 / 99 |
| long-section-hard, train (of 12) | 11 | 7 | 10 |
| long-section-hard, held-out (of 12) | 12 | 8 | 10 |
| first answer titled, `git log` slowed to 30 s | 129/129 | **0/129** | 129/129 |

Cold index (no export): 24.5 s, 50.1 s, 57.2 s. Index size 7.7, 16.5, 18.3 MB. Chunks 1326 against 1113.

## Missed targets

- **Claim 2 is not fully met.** On the hard long-section sets 1.22.0 is not back at 1.15.0 (10/12 against 11/12 train and 12/12 held-out). The doc is at @3 on all three versions, not first; the remaining misses were not examined. Bullets in both fixtures are 350-800 characters, so 1,000+ character bullets were never tested.
- **The reporter's built-in-eval loss on d0 (hybrid @1 32 to 26) did not reproduce** on our 135-doc corpus and is not explained. It needs their 919-doc tree, a post-publish re-run.
- Grounding, code edges and the entity card are absent on first answers until the code graph lands; the gate does not check that window.
- The slow-git @1 lead (1.21.0 with no metadata 95 against 90 with it) was not decomposed into priority, decay, path class and fold.

Numbers and per-set tables: `.planning/mcp-metadata-gap-long-sections/notes.md`. Floors in `baseline.json` did not change.
