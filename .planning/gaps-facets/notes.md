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

## Eval results: Phase 5
Fresh `BAND=1 bash scripts/gate-release.sh 1.31.1` (no --cache): PASS, every count identical local vs 1.31.1, cli and mcp, plain and export.
- plain: hybrid @1 91/139 (@3 115), sem@1 77, multi @1/3/8 20/28/31 of 41, cov@1/3/8 0.62/0.82/0.87, dominance 34, negatives flagged 43/47, false flags 7. export: hybrid @1 94, multi @8 32, dominance 26, same otherwise. 0 of 186 mcp-vs-cli differences. First local mcp answer 1249 ms, titled #1 139/139 (slow-git 988 ms).
- p95 local 17/15/12 ms (cli/mcp/mcp-slow) vs 1.31.1 19/14/15 ms.

By hand on `.documentation` with a scratch blind set (/tmp/claude-1000/p5/set.jsonl: near-miss s-near, absent topic s-absent, code-line s-code):
- Diagnosis: `s-near: coverage, no doc matches facet: zebra quokka protocol, nearest: changelog/v1-31-0-operating-targets.md 2/3`; `s-absent: ... nearest: none`; `s-code: ... nearest: none`.
- `--gaps-out`: 3 entries; s-near has id, tier, blind, facets, missing_facets, nearest_doc {path, facet_coverage "2/3", rank 1}; s-absent and s-code omit nearest_doc; the five classic fields unchanged.
- Warning (stderr): `warning: s-code: facet looks copied from a code line and matches no doc (write the facet from the answer in prose): const gaps = diag.map(d => d.id);`. A first draft facet `writeFileSync(opts.gapsOut, ...)` did NOT warn: it matches none of hewtd's code-line shapes (no assignment, keyword, arrow, type or trailing ;/{). Correct per the copied rule.
- `npx @theglitchking/hit-em-with-the-docs@3.4.1 reconcile --gaps <file> --json`: exit 0, 3 questions read, no errors, no dropped. (The repo's installed hewtd is 2.21.0, so npx 3.4.1 was used; it wrote only to the ignored .hewtd/; .claude/skills not relinked.)

## Eval results: Phase 8
- Full validation, one clean chain: lint, build, `npm test` (164 files, 1356 passed, 1 skipped), `npm run eval` (29 files, 283 passed, 6 expected fail; real-corpus beforeAll did not time out this run).
- `BAND=1 npm run gate:release` fresh vs 1.31.1 (no --cache): PASS, every count identical on cli and mcp, plain and export (hybrid @1 91/139, export 94; multi 20/28/31, export @8 32; cov@3 0.817; dominance 34, export 26; negatives 43/47; false flags 7; 0 of 186 mcp-vs-cli diffs).
- Edge cases: new tests in test/retrieval-eval/gaps-facets.test.ts (0-coverage run writes empty gaps, non-blind is stale and never exported, bad-regex and expected-without-facets never throw or export, `--no-oracle` still writes the same gaps file (diagnosis is computed, only the report section is dropped), CRLF set). Tie, archive, rank null, invalid-regex-as-missing are unit-tested in test/unit/eval-report.test.ts.
- Independent review (`claude -p --setting-sources "" --tools ""`, given the src/test/docs diff). Rejected after checking code: (1) toGapsV1 index join: toGapsV1 is a plain map, order and count preserved; (2) duplicate case ids: pre-existing (outcomes are keyed by id), not new; (3) nearest vs facetIssue matcher: both use /i; archive differs on purpose (facetRank ignores archive, so an archive-only facet really is missing), unit-tested; (5) top8 first-call-wins: the only caller passes maxK (8) per case; section duplicates in top 8 keep rank as result position, as documented. Accepted as a known limit: (4) a mixed [unmatched, invalid-regex] facet list lists the bad regex under missing_facets and counts it in the denominator (label is order-dependent, as facetIssue already is); rare, not changed. Test-gap suggestions about CRLF strength noted; no change.

## Eval results: Phase 9
Docs only. Full chain: lint, build, npm test (164 files, 1356 passed) clean; npm run eval 28/29 files, the one failure was real-corpus-eval (beforeAll 600s timeout under load, as in Phases 2 to 4; the full eval took 748s); alone it passes (16 passed, 1 expected fail, 85s). No ranking numbers changed. AGENTS.md regenerated from branch code: only last_generated changed, reverted. hewtd maintain --quick ran; the new docs were not in its error list.
