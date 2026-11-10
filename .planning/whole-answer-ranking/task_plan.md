# Task Plan: cold-build readiness and whole-answer ranking (#90, #91)

## Goal
Three fixes, released together as 1.28.0 (minor: ranking changes).

1. **#90.** Right after a cold build, the first answers already rank, but the code-graph grounding multiplier has not landed yet. `applyCode` runs fire-and-forget after `ready`, so two docs drop about 2 s later and ranks 4 and 5 swap. After this fix, the first answer after a cold build equals the answer 10 s later.
2. **#91 part 1.** For an identifier query, a doc that does not contain the identifier must not outrank one that does, when the identifier is in the corpus.
3. **#91 part 2.** For a multi-part question, a doc that answers every part across two or three sections should beat a doc whose single best chunk matches only one part. This part ships only if it passes the train/gate rules below.

## Phases
- [x] Phase 1: Verify and plan (notes.md)
- [x] Phase 2: Reproduce first, as failing tests (`it.fails` until fixed), and the new eval sets
  - [x] #90 integration (`test/integration/code-load-order.test.ts`, or a new `cold-build-ready.test.ts`).
    - Mock `loadCodeData` slow, as that file already does.
    - On a cold `fullIndex()` of a vault whose docs get a grounding below 1 (the `code-graph-vault` fixture has dead refs), assert that when `fullIndex()` resolves, `isStale()` is false.
    - Assert that a fixed query's hybrid scores and order equal the same query run after the code load has settled.
    - Also cover the MCP server path: the first `search_hybrid` answer that is not "Indexing in progress" equals the answer 5 s later, through `buildServer` with no `waitForReady`.
  - [x] #91 part 1 fixture test (`test/retrieval-eval/identifier-tier.test.ts`): a small fixture corpus. One identifier (`check_widgets.py`) appears in 3 docs. Two other docs do not contain it, but their titles and bodies match the rest of the question better ("what does it verify, and what exit codes does it return"; one says "exits 0" in its title). `search_hybrid` and CLI `search`: the top min(N,3) all contain the identifier. Also: a query that is only the identifier still ranks identifier docs first (already true; guard it). An identifier in NO doc changes nothing (`missing_terms` path, order identical to main).
  - [x] Our own docs reproduce it too. Record it, but don't gate on it (docs change). On `.documentation`, "What does gate-release.sh check, and what exit codes does it return?" ranks `changelog/v1-23-0-…` and `reference/cli-reference.md` #2 and #3. Neither contains `gate-release.sh`; 5 docs do (notes.md).
  - [x] #91 part 2 fixture test (`test/retrieval-eval/multi-clause.test.ts`).
    - Doc X answers clause 1 strongly in one chunk (plus unrelated sections, longer doc).
    - Doc Y answers clause 1 and clause 2 in two different chunks, each slightly weaker than X's best.
    - Query "<clause 1>, and <clause 2>?". Y ranks above X.
    - A single-clause query on the same corpus keeps X first (no regression for one-part questions).
  - [x] New eval rows, written BEFORE any ranking change and never edited to fit it.
    - On the existing fixture corpora (whichever the golden sets already use), add multi-part questions in the `{id, tier, q, facets}` JSONL form: about 12 train and 12 held-out, split by id hash the way the other sets split.
    - Also add about 8 train and 8 held-out identifier questions of the "What does <name> verify, and what does it return?" shape.
    - Record the main/1.27.1 numbers for them in notes.md (`## Eval results: Phase 2`). Floors come later, from the measured numbers.
    - Done: sets `whole-answer(-heldout).jsonl` (12+12, multi-hub fixture) and `identifier-tier(-heldout).jsonl` (8+8, new `test/fixtures/identifier-tier/`).
- [x] Phase 3: #90, scoring is final before the index says ready
  - [x] `fullIndex()` (src/mcp/context.ts:562) awaits the code load its sync started before setting `indexState = "ready"`. Track the last `applyCode` promise; don't reorder the #73 design (docs are installed first, code after).
    - The `--wait-for-ready` path awaits it too (it calls `fullIndex`).
    - A failing or slow code load must not block forever: `loadCode` already catches. Keep that; time-box only if a test shows a hang.
  - [x] Warm swaps (reconcile, `loadFromDisk`) keep the #73 behavior: served at once and marked stale until the code lands. Only the cold path, where nothing was being served, waits. Record the decision.
  - [x] Readiness is visible: `get_stats` (or wherever index state is reported) says `stale`/`ready` truthfully while a code load is pending. Check what it reports today. Add a field only if nothing exposes it.
  - [x] The retrieval-eval runner and `gate-release.sh` wait for a non-stale answer (the `_meta.stale` flag or the stale note) before scoring, not just for a non-"Indexing" answer. Check `src/core/retrieval-eval/runner.ts:12`.
  - [x] The CLI `search` path loads code itself (src/cli/search.ts:174). Confirm it is not affected (no race there). Record it.
  - [x] Phase 2 #90 tests pass as plain `it`.
