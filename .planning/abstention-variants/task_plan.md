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
- [x] Phase 2: Reproduce first (before any change)
  - [x] Fixture `test/fixtures/abstention-variants/`, a git repo built in the test:
        - INDEX.md/REGISTRY.md hubs without `generated: true` that name an absent product;
        - a doc writing `auto-fill`, and code with `autoFill`;
        - `snake_case` and `Title Case` variants;
        - a lock file and a TOML that name an absent product.
  - [x] Failing tests on main:
        - (a) the product named only in a hub is flagged, with and without `generated: true` and with and without the export;
        - (b) `autofill`, `auto_fill` and `AutoFill` are not missing when the docs say `auto-fill`;
        - (c) a name found only in a lock file or config is still missing (it already is; pin it).
        Run them over stdio and the CLI.
  - [x] Add variant negatives and controls to `absent-terms.jsonl` and `absent-terms-heldout.jsonl` (hyphenated and camelCase controls that ARE documented under another spelling). Write them before measuring.
  - [x] Baseline in notes.md: 1.22.0, 1.23.0, 1.24.0 and local, same run (1.15.0 dropped: #74 already measured it; 1.24.0 added as the previous release), CLI and MCP, with and without an export.
- [x] Phase 3: Presence counts only searchable docs
  - [x] `Bm25Index` presence (`has`, `docFreq`, `docHas` as the detector uses them) skips docs that are `generated`, or that match `resultsExclude` or `exclude`. Keep BM25 scoring unchanged, or prove rank-neutral if the hubs' chunk text already is not scored.
        (Generated, `exclude`d docs already had no chunks; the leak was `results.exclude` hubs without `generated: true`. A second df, `presenceDf`, counts searchable docs only; scoring still reads `df`. Rank parity measured: notes.md.)
  - [x] Apply the same rule to `paths` (doc paths joined) so a hub's file name never counts as presence.
  - [x] Unit and stdio tests from Phase 2 (a) pass.
- [x] Phase 4: Spelling variants count as present
  - [x] Normalized form: lowercase, with `-`, `_` and whitespace removed, and camelCase joined.
        - Docs: index the joined forms of hyphenated and underscored compounds as presence-only terms (not scored). (`joinedForms`/`hasJoined` in bm25.ts: adjacent-pair and whole-run joins, searchable docs only; camelCase needs nothing, tokens are already lowercase.)
        - Code: compare `knownToCode` symbols and file names in normalized form. (File names only, in `splitUndocumented`; see Decisions.)
  - [x] A name present only under a variant is neither in `missing_terms` nor in `passing_terms` (decide on train whether passing_terms uses the joined form's doc count). (Decided: a variant is not a passing term; `passingTerms` is unchanged. Joined doc counts add nothing the train needs.)
  - [x] Measure on train: negatives flagged, false flags (controls, real-corpus, hub, golden). Check that the known false flags (`wildcard`, `refetching`, `dotfiles`) are fixed or unchanged, and say which. (notes.md "Eval results: Phase 4")
- [x] Phase 5: Same answer on every path
  - [x] MCP `search_hybrid`, the CLI `search`, `eval` and federation agree on the Phase 2 fixture (parity test over stdio and the CLI).
        (Done wider: `test/e2e/abstention-parity.test.ts` runs every question of both absent-terms sets on a tree clone, plain and with the hewtd export: stdio vs the CLI's `openSearch`, and a federated server with an identical source. No divergence found, so no src change. The Phase 2 fixture's stdio-vs-CLI check stays. `eval` is the same pipeline as stdio; its aggregates matched in Phases 3-4.)
- [x] Phase 6: Release gate
  - [x] Add the variant controls to the gate's held-out absent-terms set. Run `gate:release` against the previous release; record the result and runtime. (Controls were added to the held-out set in Phase 2 and the gate already reads that set; hub-only presence needs a tree whose hubs lack the flag, which the repo corpus is not, so it stays in the e2e fixture. PASS vs 1.24.0 in 3m24s.)
- [x] Phase 7: Release prep
  - [x] Bump all five version fields to 1.25.0 and update the lockfile
  - [x] Offline tarball deferred to release (built from the merge commit) (deferred to release)
- [x] Phase 8: Cleanup
  - [x] Remove what this branch created or made dead: losing variants, trial knobs, scratch scripts
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

- Phase 4: variant presence is a second, presence-only map (`joinedDf`) beside `presenceDf`, so scoring never sees it. `knownToCode` symbols are not normalized: it only gates PascalCase candidates, and a symbol is in the docs (so already present) only when a doc cites it. Normalized file names rescue a name only as `undocumented`, in `splitUndocumented`, not in `locateFiles`' entity cards.

## Errors Encountered
- Phase 2: the interrupted run left its work in stash@{0} (kept, not popped); it was sound and reused as is. Absent-terms baseline arms: 1.22.0 instead of 1.15.0 (see Phase 2).

## Status
**Currently in Phase 9** (Phases 7 and 8 done: 1.25.0 bump; removed the always-empty MAIN_WRONG scaffold from the e2e test)
