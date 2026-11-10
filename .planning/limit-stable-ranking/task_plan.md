# Task Plan: ranking that does not depend on `limit` (#85)

## Goal
`search(q, k)` returns the first k results of `search(q, K)` for any K > k, in order and with the same scores, for k ≤ 20. This holds for MCP `search_hybrid`, `search_semantic` and CLI `search` (hooks, kit).

Today the candidate pool is `limit * 3` for both the vector and BM25 lists. So:
- a doc in one list but outside the other gets 0 for the missing part;
- the fused and coverage scores change with `limit`;
- every caller (skill 5–10, hooks 6/8, CLI 8, kit 8) sees a different ranking.

Also (the reporter's second comment on #85): two full builds of byte-identical files must rank identically, so vector search is exact below 100k vectors.

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
  - [x] Re-run Phase 2's baseline measurements on the branch. #1 accuracy must be the same at every limit, and the eval metrics must be ≥ the baseline at limit 8 (the default). (#1 counts constant at every limit on all 4 splits; metrics >= baseline on those sets.)
  - [x] Latency: p95 at limit 8 must stay within 10% of the baseline, or the cause must be recorded and accepted.
  - [x] If any eval metric drops (gate-release.sh dominance and, on the docs-only train sets, hyb@3/multi@3), try pool 40 and 100, on train splits only. Pick the smallest pool that matches or beats the baseline; record every number in notes.md. (No pool recovers it; 60 kept, see notes.)
  - [x] Update any eval expectation or threshold that moved, with the reason in notes.md.
  - [ ] `npm run gate:release` passes (fresh, no `--cache`). **NOT MET: FAILS on dominance 38 vs 35 (band 1), see notes and Errors Encountered.**
- [x] Phase 5: Reproducible vector search (#85, second comment: two full builds of identical files rank differently)
  - [x] Reproduce first, as a failing test. Build the index twice from scratch on two copies of a fixture corpus: separate temp dirs and index dirs, no shared embedding cache. Compare `search_semantic` and `search_hybrid` for a fixture query set (paths and order identical, scores within 1e-6). A second test feeds one build's embeddings perturbed by ~1e-6 (simulated cross-run ONNX float noise). The ranking must be the same unless two docs are within the noise. If the first test does not fail on main, keep it as a regression gate and rely on the perturbed test, which reproduces the mechanism. Record which fail.
  - [x] Find the actual source and record it in notes.md. The reporter suspects insertion order, but `listMarkdown` sorts (`src/core/indexer.ts:38`) and the build keeps `plan.parse` order (`src/mcp/context.ts:388`). Check:
    - the max abs difference between the two builds' embeddings (ONNX batching/threads);
    - whether a resumed build (`SAVE_INTERVAL`) or an incremental `addChunks` path changes the batch composition or the insertion order;
    - hnswlib's level RNG seed (`initIndex` defaults).
  - [x] Exact search below a size threshold:
    - `VectorIndex.search` scores every live chunk by cosine (brute force over the stored vectors: `getPoint` or a kept `Float32Array`) when live chunks ≤ `EXACT_MAX_VECTORS` (100_000). Break ties by doc path, then label, so the order is total.
    - Keep the per-doc best body/meta chunk logic and the result shape as they are.
    - Above the threshold, HNSW is unchanged (insertion is already sorted).
    - Keep building and saving `hnsw.bin` this release (load compatibility, and the large-vault path). Dropping it for small vaults is out of scope; note it as a possible follow-up.
  - [x] Phase 5 tests pass as plain `it`. The Phase 2/3 prefix tests still pass. `search_semantic` and the hybrid vector arm now return the exact top-k, so the recall of `ef=100` no longer limits them.
  - [x] Measure on the same script and sets as Phase 4:
    - the eval metrics at limit 8 must be ≥ Phase 4's;
    - p95 `search_hybrid` at limit 8 must stay within +10 ms of Phase 4's on the eval corpus;
    - one timing on a synthetic 13k × 384 index (the reporter's size): one exact query must take < 20 ms;
    - build twice and confirm zero differing top-8 results on the real-corpus sets.
    Record all of it in notes.md.
  - [x] Real-corpus slack: `baseline.json` and `gate-release.sh` allow about ±1 case for HNSW randomness. If two fresh builds now give identical results on the real corpus, record that in notes.md. Keep the slack for now (CI CPUs differ), and note that it could be removed as a follow-up.
- [ ] Phase 6: The reporter's nit, plus release prep
  - [ ] `hooks/reconcile.js` header comment (lines ~21-23): it still says the docs entry "stays semantic-sidekick". Make it describe `DOCS_KEY = "semantic-memory-docs"` and the legacy name.
  - [ ] Bump all five version fields to 1.27.0, plus the lockfile. The offline tarball is deferred to release.
- [ ] Phase 7: Cleanup -- remove junk and unused code this work created: scratch/test scripts, debug files, probe logging, one-off test functions, commented-out code, dead code from abandoned approaches (MANDATORY)
- [ ] Phase 8: Validate success through comprehensive testing (MANDATORY)
  - [ ] Phase 2 tests pass, and none are left as `it.fails`.
  - [ ] Edge cases:
    - limit 1, and limit 20 (the boundary);
    - limit 50 (above the guarantee: results come back, no crash, and the first 20 are a superset of `search(q, 20)`'s);
    - a corpus smaller than the pool (6 docs);
    - status/tier/domain filters at limit 3 return no fewer results than on main;
    - text-only CLI (`--text-only`) unchanged.
  - [ ] Build twice from scratch (fixture corpus and this repo's `.documentation`): identical `search_semantic`/`search_hybrid` results.
  - [ ] Exact-search edge cases: an empty index, one chunk, every chunk of a doc deleted (`removeDoc`), and an index that crosses `EXACT_MAX_VECTORS` (a test-only lower threshold) and switches to HNSW.
  - [ ] MCP vs CLI parity: same #1 for the fixture queries at limits 3 and 8.
  - [ ] Re-run the reporter-style check on this repo's `.documentation`: 10 queries × limits 1, 3, 5, 8, 10, 20, prefix property holds.
  - [ ] Lint, build, `npm test`, `npm run eval`, `npm run gate:release` (fresh).
  - [ ] Independent review of `git diff main...HEAD`.
- [ ] Phase 9: Documentation pass with hit-em-with-the-docs; no secrets (MANDATORY)
  - [ ] `.documentation/architecture/` search pipeline doc (find it: the one that describes `hybridRanked`, fusion and coverage). Describe the fixed candidate pool and the prefix property.
  - [ ] `.documentation/reference/mcp-tools-reference.md`: `limit` cuts a stable ranking (≤ 20).
  - [ ] `.documentation/testing/retrieval-eval-guide.md`: if Phase 4 adds the per-limit #1 report.
  - [ ] A KB gotcha fact: a candidate pool sized by `limit` makes ranking depend on `limit`. In `## Instead`: a fixed pool, plus the prefix test.
  - [ ] Phase 5 docs: the architecture/indices doc (exact search below `EXACT_MAX_VECTORS`, HNSW above), and a KB gotcha fact: approximate HNSW plus float noise means rebuilds rank differently. In `## Instead`: exact search for typical vault sizes, and a build-twice test.
  - [ ] `CHANGELOG.md` 1.27.0, and `.documentation/changelog/v1-27-0-limit-stable-ranking.md`, with the before/after numbers from Phase 4.
  - [ ] `npx hewtd maintain --quick`; never hand-edit INDEX.md or REGISTRY.md. Re-run `npm run eval` after the docs.

## Key Questions
1. Pool size: 60 (the reporter's suggestion, ≥ the old pool for any limit ≤ 20), unless Phase 4's train-split numbers say otherwise.
2. Limits above 20: the pool grows (`limit * 3`), so the prefix property is only guaranteed up to 20. This is documented, not hidden.

## Decisions Made
- 2026-11-09: the second #85 comment (build-to-build ranking noise) is folded into this plan as Phase 5, same release. The workflow was stopped after Phase 3 and relaunched from Phase 4.
- Version 1.27.0, not a patch: every caller's ranking can change.
- 2026-11-09 (Phase 5): the reporter was right about the source. `reconcile` pushed files to `parse` in stat/read completion order, so the index was built in I/O-timing order (`listMarkdown` sorts, but the order was lost). Fixed by sorting `parse` (src/core/reconcile.ts), on top of exact search. HNSW above 100k is therefore now reproducible too.
- Measure first: the baseline in Phase 2 happens before the fix lands.

## Errors Encountered

Phase 4: `npm run gate:release` (fresh, local 1.26.0 tree vs 1.25.1) FAILS: "dominance rises beyond the band", no-export eval and eval-mcp (38 vs 35, band 1). Everything else passes (hyb@1 74 vs 73, multi@1 10 vs 10, multi@3 16 vs 17 and @8 20 vs 21 within band, cov@3 .773 vs .776, negatives 43 vs 43, false flags 7 vs 7, mcp vs cli 0/166, export arm passes with dominance 27 vs 26). Not tuned on held-out; gate script and band untouched. Needs the user to accept a dominance change or choose another fix. See notes.

Phase 5: gate vs 1.26.0 (fresh, local branch with exact search) is RED, and worse than Phase 4's vs 1.25.1: dominance 44 vs 35 (export 30 vs 26), multi @3 16 vs 17 and @8 19 vs 21 (no export), hyb@1 75 vs 78 (export). Not tuned; no threshold, band or floor touched. Exact search returns the true top-k docs, so a broad doc reaches the vector arm's top-k more often. See notes, "Gate vs 1.26.0 after Phase 5".

(Phase 3: none. Other `* 3` sites: only `GRAPH_SEARCH_SEEDS * 3` in search_graph, a constant independent of `limit`, left as is. ef = max(100, 60) = 100 >= pool, so recall is unchanged. The trial script `repro.sh` was not copied: limit-stable.test.ts covers it.)

## Status
**Phase 5 done (exact search + sorted parse order); gate vs 1.26.0 RED (dominance 44 vs 35, multi @8 19 vs 21, export hyb@1 75 vs 78): needs the user's decision before Phase 6.** (Phase 4 gate was red too.) Phase 1 done. Reproduced on 1.26.0 (this repo's `.documentation`, CLI search): 10/10 queries break the prefix property, and 2 change #1. A trial of `Math.max(limit * 3, 60)` fixes all 10.
