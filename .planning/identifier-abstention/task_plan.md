# Task Plan: identifier-abstention

## Goal
Ship semantic-memory#57 as v1.14.0. When a query names an identifier (snake_case, ALL_CAPS, lower camelCase, a path,
a dotted name, a backticked span) that no indexed doc contains, every result gets `no_strong_match: true` and
`missing_terms: [...]`, in MCP search and the CLI/hook path alike. This is an OR with the existing score rule, never a
replacement; plain-English queries behave exactly as before. One PR from `feat/identifier-abstention`. Series step 1,
measured with #56's `eval`. Every missed target is stated in the PR.

## Prerequisites
- #56 (`builtin-eval`) merged: identifier negatives are reported with `negative_kind: identifier`.

## Rules for every phase
- **Verify before ticking.** Confirm in code, or with a test, that a box is actually done before ticking it.
- **No false flags.** For every answerable question in every golden set, `missingTerms` against its corpus is empty.
- **One identifier detector.** `src/core/identifiers.ts` is the only one; #58 and #61 reuse it.
- **Wording.** "not in the docs", never "does not exist": many such names exist in code.
- **Response shape.** Flags ride on the result items like `no_strong_match`; `content[0]` stays a bare JSON array.
- **Works without hit-em-with-the-docs.** No export or gaps file is read.

## Phases
- [x] Phase 1: Verify and plan
  - [x] Verify #57 against main @ 29e74db (notes.md)
  - [x] Re-verify against main after #56 merges (13ab4c0: isWeak, bm25 df, shape(), openSearch unchanged; eval has `negative_kind`)
  - [x] Post the verification comment on #57
  - [x] Sync main, cut `feat/identifier-abstention`, commit this plan (with the archive move of `builtin-eval`)
- [x] Phase 2: Identifier negatives first
  - [x] Identifier negatives (7+ train and 7+ held-out) for the docs-vault fixture and `.documentation`, each term
        grep-verified absent, tagged `negative_kind: identifier`. Keep the planted terms out of this plan's own docs
        (`.documentation` is a corpus). Record the shipped baseline (expected: mostly not flagged). Done: 8 per split, baseline 3/8, 3/8, 2/8, 1/8 flagged (notes.md).
- [x] Phase 3: `missingTerms` and `Bm25Index.has`
  - [x] `src/core/identifiers.ts`: detection (tokens with `_`, lower camelCase `[a-z]+[A-Z]\w*`, paths with `/`,
        dotted names whose every part starts with a letter so `v1.12.0` is excluded, backticked spans without
        whitespace). Not in v1: bare acronyms (SLA, TLS), PascalCase, kebab-case.
  - [x] Presence: strip edge `_` and `*`, tokenize as BM25 does; a path checks only its last segment. A term is
        missing when some token has df 0 AND it does not appear in the lowercased joined doc paths (BM25 path words
        replace `_` with spaces, so a file named after the identifier counts as present). Return the original spelling.
        Shortcut comment: parts are checked, not adjacency; upgrade to a literal check over `doc.content` if the eval
        shows misses.
  - [x] `Bm25Index.has(term)` (the df map is private today).
- [x] Phase 4: Wire it up
  - [x] `shape()` in `src/mcp/tools/search.ts`: `weak = isWeak(...) || missing.length > 0`; `missing_terms` on every
        item (covers `search_hybrid` and `search_semantic`).
  - [x] CLI `openSearch` (`src/cli/search.ts`): the same, `missing_terms?: string[]` on `SearchHit`; parity test.
  - [x] `hooks/vault-context.js`: say "not in the docs: X" instead of a bare weak-match line.
  - [x] Tool description and server instructions; update the tool-surface snapshot.
- [x] Phase 5: Measure
  - [x] All splits with `eval`: identifier negatives flagged (target: at least 4 of 7 per split), answerable false
        flags unchanged, plain-English questions unchanged. Gates for the new negatives; raise the negatives floors.
- [ ] Phase 6: Release prep v1.14.0
  - [ ] Bump all five version fields, lockfile; offline tarball builds
- [ ] Phase 7: Cleanup -- remove junk and unused code this work created: scratch/test scripts, debug files, probe logging, one-off test functions, commented-out code, dead code from abandoned approaches (MANDATORY)
  - [ ] Dead-code check over the branch diff.
