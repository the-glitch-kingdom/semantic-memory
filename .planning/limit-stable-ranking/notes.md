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

## Eval results: Phase 3
`CANDIDATE_POOL = 60`, `candidatePool(limit) = max(60, limit*3)` in `src/core/bm25.ts`, used by hybridRanked, search_semantic and CLI search. `limit-stable.test.ts`: 21/21 pass as plain gates (17 failed on main); BROKEN table removed. Accuracy/latency numbers are Phase 4.
Side effect: `test/fixtures/federation/single-source-snapshot.json` re-taken (ranking changed by design). Two queries moved: "Undo a faulty software release on the ships" (changelog/v2-0-release.md 0.300 -> 0.385, now above reference/cli-reference.md) and the nonexistent_function query (cli-reference 0.285 -> 0.293); the other 8 are identical. Flakes seen in the first full run, both passed alone: stdin-eof, claude-run concurrency. `npm run eval` 169 passed + 4 expected fail (was 152 + 21).

## Eval results: Phase 4 (branch, pool 60; raw: `branch-phase4.json`)
Same script and sets as Phase 2. Held-out reported only, not used for any choice.

#1 answers by limit (1/3/5/8/10/20) and changes across limits 3-10:

| split | n | branch | main (Phase 2) | changed 3-10 |
|---|---|---|---|---|
| real-train | 27 | 21 at every limit | 21 at every limit | 0 (main: 1) |
| real-heldout | 27 | 18 at every limit | 17/18/18/18/18/18 | 0 |
| hub-train | 12 | 6 at every limit | 5/6/6/6/6/6 | 0 |
| hub-heldout | 10 | 6 at every limit | 5/7/6/6/6/6 | 0 (main: 1) |

So #1 is now identical at every limit on all 4 splits (limit 1 included, which main got wrong on 3 splits).

Eval metrics at limit 8 (all @1/@3/@8; negatives flagged; p50/p95), main -> branch:
- real-train: 21/27/27 -> 21/27/27; 11/12 -> 11/12; p95 38 -> 21 ms
- real-heldout: 18/25/26 -> 18/26/27 (better); 6/8 -> 6/8; p95 33 -> 27 ms
- hub-train: 6/10/11 -> 6/10/11; 1/1 -> 1/1; p95 32 -> 22 ms
- hub-heldout: 6/9/10 -> 6/9/10; 1/1 -> 1/1; p95 33 -> 17 ms
Latency: no regression (the baseline run was on a loaded machine; the branch is lower on all four). No search work was added (same two searches, a larger pool).

