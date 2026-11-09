# Task Plan: ranking that does not depend on `limit` (#85)

## Goal
`search(q, k)` returns the first k results of `search(q, K)` for any K > k, in order and with the same scores, for k ≤ 20. This holds for MCP `search_hybrid`, `search_semantic` and CLI `search` (hooks, kit).

Today the candidate pool is `limit * 3` for both the vector and BM25 lists. So:
- a doc in one list but outside the other gets 0 for the missing part;
- the fused and coverage scores change with `limit`;
- every caller (skill 5–10, hooks 6/8, CLI 8, kit 8) sees a different ranking.

Release as 1.27.0: ranking changes for every caller.

## Phases
- [x] Phase 1: Verify and plan (notes.md)
- [x] Phase 2: Reproduce first, as failing tests (expected-fail until fixed), and a baseline
  - [x] A prefix-property test over a fixture corpus big enough that `limit * 3` pools differ (the retrieval-eval fixture corpus, or a generated one of 40+ docs whose vector and BM25 lists disagree). Use a few queries (at least 5, including one that names an identifier). For limits 1, 3, 5, 8 and 10: the paths and scores of `search(q, k)` equal `search(q, 20).slice(0, k)`. Cover:
    - [x] MCP `search_hybrid` (in-process server, as the e2e tests do);
    - [x] CLI `search` (`createSearch(...).search(q, k)` in `src/cli/search.ts`, or the built CLI);
    - [x] MCP `search_semantic`.
  - [x] Mark the failing cases `it.fails`, and record which fail on main.
  - [x] Baseline on main, before any fix, kept in notes.md. For the built-in eval sets (`npm run eval` corpus, the mcp arm), record:
    - the eval's own metrics;
    - #1 accuracy at limits 1, 3, 5, 8, 10 and 20;
    - how many questions change #1 across limits 3–10;
    - p95 `search_hybrid` latency at limit 8.
    Use one heavy job at a time.
