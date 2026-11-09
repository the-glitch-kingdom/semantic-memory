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
