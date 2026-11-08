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
