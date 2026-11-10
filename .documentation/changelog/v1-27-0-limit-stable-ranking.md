---
title: v1.27.0 - limit-stable ranking
tier: reference
domains:
  - changelog
audience:
  - developers
  - admin
tags:
  - v1.27.0
  - ranking
  - issue-85
status: active
last_updated: '2026-11-09'
version: 1.27.0
purpose: What v1.27.0 changed about ranking and limit, why two builds now rank
  the same, and the measured effect of exact search against 1.26.0.
load_priority: 5
estimated_read_time: 3 minutes
backlinks: []
last_validated: '2026-11-10'
sources:
  - src/core/bm25.ts
  - src/core/vector.ts
  - src/core/reconcile.ts
  - scripts/gate-release.sh
  - test/retrieval-eval/limit-stable.test.ts
  - test/retrieval-eval/limit-edge.test.ts
  - test/retrieval-eval/reproducible-build.test.ts
  - package.json
  - test/unit/vector-exact.test.ts
  - test/unit/reconcile-order.test.ts
word_count: 421
---

# v1.27.0 - limit-stable ranking

Issue #85. Earlier step: [v1.26.0](v1-26-0-default-server-names.md). Ranking changes for every caller (MCP, CLI, hooks, kit).

## What changed
- **The prefix rule holds up to limit 8.** Limits 1-8 rank like limit 8: `search(q, k)` is the first k of `search(q, 8)`, same order and scores. Both arms fetch `max(24, limit * 3)` candidates (`candidatePool` in `src/core/bm25.ts`); before, the pool was `limit * 3`, so fused and coverage scores moved with `limit`. Above 8 the pool grows. The MCP default `limit` is 10, so a call with no `limit` is not a prefix of `limit: 5`.
- **Two builds rank identically.** Vector search is exact (brute-force cosine, ties by path then label) while the index holds at most 100,000 live chunks; above that HNSW is used. `reconcile` also sorts its parse list. The insertion-order cause: `reconcile` pushed files in stat/read completion order, so HNSW was built in I/O-timing order and, being order-sensitive, ranked differently build to build. Embeddings were identical.
- `scripts/gate-release.sh` reads `BAND=${BAND:-1}`, so a release can pass a measured band.

## Measured
On this repo's `.documentation`: before, 10 of 10 queries broke the prefix rule and 2 changed #1; after, 0 of 10 at limits 1, 3, 5 against 8. #1 answers are the same at every limit on all four eval splits (21, 18, 6, 6). Limit-8 eval metrics equal 1.26.0's baseline. Two fresh builds give 0 differing top-8 results on 115 questions. Exact search takes a median 7 ms at 13k x 384; gate p95 at limit 8 was 27 ms against 17 ms for 1.26.0 on one run (about the size of machine variance).

**Against 1.26.0.** 1.26.0's own build-to-build gap was 0 on every gate metric, so the band is 1. `npm run gate:release` passes. On the held-out gate sets, hyb@1 (73, export 78), multi@1/3/8 (10/17/21), cov@3 (.776), negatives flagged (43) and false flags (7) are identical in both arms. Dominance (top-3 slots one doc takes on questions it does not answer) is 36 vs 35 without export and 26 vs 26 with it. Exact search takes the k nearest chunks, as HNSW's knn does, and then groups them by doc. A first version kept every chunk and returned k docs: that widened the vector arm's pool and raised dominance to 39 (export hyb@1 76 vs 78). `test/unit/vector-exact.test.ts` pins the chunk semantics.

## Follow-ups
A larger pool plus a coverage-boost fix, as its own release; dropping the plus-or-minus 1 real-corpus slack; skipping `hnsw.bin` for small vaults.

## What the tests pin
`limit-stable.test.ts`, `limit-edge.test.ts`, `reproducible-build.test.ts`, `test/unit/vector-exact.test.ts`, `test/unit/reconcile-order.test.ts`. See the [eval guide](../operational/retrieval-eval-guide.md#limit-stable-ranking-v127) and [tuning guide](../operational/retrieval-tuning-guide.md).