- [x] Phase 4: #91 part 1, an identifier tier after fusion
  - [x] In `hybridRanked` (src/mcp/tools/search.ts:112), and the same step in CLI `search` (src/cli/search.ts:169), after fusion and coverage and before the reranker:
    - When the query has identifiers (`identifiers(query, known)`, the same detector `classifyQuery` uses) and at least one of them occurs in a searchable doc (`bm25.has` on its tokens, `hasJoined` for other spellings, the doc path words as `missingTerms` checks them), stably partition the candidates. Docs containing every such present identifier come first (`bm25.docHas` on all its tokens, or its path), then the rest, each group in its fused order.
    - With several identifiers and no doc holding all of them, partition on the count held (more first).
    - Put the shared helper in `src/core/` next to `identifiers.ts`, used by both MCP and CLI.
  - [x] An identifier present only in docs outside the candidate pool still changes nothing (no pool widening here; the pool stays `candidatePool(limit)`). Record whether that leaves any Phase 2 eval row unfixed.
  - [x] `search_semantic` is unchanged (cosine only, by design).
  - [x] Tests: the Phase 2 part 1 cases pass as plain `it`.
    - Also: limit 1, 3 and 5 are prefixes of limit 8 (the #85 rule), and the tier is stable when every candidate or none contains the identifier.
    - `mode: "fact"` override still tiers? Decide (the tier keys on identifiers present, not on the label), record it, and test it.
  - [x] Measure on train only: the identifier rows and every existing set. Gate vs 1.27.1 (`bash scripts/gate-release.sh 1.27.1`, BAND=1) with only this change. Dominance must not rise beyond the band. Record numbers. If the gate fails, find the cause (e.g. a common identifier like `vault.schema.yml` in many docs reorders a non-identifier question). Narrow the trigger on TRAIN evidence only, e.g. skip identifiers present in more than N% of docs, with N picked on train. Then re-gate.
  - [x] Commit this phase on its own, so part 1 can ship without part 2.
- [x] Phase 5: #91 part 2, clause coverage (ships only if it passes; SHIPPED OFF)
  - [x] Split the query into clauses on ` and `, `,`, `;` and `?`. Keep a clause only if it has at least 2 non-stop tokens (`tokenize`). With fewer than 2 clauses, nothing changes.
    - Done: `splitClauses` (src/core/rank.ts), cap 3 (`MAX_CLAUSES`).
  - [x] Per clause, one extra query embedding (batch the clauses into one `embedder` call if the API allows). For each candidate doc in the fused pool, the best body-chunk cosine for each clause comes from the stored unit vectors. Use `VectorIndex` (add one method there, next to `bestChunk`, that scores a doc's chunks against several query vectors). No re-embedding of docs, no new index.
    - Done: `VectorIndex.clauseCover` (src/core/vector.ts) keeps each clause's top two body chunks and returns the best min(cos) over clause pairs on DISTINCT chunks; clauses embedded with `Promise.all(embedQuery)` (no batch API for queries).
  - [x] Score: a bonus for covering several clauses with DIFFERENT chunks, not for breadth. E.g. `score *= 1 + w * (second-best clause match, where the best two clauses' best chunks are distinct)`, or `w * mean(per-clause best) - …`. Pick the form and `w` on TRAIN only (the Phase 2 train rows plus the existing train sets).
    - Done: `score *= 1 + w * clauseCover`, applied by `applyClauses` after coverage and before the path-class filter (MCP and CLI). Train sweep in notes.md. Result: no `w` met the rule AND passed the gate (see below).
    - The selection rule: train hybrid @1 must not drop on any set, and dominance must not rise (#87's failure mode: a breadth reward let overview docs take every slot).
    - Default `w` = the train-best value that meets both, or 0 if none does.
    - Put `w` in `RankingConfig` (`ranking.clause_weight` in vault.schema.yml), like `coverage_weight`.
  - [x] Latency: the extra embeddings must keep p95 within the gate's bound. Measure p95 with 2- and 3-clause queries. If it busts the bound, cap the number of clauses at 3 and record it.
    - Measured in the gate run at w=1: p95 32 ms vs 14 ms (1.27.1), 3 clauses max. Within the gate (it has no p95 bound). Moot: ships off, so no extra embeddings run by default.
  - [x] Gate vs 1.27.1 with parts 1 and 2 (BAND=1), then held-out as measured.
    - Done at w=1: FAIL (hybrid @1 72 vs 73 no export, 76 vs 78 export, band 1). Shipped `clause_weight: 0`; multi-clause hybrid/CLI `it.fails` kept with the reason. #91 stays open for part 2.
    - **If no `w` > 0 passes on train, or the gate fails:** ship `clause_weight: 0` (off) with the code and tests. Say so in the changelog with the numbers. #91 then stays open for part 2 (as #76 did), and the release comment asks for the anonymised repro.
    - Do not tune on held-out.
  - [x] Relation to #87: if part 2 works, note in notes.md whether it also lets the candidate pool grow without the dominance rise (one train-only measurement at pool 60 is enough). Don't change the pool in this plan; #87 stays its own release.
    - Skipped: part 2 did not ship on, so there is no pool-60 measurement to make.
- [x] Phase 6: Measure the whole branch
  - [x] `npm run eval` and the #85 per-limit check: limits 1, 3 and 5 are prefixes of limit 8 on every set. Reproducible builds still give 0 differing results (`test/retrieval-eval/reproducible-build.test.ts`).
  - [x] Cold-build check by hand on this repo's `.documentation`, the #90 repro:
    1. delete the index;
    2. start the server;
    3. poll until ready;
    4. run a fixed 10-query set at once and again 10 s later.
    Expect 0 differences.
  - [x] `npm run gate:release` (fresh, BAND=1) vs 1.27.1 passes. Record @1/@3/@8 per set, dominance and p95 in notes.md, with the per-change split from Phases 4 and 5.
  - [x] Set floors for the new eval rows from the measured branch numbers (train and held-out, real-corpus slack as baseline.json describes).
- [x] Phase 7: Release prep
  - [x] Bump all five version fields to 1.28.0, plus the lockfile.
- [x] Phase 8: Cleanup -- remove junk and unused code this work created: scratch/test scripts, debug files, probe logging, one-off test functions, commented-out code, dead code from abandoned approaches (MANDATORY)
- [ ] Phase 9: Validate success through comprehensive testing (MANDATORY)
  - [ ] Every Phase 2 test passes, and none is left as `it.fails` (except part 2 if it shipped off, then as a documented `it.fails` with the reason).
  - [ ] Edge cases:
    - **Identifier tier:** an identifier in 0 docs; one present in every candidate; two identifiers where one is missing; a path identifier (`src/x/y.ts`); a backticked one; an identifier only in a doc's path, not its body; an excluded or `generated: true` doc holding it (must not count); the `mode` override.
    - **Clauses:** a question with no "and"; "and" inside a name ("Tom and Jerry"); a 4-clause question (the cap); an empty clause after splitting; a query that is only punctuation.
    - **#90:** a code load that throws (the index still goes ready); a vault with no code at all (no wait beyond the load); a warm restart (stable from the first answer, as before).
  - [ ] Federation: `search_hybrid` over two sources applies the same tier per source and merges as before (the federation snapshot test; re-take a drifted score only if the order is unchanged, as 1.27.0 did).
  - [ ] Lint, build, `npm test`, `npm run eval`, `npm run gate:release` (fresh).
  - [ ] Independent review of `git diff main...HEAD` (`claude -p`, with the code, not our conclusions).
- [ ] Phase 10: Documentation pass with hit-em-with-the-docs; no secrets (MANDATORY)
  - [ ] `.documentation/operational/retrieval-tuning-guide.md`: the identifier tier, `ranking.clause_weight` (its default and how it was chosen) and how both interact with coverage.
  - [ ] `.documentation/reference/mcp-tools-reference.md`: the `search_hybrid` ranking order (the tier) and readiness after a cold build.
  - [ ] `.documentation/architecture/indices-and-storage.md`, or wherever the #73 code-graph-after-docs order is described: a cold build is ready only after the code graph lands.
  - [ ] `.documentation/operational/retrieval-eval-guide.md`: the new eval sets and their floors.
  - [ ] KB gotcha facts:
    - "a readiness flag set before every score input lands makes the first answers rank differently" (`## Instead`: await every scoring input on the cold path; a first-answer-equals-later test);
    - "best-single-chunk ranking loses to multi-part questions" (`## Instead`: per-clause matching), only if part 2 shipped on, or as a measured-negative fact if it shipped off.
  - [ ] `CHANGELOG.md` 1.28.0 and `.documentation/changelog/v1-28-0-whole-answer-ranking.md`, with the per-change gate numbers.
  - [ ] `npx hewtd maintain --quick`; never hand-edit INDEX.md or REGISTRY.md. Re-run `npm run eval` after the docs.

## Key Questions
1. Should a cold build wait for the code graph, or answer marked stale? Wait. Before ready, nothing was being served ("Indexing in progress"), so waiting costs only the `git log` time, and it makes the first answer final. Warm swaps keep #73's serve-then-mark-stale.
2. Is the identifier tier hard or a boost? Hard (a stable partition), as the reporter suggests, but only for identifiers present in the corpus, and narrowed on train evidence if the gate shows a cost.
3. Clause coverage vs #87? #87 is about the whole-doc term-coverage boost rewarding breadth in a larger pool. Part 2 rewards distinct chunks matching distinct clauses, a different signal. The pool stays 24 here.

## Decisions Made
- Phase 2: identifier sets use a new small fixture (`test/fixtures/identifier-tier/`, flat so `eval-against-release.sh` copies it), because no existing fixture holds one identifier in several docs; whole-answer sets reuse the multi-hub fixture.
- Version 1.28.0 (minor: ranking order changes for identifier and multi-part queries).
- Each ranking change is gated separately against 1.27.1, then together (as #85 was).
- Part 2 may ship off by default. #91 then stays open with numbers.

- Phase 3: `fullIndex()` awaits the last `applyCode` promise before saving and setting ready (so the saved cache also holds the final grounding). The cold path is `documents.length === 0` at its start; there `getVectorIndex()` returns null until fullIndex ends, because search tools gate on the vector index existing, not on indexState. Warm swaps/reconcile/loadFromDisk are unchanged (#73). `get_stats` already reports `stale` from `isStale()` (codePending), so no new field. The eval runner already retries `_meta.stale` answers (runner.ts:16), so no change there. CLI `search` reads grounding from the saved cache and loads code only for the entity card, so no race. Graph tools (`search_graph`) gate on documents, so a cold build still answers them during the code load; not scored, left.

- Phase 4: `identifierTier` (src/core/identifiers.ts) is a stable sort by the count of present identifiers a candidate holds (covers "all first" and "most first" in one rule). An identifier is present when every token of its last path segment has df > 0 (`bm25.has`); a doc holds it when `docHas` finds every token (chunks, fields, path words). Applied in `hybridRanked` after filters and before the reranker, and in CLI `search` after filterPathClass and before fold (the CLI's code load moved ahead of it, to get `knownToCode`). The `mode` override still tiers (keys on identifiers, not the label; tested). No narrowing was needed: the gate passed with no train regression, so no N% rule. `hasJoined` spellings are not used (shortcut: a doc spelling `check-widgets` for `check_widgets` tokenizes alike or is not tiered).
- Phase 4: out-of-pool identifier docs are not pulled in. The identifier eval rows all have their docs in the pool of 24, so none is left unfixed.

- Phase 5: `clause_weight` swept on train only; ships 0 (off). Code, config key (`ranking.clause_weight`), unit tests and the multi-clause fixture test (`it.fails`) stay.

## Errors Encountered
- Phase 5: w=1 passed the train rule (no @1 drop on any train set, dominance unchanged, fixture flips) but failed the held-out gate vs 1.27.1: no export hybrid @1 72 vs 73, multi @1 9 vs 10; export hybrid @1 76 vs 78 (beyond BAND 1). Not re-tuned on held-out; shipped off. Also on train at w>=0.5 real-corpus hybrid @3 fell 26 to 24.
- Phase 2: the whole-answer rows leave little headroom on main (11/12 and 10/12 @1; hub docs hold both answers) and the identifier rows are 8/8 @1 already, so the eval counts alone cannot show the gains. Phase 4 reports "top-3 all identifier docs" (0/8 and 0/8 on main) and Phase 5 relies on the `multi-clause` fixture. Rows left as written.

- Phase 6: full validation: stdin-eof (known load flake) failed once in `npm test` and passed alone; real-corpus-eval hit its 600 s beforeAll timeout once in `npm run eval` (known flake) and passed alone (16 passed, 1 expected fail). Not re-run whole.

## Status
**Phase 9 next** (validate). Phase 8 cleanup done: nothing to remove. Phase 7 done (1.28.0 in all five fields and lockfile). Phase 6 done: gate PASS, #90 by-hand 0/10 differences, floors set (baseline.json newSets + new-sets-floor.test.ts). Earlier note: (measure the whole branch). Phases 2-5 done; #91 part 2 is built but ships OFF (`clause_weight: 0`) after failing the held-out gate; the multi-clause two-part tests stay `it.fails`. Floors for the new eval sets and gate-release.sh entries are still pending (Phase 6).