# Notes: code-graph

## Verification against main @ 29e74db (2026-11-08, read-only agent)
| #58 claim | Verdict | Evidence |
|---|---|---|
| The link graph is doc-to-doc only | True | Nodes are docs only (`src/core/graph.ts:53-60`); edge types at `src/core/types.ts:72` |
| Nothing knows which code a doc describes | True | Code spans survive only as unwrapped chunk text (`indexer.ts:279-293`). Links to non-`.md` files or outside the vault are dropped (`indexer.ts:232`) |
| Decay only uses the doc's own dates | True | `decayForDoc` reads `last_verified`, `gitDate` and `mtime` (`decay.ts:173-182`). `gitDate` is computed only for unverified docs in git mode (`context.ts:370-383`) |
| Fall back to code spans that resolve to repo paths | Feasible | The server only knows `notesPath` (`context.ts:141-142`). `repoRoot()` exists (`src/core/skill-evidence.ts:24-29`). `gitCommitDates` reads the vault folder only (`git-dates.ts:23`) |
| Reuse the dossier format | Partly | A dossier is a note plus a cache entry `{entity, aliases, path, purpose, current_state}` (`dossier.ts:26-47`), rendered by the hook (`vault-context.js:292-300`). Reuse the field names, not note writing |
| `search_graph` mode | Poor fit | It walks from a concept (`search.ts:139-156`). `backlinks`/`forwardlinks` (`tools/graph.ts:13-33`) fit code↔docs once code nodes exist |
| Drift as a ranking feature | Feasible | `applyDecay` runs per arm before fusion (`search.ts:171-175`); the CLI has its own copy (`cli/search.ts:121,134`) |
| 65% / 5% / 35% figures | Not checkable from code | The "citing no missing references" metric does not exist in `test/retrieval-eval` |
| Symbol location | Approximate | hewtd finds a symbol by the first file containing the word (`hit-em-with-the-docs/src/core/reconcile/references.ts:227-286`) |

## hit-em-with-the-docs (read only, main @ 8172adf)
- No export code yet: no branch for #65, and nothing mentions `graph.json`. `schemas/graph.v1.schema.json` exists (commit 832de35, per the #59 agent).
- The data already exists there:
  - refs in `src/core/reconcile/references.ts`
  - duplicates in `duplicates.ts`
  - pointers in `apply.ts:194-212`
  - anchors in `src/core/links/anchors.ts:14-89`
- Its doc paths are relative to the docs folder (`duplicates.ts:73`).

## Contract: `.hewtd/graph.json` v1 (comment on #58, 2026-11-08T02:12Z)
- **Top level:** `{version: 1, source_commit, docs: {path: {...}}, symbols: {name: {file, cited_by}}}`.
- **Per doc:** `body_changed`, `verdict`, `last_verified`, `refs[]`, `owner_of[]`, `points_to[{from, to}]`, `duplicates[{section, owner}]`.
- **Each ref:** `{kind: file|symbol|env|command|table|column|doc, target, file?, repo?, resolved: true|false|null, code_changed?}`.
- `resolved: null` is not dead. `code_drift` = refs with `code_changed` > `body_changed`.
- **Verdicts:** verified, fields-only, check, stale, archive-candidate, secret, unreviewed.
- The file is byte-identical for an unchanged tree. Additive fields keep v1; for an unknown version, ignore it with one warning.
- No doc text or secrets. A missing file means "no export".

## Real export (Phase 2)
- `npx hewtd index` in a scratch `git clone --local` of this repo @ 75d4e9f (hewtd 2.21.0, ~5.7 s): `.hewtd/graph.json` 451 KB, 95 docs, 281 symbols,
  `source_commit` = HEAD. Ref kinds: file 712, symbol 901, doc 319, column 115, env 123, command 42. `resolved`: 303 false, 148 null. Verdicts: unreviewed 78,
  secret 16 (false positives on docs about secrets), archive-candidate 1; none `verified`/`stale`/`check` because nothing went through `/reconcile`, so
  `unreviewed` is the common verdict. Doc keys docs-relative; no `docs_root` field; no `repo` refs in this repo. `last_verified` is null for all.
  Many "dead" refs are prose (`crud.update` column kind, paths in other repos), so dead-ref ranking must stay damped.
- Fixture `test/fixtures/code-graph-exports/real-trimmed.json`: 11 docs (the dead-ref-heavy ones, the archive-candidate, secret ones, the two with
  `owner_of`/`points_to`), symbols filtered to them, `source_commit` null. Holds paths, names and dates only. Validated by `test/unit/graph-export-fixtures.test.ts`.

