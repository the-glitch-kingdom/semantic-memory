# Task Plan: `eval --gaps-out` exports facets, missing facets and the nearest doc; the Diagnosis shows them; facet-shape rule for blind sets (#101)

## Goal
#101 is the companion to hit-em-with-the-docs#113. hit-em-with-the-docs will turn coverage misses into a docs plan (new doc vs extend an existing one), and needs per-miss detail that 1.31.x's `eval --gaps-out` doesn't write. Three parts:

1. **Richer `gaps.v1` entries** from `eval --gaps-out`. These are optional fields, so the usage-log gaps (`semantic-memory gaps --json`) stay as they are:
   - `id`, `tier`, `blind`, from the question set;
   - `facets`;
   - `missing_facets`: facets that match no active doc;
   - `nearest_doc`: `{path, facet_coverage: "k/n", rank}`, the doc holding the most facets, with its hybrid rank, or `null` outside the top k;
   - `expected`, when the set has it.
2. **The Diagnosis** prints the nearest doc and `k/n` on each coverage line, so "one missing detail" vs "topic absent" is visible in the report.
3. **The facet-shape rule** goes into `BLIND-SETS.md` (eval init) and `docs/measure-and-tune.md`.
   - One facet is one fact a correct written answer contains: an identifier alone, or a value with its unit in prose forms (`24 ?(h|hours?)|86400`). Not a whole line of code.
   - It must match both the code and a correct prose answer.
   - No bare common words or small numbers.
   - Plus an `eval` warning when a facet looks like a code line and matches no doc.

