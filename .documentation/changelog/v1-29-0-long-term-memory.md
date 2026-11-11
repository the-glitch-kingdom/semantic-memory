---
title: v1.29.0 - long-term memory
tier: reference
domains:
  - changelog
audience:
  - developers
  - admin
tags:
  - v1.29.0
  - long-term-memory
  - federation
  - issue-93
status: active
last_updated: '2026-11-11'
version: 1.29.0
purpose: What v1.29.0 added (opt-in and locked sources, long-term memory over
  hit-em-with-the-docs cold generations) and the measurements behind "default
  search is unchanged".
load_priority: 5
estimated_read_time: 3 minutes
backlinks: []
sources:
  - src/core/cold.ts
  - src/core/federation.ts
  - src/mcp/sources.ts
  - src/mcp/tools/search.ts
  - src/cli/search-sources.ts
  - hooks/cold-notice.js
  - scripts/eval-against-release.sh
  - package.json
  - .claude/hit-em-with-the-docs.json
  - test/retrieval-eval/baseline.json
word_count: 416
last_validated: '2026-11-11'
---

# v1.29.0 - long-term memory

Issue #93 (search side). Rotation, staging, undo and the secrets scan of the outgoing tree belong to hit-em-with-the-docs 3.2.0. Guide: [long-term memory](../operational/long-term-memory-guide.md).

## What changed

- **Opt-in and locked sources.** `federation.sources[].default: false` makes a source opt-in: not built, loaded or counted unless a call names it. `locked: true` indexes it once, never reconciles it and never writes into its folder. `related_repos: opt-in` registers sibling repos as opt-in. See the [federation guide](../operational/federation-guide.md).
- **Cold generations.** Each `cold_storage` entry in `.claude/hit-em-with-the-docs.json` becomes a locked opt-in source `cold-<date>`; the label `long-term` means all of them. A generation is skipped when its checksum does not match the manifest (hewtd's definition: `checksum` over git-tracked files, `disk_checksum` over the full tree) or when it has none. Files in `secrets_findings` are neither indexed nor readable. `federation.cold_storage: false` turns this off.
- **Tools take `sources`.** `search_hybrid`, `search_semantic` and `search_text`; hits carry `source` and, for a cold generation, `historical: {generation, source_commit, rotated_at}`. `read_note` resolves the labels. MCP `reindex {source}` rebuilds one source. `get_stats` lists `sources`.
- **CLI.** `search --source <label>` (repeatable) and `--reindex` (rebuild the named sources first).
- **Hooks.** SessionStart `hooks/cold-notice.js` announces each new generation once and warns about unusable ones; the prompt hook injects a `<vault-context source="long-term">` block for requests such as "search long-term memory for ...". `healthcheck` gains a `cold-generations` finding.
- **Help.** New topics `long-term-memory`, `tune-ranking`, `stable-results`, `index-readiness`; `federated-search`, `getting-started`, `add-index`, `eval`, `query-routing` brought up to date; every `--help` reviewed and tested (`test/unit/cli-help.test.ts`).

## Measured

- Default search is unchanged: `gate-release.sh 1.28.0` (fresh) gives identical counts with and without an 892-file cold generation configured (hybrid @1 92/139, multi 20/28/31 of 41, negatives 43/47, false flags 7; mcp and cli differ on 0 of 186). No index appears under `<index>/sources/`.
- Opt-in cost on a 912-file generation: checksum 11 ms; first `sources: ["long-term"]` query 48.1 s to the first hit; warm p95 32 ms; RSS 1542 to 1746 MB.
- Long-term recall (`test/retrieval-eval/long-term*.jsonl`, 10 questions each): train @1 10/10, @3 10/10; held-out @1 7/10, @3 9/10. Floors in `baseline.json` `longTerm`.

## Limits

- The checksum is recomputed on each hook run and `coldGenerations` call (about 20 ms per 1,000 files); a tracked-only match does not catch an edit to a gitignored file.
- A locked source without a manifest checksum records its build-time checksum in `<index>/locked.json`; the record is written on a later call in the same process, so a change between build and that call is taken as the baseline.
- The first long-term query on a large generation can exceed the prompt hook's 60 s cap; the hook then falls back to the normal block.
- Symlinks are not followed in locked sources; a live opt-in source still follows them.