## Eval results: Phase 2 (baseline, v1.15.0, no graph code)
`npx vitest run test/retrieval-eval/graph-eval.test.ts` (fixture `code-graph-vault`, `.hewtd/graph.json` present but unread). 9 answerable + 2 undocumented per split.

| split | arm | answer@1 | answer@3 | clean-top3 share | fully clean top-3 | answer above twin (12 pairs: 6 per split) | undocumented flagged |
|---|---|---|---|---|---|---|---|
| train | semantic | 5/9 | 9/9 | 0.778 | 4/9 | 2/6 | 2/2 |
| train | hybrid | 5/9 | 9/9 | 0.778 | 4/9 | 2/6 | 2/2 |
| held-out | semantic | 4/9 | 9/9 | 0.778 | 3/9 | 3/6 | 2/2 |
| held-out | hybrid | 6/9 | 9/9 | 0.778 | 3/9 | 3/6 | 2/2 |

Per tier answer@1 (hybrid): train drift 1/3, dead 1/3, identifier 2/2, plain 1/1; held-out drift 1/3, dead 2/3, identifier 2/2, plain 1/1.
Twin pairs are a coin flip today, as designed. Floors recorded in `baseline.json` under `codeGraph` (test allows one case of slack); the known gate
"answer above its twin in every pair" runs as `it.fails` and turns into a real gate when Phases 5-6 make it pass.
The real-corpus eval copies only `.documentation`, so a local `.hewtd/graph.json` does not change its numbers; the existing floors are untouched.

## Eval results: Phase 3
No retrieval numbers: `codeRefs` is parse-only, chunk text is unchanged, so `npm run eval` is unchanged. Re-parse proof: `test/integration/index-upgrade.test.ts` schema 7 to 8 embeds 0 chunks.
- Phase 3 full run: freshness-scale warm start and hook-failure Jev-hang failed under load, both passed alone.

## Eval results: Phase 4
No retrieval numbers: the module is not wired in yet. `npm run eval` unchanged (83 passed, 7 expected fail). Full `npm test`: only the hook-failure Jev-hang timing failed under load; passed alone.

## Eval results: Phase 5
Ranking is untouched, so `npm run eval` is unchanged (train hybrid @1 5/9, twin-beaten 2/6; held-out hybrid @1 6/9, twin-beaten 3/6; 84 passed, 7 expected fail). New: unit `graph-code.test.ts` (nodes, edges, dead refs, walks/paths/stats unchanged) and a graph-eval integration test (`backlinks("scripts/ci/guards.sh")` lists its 3 docs; `forwardlinks(doc)` has the code node; default walk types return only notes). Full `npm test`: freshness-scale warm start and hook-failure Jev-hang failed under load, both passed alone (16/16).

## Eval results: Phase 6
Grounding on, `decay.code` defaults (0.97 per drifted file, 0.95 per dead file ref, each capped at 3, floor 0.8, archive-candidate x0.85). The train split already gave 6/6 twin pairs with the defaults, so nothing was tuned; held-out was measured once, as is.

| split | arm | answer@1 | answer@3 | clean-top3 share | answer above twin |
|---|---|---|---|---|---|
| train | semantic / hybrid | 9/9 (was 5/9) | 9/9 | 0.815 (was 0.778) | 6/6 (was 2/6) |
| held-out | semantic / hybrid | 9/9 (was 4/9, 6/9) | 9/9 | 0.778 (unchanged) | 6/6 (was 3/6) |

Stable over 3 repeat runs. The held-out clean share cannot move on this fixture: a demoted dead twin still sits in the top 3 (see Phase 2). The `it.fails` pair gates are now real gates; codeGraph floors in baseline.json raised to these numbers (test keeps one case of slack). Real-corpus and docs-vault eval unchanged (87 passed, 5 expected fail; mean payload 4746 B hybrid, ceiling 4750): those vaults have no code refs to ground. The `grounding` block only appears with something to report. Bug caught by the unit test: `Math.max` with a NaN date silently dropped all drift; dates are filtered first.
Full `npm test`: only the hook-failure Jev-hang timing failed under load; passed alone (14/14).

