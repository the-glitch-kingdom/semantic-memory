# Notes: gaps facets (#101)

## On 1.31.x (2026-11-15)
- `--gaps-out` (`src/cli/retrieval-eval.ts:48`) writes `toGapsV1(gaps, version)` (`src/core/usage-log.ts:195`): `{version: 1, source, gaps: [{query, used_doc, suggested, count, last_seen}]}`. The comment there says "no extra fields".
- `diagnose` (`src/core/retrieval-eval/report.ts`): a coverage case comes from `facetIssue(c, docs)` with `unmatched`, `why`. Cases carry `{id, q, label, why, grepAt8?}`. The hybrid top 3 per question comes from `runSuite`'s probes (`top3`).
- 1.31.0's diagnosis labels a case coverage when any one facet matches no doc. Blind only; non-blind cases with an unmatched facet are `stale` and skipped.

## hit-em-with-the-docs side (read-only, `main` 4a49bc9 "feat(coverage): locate facets in tracked code …" #113)
- `src/core/reconcile/gaps.ts` `Gap` and `parse_gaps`:
  - `id` and `tier`: strings;
  - `blind`: boolean, else the error `"blind" must be a boolean`;
  - `facets`, `missing_facets` and `expected`: arrays of strings;
  - `nearest_doc`: `{path, facet_coverage, rank: number | null}`;
  - an entry with facets is planned by the coverage engine, not phrase-classified.
- `src/core/coverage/facets.ts`:
  - `compile_facet` guards (max 300 chars, no nested quantifiers);
  - `is_code_line_facet = /\s=\s|(?:^|\s)(?:def|class|function|const|let|var|interface)\s|=>|:\s*(?:str|string|int|number|bool|boolean|float)\b|[;{]\s*$/`.
- The released 3.4.1 predates this. Phase 2 checks that it accepts the richer file.

## #101 numbers (reporter, real tree, numbers only)
- 8 of 16 blind coverage misses had one doc holding 2–3 of 3–4 facets; 2 had none anywhere.
- A second blind set with code-line facets: 25/25 coverage, grep oracle 0/25. The same questions with prose facets: 11 coverage, 6 ranking, 3 grounding, 5 answered @1, grep 1/25 @3.

## Eval results: Phase 2
- Tests only, no src change: `test/retrieval-eval/gaps-facets.test.ts`, 15 cases: 10 `it.fails`, 5 plain guards (usage-log `gaps --json` byte-pinned, `toGapsV1` five fields, ranking/grounding cases carry no new fields, code-miss stays coverage, hewtd 3.4.1 accepts a hand-written richer file).
- Each `it.fails` was run as plain `it` and fails for the stated reason: entries lack `id`/`facets`/`missing_facets`/`nearest_doc`; coverage lines lack `nearest:`; no stderr warning; BLIND-SETS.md and measure-and-tune.md lack the "code-line facet" rule.
- hit-em-with-the-docs checkout is on feat/gaps-coverage-misses-113 (c9c43ad, descendant of 4a49bc9); its built dist `parse_gaps` is used read-only. Installed 3.4.1 (`node_modules/@theglitchking/hit-em-with-the-docs`) accepts the richer file.
- Fixture: docs-vault copy plus one doc (`reference/ttl-cache.md`) holding a code line, made in the test; `operational/log-rotation.md` holds 2 of the 3 near-miss facets.
- Full validation: lint, build, `npm test` (164 files, 1353 passed) green; `npm run eval` 28/29 files green, real-corpus-eval.test.ts hit a 600s beforeAll timeout under load (a stray index-build ENOENT in a /tmp/lt-* dir at the same time) and passed alone (16 passed, 1 expected fail). Not a Phase 2 regression: no src change.

## Eval results: Phase 3
- No ranking change (diagnosis and export only). Phase 2 export/diagnosis/parse_gaps/3.4.1 tests now pass as plain `it`; new unit tests in test/unit/eval-report.test.ts (tie, archive, rank null, bad regex, none).

## Eval results: Phase 4
No ranking change (warning on stderr only; labels untouched). All 15 gaps-facets tests plain `it` now; the pin test in test/unit/eval-report.test.ts uses hewtd's own examples. Guide text carries #101's numbers.
- Phase 4 validation: stdin-eof (load flake) and real-corpus-eval beforeAll 600s timeout under full eval both passed alone.
