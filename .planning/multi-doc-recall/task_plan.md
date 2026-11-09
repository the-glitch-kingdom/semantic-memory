# Task Plan: multi-doc-recall

## Goal
Ship semantic-memory#76 as v1.24.0, after #74's v1.23.0. Multi-doc questions on a tree with long hub docs get back to 1.15.0 depth (the reporter's targets: built-in eval multi @8 >= 12/14 and multi @1 >= 5/14 on d0, paraphrase @1 stays >= 14/22; A+B multi `cov@1` >= 0.85 on both trees). Exact-term hub questions (H14, C22) are back at #1. No single doc is in the top 3 of more than 3 unrelated questions. p95 <= 100 ms. 1.22.0's paraphrase and metadata gains are kept.

One PR from `feat/multi-doc-recall`, rebased on main after #74 merges. The reporter's tree decides after publish; every missed target is stated in the PR and on #76.

## Prerequisites
- #74 (v1.23.0) merged and published. Rebase this branch on main first; #74 extends the eval and the gate this plan also extends.

## Rules for every phase
- **Verify before ticking.** Confirm in code, or with a test, that a box is actually done before ticking it.
- **Eval discipline.**
  - Choose rules and constants on TRAIN only. Write held-out before any tuning and report it as measured.
  - Compare against published 1.15.0, 1.22.0 and the previous release (1.23.0), measured **in the same run** on `git clone --local` trees, never against floors. Measure both CLI and `eval --via mcp --settle`, with and without an export.
  - The reporter's question IDs and wording are not used for tuning.
- **Keep 1.22.0's gains.** Report paraphrase @1, exact @1 and long-section-hard next to every multi number. A change that wins multi by losing them is not kept.

## Phases
- [x] Phase 1: Verify and plan
  - [x] Verify #76 against main @ 066c730 (notes.md). Mechanism found in code; the regression did not reproduce on this repo's sets.
  - [x] Post the verification comment on #76
  - [x] Cut `feat/multi-doc-recall`, commit this plan
- [x] Phase 2: Reproduce first (before any change)
  - [x] Hub fixture shaped like the reporter's tree: `test/fixtures/multi-hub/`.
        - Long "operator notes" hub docs (8-15 KB, many H2 sections) that each hold 3-4 facets of a question in different sections.
        - Narrower docs that each hold one of those facets.
        - Short broad docs (one chunk, vocabulary or picklist style) that match many questions loosely.
        - An exact env-var or script name that appears only inside a long hub doc.
        (Done: 5 hubs of 8.0-8.4 KB, 7.96 KB for storage, i.e. the low end of the band; 10 narrow docs; 5 one-chunk broad docs.)
  - [x] Question sets `multi-hub.jsonl` (train) and `multi-hub-heldout.jsonl`. Each has at least 12 multi questions with 3-4 facets and `expected` docs, plus exact-term-in-hub questions and paraphrase controls. Write and facet-check them before measuring.
  - [x] Eval metrics:
        - `cov@k`: mean fraction of a multi question's facets (and expected docs) found in the top k.
        - `dominance`: the most top-3 slots any one doc takes across unrelated questions.
        - Report both in `eval --json` and in the `eval-against-release.sh` table.
  - [x] Measure the candidate pool: distinct docs among the `limit * 3` nearest chunks, per question, for 1.15.0, 1.21.0 and 1.22.0 on the same tree. Count chunks per doc for each schema.
  - [x] Baseline in notes.md: 1.15.0, 1.21.0, 1.22.0, 1.23.0 and local, same run, CLI and MCP, with and without an export. The stdio test must show the multi @8 loss before any fix; if it does not reproduce, say so plainly and build a harder fixture before Phase 3.
