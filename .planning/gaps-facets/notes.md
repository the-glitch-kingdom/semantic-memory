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
