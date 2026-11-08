---
title: v1.19.0 - federated search
tier: reference
domains:
  - changelog
audience:
  - developers
  - admin
tags:
  - v1.19.0
  - federation
  - issue-62
status: active
last_updated: '2026-11-08'
version: 1.19.0
purpose: What v1.19.0 changed (issue 62), the measured results, and the targets
  that were missed.
load_priority: 5
estimated_read_time: 2 minutes
sources:
  - src/core/federation.ts
  - src/core/federation-merge.ts
  - src/mcp/sources.ts
  - src/mcp/tools/search.ts
  - package.json
backlinks: []
word_count: 300
last_validated: '2026-11-08'
---

# v1.19.0 - federated search

Issue #62. `search_hybrid` searches this vault plus configured sources and merges one list. How to use it: [federation guide](../operational/federation-guide.md).

## What changed

- `federation.sources` and hewtd `related_repos` in `vault.schema.yml` (`src/core/federation.ts`).
- Read-only source contexts sharing the primary's embedder, indexed under `<index>/sources/` (`src/mcp/sources.ts`); `Embedder.init()` memoizes its in-flight load.
- Merge keyed on the fused score with BM25 rescaled by each source's `selfTop`, times weight (`src/core/federation-merge.ts`). Calibrated on train only.
- `source` on items, `read_note` `source`, `label:path` in telemetry, skipped and stale sources in a trailing text block.
- Review fixes: a source's own reranker is off; a sibling `docs_root` outside the sibling is ignored.

## Measured

Single-source output equals the v1.18.0 output on the snapshot queries (tolerance 1e-4), so existing splits are unchanged. Federated eval, found@1 / @3, federated against each index alone measured in the same run:

| split | federated | docs alone | vault alone |
|---|---|---|---|
| train (21) | 17 / 20 | 11 / 12 | 8 / 8 |
| held-out (20) | 16 / 20 | 10 / 13 | 8 / 8 |

Latency and memory on 183 docs per source: p95 10.5 / 16.3 / 19.5 ms with 0 / 1 / 3 sources; heap +16 MB and RSS +40 MB per source.

## Missed targets

- On the vault's own questions federated @1 is one case below vault alone on both splits (7 vs 8, 6 vs 7), inside the one-case gate but all of its slack; the vault fixture has about 8 docs.
- The repo has no p95 budget, so "within budget" is judged against the 33 ms baseline in the issue and the same-run 0-source arm (3 sources cost about 2x).
- Not federated: tools other than `search_hybrid` and `read_note`. A source skipped at the first search is not retried until restart.
