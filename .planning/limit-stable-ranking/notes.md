# Notes: limit-stable ranking (#85)

## Cause (verified on main 3f33ef8)
- `src/mcp/tools/search.ts:120-121` (hybridRanked): `vectorIndex.search(queryEmbed, limit * 3)` and `ctx.bm25.search(query, limit * 3)`, then `fuseScores` and `applyCoverage`.
- `src/mcp/tools/search.ts:173` (search_semantic): `limit * 3`.
- `src/cli/search.ts:156,169` (CLI search, used by hooks with `--limit 6/8`): same.
- `fuseScores` (`src/core/bm25.ts:205`) gives 0 for a missing component. A doc inside the vector top-3k but outside the BM25 top-3k loses its lexical share, so the score changes with `limit`.
- hnswlib ef = `max(EF_SEARCH=100, numResults)` (`src/core/vector.ts:97`).
- Reranker: `max(RERANK_TOP=30, limit)` (`src/core/reranker.ts:11`).

## Reproduction (Phase 1, CLI search, this repo's `.documentation`, limits 1/3/5/8/10/20)
10 hand-written queries. A query breaks the prefix property if `search(q,k)` ≠ `search(q,20).slice(0,k)` for some k.

| | prefix broken | #1 changes |
|---|---|---|
| main (1.26.0) | 10/10 | 2/10 |
| trial `Math.max(limit * 3, 60)` | 0/10 | 0/10 |

Examples on main:
- "what does the freshness check do on a warm start": the #1 alternates between `changelog/v1-9-0-retrieval-graph-quality.md` (0.300 at k=1/3, 0.505 at k=10), `testing/tests-and-validation.md` (k=5/8) and `troubleshooting/troubleshooting.md` (k=20). The same doc scores 0.300 at k=3 and 0.505 at k=10.
- "what happens when the index lock is stale": the #1 is `changelog/v1-11-0-…` at k=1, `architecture/indices-and-storage.md` at k=3, and `troubleshooting/troubleshooting.md` at k≥5.

## Reporter's nit
- `hooks/reconcile.js:21-23` header comment still says the docs entry "stays semantic-sidekick", while the code uses `DOCS_KEY = "semantic-memory-docs"`.

## Eval results: Phase 2 (baseline on UNFIXED main code, 9d50399 + tests only)
Script: `.planning/limit-stable-ranking/measure-limits.test.ts` (run: `OUT=<file> npx vitest run --config .planning/limit-stable-ranking/vitest.measure.config.ts`; reuses `startEval`, the in-process mcp arm, `runFacetEval`, `facetRank`). Corpus: copy of `.documentation` with backdated git history (as `real-corpus-eval.test.ts`). Raw numbers: `baseline-main.json`. Sets: real-corpus (train), real-corpus-heldout, real-hub, real-hub-heldout; identifier negatives excluded as the real-corpus eval does. The long-section sets are not measured (they need their fixture dirs; the Phase 4 comparison can add them through `eval-against-release.sh`). Held-out is reported, never tuned on.

"#1 answers" = the top result alone satisfies the case's facets (`facetRank(...) === 1`), answerable cases only (negatives excluded), `search_hybrid`.

| split | n | #1@limit 1 | 3 | 5 | 8 | 10 | 20 | questions whose #1 differs across limits 3,5,8,10 |
|---|---|---|---|---|---|---|---|---|
| real-train | 27 | 21 | 21 | 21 | 21 | 21 | 21 | 1 (p01) |
| real-heldout | 27 | 17 | 18 | 18 | 18 | 18 | 18 | 0 |
| hub-train | 12 | 5 | 6 | 6 | 6 | 6 | 6 | 0 |
| hub-heldout | 10 | 5 | 7 | 6 | 6 | 6 | 6 | 1 (hub-h09) |

So #1 accuracy is not constant across limits on 3 of 4 splits (limit 1 differs from 3 on real-heldout and hub; hub-heldout goes 5, 7, 6, 6, 6, 6). Phase 4 target: identical counts at every limit.

The eval's own metrics at limit 8 (`runFacetEval`, `search_hybrid`), the floors Phase 4 must meet:

| split | all @1/@3/@8 | negatives flagged | p50 / p95 @8 |
|---|---|---|---|
| real-train (27) | 21 / 27 / 27 | 11/12 | 16 / 38 ms |
| real-heldout (27) | 18 / 25 / 26 | 6/8 | 19 / 33 ms |
| hub-train (12) | 6 / 10 / 11 | 1/1 | 17 / 32 ms |
| hub-heldout (10) | 6 / 9 / 10 | 1/1 | 16 / 33 ms |

Latency is in-process and warm (one pass over each set); Phase 4 re-measures p95 on the branch in the same way and fresh (never cached). One run on a loaded machine, so treat 10% as noise-level at ~35 ms: re-run both sides back to back if it is borderline.

## Prefix-property tests (Phase 2)
`test/retrieval-eval/limit-stable.test.ts` (runs under `npm run eval`): this repo's `.documentation`, 7 queries (one is the identifier `fuseScores`), limits 1, 3, 5, 8, 10 against `search(q, 20).slice(0, k)` (paths equal, scores within 1e-6), for MCP `search_hybrid`, MCP `search_semantic` and CLI `openSearch(...).search`. Fails on main: 17 of 21 cases (marked `it.fails`):
- `search_hybrid` 6/7 and `cli` 6/7: all but "how do I publish a release to npm".
- `search_semantic` 5/7: all but "publish a release" and "offline tarball".
Phase 3 must empty the `BROKEN` table in that file so every case is a plain `it`.
