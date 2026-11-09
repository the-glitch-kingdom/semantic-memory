# Notes: abstention-variants (#78)

## Phase 1: verification (main @ 2ab171c, v1.23.0)

Fixtures are in the scratchpad only (`r78/t`, `r78/t2`): a git repo holding `.documentation/api/{INDEX,REGISTRY,rest-endpoints}.md`, a `package-lock.json` naming `graphql`, and `scripts/autofill.js` (`autoFill`). The CLI `search` from the v1.23.0 build was run on it.

### 1. GraphQL flagged with the export, not without it: reproduced. The export is not the cause.
- INDEX.md and REGISTRY.md **without** `generated: true` mention GraphQL. Result: `missing_terms` is empty; `no_strong_match` comes only from low confidence. This matches the reporter's d0.
- After running `hewtd index` (the step that writes `.hewtd/graph.json`), both files are rewritten **with** `generated: true`. After a re-index: `missing_terms: ["GraphQL"]`. This matches d1b.
- Cause:
  - A doc with `generated: true` is `hidden` (`src/core/indexer.ts:140`), so it has no chunks and no field text, and BM25 never sees its body.
  - Without the flag, the hub is a normal doc, so `index.has("graphql")` is true.
  - Yet INDEX.md and REGISTRY.md are never returned by a search either way (`DEFAULT_EXCLUDE_HUBS` in `resultsExclude`, `src/core/path-class.ts:39`). Presence and results disagree.
- With `generated: true` already present, GraphQL was flagged both with and without the export (fixture `r78/t`).
- Lock files and config: the code-graph fallback (`fallbackCode`, `gitFiles`) reads only file names and doc-cited symbols, never file contents. A name in `package-lock.json` or a TOML is not presence, and `knownToCode` only affects the `missing` / `undocumented` split.

### 2. `autofill` false flag: cause confirmed
- `identifiers(q, known, true)` returns `["autofill"]`: lowercase and not in the word list.
- The docs write `auto-fill`, and `tokenize` splits it into `auto` and `fill`, so `index.has("autofill")` is false and the name is missing.
- Code: `knownToCode` matches symbols exactly and file basenames. `autoFill` does not equal `autofill`, so it only rescues the name when a file is named `autofill.*`. In our fixture the file `scripts/autofill.js` moved it to `undocumented`, but `no_strong_match` stayed true.

### Not asked (APNs)
`APNs` collides with an in-tree plural. Leaving it unflagged is correct; no change.

## Eval results: Phase 2 (reproduce on main + 1.24.0, nothing changed in src/)
Same run (`scripts/eval-against-release.sh`, one `git clone --local` tree per version, no export and `--export`), then every question of both sets asked through one stdio server per tree (`search_hybrid`, limit 5) and `missing_terms` read from result #1. Sets: `absent-terms.jsonl` (32 negatives n01-n32, 28 controls c01-c28) and `absent-terms-heldout.jsonl` (30 negatives hn01-hn30, 27 controls hc01-hc27). Phase 2 added n30-n32, c24-c28, hn28-hn30, hc23-hc27 before any measuring; held-out was not used to choose anything. Negative terms are not named here (this file would be a doc in a clone); ids only.

"neg" = negatives with a non-empty `missing_terms`; "false" = controls with a non-empty `missing_terms`. Identical with and without the export, and identical for 1.23.0, 1.24.0 and local.
| set | 1.22.0 neg / false | 1.23.0 = 1.24.0 = local neg / false |
|---|---|---|
| train (32 neg, 28 controls) | 2 / 1 | 23 / 5 |
| held-out (30 neg, 27 controls) | 2 / 1 | 27 / 4 |
| Phase 2 additions only: variant negatives (6) | 4 / - | 6 / - |
| Phase 2 additions only: variant controls (10) | - / 2 | - / 9 |
The 9 false flags on the new controls are the spelling problem: c24 c25 c26 c27 (joined forms of text-only, append-only, smoke-test, no-watch), c28 and hc27 (camelCase of missing_terms / passingTerms), hc23 hc25 hc26 (rank-only, claude-run, re-embed). hc24 (wait-for-ready) is not flagged (not a candidate, a plain word). The 1.22.0 false flags (c28, hc27) are camelCase identifiers it detected. Aggregates from the harness (cli = mcp, `neg flagged` also counts low-confidence flags): 57/62 for 1.23.0, 1.24.0 and local, 18/62 for 1.22.0; hybrid @1 38/55 (no export), 41/55 (export), the same for every version. The 6 new variant negatives are all still flagged, so a variant rule has to keep them.
CLI vs MCP: `search` over the CLI gives the same `missing_terms` as stdio for the 8 train additions on local (n30-n32, c24-c28). The harness's `cli` and `mcp` arms agree on every aggregate.