**The contract is fixed by the consumer.** hit-em-with-the-docs `main` (4a49bc9, unreleased #113 work, read-only) already parses these exact fields in `src/core/reconcile/gaps.ts` `parse_gaps`:
- `id` and `tier` as strings;
- `blind` as a boolean;
- `facets`, `missing_facets` and `expected` as arrays of strings;
- `nearest_doc` as `{path, facet_coverage, rank: number | null}`.
Its code-line test is `is_code_line_facet` in `src/core/coverage/facets.ts`. Match both exactly. Never modify that repo.

Release as **1.32.0** (minor: new export fields, new report detail, new warning).

**Out of scope.**
- The docs-plan logic itself (new vs extend, merge, drafts): that's hit-em-with-the-docs#113.
- Changing coverage labelling (a facet matching no doc is still coverage).
- Ranking.

## Phases
- [x] Phase 1: Verify and plan (notes.md)
- [x] Phase 2: Acceptance as failing tests first (`it.fails` until fixed)
  - [x] `eval --gaps-out` on a fixture with a blind set holding:
    - a "one missing detail" miss: some doc holds 2 of 3 facets;
    - a "topic absent" miss: no doc holds any facet.
    Each entry carries `id`, `tier`, `blind`, `facets`, `missing_facets` and `nearest_doc {path, facet_coverage, rank}`, plus `expected` when the row has it. For the topic-absent case, `nearest_doc` is `null` or omitted; pick one and match hit-em-with-the-docs' parser.
  - [x] **Compatibility:**
    - `semantic-memory gaps --json` (usage-log gaps) is byte-identical to main;
    - an entry without facets keeps only the five classic fields;
    - the output is accepted by hit-em-with-the-docs' parser. Run `parse_gaps` from its built `main` in a temp copy, read-only. If that build isn't available, assert against a copied schema from its source, and record the commit.
    - Also confirm that the released hit-em-with-the-docs 3.4.1 `reconcile --gaps --json` still accepts the richer file (unknown fields ignored, not errors).
  - [x] **Diagnosis:** each coverage line ends with `nearest: <path> k/n`, or `nearest: none` when no doc holds a facet. `--json` `diagnosis.cases[]` gains `missing_facets` and `nearest_doc` on coverage cases.
  - [x] **Code-line facet warning:** a facet like `_TTL_SECONDS = 24 * 60 * 60` or `class Foo:` that matches no doc prints one warning per facet (id plus facet) on stderr. A prose facet doesn't. A code-line facet that does match a doc doesn't.
  - [x] **Guide text:** `BLIND-SETS.md` (from `eval init`) and `docs/measure-and-tune.md` contain the facet-shape rule. The guide deny-list test still passes.
  - [x] Guards (plain `it`): today's Targets rows and the report head are byte-identical; ranking and grounding cases are unchanged.
- [x] Phase 3: Export and diagnosis
  - [x] Per coverage case, compute from the live docs (reuse `facetIssue` / `findStale`'s facet matching, not a second one):
    - `missing_facets`;
    - per-doc facet counts, giving `nearest_doc` = the doc with the most facets (ties: the hybrid-higher one, then path order);
    - `facet_coverage` = `k/n`;
    - `rank` = its position in hybrid's top 8 for that question, else `null`.
    That needs hybrid's top-8 paths per question: extend the probe in `runSuite`, which keeps only the top 3 today, without changing the arms.
  - [x] `--gaps-out` writes the extra fields for case-derived entries only. Keep `toGapsV1` for the usage log as is (its comment says "no extra fields"); add a separate builder for eval gaps, or an optional extras pass-through. Recorded: a separate builder inline in the CLI (base `toGapsV1` entries merged with case detail); `toGapsV1` untouched.
  - [x] Diagnosis line and `--json` fields as in Phase 2.
- [x] Phase 4: Facet-shape rule and warning
  - [x] The code-line test matches hit-em-with-the-docs' `is_code_line_facet` regex exactly. Copy it, with a comment naming the source and commit, and a test pinning the same examples, so both tools agree.
  - [x] The warning goes on stderr, one line per facet, after the run. It never changes labels.
  - [x] The guide text goes in `BLIND-SETS.md` (`src/core/retrieval-eval/targets.ts`) and `docs/measure-and-tune.md` §3, with #101's numbers, numbers only: 25/25 coverage with code-line facets vs 11 coverage, 6 ranking, 3 grounding and 5 answered with prose facets.
- [x] Phase 5: Measure
  - [x] Fresh `BAND=1 bash scripts/gate-release.sh 1.31.1`: every count identical (no ranking change).
  - [x] By hand on this repo's `.documentation`, with a small scratch blind set (one near-miss, one absent topic, one code-line facet):
    - the Diagnosis lines;
    - the `--gaps-out` file;
    - the warning;
    - and that hit-em-with-the-docs 3.4.1 `reconcile --gaps <file> --json` accepts the file.
    Record it all.
- [x] Phase 6: Release prep
  - [x] Bump all five version fields to 1.32.0, plus the lockfile. (all five fields + lockfile at 1.32.0)
- [ ] Phase 7: Cleanup -- remove junk and unused code this work created: scratch/test scripts, debug files, probe logging, one-off test functions, commented-out code, dead code from abandoned approaches (MANDATORY)
- [ ] Phase 8: Validate success through comprehensive testing (MANDATORY)
  - [ ] Every Phase 2 test passes as plain `it`.
  - [ ] Edge cases:
    - a case with `expected` but no facets (no `nearest_doc`; `expected` exported);
    - a facet that is an invalid regex (reported as today, never thrown);
    - a tie for nearest doc;
    - the nearest doc outside the top 8 (`rank: null`);
    - archived docs never count as nearest (`ARCHIVE_RE`);
    - a non-blind set (coverage cases stay `stale`, as today, so no export rows);
    - `--no-oracle` (no diagnosis, so `--gaps-out` behaves as it does in 1.31.x with `--no-oracle`; decide and record);
    - CRLF sets;
    - a 0-coverage run writes an empty `gaps.v1`.
  - [ ] Lint, build, `npm test`, `npm run eval`, `npm run gate:release` (fresh, BAND=1 vs 1.31.1).
  - [ ] Independent review of `git diff main...HEAD` (`claude -p --setting-sources "" --tools ""`, given the code, not our conclusions). Fix what it confirms; record rejections.
- [ ] Phase 9: Documentation pass with hit-em-with-the-docs; no secrets (MANDATORY)
  - [ ] `.documentation/operational/retrieval-eval-guide.md`: the new gaps fields, the nearest-doc line, the code-line warning and the facet-shape rule.
  - [ ] `docs/measure-and-tune.md`: the coverage route mentions `nearest_doc` (extend vs new doc); facet shape is in §3. The deny-list test passes.
  - [ ] The `optimize-search` skill: the coverage step reads `nearest` (k/n high → extend that doc; none → new doc).
  - [ ] Plugin help (`src/core/help/topics.ts`): the `eval` topic mentions the richer `--gaps-out`. `test/unit/help-coverage.test.ts` and `test/unit/cli-help.test.ts` pass, and the `eval --gaps-out` `--help` text is accurate.
  - [ ] KB gotcha fact: facets copied verbatim from code lines score every blind question as a coverage miss, because prose never quotes the line. `## Instead`: one fact per facet, prose-tolerant.
  - [ ] `CHANGELOG.md` 1.32.0 and `.documentation/changelog/v1-32-0-gaps-facets.md`.
  - [ ] `npx hewtd maintain --quick`; never hand-edit INDEX.md or REGISTRY.md. Re-run `npm run eval` after the docs.

## Key Questions
1. Should `nearest_doc` be `null` or omitted when no doc holds a facet? Whichever hit-em-with-the-docs' `parse_gaps` treats as "none"; read it and match it.
2. Should non-blind coverage cases be exported? No: they are `stale` (skipped) today, not diagnosed. Only diagnosed coverage misses are exported, as in 1.31.x.

## Decisions Made
- Version 1.32.0. Branch `feat/gaps-facets`, cut from main before 1.31.1 merged. Merge main into it after 1.31.1 ships (don't rebase), and archive `two-part-ranking-and-bare-refs` there.
- Field names and shapes follow hit-em-with-the-docs `main` 4a49bc9 `parse_gaps`.
- Key Question 1 answered: a topic-absent entry OMITS `nearest_doc` (`parse_gaps` rejects `null` with `"nearest_doc" must be {path, facet_coverage, rank}`; only `rank` may be null).
- Phase 2 tests are in `test/retrieval-eval/gaps-facets.test.ts` (10 `it.fails`, 5 plain guards). Parser check: a copied per-key validator (4a49bc9) always runs; the real `parse_gaps` runs from the sibling checkout's built dist (`HEWTD_BUILD` overrides the path), skipped when absent. 3.4.1 acceptance runs `reconcile --gaps --json` from a temp project copy.
- The non-coverage-only compat items (entry without facets keeps five fields) are guarded on `toGapsV1` and the usage-log `gaps --json` CLI (byte-pinned); the eval only exports coverage cases, which always have facets.

- Phase 3: hybrid top 8 is kept in a separate `top8` map in `runSuite` (not on `Probe`, which the release gate compares), passed as an optional last arg to `diagnose`. `nearest_doc`/`missing_facets` count non-archive docs only; invalid-regex facets count as missing. The eval gaps builder is inline in `src/cli/retrieval-eval.ts`. The 5 Phase 2 `it.fails` for export/diagnosis/parse_gaps/3.4.1 are now plain `it`; the code-line warning and guide-text ones stay `it.fails` for Phase 4.

## Errors Encountered
(none)

## Status
**Phase 7 next** (Phase 6 release prep done, all versions 1.32.0). Earlier: **Phase 6** (release prep). Phase 5 done (gate PASS, by-hand check in notes.md). Phase 4 done: `isCodeLineFacet` (metrics.ts, copied from hewtd 4a49bc9), stderr warning in src/cli/retrieval-eval.ts, guide text in targets.ts and docs/measure-and-tune.md.
