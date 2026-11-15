# Notes: two-part ranking (#91 part 2) and bare-filename refs (#98)

## #91 part 2: reproduced on 1.31.0 (2026-11-15)

The reporter's repro is in the 2026-11-15 #91 comment: `~/workspace/the-glitch-kingdom/plugin-benchmarks/semantic-retrieval/repros/sm-91-two-part/` (18 docs, 2 blind questions, README). To reproduce: copy it to scratch, run `semantic-memory --notes .documentation --reindex` (272 chunks), then `eval --notes .documentation --set questions.jsonl`.

| arm | @1 | @3 | @8 |
|---|---|---|---|
| hybrid | 0/2 | 1/2 | 1/2 |
| semantic | 1/2 | 1/2 | 2/2 |
| grep | 0/2 | 1/2 | 1/2 |

Diagnosis: R91-A is `ranking, answered at 3, not at 1 (grep finds it at 8)`; R91-B is `ranking, not in the top 8 (grep misses it too)`.

Hybrid top 3 for R91-A (CLI `search --json`):
1. `knowledge-base/facts/cookie-custody-e2e-gate-self-skipped-on-wrong-probe-path.md` 0.5074, section "… > Lesson" (0/3 facets; semantic #6)
2. `marketing/seo-surface-implementation.md` 0.4791, section "The CI allowlist guard" (3/3 facets; semantic #1)
3. `marketing/marketing-block-library.md` 0.4791, section "How to add a new block"

Mechanism: `fuseScores` (`src/core/bm25.ts:221`) is `COSINE_WEIGHT (0.7) · cosine + 0.3 · bm25 / max(bm25 in this query's pool)`. The pipeline (`src/mcp/tools/search.ts:183`): fuse → `applyCoverage` (`coverage_weight` 0, `link_prior` 1) → `applyClauses` (`clause_weight` 0) → `identifierTier`. No identifier is in these questions, so the tier doesn't apply.

History: 1.28.0's `clause_weight: 1` (vector per-clause chunk cover) fixed our multi-clause fixture but failed the held-out gate (no-export hybrid @1 72 vs 73). The reporter's older set traded multi @1 0.62 → 0.52 for @3 0.77 → 0.85 with it.

## #98: confirmed by reading (1.31.0)

`src/core/code-graph.ts`, `patchStale`:
- `fileOf = (r) => r.kind === "file" ? clean(r.file ?? r.target) : undefined`;
- `dirty = (r) => !!f && (!changed || changed.has(f) || r.resolved === false)`.

`changed` is the set of repo paths from `git diff --name-only <source_commit>`. A bare-filename ref (`target: "test_x.py"`, `resolved: true`, no `file`) never matches. hewtd resolves bare names by basename (#98 body), so the right check is basename semantics. `exp.files` (tracked files, `gitFiles(root)`) is already loaded before `patchStale`.

## Eval results: Phase 2 (acceptance tests, 1.31.0 code, no src change)

Fixture `test/fixtures/two-part` (18 docs, cold build, `startEval` with vault `docs`):
- R91-A hybrid (search_hybrid and CLI): whole-answer doc `marketing/seo-surface-implementation.md` is #2 (it.fails, fails with `expected 2 to be 1`); semantic #1 (guard).
- R91-B hybrid: `troubleshooting/email-deliverability.md` #7, `devops/droplet-deployment.md` #12 (asserted not worse).
- #98: 4 it.fails (bare dead after delete; bare drift after edit; unknown/null source_commit: bare name existing elsewhere falsely dead), each confirmed failing as plain `it` for the stated reason; 6 plain guards pass.

## Eval results: Phase 3 (#98 fix, src/core/code-graph.ts patchStale)

No ranking change. One basename map over `exp.files` + the changed set; a bare ref's candidates are its name plus every file with that basename; `resolved` = any candidate exists, `changed` = newest date among existing candidates. Path refs behave as before (candidates = [path]); the `..`/absolute guard is kept. `test/integration/stale-code-graph.test.ts`: all 4 #98 it.fails are plain `it` and pass (23/23).

## Eval results: Phase 4 (#91 candidates, train + fixture only; held-out never run)

Method: a local clone with the multi-hub, long-section, long-section-hard and identifier-tier fixtures copied into `.documentation`, indexed once (fusion is query-time only), then `eval` per candidate with the candidate switched by an env var in a throwaway `fuseScores` patch (both the CLI and the MCP caller; reverted, nothing in src/ is committed this phase). Train sets: real-corpus (50), real-hub (18), long-section (16), long-section-hard (13), multi-hub (30), identifier-tier (9), whole-answer (13); the two-part fixture is a separate 18-doc tree. Hybrid arm, in-process; "all" = the seven train sets run together (n=115 scored). 1.31.0 numbers are this branch's code with no switch (identical to 1.31.0 for ranking; Phase 3 touched only code-graph.ts) and match Phase 2's fixture ranks (R91-A #2, R91-B 7/12). One early sweep was invalid (the MCP caller did not pass the new arguments, so candidates 2 and 3 were never applied in the eval; redone below and only the redone numbers count).

Columns: all hyb@1/@3 of 115; multi @1/@3/@8 of 44; dom = most top-3 slots one doc takes (lower is better); R91-A rank, R91-B ranks (email-deliverability, droplet-deployment). Per-set hyb @1/@3 in order real-corpus, real-hub, long-section, long-section-hard, multi-hub, identifier-tier, whole-answer.

| candidate | all @1/@3 | multi @1/@3/@8 | dom | R91-A | R91-B | per-set @1/@3 |
|---|---|---|---|---|---|---|
| baseline (1.31.0) | 80/104 | 21/36/37 | 13 | 2 | 7,12 | 18/26, 6/10, 15/15, 10/12, 12/21, 8/8, 11/12 |
| 4. coverage_weight 0.3 | 84/104 | 23/36/38 | 16 | 3 | 6,11 | 19/26, 7/10, 15/15, 11/12, 12/21, 8/8, 12/12 |
| 4. clause_weight 1 | 81/102 | 22/35/38 | 13 | 2 | 3,12 | 18/24, 6/10, 15/15, 10/12, 12/21, 8/8, 12/12 |
| 4. COSINE_WEIGHT 0.8 | 80/101 | 21/35/38 | 14 | 1 | 5,12 | n/a |
| 4. COSINE_WEIGHT 0.9 | 78/99 | 21/33/38 | 16 | 1 | 5,11 | n/a |
| 1. agreement, share x (cos/cosTop)^p, p=1 | 80/100 | 21/34/38 | 15 | 1 | 5,12 | 18/24, 6/9, 15/15, 10/12, 12/20, 8/8, 11/12 |
| 1. p=2 | 79/100 | 21/34/38 | 15 | 1 | 5,11 | |
| 1. p=4 | 78/99 | 21/33/38 | 16 | 1 | 5,9 | |
| 1. p=8 | 78/99 | 20/33/38 | 17 | 1 | 4,8 | |
| 1. p=0.25 | 80/104 | 21/36/38 | 13 | 2 | 6,12 | |
| 1. p=0.3 | 80/104 | 21/36/38 | 13 | 2 | 6,12 | |
| 1. p=0.35 | 80/104 | 21/36/38 | 13 | 2 | 6,12 | |
| **1. p=0.4** | **80/104** | **21/36/38** | **13** | **1** | **6,12** | 18/26, 6/10, 15/15, 10/12, 12/21, 8/8, 11/12 |
| 1. p=0.425 | 80/104 | 21/36/38 | 13 | 1 | 6,12 | same |
| 1. p=0.45 | 80/104 | 21/36/38 | 13 | 1 | 6,12 | same |
| 1. p=0.5 | 80/103 | 21/35/38 | 14 | 1 | 6,12 | |
| 1. p=0.6 | 80/102 | 21/35/38 | 14 | 1 | 6,12 | |
| 1. p=0.75 | 80/102 | 21/35/38 | 15 | 1 | 5,12 | |
| 2. BM25 normalised against max(top, k*bm25SelfTop), k=1 | 80/103 | 21/35/38 | 15 | 2 | 7,12 | |
| 2. k=2 | 78/100 | 21/34/38 | 15 | 1 | 5,11 | |
| 2. k=4 | 78/99 | 20/33/39 | 16 | 1 | 5,11 | |
| 3. clause cover, share x (clauses with doc cover >= 0.5)/clauses | 82/97 | 23/30/38 | 13 | 3 | 7,11 | 19/22, 6/9, 15/15, 10/12, 12/19, 8/8, 12/12 |
| 3. soft: share x (min over clauses of cover)^p, p=1 | 79/99 | 20/32/38 | 14 | 1 | 4,8 | 19/24, 6/10, 15/15, 10/12, 11/18, 8/8, 10/12 |
| 3. soft, p=2 | 79/95 | 21/29/38 | 14 | 1 | 4,10 | |
| 3. soft, p=0.5 | 80/99 | 21/32/39 | 14 | 3 | 5,10 | |

Fixture (two-part) hybrid @1/@3/@8 of 2: baseline 0/1/1; candidate 1 p=0.4 1/1/1 (R91-A #1).

Reading:
- The existing knobs do not fix R91-A (coverage_weight 3, clause_weight 2) and coverage_weight raises dominance 13 to 16. A plain COSINE_WEIGHT 0.8/0.9 fixes it but loses 3 to 5 train @3 and raises dominance.
- Candidate 2 only moves anything when the vault is small (the self-query reference is large next to a short question's BM25 top), and then it costs train @1/@3 and dominance. Fails.
- Candidate 3 (both forms) fixes or improves R91-A only at a loss of 5 to 9 train @3. Fails.
- Candidate 1 with a gentle exponent is the only one that fixes R91-A with nothing lost on train: p in [0.4, 0.45] gives train 80/104 (unchanged), multi @8 37 to 38 (+1), dominance 13 (unchanged), negatives flagged 18/22 (unchanged), R91-B email-deliverability 7 to 6. p=0.5 already loses one @3 and raises dominance to 14, and p<=0.35 does not fix R91-A. The window is narrow (three measured points), the fix is one question's gain, and the cliff is close: record it as fragile.

## Phase 4 outcome

**Chosen: candidate 1, lexical share scaled by agreement, exponent 0.4.** In `fuseScores`, each lexical-list doc's BM25 share (0.3 * bm25/max) is multiplied by `min(1, cosine / topCosine) ^ 0.4`, where `cosine` is the doc's vector-arm score (0 for a doc outside the vector pool) and `topCosine` is the vector arm's best score (after the same boosts). Pure vector order is unchanged when BM25 returns nothing; the vector arm's cosine term is unchanged, so only the lexical share of a doc that is weak on meaning shrinks. It qualifies under the plan's rule (fixes R91-A, loses nothing on train, dominance not raised). Caveats for Phase 5: (1) tuned on one failing question plus the train sets; the exponent window is 0.4 to 0.45 and the real test is the held-out gate; (2) the identifier tier and `no_strong_match` are untouched in code but Phase 9 must compare top 3 on every train question; (3) the throwaway patch passed `{query, bm25, selfTop, clauses}` through fuseScores for candidates 2 and 3; the chosen one needs only the vector list already passed in, so no signature change. Losing candidates (2, 3) leave no code behind.

## Eval results: Phase 5 (gate, fresh `BAND=1 bash scripts/gate-release.sh 1.31.0`, candidate on at 0.4, no cache)

Held-out, 8 sets (n=139 hybrid; multi n=41). Local (candidate on) vs 1.31.0:

| run | hyb@1 | hyb@3 | multi @1/3/8 | cov@3 | dom | neg flagged | false flags |
|---|---|---|---|---|---|---|---|
| no export, 1.31.0 | 91 | 115 | 20/28/31 | 0.817 | 34 | 43 | 7 |
| no export, local | 89 | 115 | 20/28/32 | 0.811 | 33 | 43 | 7 |
| export, 1.31.0 | 94 | 115 | 20/28/32 | 0.817 | 26 | 43 | 7 |
| export, local | 94 | 116 | 20/28/33 | 0.825 | 28 | 43 | 7 |

cli and mcp identical (0 of 186 differ in top 3, both modes); titled #1 139/139; slow git fine. Gate verdict: **FAIL** (exit 1): no-export hybrid @1 drops 2 (band 1) on cli and mcp; export dominance rises 2 (28 vs 26, band 1) on cli and mcp. Gains (multi @8 +1, +2 hyb@3 on export) do not offset. Decision: ship OFF as opt-in `ranking.lexical_agreement` (default 0); version 1.31.1. Exponent was not re-tuned after seeing held-out (eval discipline). Log: /tmp/claude-1000/gate-p5.log.

Validation (Phase 5): lint, build, npm test (164 files) green. First `npm run eval`: 1 of 28 files failed (name lost to a tail); re-run in two batches (4 ranking-sensitive files, then the other 24) all pass: a load flake, not reproduced.

## Eval results: Phase 6 (measure)

Gate numbers (Phase 5) are in the section above. Fixture `test/fixtures/two-part` (2 questions), from the Phase 4 runs (`/tmp/claude-1000/p4/tp-*.json`), @1/@3/@8 of 2:

| arm | 1.31.0 ranking (setting off) | `lexical_agreement: 0.4` |
|---|---|---|
| hybrid | 0/1/1 | 1/1/1 |
| semantic | 1/1/2 | 1/1/2 (unchanged, fusion only) |

The default ships off, so the shipped hybrid numbers are the left column; the right column is what the opt-in gives (R91-A #2 to #1).

#98 by hand (scratch, /tmp/claude-1000/p6): a temp git repo with 2 docs, hewtd 3.4.1's built `dist/cli/index.js graph` (read-only; its repo untouched) wrote `.hewtd/graph.json` (v1; the bare ref `export_audit_log.py` is `resolved: true`, no `file`). Then `git rm backend/scripts/export_audit_log.py` and commit; branch build, MCP server:
- at the export commit (file present): no grounding on the doc;
- after the delete: `search_hybrid` result has `grounding {"source":"export+live","stale":true,"code_drift":[],"dead_refs":["export_audit_log.py"]}`; `get_stats` has `codeGraph {source: "export", behind_head: 1, files_changed_since: 1}`.
I did not re-run 1.31.0 here (Phase 1 reproduced the miss by reading `patchStale`; the Phase 3 test failed on it before the fix).

Code-load cost (`loadCodeData`, 1,000 tracked files in 50 dirs, 60 docs each citing 2 bare + 1 path ref, export 100 commits behind, 200 files changed since; median of 5 warm in-process calls after a discarded first, 2 runs, esbuild bundles of `main` and this branch, git file cache warm):

| build | run 1 | run 2 |
|---|---|---|
| main (1.31.0) | 20 ms | 27 ms |
| branch | 24 ms | 25 ms |

No measurable cost (within run-to-run noise, <= 4 ms). The branch re-checks more refs: 27 docs patched vs 10 on main (bare refs main skipped), 0 dead in both because nothing was deleted. The basename map is built once from the already-loaded `exp.files`; no extra git spawn.
