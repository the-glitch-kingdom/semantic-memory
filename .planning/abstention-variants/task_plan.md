# Task Plan: abstention-variants

## Goal
Ship semantic-memory#78 as v1.25.0, after #76's v1.24.0. Two fixes to the abstention detector:
1. A term counts as present only in docs a search can return. Generated hubs (`generated: true`, or the `results.exclude` globs, by default `**/INDEX.md` and `**/REGISTRY.md`) never make a name present. The same negative is then flagged on a tree whatever its index files' frontmatter, and with or without the export.
2. A name written in the docs or the code as a hyphen, underscore, case or camelCase variant counts as present (`autofill` against `auto-fill` / `autoFill`).

Targets (reporter's): A+B negatives >= 6/7 on both trees with <= 1/34 false flags; C09 has no `missing_terms`; set C stays >= 9/10 with 0/25; the #74 held-out absent-terms set does not drop.

One PR from `feat/abstention-variants`, rebased on main after #76 merges. The reporter's tree decides after publish; every missed target is stated in the PR and on #78.

## Prerequisites
- #76 (v1.24.0) merged and published. Rebase this branch on main first.

## Rules for every phase
- **Verify before ticking.** Confirm in code, or with a test, that a box is actually done before ticking it.
- **One detector.** Change `missingTerms` / `passingTerms` (src/core/identifiers.ts) and what they read. Never add a second detector. MCP, CLI, `eval` and federation call the same functions.
- **Rank-neutral.** Only `no_strong_match`, `missing_terms` and `passing_terms` change. Assert that the result order is identical.
- **Eval discipline.**
  - Choose rules on TRAIN only.
  - Compare against 1.15.0, 1.23.0 and the previous release (1.24.0) **in the same run**.
  - Put false flags beside every negatives-flagged number.

## Phases
- [x] Phase 1: Verify and plan
  - [x] Verify #78 against main @ 2ab171c (notes.md): both causes reproduced on a fixture
  - [x] Post the verification comment on #78
  - [x] Cut `feat/abstention-variants`, commit this plan
- [ ] Phase 2: Reproduce first (before any change)
  - [ ] Fixture `test/fixtures/abstention-variants/`, a git repo built in the test:
        - INDEX.md/REGISTRY.md hubs without `generated: true` that name an absent product;
        - a doc writing `auto-fill`, and code with `autoFill`;
        - `snake_case` and `Title Case` variants;
        - a lock file and a TOML that name an absent product.
  - [ ] Failing tests on main:
        - (a) the product named only in a hub is flagged, with and without `generated: true` and with and without the export;
        - (b) `autofill`, `auto_fill` and `AutoFill` are not missing when the docs say `auto-fill`;
        - (c) a name found only in a lock file or config is still missing (it already is; pin it).
        Run them over stdio and the CLI.
  - [ ] Add variant negatives and controls to `absent-terms.jsonl` and `absent-terms-heldout.jsonl` (hyphenated and camelCase controls that ARE documented under another spelling). Write them before measuring.
  - [ ] Baseline in notes.md: 1.15.0, 1.23.0 and local, same run, CLI and MCP, with and without an export.
- [ ] Phase 3: Presence counts only searchable docs
  - [ ] `Bm25Index` presence (`has`, `docFreq`, `docHas` as the detector uses them) skips docs that are `generated`, or that match `resultsExclude` or `exclude`. Keep BM25 scoring unchanged, or prove rank-neutral if the hubs' chunk text already is not scored.
  - [ ] Apply the same rule to `paths` (doc paths joined) so a hub's file name never counts as presence.
  - [ ] Unit and stdio tests from Phase 2 (a) pass.
- [ ] Phase 4: Spelling variants count as present
  - [ ] Normalized form: lowercase, with `-`, `_` and whitespace removed, and camelCase joined.
        - Docs: index the joined forms of hyphenated and underscored compounds as presence-only terms (not scored).
        - Code: compare `knownToCode` symbols and file names in normalized form.
  - [ ] A name present only under a variant is neither in `missing_terms` nor in `passing_terms` (decide on train whether passing_terms uses the joined form's doc count).
  - [ ] Measure on train: negatives flagged, false flags (controls, real-corpus, hub, golden). Check that the known false flags (`wildcard`, `refetching`, `dotfiles`) are fixed or unchanged, and say which.
- [ ] Phase 5: Same answer on every path
  - [ ] MCP `search_hybrid`, the CLI `search`, `eval` and federation agree on the Phase 2 fixture (parity test over stdio and the CLI).
- [ ] Phase 6: Release gate
  - [ ] Add the variant controls to the gate's held-out absent-terms set. Run `gate:release` against the previous release; record the result and runtime.
- [ ] Phase 7: Release prep
  - [ ] Bump all five version fields to 1.25.0 and update the lockfile
  - [ ] Offline tarball deferred to release (built from the merge commit)
- [ ] Phase 8: Cleanup
  - [ ] Remove what this branch created or made dead: losing variants, trial knobs, scratch scripts
- [ ] Phase 9: Validation (independent review)
  - [ ] Review `git diff main...HEAD` adversarially against this plan, fix real bugs with regression tests, audit every ticked box
  - [ ] Unit: presence with generated and results-excluded docs, normalized variants for docs and code, lock files are not presence
  - [ ] Integration/e2e: stdio and CLI on the fixture, with and without `generated: true` and the export; rank parity
  - [ ] Regression: lint, build, full `npm test` (known load flakes re-run alone), `npm run eval`, no new false flags on the real-corpus, hub and golden sets
  - [ ] Every #78 acceptance check against 1.15.0, 1.23.0 and 1.24.0 in the same run, answered honestly in notes.md
  - [ ] `npm run gate:release` passes
- [ ] Phase 10: Documentation (full hit-em-with-the-docs pass, no secrets)
  - [ ] `.documentation/changelog/v1-25-0-*.md` and the CHANGELOG.md entry: numbers against 1.15.0, 1.23.0 and 1.24.0 in the same run, false flags beside every negatives number, missed targets stated
  - [ ] Docs for `missing_terms` / `passing_terms` presence rules (search reference, retrieval-tuning-guide, the `weak-matches` help topic)
  - [ ] KB gotcha fact: generated hubs without `generated: true` made absent names look present; `hewtd index` adds the flag
  - [ ] README version row; AGENTS.md regenerated
  - [ ] Final `npm run eval`; floors move only with a measured reason

## Key Questions
1. Do the reporter's d0 INDEX/REGISTRY files lack `generated: true`? Asked on #78. The fix does not depend on the answer.
2. Does presence-only indexing of joined compounds add false negatives (a real absent name that happens to join two doc words)? Answered on train in Phase 4.

## Decisions Made
- One plan for #78. It waits for #76, which owns the main checkout and also extends the gate.
- The reporter's guess that lock files or config count as code presence does not hold: the code-graph fallback never reads file contents, only file names and doc-cited symbols. Phase 2 pins it with a test.

## Errors Encountered
- (none yet)

## Status
**Currently in Phase 2** (waiting for #76 to merge, then rebase)