- [ ] Phase 8: Validate success through comprehensive testing -- we need to validate success thoroughly through comprehensive testing of our changes (MANDATORY)
  - [ ] Independent review: false-flag paths (path words, code spans, table cells, `__init__`), a second detector,
        wording that claims non-existence, CLI/MCP drift.
  - [ ] Unit `missingTerms`: flags `FOO_BAR`, `fooBar`, `x/y/zz_missing.py`; does not flag present terms, a term only
        in a code span or table cell, a term only in a file name, `__init__`, `v1.12.0`, `e.g.`, `SLA`; returns the
        original spelling.
  - [ ] #57 check 1: a query naming an absent identifier returns `no_strong_match: true` and lists it.
  - [ ] #57 check 2: no answerable question in any golden set gains a flag (deterministic, no embedder).
  - [ ] #57 check 3: identifier negatives flagged rise (≥ 4 of 7 per split), false flags ≤ the existing ceiling. The
        external "4 of 7 / ≤ 2 of 34" target is run with `eval` on the external set as a release step, if available.
  - [ ] #57 check 4: every plain-English golden question gets `missingTerms = []` and its flag equals `isWeak` alone.
  - [ ] #57 check 5: CI has no export or gaps file; one assertion that #57 reads neither.
  - [ ] CLI/MCP parity case with a missing identifier. Full suite; known flakes re-run alone. Answer each #57 item in notes.md.
- [ ] Phase 9: Documentation pass -- a full hit-em-with-the-docs pass to create/update/deprecate as many docs as needed to capture all our changes: new procedures, tools, troubleshooting steps, gotchas, KB articles, etc. Never include secrets or passwords (MANDATORY)
  - [ ] New `.documentation/changelog/v1-14-0-identifier-abstention.md` (`npx hewtd integrate -a`); `CHANGELOG.md`
  - [ ] `.documentation/reference/mcp-tools-reference.md` (`missing_terms`), `.documentation/reference/cli-reference.md`
        (search output), `.documentation/operational/retrieval-tuning-guide.md`, `.documentation/troubleshooting/troubleshooting.md`
  - [ ] KB fact (gotcha): BM25 path words replace `_` with spaces, so a file named after an identifier is not a body match
  - [ ] `README.md`, `npx hewtd maintain --quick`, regenerate AGENTS.md; tick the last boxes so `/plan-status` reads COMPLETE

## Decisions Made
- `undocumented: [...]` (a name in code but in no doc) is left to #58, which builds the symbol table; #58's plan adds it.
- `missing_terms` is on `search_semantic` too: it comes free through `shape()`.
- v1 detection leaves out bare acronyms, PascalCase and kebab-case to avoid false flags on product names and prose.
- A weak flag also suppresses `related` on that result (existing behaviour); recorded, not changed.

- Phase 2: 8 identifier negatives per split (not 7); the identifier gate scales to ceil(n*4/7) = 5 of 8, so Phase 5 must reach 5/8 or restate the target.
- Phase 2: identifier negatives run as a separate `search_hybrid` pass (`idArms`) so the old negatives gate, `meanBytes` ceiling and tier counts are unchanged; the new gate is an `it.fails` until Phase 4/5.

- Phase 3: `missingTerms(query, index, paths)` takes the lowercased joined doc paths as a string (the caller already holds the docs); `identifiers(query)` is exported separately for #58/#61. Presence is checked per token (a term with several tokens is missing if any is). DOTTED parts need 2+ chars so `e.g.` is excluded. A `://` word is skipped (URLs).

- Phase 5: identifier gate floor raised from ceil(n*4/7)=5 of 8 to every case (8/8), no slack: deterministic detector; `known` param removed as dead.
- Phase 4: the 4 identifier gates became real gates here (not Phase 5): once wired they pass 8/8, and `npm test` fails on an `it.fails` that passes. The detector is deterministic (no HNSW), so no slack is needed. The hook says "Not in the docs: `X`" in place of the weak-match line when `missing_terms` is present; its existing score gate (top score < 0.35 injects nothing) is unchanged.

## Errors Encountered
- Phase 5 full run: freshness-scale and skill-eval concurrency failed under load, both pass alone; lint, build, eval clean.
- Phase 3 full run: freshness-scale and hook-failure (Jev-hang) failed under load, both pass alone; lint, build, eval (72 passed, 9 expected fail) clean.

## Status
**Currently in Phase 6** - Release prep v1.14.0

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
    /archive-plan identifier-abstention    # -> .planning/.archive/identifier-abstention/

Archiving moves this directory to the gitignored .planning/.archive/ and stamps
it archived. Nothing is destroyed.