### Pool 40 / 100 (train sets only, docs-only, `eval-against-release.sh --cache`, cli arm)
Triggered by gate-release (below). Sets: real-corpus + real-hub (39 answerable). hyb@1 / hyb@3 / multi@1/3/8 / dom:
- 1.26.0 (main): 28 / 37 / 9/13/13 / 11
- pool 40: 28 / 36 / 9/12/13 / 14
- pool 60: 28 / 36 / 9/12/13 / 14
- pool 100: 28 / 36 / 9/12/13 / 16
No pool size recovers hyb@3 (-1) / multi@3 (-1) or the dominance; larger is worse. Pool 40 equals 60 on these sets but breaks the prefix property above limit 13, so 60 stays (the plan's smallest-that-matches rule holds only with the property). The cause is the fix itself, not the pool size: with a fixed pool, a doc missing from one list no longer loses that component at limit 8 (the old limit-8 pool was 24), so broad docs like troubleshooting.md reach the top 3 more often.

### gate:release (fresh, no --cache), local vs 1.25.1, held-out sets, band 1: FAIL
- no-export: hyb@1 74 vs 73, multi@1 10 vs 10, multi@3 16 vs 17, @8 20 vs 21 (within band), cov@3 .773 vs .776, **dominance 38 vs 35 (FAIL, band 1)**, negatives 43 vs 43, false flags 7 vs 7, mcp vs cli 0/166, titled #1 119/119, first answer 1160 ms.
- export: hyb@1 77 vs 78, multi@3 17 vs 17, @8 20 vs 21, cov@3 .796 vs .776, dominance 27 vs 26 (ok), same negatives/false flags, 0/166.
- p95 in the gate table (local mcp 35/16 ms vs 22/39 ms): noisy, no pattern.
Note: once Phase 6 bumps to 1.27.0 the gate compares with 1.26.0 (main's ranking), not 1.25.1; its dominance was not measured held-out here. Decision for the user: accept dominance +3 (troubleshooting.md top-3 slots, a doc this repo's sets answer often; see multi-doc-recall notes) by widening the band for dominance, or add a mitigation (e.g. a length prior, previously noted as a trade).

## Eval results: Phase 5 (exact search; raw: `branch-phase5.json`)

### Source of the build-to-build noise (reproduced)
- Reproduction: `test/retrieval-eval/reproducible-build.test.ts` builds `.documentation` twice (separate temp dirs, no shared cache). On the unfixed code `search_semantic` top-8 differed on query 1 (`architecture/v1-stack-overview.md` vs `operational/retrieval-eval-guide.md` at rank 8); `search_hybrid` passed that run. The embedding-difference test and the perturbation test passed on main (HNSW is not that sensitive to 1e-6 noise on this corpus), so the perturbation test is a regression gate.
- Embeddings are NOT the source: across the two builds 1761 vectors, 0 differ, max abs diff 0 (same machine; ONNX batch composition is identical). The same embeddings built into two HNSW indexes in the same order gave 0 differing top-8; in a different order (cache-file order vs the other build's) 337 of 353 queries differed. So HNSW is deterministic but order-sensitive, as the reporter said.
- The order: `reconcile` (`src/core/reconcile.ts`) filled `parse` inside `Promise.all` of stat+readFile, i.e. in completion order. `listMarkdown` is sorted, `context.ts:388` keeps `plan.parse` order, but `plan.parse` was already racy. Unit test `test/unit/reconcile-order.test.ts` fails on the old code (200 files, mixed sizes), passes with `parse.sort()`.
- With only the sort (HNSW kept), the build-twice test passed 2 of 2 runs; exact search is kept regardless as asked. resumed builds (`SAVE_INTERVAL`) only save the vector cache, not the insertion order. hnswlib's `initIndex` uses its default fixed seed (not changed).

### What changed
- `src/core/vector.ts`: `EXACT_MAX_VECTORS = 100_000`; live chunks at or below it are scored by brute-force cosine over unit-length copies kept per label (`unit`), ties by doc path then label, results total-ordered (score, then path) and cut to k docs (the HNSW path returned up to k docs from k chunks, so exact now returns the true top-k docs). Above it HNSW is unchanged (and `load` keeps no copies). `hnsw.bin` is still written. Constructor takes `exactMax` for tests.
- Snapshot `test/fixtures/federation/single-source-snapshot.json` re-taken: "telemetry message ... cold storage" gains `blank-charts-playbook.md` (0.256) at rank 5 (HNSW missed it), nonexistent_function #1 0.300 -> 0.304; other 8 identical.

### Measurements
- Eval metrics at limit 8 on the 4 real sets: identical to Phase 4 (only meanBytes moved); #1 counts the same at every limit (21/18/6/6).
- p50/p95 @8 (ms), Phase 4 -> Phase 5: real-train 8/21 -> 9/17, real-heldout 11/27 -> 9/16, hub-train 11/22 -> 9/19, hub-heldout 9/17 -> 9/13 (all within +10 ms).
- Synthetic 13256 x 384 exact search (random vectors, 590 docs, k=24): median 6.9 ms, max 18.0 ms over 30 queries (target < 20 ms).
- Build twice on this repo's `.documentation` with git history, all 115 queries of the 4 real sets, limit 8: top-8 differ in 0 for `search_semantic` and 0 for `search_hybrid`, #1 differ 0 (the reporter's 4 and 2 of 41). Real-corpus slack: fresh builds now agree exactly here; the +-1 slack stays (CI CPUs differ). Follow-up: it could be dropped, and `hnsw.bin` skipped for small vaults.
- Full validation: lint, build, `npm test` (1150 passed after the snapshot re-take), `npm run eval` 173 passed + 4 expected fail.

## Gate vs 1.26.0 after Phase 5
`scripts/gate-release.sh 1.26.0` (fresh, no --cache, held-out gate sets, band 1; package.json still 1.26.0, so it was run with the version as an argument). RESULT: FAIL.

| metric | no export: branch vs 1.26.0 | export: branch vs 1.26.0 |
|---|---|---|
| hyb@1 | 73 vs 73 | 75 vs 78 (drop 3, FAIL) |
| multi@1 | 10 vs 10 | 10 vs 10 |
| multi@3 | 16 vs 17 | 17 vs 17 |
| multi@8 | 19 vs 21 (FAIL) | 20 vs 21 |
| cov@3 | .773 vs .776 | .796 vs .776 |
| dominance slots | 44 vs 35 (FAIL) | 30 vs 26 (FAIL) |
| negatives flagged | 42 vs 43 | 42 vs 43 |
| false flags | 7 vs 7 | 7 vs 7 |
| mcp vs cli differ | 0 of 166 | 0 of 166 |
| titled #1 | 119/119 | 119/119 |
| first answer (mcp) | 1307 ms | 1333 ms |

Same numbers on the cli and mcp arms. Dominance path: the top-3 slots one doc takes on questions it does not answer; no-export 44 (Phase 4 measured 38 vs 1.25.1). Not tuned. The user decides: widen the dominance/multi bands, or add a mitigation (a length prior, or a different coverage rule).

## Eval results: Phase 6 (pool `max(24, limit*3)`, separate gates vs 1.26.0; raw: `branch-phase6.json`)
All gate runs: fresh (no --cache), held-out gate sets (real-corpus, real-hub, long-section, long-section-hard, absent-terms, multi-hub), `scripts/eval-against-release.sh` / `gate-release.sh` shape, one heavy job at a time. Tuned on nothing.

### Noise band: 1.26.0 from independent fresh builds
Four fresh 1.26.0 builds in total (two dedicated runs, plus the 1.26.0 side of Gate A and Gate B). cli and mcp arms agree in every build.

| metric | build 1 | build 2 | gap | (Gate A / B builds) |
|---|---|---|---|---|
| no-export hyb@1 | 73 | 73 | 0 | 73 / 73 |
| multi@1 / @3 / @8 | 10 / 17 / 21 | 10 / 17 / 21 | 0 / 0 / 0 | same |
| cov@3 | .776 | .776 | 0 | .776 |
| dominance | 35 | 35 | 0 | 35 |
| negatives flagged / false flags | 43 / 7 | 43 / 7 | 0 / 0 | same |
| export hyb@1 | 78 | 78 | 0 | 78 |
| export multi@3 / @8, dominance | 17 / 21, 26 | 17 / 21, 26 | 0 | same |

So 1.26.0 is deterministic on this machine and corpus (as are the Phase 5 branch builds); the noise gap is 0 for every metric. Judged band per metric: max(1, 0) = 1, the same as the script's default. `BAND` was NOT widened: `BAND=${BAND:-1}` now lets a release pass a measured band, and the measured band is 1.

### Gate A: determinism alone (main + Phase 5 `vector.ts` exact search + `reconcile.ts` sort, pool `limit*3`) vs 1.26.0
RESULT: FAIL (band 1). no export (cli = mcp): hyb@1 74 vs 73, multi@1 10 vs 10, multi@3 16 vs 17, @8 20 vs 21, cov@3 .773 vs .776, **dominance 39 vs 35 (+4)**, negatives 43 vs 43, false flags 7 vs 7, mcp vs cli 0 of 166, titled #1 119/119. export: **hyb@1 76 vs 78 (-2)**, multi@1 10 vs 10, @3 17 vs 17, @8 20 vs 21, cov@3 .796 vs .776, dominance 27 vs 26, negatives/false flags same, 0 of 166.
Exact search alone moves dominance by +4 (no export) and export hyb@1 by -2, beyond noise (gap 0). This is a real effect of HNSW being approximate: exact search returns the true top-k docs, so a broad doc (troubleshooting.md) reaches the vector arm's top-k more often. Recorded for the changelog; not reverted (user decision).

### Gate B: full branch (pool 24) vs 1.26.0
RESULT: FAIL, with numbers identical to Gate A in every row (no export: 74/10/16/20/.773/dom 39/neg 43/fals 7; export: 76/10/17/20/.796/dom 27/43/7; mcp vs cli 0 of 166; titled 119/119; first answer 1259 ms, export 1269 ms).
Limit-8 rankings: all 166 gate-set questions, cli arm (`openSearch`) and mcp arm (`search_hybrid`), top 8 paths and order identical between Gate A and Gate B (0 of 332 differ), scores within 1e-4. Pool 24 at limit 8 is the same pool as `limit*3`, so the branch equals determinism alone at the default limit, as designed.
Gap to 1.26.0 that remains (beyond a band of 1): dominance +4 (no export), export hyb@1 -2. Both come from exact search (Gate A), not from the pool. Judge by the user; no band widened, no threshold touched.

### #1 accuracy by limit and limit-8 metrics (re-run of the Phase 4 script, branch with pool 24)
| split | n | #1 at limits 1/3/5/8/10/20 | changed 3-10 | Phase 2 main | @1/@3/@8 | neg flagged | p50/p95 @8 |
|---|---|---|---|---|---|---|---|
| real-train | 27 | 21 at all | 0 | 21 at all | 21/27/27 | 11/12 | 10/44 ms |
| real-heldout | 27 | 18 at all | 0 | 17/18/18/18/18/18 | 18/25/26 | 6/8 | 12/22 ms |
| hub-train | 12 | 6 at all | 0 | 5/6/6/6/6/6 | 6/10/11 | 1/1 | 8/22 ms |
| hub-heldout | 10 | 6 at all | 0 | 5/7/6/6/6/6 | 6/9/10 | 1/1 | 20/35 ms |
#1 at limits 1-8 equals limit 8's on every set. Limit-8 metrics equal Phase 2's main baseline (21/27/27, 18/25/26, 6/10/11, 6/9/10). p95 is a single noisy pass (real-train 44 ms, hub-heldout 35 ms vs Phase 5's 17/13 ms; machine was busy right after the gate runs).

### Follow-up for the larger-pool issue (to file at release time)
Dominance (top-3 slots one doc takes on questions it does not answer), no export, held-out gate sets: 1.26.0 35; Phase 4 pool 60 (hnsw) 38 vs 1.25.1's 35; Phase 5 pool 60 + exact 44; Phase 6 exact + pool 24 (= Gate A) 39. Export: 26 / 27 / 30 / 27. Train-set dominance (docs-only, cli): 1.26.0 11, pool 40/60 14, pool 100 16. A larger pool pays off only once the coverage boost stops rewarding breadth; tune on train splits only, gate on dominance, own release.

### Real-corpus slack
Builds are deterministic from Phase 5 on (this machine); the +-1 slack in baseline.json and gate-release.sh stays (CI CPUs differ). Follow-up: it could be dropped.

### Phase 6 validation
Snapshot `test/fixtures/federation/single-source-snapshot.json` re-taken again (pool 24 changes 3 of the 10 queries' results; the rest identical). Lint, build, `npm test` (1149 passed + snapshot re-taken; stdin-eof timeout flake passed alone), `npm run eval` 173 passed + 4 expected fail.

## Eval results: Phase 7
`BAND=1 npm run gate:release` (fresh, no --cache, 1.27.0 vs 1.26.0; Phase 6 recorded band 1): FAIL. Identical to Phase 6.
no export (cli = mcp): hyb@1 74 vs 73, multi@3 16 vs 17, @8 20 vs 21, cov@3 .773 vs .776, dominance 39 vs 35 (FAIL), negatives 43 vs 43, false flags 7 vs 7, mcp vs cli 0 of 166, titled 119/119.
export: hyb@1 76 vs 78 (FAIL), multi@3 17 vs 17, @8 20 vs 21, cov@3 .796 vs .776, dominance 27 vs 26, 0 of 166.
No band or threshold changed. Cause is exact search (Phase 6 Gate A); the user decides.