- [x] Phase 3: Fixed candidate pool, shared by every search path
  - [x] One constant and helper in `src/core` (next to `fuseScores` in `src/core/bm25.ts`): `CANDIDATE_POOL = 60` and `candidatePool(limit) = Math.max(CANDIDATE_POOL, limit * 3)`. Comment why: ranking must not depend on `limit` (#85), and the prefix property holds for limit ≤ 20.
  - [x] Use it for both lists in `hybridRanked` (`src/mcp/tools/search.ts:120-121`), CLI `search` (`src/cli/search.ts:156,169`) and `search_semantic` (`src/mcp/tools/search.ts:173`). Grep for any other `limit * 3` or pool sized by `limit` (federated sources, `search_graph` seeds, the eval runners) and use the helper wherever a ranking is computed.
  - [x] The reranker reranks `max(RERANK_TOP, limit)`, so it stays limit-independent for limit ≤ 30. Leave it, and note this in a code comment.
  - [x] Check that `hnswlib`'s ef is `max(EF_SEARCH=100, numResults)`, which stays ≥ the pool, so recall is unchanged.
  - [x] Phase 2 tests pass as plain `it`.
  - [x] Trial result on this repo's `.documentation`, 10 queries, limits 1–20: before, 10/10 broke the prefix rule and 2 changed #1; with `Math.max(limit * 3, 60)`, 0/10 and 0. Script: `$S/i85/repro.sh` in the session scratchpad; copy it into notes if it is useful.
- [ ] Phase 4: Measure the change. Accuracy must not drop, and the pool may be tuned only on train splits.
  - [ ] Re-run Phase 2's baseline measurements on the branch. #1 accuracy must be the same at every limit, and the eval metrics must be ≥ the baseline at limit 8 (the default).
  - [ ] Latency: p95 at limit 8 must stay within 10% of the baseline, or the cause must be recorded and accepted.
  - [ ] If any eval metric drops, try pool 40 and 100, on train splits only. Pick the smallest pool that matches or beats the baseline; record every number in notes.md.
  - [ ] Update any eval expectation or threshold that moved, with the reason in notes.md.
  - [ ] `npm run gate:release` passes (fresh, no `--cache`).
- [ ] Phase 5: The reporter's nit, plus release prep
  - [ ] `hooks/reconcile.js` header comment (lines ~21-23): it still says the docs entry "stays semantic-sidekick". Make it describe `DOCS_KEY = "semantic-memory-docs"` and the legacy name.
  - [ ] Bump all five version fields to 1.27.0, plus the lockfile. The offline tarball is deferred to release.
- [ ] Phase 6: Cleanup -- remove junk and unused code this work created: scratch/test scripts, debug files, probe logging, one-off test functions, commented-out code, dead code from abandoned approaches (MANDATORY)
- [ ] Phase 7: Validate success through comprehensive testing (MANDATORY)
  - [ ] Phase 2 tests pass, and none are left as `it.fails`.
  - [ ] Edge cases:
    - limit 1, and limit 20 (the boundary);
    - limit 50 (above the guarantee: results come back, no crash, and the first 20 are a superset of `search(q, 20)`'s);
    - a corpus smaller than the pool (6 docs);
    - status/tier/domain filters at limit 3 return no fewer results than on main;
    - text-only CLI (`--text-only`) unchanged.
  - [ ] MCP vs CLI parity: same #1 for the fixture queries at limits 3 and 8.
  - [ ] Re-run the reporter-style check on this repo's `.documentation`: 10 queries × limits 1, 3, 5, 8, 10, 20, prefix property holds.
  - [ ] Lint, build, `npm test`, `npm run eval`, `npm run gate:release` (fresh).
  - [ ] Independent review of `git diff main...HEAD`.
- [ ] Phase 8: Documentation pass with hit-em-with-the-docs; no secrets (MANDATORY)
  - [ ] `.documentation/architecture/` search pipeline doc (find it: the one that describes `hybridRanked`, fusion and coverage). Describe the fixed candidate pool and the prefix property.
  - [ ] `.documentation/reference/mcp-tools-reference.md`: `limit` cuts a stable ranking (≤ 20).
  - [ ] `.documentation/testing/retrieval-eval-guide.md`: if Phase 4 adds the per-limit #1 report.
  - [ ] A KB gotcha fact: a candidate pool sized by `limit` makes ranking depend on `limit`. In `## Instead`: a fixed pool, plus the prefix test.
  - [ ] `CHANGELOG.md` 1.27.0, and `.documentation/changelog/v1-27-0-limit-stable-ranking.md`, with the before/after numbers from Phase 4.
  - [ ] `npx hewtd maintain --quick`; never hand-edit INDEX.md or REGISTRY.md. Re-run `npm run eval` after the docs.

## Key Questions
1. Pool size: 60 (the reporter's suggestion, ≥ the old pool for any limit ≤ 20), unless Phase 4's train-split numbers say otherwise.
2. Limits above 20: the pool grows (`limit * 3`), so the prefix property is only guaranteed up to 20. This is documented, not hidden.

## Decisions Made
- Version 1.27.0, not a patch: every caller's ranking can change.
- Measure first: the baseline in Phase 2 happens before the fix lands.

## Errors Encountered

(Phase 3: none. Other `* 3` sites: only `GRAPH_SEARCH_SEEDS * 3` in search_graph, a constant independent of `limit`, left as is. ef = max(100, 60) = 100 >= pool, so recall is unchanged. The trial script `repro.sh` was not copied: limit-stable.test.ts covers it.)

## Status
**Phase 3 done (fixed pool); next: Phase 4.** Phase 1 done. Reproduced on 1.26.0 (this repo's `.documentation`, CLI search): 10/10 queries break the prefix property, and 2 change #1. A trial of `Math.max(limit * 3, 60)` fixes all 10.
