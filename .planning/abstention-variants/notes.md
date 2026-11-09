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

## Eval results: Phase 9 (independent review)
Method: one stdio `search_hybrid` (limit 5) probe per question, same run, on a fresh `git clone --local` per build and arm (plain, and with `hewtd index`): 1.23.0 (npm pack), 1.24.0 (main built in a worktree) and this branch. Sets: both absent-terms sets and real-corpus, real-hub (train and held-out), 232 questions. "neg" = negatives with non-empty `missing_terms` or `passing_terms`; "false" = controls with either.

| set | 1.23.0 = 1.24.0 neg / false | branch neg / false |
|---|---|---|
| absent-terms (32 neg, 28 ctl) | 25 / 5 | 25 / **0** |
| absent-terms-heldout (30 neg, 27 ctl) | 30 / 4 | 30 / **0** |
| real-corpus (20 / 27) | 15 / 1 | 15 / 1 |
| real-corpus-heldout (16 / 27) | 11 / 1 | 11 / 1 |
| real-hub (2 / 12), real-hub-heldout (1 / 10) | 1 / 0, 1 / 0 | 1 / 0, 1 / 0 |
Identical with and without the export. Per question, the flags differ from 1.24.0 only on the 9 variant controls (c24-c28, hc23, hc25-hc27) that stopped being false flags; no negative changed. Ranking: top-5 paths identical to 1.24.0 on all 232 questions, plain (0 differ) and export (0 differ, one probe showed 3-4 tail differences that a rebuilt 1.24.0 also shows: HNSW noise). 1.23.0 vs 1.24.0 differ on 4 export questions, the same noise.
p50/p95, 1.23.0 / 1.24.0 / branch, quiet machine: 6/14, 6/14, 6/13 ms plain; 6/14, 6/13, 6/16 ms export. No change beyond noise.

### Review findings
- Fixed: `joinedForms` joined every adjacent pair of words in plain prose (`mongo db server` gave `mongodb`, `dbserver`, `serverand`) and the whole run of a line. On this corpus that is 44.7k joined forms against 5.8k tokens (94% from prose spaces; 2.8k from hyphens and underscores). It also let any absent name that happens to be two adjacent words count as present. Now only `-`/`_` runs and Title Case runs (`Smart Retry`) are joined. Measured after: the same 9 controls fixed, no negative moved, the same 232 top-5 lists. Unit test added. The note "joins across sentence breaks" was wrong: `.` is not a separator, `end. Start` never joined (asserted).
- Fixed: the parity test timed out under full-suite load (MCP request timeout 60 s); requests now allow 300 s. It passes alone.
- Resolved open items from earlier phases: the held-out "42 vs 43 negatives flagged" of the Phase 6 gate was not a lost negative. Per question, no negative differs between 1.24.0 and the branch in the probe (flags or `no_strong_match`), and the second gate run reads 43 vs 43. The `#1+rel` 43 vs 44 difference does not reproduce either (83 vs 83 in both gate runs); related edges do not read presence.
- No other bug found in the diff: `removeDoc` keeps both dfs and the joined map consistent, `searchablePaths` is rebuilt whenever `docByPath` is reassigned (the only writer), the CLI and MCP use the same `isSearchableDoc`, federation goes through `shape()` per source.
- gate:release: first run FAILED on `export: mcp differs from cli on 1 of 166 questions` ("How does the circuitbreaker trip when the embedder fails?", top 3); the second run PASSED (0 of 166, negatives 43 vs 43, false flags 7 vs 10, hybrid @1 73 vs 73, export 78 vs 78). A top-3 difference between two builds of one tree is HNSW noise; the gate has no slack for it. Not caused by this plan (ranking is untouched), but the gate can fail at random at about this rate.
- Full `npm test`: 1267 passed; 3 failures, all pass alone: parity (timeout, fixed), freshness-scale warm start, hook-failure Jev-hang. `npm run eval`: 148 passed, 4 expected fail.

### #78 acceptance checks, answered honestly
The reporter's trees and question sets (A+B, set C, `all.json`, `set-c-validation.json`) are not in this repo; they could not be run. The numbers below are our own proxies, and the reporter's tree decides after publish.
1. A+B negatives >= 6/7 with and without the export, false flags <= 1/34: not measurable here. Proxy: negatives flagged are exactly 1.24.0's on all our sets, with and without the export (no negative lost), and false flags on controls fall 5 to 0 (train) and 4 to 0 (held-out). Cause 1 (the GraphQL hub-only case, d0) is fixed in the fixture on all four arms (hubs with and without `generated: true`, with and without the export), over stdio and the CLI. Whether d0's hubs lack `generated: true` was never answered on #78.
2. C09 (`autofill` against `auto-fill` / `autoFill`): fixed in the fixture (`autofill`, `auto_fill`, `AutoFill`, `retrybudget`, `SmartRetry` are not missing) and on 9 camelCase, hyphen and underscore controls of the sets. The reporter's C09 text was not run. Not fixed: a lowercase prose pair (`auto fill` in the docs) no longer counts as a variant of `autofill`; the first Phase 4 draft covered that, and it was withdrawn because it multiplied the presence vocabulary by eight. If the reporter's docs write `auto fill` with a space and no capitals, C09 would still be flagged; unknown.
3. Set C stays >= 9/10 with 0/25 false flags: not measurable here. Proxy: negatives are unchanged from 1.24.0 on every set; false flags can only fall.
4. The held-out absent-terms set of #74 does not drop: 30/30 and 0/27 against 30/30 and 4/27 for 1.24.0, and gate:release passes against 1.24.0 (second run).
Does not meet the target: none measured. Not verified: all four items on the reporter's own data.