## Eval results: Phase 7
`npx vitest run test/retrieval-eval/graph-eval.test.ts` (fixture, both arms, both splits): ranking unchanged (answer@1 9/9, @3 9/9, twin-beaten 6/6; clean-top3 0.815 train, 0.778 held-out).
Undocumented: flagged 2/2 and located 2/2 per split (the file path matches truth); `missing_terms` is now empty for them (named 0/2), so the old "named" check became "located". Held-out was measured once, nothing tuned.
Entity card: `check_rls_coverage.py` returns a file card on result #1 only, citing row-security-audit.md; CLI and MCP return the same card.
Full suite: 1016 passed, 5 expected fail; only the known hook-failure Jev-hang flake failed under load (14/14 alone). Tool-surface snapshot updated for the new search descriptions.
Open: symbol cards need the export for a file (fallback symbols have none); the card is built from `identifiers()` tokens, so a bare word such as `guards` gets none.

## Eval results: Phase 10 (review and validate)
Fixture eval (both arms, both splits), grounding on, nothing tuned, held-out measured as is: answer@1 9/9, answer@3 9/9, twin-beaten 6/6 per split; clean-top3 share 0.815 train, 0.778 held-out (Phase 2 baseline: 0.778, @1 4-6/9, twin-beaten 2-3/6). Undocumented flagged and located 2/2 per split.
Fallback (no `.hewtd/`, `test/retrieval-eval/graph-fallback.test.ts`, train + held-out questions): twin-beaten 12/12, the twin carries `grounding` (source `code-spans`) 12/12, `backlinks(guards.sh)` lists its 3 docs, the file card on result #1 is found. Outside git: `codeNodes` 0, no grounding, no card, no `undocumented`, `backlinks(file)` empty.
Real hewtd export (`real-trimmed.json`, `test/unit/code-graph-real-export.test.ts`, 11 docs staged in a temp git repo): loads with no warning; dead refs equal the file refs with `resolved: false` exactly (symbol, column, env, null never dead); `archive-candidate` verdict surfaced, `unreviewed` not; multiplier stays above the 0.8 x 0.85 floor; graph builds with code and symbol nodes, doc stats unchanged. It found the `./` dead ref (dropped now).
Real-corpus and docs-vault eval: 92 passed, 5 expected fail, every floor untouched; those vaults hold no code refs, so their numbers did not move (real-train hybrid @1 21/27, real-heldout 18/27, flagged 8/8 each).
Full suite: 1019 passed, 5 expected fail; two load flakes (freshness-scale, hook-failure Jev-hang) passed alone 3 of 3.

### #58 acceptance checks
1. **Met.** With an export, `forwardlinks(doc)` includes `code:`/`symbol:` nodes and `backlinks("scripts/ci/guards.sh")` lists its 3 citing docs (graph-eval, graph-code unit, real-export test). A code file under an `archive/` folder is no longer hidden (fixed in review).
2. **Met on the fixture, with a caveat.** `check_rls_coverage.py` returns a file card on result #1 with the citing doc (MCP and CLI equal). The card rides on #1; it does not reorder prose matches (the doc that cites the script already ranks first). A bare `check_rls_coverage` symbol gets a path only from the export (the fallback has no symbol file).
3. **Met.** A drifted doc carries `grounding.code_drift` and ranks below its twin in 6/6 pairs per split (export) and 12/12 (fallback).
4. **Not shown on the fixture, not measurable here.** "Top-3 docs citing no missing references" rose on train (0.778 to 0.815) and stayed 0.778 on held-out because a demoted dead twin still sits in the top 3; answer@1 did not drop (it rose 4-6/9 to 9/9). The real-corpus eval vaults have no code refs, so they cannot show it, and the external 751-doc tree was not available: this needs the release-step run.
5. **Met.** Without an export the fallback grounds docs from code spans and links (above); outside git it is the doc-only graph.
6. **Met.** No export and no gaps file is the default in CI (the unit and integration tests run that way); every existing floor passes untouched.
Known limits: fallback dead refs treat a prose route such as `api/v1/x` as dead when `api/` is a top folder (damped to 0.95 each, floor 0.8); symbol cards from the fallback have no file; `.git` as a worktree file never moves the stamp (`.git/logs/HEAD` missing).

## Eval results: Phase 11 (docs)
Code unchanged. `npm run eval` after the docs: 92 passed, 5 expected fail, every floor untouched (real-train hybrid @1 18/27 @3 25/27, flagged 8/8 each). New text went in two new pages (architecture/code-graph.md, changelog/v1-16-0-code-graph.md); existing pages got one short paragraph each (what-gets-indexed, indices-and-storage, decay-guide, mcp-tools-reference) and a one-line comment in configuration-reference. AGENTS.md regenerated from branch code: the managed body is unchanged (no tool added), only `last_generated` moved. `hewtd maintain --quick`: 10 errors, 94 warnings, same as before this phase (95 warnings before).
Full npm test: only freshness-scale and hook-failure Jev-hang failed under load; both passed alone (16/16).
