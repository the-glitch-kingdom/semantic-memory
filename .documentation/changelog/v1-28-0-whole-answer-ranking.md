---
title: v1.28.0 - whole-answer ranking
tier: reference
domains:
  - changelog
audience:
  - developers
  - admin
tags:
  - v1.28.0
  - ranking
  - identifier
  - cold-build
  - issue-90
  - issue-91
status: active
last_updated: '2026-11-10'
version: 1.28.0
purpose: What v1.28.0 changed (cold-build readiness, identifier tier, clause coverage shipped off) and the per-change gate numbers.
load_priority: 5
estimated_read_time: 3 minutes
backlinks: []
sources:
  - src/mcp/context.ts
  - src/core/identifiers.ts
  - src/core/rank.ts
  - src/core/vector.ts
  - scripts/gate-release.sh
  - package.json
word_count: 460
last_validated: '2026-11-10'
---

# v1.28.0 - whole-answer ranking

Issues #90 and #91. Part 2 of #91 ships off, so #91 stays open.

## #90: cold build ready only after the code graph

Cause: on a cold build the code graph loaded after the docs and fed grounding into ranking, but the index was ready first, so early answers differed from settled ones. Fix in `src/mcp/context.ts`: `fullIndex()` awaits the code load (cold builds only) before saving and before `getVectorIndex()` returns an index; search tools answer "Indexing in progress" until then. Warm swaps, `reindex`, reconcile and `loadFromDisk` keep #73's serve-then-mark-stale. Check by hand on a copy of `.documentation` with no index: first real answer at 40.4 s, again 10 s later, 0 differences of 10. See [indices and storage](../architecture/indices-and-storage.md#cold-build-readiness-v128).

## #91 part 1: identifier tier

`identifierTier()` (`src/core/identifiers.ts`) stable-sorts by the number of corpus-present query identifiers a candidate holds, after fusion and filters, before the optional reranker; MCP and CLI. See the [tuning guide](../operational/retrieval-tuning-guide.md).

## #91 part 2: clause coverage, shipped off

`ranking.clause_weight` defaults to 0. Weight 1 fixed the multi-clause fixture and passed the train rule, but failed the held-out gate (below), so it was not enabled and not re-tuned on held-out.

## Gate numbers

`BAND=1 npm run gate:release` against 1.27.1, fresh, branch = #90 + identifier tier, clause_weight 0: PASS (139 held-out questions, 186 probes).

| arm | hyb@1 | hyb@3 | sem@1 | multi@1/3/8 | dominance | negatives flagged |
|---|---|---|---|---|---|---|
| no export (cli, mcp) | 92 vs 92 | 116 vs 116 | 79 vs 79 | 20/28/31 vs same | 33 vs 34 | 43 vs 43 |
| export (cli, mcp) | 95 vs 95 | 117 vs 117 | 81 vs 81 | 20/28/32 vs same | 23 vs 25 | 43 vs 43 |

False flags 7 vs 7; mcp vs cli 0 of 186 differ; p95 12 to 16 ms in both arms; first mcp answer 1290 ms vs 1253 ms. Per change: the identifier tier gave dominance -1 to -2 and nothing else on held-out; #90 changes readiness, not counts; clause coverage is off.

New sets (hybrid, identical on both versions): whole-answer 11/12 @1 (held-out 10/12), identifier 8/8 (held-out 8/8). Top-3 all identifier docs: 8/8 and 8/8 on the branch, 0/8 and 0/8 on 1.27.1. Clause weight 1 on held-out vs 1.27.1: no-export hybrid @1 72 vs 73, multi @1 9 vs 10, export hybrid @1 76 vs 78.

## Floors and tests

`baseline.json` `newSets`, enforced by `test/retrieval-eval/new-sets-floor.test.ts`; `gate-release.sh` gates both held-out sets. Tests: `test/unit/identifier-tier.test.ts`, `test/unit/rank.test.ts`, `test/integration/cold-build-ready.test.ts`, `test/retrieval-eval/identifier-tier.test.ts`, `multi-clause.test.ts` (two-part tests stay `it.fails`).

## Known limits

The tier reorders only the pool of 24; a very common identifier can reorder queries that merely mention it (not seen in the gate); the reranker can reorder the tier's output.
