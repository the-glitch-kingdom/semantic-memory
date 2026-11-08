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