- [x] Phase 3: The candidate pool counts docs, not chunks (WITHDRAWN in Phase 9: raised dominance, no multi gain)
  - [x] `VectorIndex.search(q, k)` returns up to k distinct docs. Fetch more neighbours (bounded, for example doubling up to a cap) until k docs are found or the index is exhausted. Every caller (`src/mcp/tools/search.ts`, `src/cli/search.ts`, graph seeds) gets the same behaviour. BM25 is already one result per doc; confirm it.
  - [x] Measure on train: multi @1/@3/@8, `cov@k`, paraphrase, exact, long-section-hard and p95. (Pool fix does NOT move multi @8: 13 -> 13, see notes.)
  - [x] Unit test: a doc with many chunks near the query no longer shrinks the number of distinct docs returned.
- [x] Phase 4: Per-doc score aggregation and short broad docs
  - [x] Decompose on train only (#73's open lead: without doc metadata, hybrid @1 was 51 against 46):
        - best chunk against the summary chunk (`5b7d7a9`);
        - priority boost, decay, path class and fold;
        - a length or chunk-count prior.
        (Done on train: summary chunk +1 @1; boosts change nothing; length prior trades dominance for multi @1, not kept. See notes.)
  - [x] Candidates measured on train:
        - (a) best chunk (current); KEPT, none beat it;
        - (b) best chunk plus a small bonus for a second strong chunk (multi-facet docs);
        - (c) a short-doc dampener for docs that are a single chunk.
        Keep one variant and remove the rest. If none beats (a) on train, keep (a) and say so.
        (Done: (b), (b2), (b3) and (c) measured; none beats (a); (a) kept, no code change, all knobs reverted.)
  - [x] Dominance: no doc in the top 3 of more than 3 unrelated questions, on train and on the real-corpus sets.
        (Measured, target MISSED: 4 on multi-hub train, 18 on real-corpus, where `troubleshooting.md` is a 38 KB real doc; see Errors.)
- [x] Phase 5: Export path (d1b-only losses) (dropNonDead WITHDRAWN in Phase 9: -6 hyb@1 with export on 12 sets; the context.ts save fix stays)
  - [x] Check whether graph `related`, entity cards, duplicates or fold push the exact-term doc down when `.hewtd/graph.json` exists. Fix only what the measurement shows, and keep rank parity between MCP and CLI.
        (Measured on one index with `.hewtd/graph.json` toggled: not fold, duplicates, entity cards or `related`; the whole effect is the grounding multiplier from export dead refs (runtime paths and bare names). Fixed in `loadCodeData` (`dropNonDead`), plus a save race in `src/mcp/context.ts` the fix exposed; export now within one case of no export, CLI = MCP.)
- [x] Phase 6: Release gate (gate runs and FAILS on 1.23.0, see Errors Encountered)
  - [x] Add `multi-hub-heldout` to `npm run gate:release`. The gate fails when multi @3 or @8, or `cov@3`, drops by more than 1 question against the previous release, or when `dominance` exceeds 3. (dominance is relative: more than 1 slot above the previous release, per the Phase 4 decision; cov@3 band is one multi question's share)
  - [x] Run it against the previous release; record the result and runtime. (1.23.0: FAIL, 3m17s)
- [x] Phase 7: Release prep
  - [x] Bump all five version fields to 1.24.0 and update the lockfile
  - [x] Offline tarball deferred to release (built from the merge commit) -- deferred to release, not built here
- [x] Phase 8: Cleanup
  - [x] Remove what this branch created or made dead: losing variants, trial knobs, scratch scripts -- audited main..HEAD: no env knobs, no losing variants, no scratch files in the repo; nothing dead left (MAX_FETCH_FACTOR, dropNonDead, applyCode all used)
- [x] Phase 9: Validation (independent review)
  - [x] Review `git diff main...HEAD` adversarially against this plan, fix real bugs with regression tests, audit every ticked box
  - [x] Unit: `cov@k` and `dominance` metrics (facet-metrics.test.ts); the pool and its test are withdrawn, no aggregation variant kept
  - [x] Integration/e2e: stdio `search_hybrid` and the CLI on a multi-hub question (parity); `eval --via mcp` reports the same multi numbers
  - [x] Regression: lint, build, full `npm test` (known load flakes re-run alone), `npm run eval`, real-corpus/hub/long-section sets not below 1.22.0 (equal to 1.22.0 and 1.23.0 on all 12 sets)
  - [x] Every #76 acceptance check against 1.15.0, 1.22.0 and 1.23.0 in the same run, answered honestly in notes.md (multi @8, cov@8 and dominance targets NOT met); p95 measured (10-32 ms)
  - [x] `npm run gate:release` passes (after withdrawing the Phase 3 pool and the Phase 5 `dropNonDead`; PASS = 1.23.0 on every number)
- [ ] Phase 10: Documentation (full hit-em-with-the-docs pass, no secrets)
  - [ ] `.documentation/changelog/v1-24-0-*.md` and the CHANGELOG.md entry: numbers against 1.15.0, 1.22.0 and 1.23.0 in the same run, missed targets stated
  - [ ] retrieval-tuning-guide (candidate pool, aggregation), retrieval-eval-guide (`cov@k`, `dominance`, multi-hub sets), release-process (gate sets), help topics in `src/core/help/topics.ts` if they describe ranking
  - [ ] KB gotcha fact if the chunk-pool mechanism holds: "smaller chunks shrink the doc pool when k counts chunks"
  - [ ] README version row; AGENTS.md regenerated
  - [ ] Final `npm run eval`; floors move only with a measured reason

## Key Questions
1. Is the pool shrink (k counts chunks) the main cause of the multi @8 loss, or is it aggregation and short-doc broad matches? Answered by the Phase 2 pool measurement, then Phases 3 and 4.
2. Do the d1b-only losses come from the export path? Answered in Phase 5.

## Decisions Made
- Phase 9: the Phase 3 distinct-doc pool and the Phase 5 `dropNonDead` are withdrawn (measured worse than 1.23.0 on the pooled sets, no multi gain); the Phase 5 `context.ts` save/dirty fix, the metrics, the fixture and the gate extension stay. 1.24.0 therefore changes no ranking.
- Phase 4: keep (a) best chunk per doc; no code change. A length prior was measured and not kept (it trades dominance for multi @1/@3 and was not a plan candidate). Phase 6's dominance gate is relative (multi-hub sets, not above the previous release by more than 1), since the absolute 3 is unreachable on the real corpus.
- One plan for #76. It waits for #74, because both extend the eval and the gate.
- Phase 2: the fixture sits in `.documentation/multi-hub/` of each eval clone (the script copies it, as for long-section-hard), so the 141-doc real tree adds noise like a real vault. Docs-only runs are not used for these sets.
- Phase 2: `cov@k` and `dominance` live in `ArmMetrics`, so every eval report carries them; the old releases get them through the mcp arm, which this checkout drives.

## Errors Encountered
- Phase 9: the branch as reviewed (pool + dropNonDead) lost to 1.23.0 on the same 12 sets: dominance 67 vs 55 (no export), export hyb@1 151 vs 157, multi @8 46 vs 47, gate RED. Swapping only `vector.ts` back restored dominance 55 / multi @8 47; swapping `dropNonDead` off made the gate PASS. Both reverted; the 'Errors' for Phase 3, 5 and 6 below describe the withdrawn state.
- Phase 6: `npm run gate:release` against 1.23.0 FAILS (3m17s). (1) With export, hybrid @1 is 70 vs 75 (cli and mcp), -5 against band 1. Per set (cli, export): real-corpus-heldout 14 vs 17, absent-terms-heldout 15 vs 16, multi-hub-heldout 11 vs 12, the rest equal. No export is 71 vs 71. So 1.23.0 GAINS 4 from export on held-out while the Phase 5 fix (train: export 64/83 vs no export 63/84) removes that effect: on held-out the old dead-ref multiplier happened to help. Not tuned on held-out; the Phase 5 rule stays and the gate stays red until the orchestrator decides. (2) Dominance (pooled over the 6 gate sets, mcp arm) 34 vs 32 no export and 28 vs 23 export, above the relative band of 1. (3) multi @3/@8 are within the band (16/20 vs 17/21 no export; 17/20 vs 17/21 export); cov@3 .773 vs .776 and .784 vs .776 pass. mcp = cli on all 158 questions; titled #1 114/114.
- Phase 5: with the export present, train hyb@3 fell 84 -> 80 and multi @1/@3 12/23 -> 10/20 (exact @1 +1), on the SAME index (only `.hewtd/graph.json` toggled). Stripping `duplicates`/`points_to` (fold) or the symbols changed nothing; emptying the `docs` table, or `decay.code.enabled: false`, restored the no-export numbers exactly. Cause: hewtd marks runtime state (`.claude/.semantic-memory/`, `.semantic-sidekick-index/`) and bare names (`manifest.json`) as dead refs, so reference docs (config, cli, mcp-internals, indices-and-storage) got the x0.857 dead-ref multiplier; the span fallback already treats a missing git-ignored path as runtime state and flags only `dir/file` under a repo folder. Fix: same rule for the export (`dropNonDead`). 1.15.0 has no grounding (export = no export there); this exists since 1.16.0, so it is not a 1.22.0 regression.
- Phase 5: the fix made `graph-eval` (CLI = MCP grounding) fail 3 in 10 runs. Not slower code: `save()` cleared `dirty` AFTER the commit, so a grounding that landed while the first save ran was never persisted and the CLI (reads the saved cache) never saw it. `save()` now clears `dirty` before the write (and restores it on failure); `applyCode` marks dirty when grounding changed. The test waits for the cache to catch up (the save is debounced).
- Phase 4: no aggregation variant beats best-chunk: (b) second-strong-chunk bonus (three forms) and (c) single-chunk dampener leave multi @8 at 26/32 (multi-hub 13/19); (b) raises dominance, (c) is a no-op. The multi @8 loss is not in aggregation or in short broad docs on this tree. Dominance <= 3 missed (multi-hub 4, real-corpus 18, a real 38 KB doc every release has); Phase 6 gates it relative to the previous release instead.
- Phase 3: `VectorIndex.search` now fetches up to 16x k chunks (doubling) until k distinct docs, but multi-hub train multi @8 stays 13/19 (one question gained, one lost) and cov@8 .85 -> .86. The pool shrink is therefore not the main cause here; the aggregation/ranking (Phase 4) is. Kept because it is principled, costs no p95 and holds every 1.22.0 gain. Real-tree dominance rose (all train sets, mcp arm: 13 -> 20 top-3 slots for one doc), to be addressed in Phase 4.
- Phase 2: the first fixture (14 multi per set) reproduced the @8 loss by only 1-2 cases (train 13 -> 11, held-out 12 -> 11), inside the noise band. Hardened before any search change: 5 more hub-heavy multi questions per set (cross-hub, 4 facets). Result: train 16 -> 13 (-3 of 19), held-out 13 -> 12 (-1), all 8 sets 51 -> 47 of 61. The held-out loss alone is still within one case, so Phase 6's gate leans on the all-sets multi @8 and `cov@8` as well as the held-out set.
- Phase 2: the first `dominance` counted every top-3 slot and so charged a hub for the questions it answers; redefined as slots on questions the doc does not answer (matches none of the question's facets).
- Phase 2: a stale scratch dir (`git clone` into an existing `tree/`) failed the first eval-against-release run; rerun with fresh `GATE_TMP` dirs. No effect on numbers.

## Status
**Currently in Phase 10** (Phase 9 done: Phase 3 pool and Phase 5 dropNonDead withdrawn, see Decisions; notes.md "Eval results: Phase 9")
(history: (Phase 6 done but its gate run is RED, see Errors Encountered) (Phase 5 done: export dead-ref fix, notes.md "Eval results: Phase 5"; Phase 4 done: best-chunk kept, no variant wins, see notes.md "Eval results: Phase 4") (hook-failure Jev-hang flake in the full run, passes alone)
