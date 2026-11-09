# Task Plan: abstention-product-names

## Goal
Ship semantic-memory#74 as v1.23.0, after #73's v1.22.0. A query that names a product or tool in neither the docs nor the code (`Hotjar`, `FullStory`, `Airflow`, `keystore`) returns `no_strong_match: true` with that term in `missing_terms`. This holds over MCP `search_hybrid`, the CLI and `eval`, and adds no false flags on answerable questions.

One PR from `feat/abstention-product-names`, rebased on main after #73 merges. The reporter's targets are A+B >= 6/7 negatives with <= 1/34 false flags, and set C >= 9/10 with 0/25. Their tree decides after publish; every missed target is stated in the PR and on #74.

## Prerequisites
- #73 (v1.22.0) merged and published. Rebase this branch on main first; #73 changes the eval (`--via mcp`) and the gate this plan extends.

## Rules for every phase
- **Verify before ticking.** Confirm in code, or with a test, that a box is actually done before ticking it.
- **Eval discipline.**
  - Rules and constants are chosen on TRAIN only; held-out is written before any tuning and reported as measured.
  - Compare against published 1.15.0 and the previous release, measured **in the same run**, never against floors.
  - The reporter's example terms are not used for tuning, because they wrote the rule while looking at them.
- **One detector.** Extend `identifiers()`/`missingTerms()` (src/core/identifiers.ts), the single detector since #57 and #71. Never add a second one. MCP, CLI and `eval` call the same function.
- **No false flags.** Count false flags (answerable questions marked `no_strong_match`) next to every negatives-flagged number.

## Phases
- [x] Phase 1: Verify and plan
  - [x] Verify #74 against main @ 0ec988d (notes.md): cause confirmed in code; reproduced on this repo's docs
  - [x] Post the verification comment on #74
  - [x] Cut `feat/abstention-product-names`, commit this plan
- [x] Phase 2: Fresh question sets (before any change)
  - [x] Negative sets: `test/retrieval-eval/absent-terms.jsonl` (train) and `absent-terms-heldout.jsonl`, at least 20 negatives each, written and grep-checked against `.documentation` and the code before measuring.
        - Vendor and tool names absent from the repo, in every shape: one capital, PascalCase, mixed case, digits, hyphenated, lowercase tech words.
        - Some names that appear only in passing: in at most a few docs, and never the subject.
  - [x] Answerable controls in the same files, at least 20 each: questions that name a documented tool, product or term in the same shapes (for example `MiniLM`, `hewtd`, `HNSW`, `Jev`, `vitest`, `npm`), plus questions that begin with a capitalized word. These measure false flags.
  - [x] Baseline in notes.md: negatives flagged and false flags for 1.15.0, the previous release and local, via CLI and `eval --via mcp`, on clones, with and without an export.
- [x] Phase 3: Absent product and tool names
  - [x] Candidates, alongside the existing identifier rules (which stay as they are):
        - a word capitalized and not first in its sentence;
        - mixed case (`pgBackRest`, `imgix`?);
        - containing a digit (`i18next`);
        - or not a common word.
        Any candidate absent from the docs (BM25 df 0 and not in paths) and from the code (`knownToCode`) is missing.
  - [x] "Common word": measure on train and keep one (kept (b); numbers in notes.md "Eval results: Phase 3"; (a) and (c) removed, never committed):
        - (a) the embedder's WordPiece vocabulary, where a word that is one vocabulary piece counts as common (no new data shipped);
        - (b) an embedded list of the most frequent English words (state the size and the source licence);
        - (c) capitalization and shape only, with no dictionary.
  - [x] Rank and filter neutral: only `no_strong_match`/`missing_terms` change; the result order is identical (test/integration/search-parity.test.ts: Hotjar vs HOTJAR, same paths; `missingTerms` runs after ranking in MCP and CLI).
  - [x] Unit tests for each candidate shape. Include sentence-initial words, acronyms and quoted terms.
- [x] Phase 4: Named only in passing
  - [x] Rule 2: a candidate in at most N docs and in none of the top 3 results. Tune N on train. Report it in a separate field or note (for example `passing_terms`), so its false flags are visible, and decide on train whether it also sets `no_strong_match`.
  - [x] Measure its false flags on the answerable controls and on the real-corpus and hub answerable sets.
- [ ] Phase 5: Same answer on every path
  - [ ] MCP `search_hybrid`, `search_semantic`/`search_text` (where they report weak matches), the CLI `search` and `eval` all call the same function. Add a parity test with an absent vendor name over stdio and the CLI.
  - [ ] Federated search: a term absent from the primary but present in a ready source is not missing (check against the merged result).
