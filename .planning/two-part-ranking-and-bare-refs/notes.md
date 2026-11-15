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