### The fixture, over stdio and the CLI (`test/e2e/abstention-variants.test.ts`, 4 arms: hubs with and without `generated: true`, with and without the export)
- Hubs without the flag: the product named only in `INDEX.md`/`REGISTRY.md` is not flagged (reproduced, both transports, with and without the export). With the flag it is flagged.
- `autofill`, `auto_fill`, `AutoFill`, `retrybudget` and `SmartRetry` against docs writing `auto-fill`, `retry_budget`, `Smart Retry` are all flagged as missing (reproduced; the code has `autoFill` in `src/form-helpers.ts` and it does not rescue them).
- A product named only in `package-lock.json` or `service.toml` is flagged (pinned, passes today).
- Stdio and CLI agree on every query (passes today).
- 44 of 68 cases are `it.fails` (they fail on main by design); 24 pass. When Phase 3/4 fix the causes, each `it.fails` that starts passing must become a plain `it`.

Checks for Phase 2: lint, build, `npm test` (the Jev-hang case of hook-failure and the skill-queue SessionEnd timing case failed under load, both pass alone), `npm run eval` 148 passed, 4 expected fail (unchanged; the new sets move no floor).

## Eval results: Phase 3 (presence counts only searchable docs)
Change: `Bm25Index.addDoc(..., searchable)` keeps a second df (`presenceDf`) over searchable docs; `has` and `docFreq` read it, scoring still reads `df`. Searchable = not `generated`, not `path_class.exclude`, not `results.exclude` (`isSearchableDoc`, path-class.ts). The path half of the test (`searchablePaths` in the MCP context, filtered `paths` in the CLI) drops the same docs. Federation goes through the same `shape()` per source, so it follows.
- Rank parity (same run, default sets, `scripts/eval-against-release.sh 1.24.0 local`, cli and mcp): hyb@1 77/105, hyb@3 98, multi@1/3/8 16/21/22 of 23, cov 0.80/0.96/0.98, dom 35, neg flagged 36/39: identical for 1.24.0 and local.
- Train absent-terms, repo corpus (hubs there already carry `generated: true`), same run, with and without `--export`: neg flagged 27/32 (harness count, includes low-confidence flags) for both. Stdio `missing_terms` probe on local: 23/32 negatives flagged, 5/28 false flags (c24-c28, the Phase 4 spelling targets): equal to the 1.24.0 baseline, as expected; this change only moves trees whose hubs lack the flag.
- Fixture (`test/e2e/abstention-variants.test.ts`): the hub-only product is now flagged on all 4 arms over stdio and CLI; 4 `it.fails` became plain `it`: 40 expected fails remain (the Phase 4 variant names). Unit test added in test/unit/bm25.test.ts.
- Checks: lint, build, `npm run eval` (148 passed, 4 expected fail), `npm test` (1227 passed; hook-failure Jev-hang failed under load, passes alone).