- [ ] Phase 6: Release gate
  - [ ] Add the absent-terms held-out set to `npm run gate:release`. The gate fails when negatives flagged drops, or false flags rise, by more than 1 against the previous release.
  - [ ] Run it against the previous release and record the result.
- [ ] Phase 7: Release prep
  - [ ] Bump all five version fields to 1.23.0 and update the lockfile
  - [ ] Offline tarball deferred to release (built from the merge commit)
- [ ] Phase 8: Cleanup
  - [ ] Remove what this branch created or made dead: losing variants, trial knobs, scratch scripts
- [ ] Phase 9: Validation (independent review)
  - [ ] Review `git diff main...HEAD` adversarially against this plan, fix real bugs with regression tests, audit every ticked box
  - [ ] Unit: candidate shapes, the dictionary choice, rule 2, absent vs present in docs/code/paths, federation
  - [ ] Integration/e2e: stdio `search_hybrid` and the CLI on an absent vendor name (parity); `eval` reports the same flags
  - [ ] Regression: lint, build, full `npm test` (known load flakes re-run alone), `npm run eval`, every real-corpus/hub answerable set has no new false flags
  - [ ] Every #74 acceptance check against 1.15.0 and the previous release in the same run, answered honestly in notes.md
  - [ ] `npm run gate:release` passes
- [ ] Phase 10: Documentation (full hit-em-with-the-docs pass, no secrets)
  - [ ] `.documentation/changelog/v1-23-0-*.md` and the CHANGELOG.md entry: numbers against 1.15.0 and the previous release in the same run, false flags beside every negatives number, missed targets stated
  - [ ] Docs for `missing_terms`/`no_strong_match` (search reference, retrieval-eval-guide, retrieval-tuning-guide), and help topics in `src/core/help/topics.ts` that describe abstention
  - [ ] README version row; AGENTS.md regenerated
  - [ ] Final `npm run eval`; floors move only with a measured reason

## Key Questions
1. Can a dictionary-free signal (the WordPiece vocabulary) match an English word list? Answered on train in Phase 3.
2. Does rule 2 cost false flags on this repo's answerable sets? Answered in Phase 4.

## Decisions Made
- Phase 3: kept (b), a shipped word list with a suffix strip (src/core/common-words.ts, 31,676 words, ~284 KB, SCOWL/Debian wamerican, MIT-style notice in THIRD_PARTY_NOTICES.md). Not a frequency list: none was available offline. `identifiers(query, known, names)` gets `names` (off by default: query typing, entity cards and `knownToCode` loading read the old shapes); `missingTerms` passes `true`. The CLI loads the code graph also when a name candidate is missing from the docs.
- One plan for #74. It waits for #73, because both extend the eval and the gate.

- Phase 4: rule 2 is `passingTerms` (N = 1, train flat 1 to 30), reported as `passing_terms` and also sets `no_strong_match` (0 false flags on train and held-out answerable sets). Catches 1/3 train passing negatives (Pinecone, Weaviate sit in a top-3 doc by design), 3/3 held-out.

## Errors Encountered
- Phase 4: freshness-scale warm start and hook-failure Jev-hang failed under full-suite load, passed alone (16/16). A first build after wiring the CLI had a missing `weak` (caught by lint, fixed before measuring).
- Phase 3: first full run failed 4 tests. (1) `docs-eval` "fixture train: every negative is flagged" started passing under `it.fails`: now a real gate (`negatives: true` removed). (2) real held-out false-flag gate failed at 4 flagged: two new missing-term false flags (h03 `supposedly`, h12 `dotfiles`). `supposedly` was a bug in my list reduction (dropped `supposed`, but one strip level could not reach `suppose`): `isCommon` now strips two levels, no constant tuned. `dotfiles` stays (compound word), 1 held-out false flag; the gate passes again at its existing slack, no floor changed. (3) freshness-scale warm start and hook-failure Jev-hang failed under load, passed alone (16/16).
- Phase 2: hook-failure Jev-hang and stdin-eof SIGTERM failed under full-suite load, passed alone (16/16).

## Status
**Currently in Phase 5** (Phase 4 done: `passing_terms`, N = 1, sets `no_strong_match`; numbers in notes.md)

---

## Notes
- This file persists across sessions
- Update status after each phase
- Mark completed phases with [x]
- Save research to notes.md instead of stuffing context

## On Completion
This plan is complete when every checkbox above is checked. That IS the
completion signal -- there is no separate status to remember to flip.

When complete, archive it instead of deleting it:

    /plan-status                  # confirm this plan reads COMPLETE
    /archive-plan abstention-product-names    # -> .planning/.archive/abstention-product-names/

Archiving moves this directory to the gitignored .planning/.archive/ and stamps
it archived. Nothing is destroyed.
