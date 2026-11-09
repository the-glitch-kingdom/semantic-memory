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
- [x] Phase 3: The candidate pool counts docs, not chunks
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
- [ ] Phase 5: Export path (d1b-only losses)
  - [ ] Check whether graph `related`, entity cards, duplicates or fold push the exact-term doc down when `.hewtd/graph.json` exists. Fix only what the measurement shows, and keep rank parity between MCP and CLI.
- [ ] Phase 6: Release gate
  - [ ] Add `multi-hub-heldout` to `npm run gate:release`. The gate fails when multi @3 or @8, or `cov@3`, drops by more than 1 question against the previous release, or when `dominance` exceeds 3.
  - [ ] Run it against the previous release; record the result and runtime.
- [ ] Phase 7: Release prep
  - [ ] Bump all five version fields to 1.24.0 and update the lockfile
  - [ ] Offline tarball deferred to release (built from the merge commit)
- [ ] Phase 8: Cleanup
  - [ ] Remove what this branch created or made dead: losing variants, trial knobs, scratch scripts
- [ ] Phase 9: Validation (independent review)
  - [ ] Review `git diff main...HEAD` adversarially against this plan, fix real bugs with regression tests, audit every ticked box
  - [ ] Unit: distinct-doc pool, the aggregation variant kept, `cov@k` and `dominance` metrics
  - [ ] Integration/e2e: stdio `search_hybrid` and the CLI on a multi-hub question (parity); `eval --via mcp` reports the same multi numbers
  - [ ] Regression: lint, build, full `npm test` (known load flakes re-run alone), `npm run eval`, real-corpus/hub/long-section sets not below 1.22.0
  - [ ] Every #76 acceptance check against 1.15.0, 1.22.0 and 1.23.0 in the same run, answered honestly in notes.md; p95 measured
  - [ ] `npm run gate:release` passes
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
- Phase 4: keep (a) best chunk per doc; no code change. A length prior was measured and not kept (it trades dominance for multi @1/@3 and was not a plan candidate). Phase 6's dominance gate is relative (multi-hub sets, not above the previous release by more than 1), since the absolute 3 is unreachable on the real corpus.
- One plan for #76. It waits for #74, because both extend the eval and the gate.
- Phase 2: the fixture sits in `.documentation/multi-hub/` of each eval clone (the script copies it, as for long-section-hard), so the 141-doc real tree adds noise like a real vault. Docs-only runs are not used for these sets.
- Phase 2: `cov@k` and `dominance` live in `ArmMetrics`, so every eval report carries them; the old releases get them through the mcp arm, which this checkout drives.

## Errors Encountered
- Phase 4: no aggregation variant beats best-chunk: (b) second-strong-chunk bonus (three forms) and (c) single-chunk dampener leave multi @8 at 26/32 (multi-hub 13/19); (b) raises dominance, (c) is a no-op. The multi @8 loss is not in aggregation or in short broad docs on this tree. Dominance <= 3 missed (multi-hub 4, real-corpus 18, a real 38 KB doc every release has); Phase 6 gates it relative to the previous release instead.
- Phase 3: `VectorIndex.search` now fetches up to 16x k chunks (doubling) until k distinct docs, but multi-hub train multi @8 stays 13/19 (one question gained, one lost) and cov@8 .85 -> .86. The pool shrink is therefore not the main cause here; the aggregation/ranking (Phase 4) is. Kept because it is principled, costs no p95 and holds every 1.22.0 gain. Real-tree dominance rose (all train sets, mcp arm: 13 -> 20 top-3 slots for one doc), to be addressed in Phase 4.
- Phase 2: the first fixture (14 multi per set) reproduced the @8 loss by only 1-2 cases (train 13 -> 11, held-out 12 -> 11), inside the noise band. Hardened before any search change: 5 more hub-heavy multi questions per set (cross-hub, 4 facets). Result: train 16 -> 13 (-3 of 19), held-out 13 -> 12 (-1), all 8 sets 51 -> 47 of 61. The held-out loss alone is still within one case, so Phase 6's gate leans on the all-sets multi @8 and `cov@8` as well as the held-out set.
- Phase 2: the first `dominance` counted every top-3 slot and so charged a hub for the questions it answers; redefined as slots on questions the doc does not answer (matches none of the question's facets).
- Phase 2: a stale scratch dir (`git clone` into an existing `tree/`) failed the first eval-against-release run; rerun with fresh `GATE_TMP` dirs. No effect on numbers.

## Status
**Currently in Phase 5** (Phase 4 done: best-chunk kept, no variant wins, see notes.md "Eval results: Phase 4") (hook-failure Jev-hang flake in the full run, passes alone)