## Eval results: Phase 4 (spelling variants count as present)
Change: `joinedForms` (bm25.ts) joins each adjacent pair, and the whole run, of words split by `-`, `_` or a space in a searchable doc's chunk text; `Bm25Index.hasJoined` reads them; `missingTerms` accepts a token whose `_`-less form is joined. Case needs nothing (tokens are lowercase). `splitUndocumented` matches a file name ignoring case, `-` and `_`. Never scored, never in `passing_terms`.
Stdio `missing_terms` probe on the repo corpus (local, search_hybrid limit 5), before to after. Train was used to design; held-out only measured:
| set | negatives flagged | false flags on controls |
|---|---|---|
| train (32 neg, 28 controls) | 23 to 23 | 5 to 0 (c24-c28 fixed) |
| held-out (30 neg, 27 controls) | 27 to 27 | 4 to 0 (hc23, hc25, hc26, hc27 fixed) |
- Key question 2 (real absent names that join two doc words): none on train or held-out. The same 9 train and 3 held-out negatives stay unflagged as before; all 6 variant negatives (n30-n32, hn28-hn30) stay flagged. The `shortcut` (joins cross a sentence break) is untested beyond these sets.
- `wildcard`, `refetching`, `dotfiles`: not terms of the absent-terms sets, so not measured by the probe; real-corpus/hub identifier negatives in `npm run eval` are flagged 8/8 and 8/8 (unchanged).
- Rank parity: top-5 paths of every train and held-out question identical before and after (cmp). Same-run `scripts/eval-against-release.sh 1.24.0 local`, default sets: hyb@1 77/105, hyb@3 98, multi 16/21/22, cov 0.80/0.96/0.98, dom 35, neg flagged 36/39, identical. On the absent-terms sets: hyb@1 38/55, @3 48, neg flagged 57/62 identical; `#1+rel` is 43 for 1.24.0 and 44 for local (rel/#1 1.11 vs 1.29), stable over two runs. Not touched by this change (related edges do not read presence); not investigated further, a check for Phase 9.
- Fixture (`test/e2e/abstention-variants.test.ts`): the 40 remaining `it.fails` are plain `it` now; 68 pass on 4 arms over stdio and the CLI. Units: bm25 (joins, hub exclusion, removal), code-graph (`splitUndocumented` variants).
- Checks: lint, build, `npm run eval` (148 passed, 4 expected fail). `npm test`: 1266 passed; load flakes this run (links-exclude, freshness-scale warm start, hook-failure Jev-hang) pass alone.

## Eval results: Phase 5
Parity test `test/e2e/abstention-parity.test.ts`, repo corpus clone, all 125 questions of the train and held-out absent-terms sets (result #1 flags: `no_strong_match`, `missing_terms`, `passing_terms`, `undocumented`):
- stdio vs CLI searcher, plain and with `hewtd index` export: `missing_terms`, `passing_terms`, `undocumented` identical on every question; `no_strong_match` allowed to differ on at most 1 question (HNSW is random per build; two builds are compared). Observed: within that slack.
- The export does not change `missing_terms` on any question.
- Federated server (this tree plus an identical source "twin"): `missing_terms` and `passing_terms` equal the single-tree answer on every question. A first run caught that the federation was not active (schema file in the wrong dir), so the test asserts the source answered.
- No divergence, no src change. The wait for the source's background build is load-sensitive (failed once at 120 s under full-suite load; now 300 s).

## Eval results: Phase 6 (gate:release vs 1.24.0)
`npm run gate:release -- 1.24.0`: PASS, 3m24s wall (22m CPU). Held-out sets incl. absent-terms-heldout with the Phase 2 variant negatives (hn28-hn30) and controls (hc23-hc27); no new gate code, comment only. Hub-only presence is not a real-corpus case (its hubs carry `generated: true`), so it is covered by test/e2e/abstention-variants.test.ts.
Plain and export, cli = mcp: hybrid @1 73 vs 73 (export 78 vs 78), multi @1/3/8 10/17/21 equal, cov@3 0.776 equal, dominance 35 vs 35 (export 26 vs 26). Negatives flagged 42 vs 43 (one fewer than 1.24.0, within the band of 1), false flags 7 vs 10 (three fewer). mcp vs cli: 0 of 166 differ. Titled #1 119/119, first answer 1186 ms (slow git 916 ms).
Open: which negative stopped being flagged was not identified; likely a joined form (Phase 9 to check, with the sentence-break join).
