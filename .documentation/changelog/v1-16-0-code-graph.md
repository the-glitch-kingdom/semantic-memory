---
title: v1.16.0 - code graph
tier: reference
domains:
  - changelog
audience:
  - developers
  - admin
tags:
  - v1.16.0
  - code-graph
  - grounding
  - issue-58
status: active
last_updated: '2026-11-08'
version: 1.16.0
purpose: What v1.16.0 changed (issue 58), the measured results on the code-graph
  fixture, and the targets that were missed.
load_priority: 5
estimated_read_time: 1 minute
word_count: 200
last_validated: '2026-11-08'
backlinks: []
sources:
  - test/fixtures/code-graph-vault/.hewtd/graph.json
---

# v1.16.0 - code graph

Design and contract: [code-graph.md](../architecture/code-graph.md).

## Added

- `code:` and `symbol:` graph nodes (`cites_code`, `defined_in`), read from `.hewtd/graph.json` v1 or, without it, from code spans and links matched against git. `backlinks` / `forwardlinks` take files and symbols.
- Grounding: drifted and dead cited files lower a doc's score a little (`decay.code`) and appear as `grounding` on results.
- `entity` card on result #1 and `undocumented` on results for identifier queries.
- Index schema 8 (`codeRefs`, a re-parse with no re-embedding).

## Measured (fixture, nothing tuned, held-out measured once)

Answer@1 4-6/9 to 9/9 on both splits, twin pairs (answer above its stale twin) 2-3/6 to 6/6, undocumented flagged and located 2/2 per split. Fallback without `.hewtd/`: 12/12 twins. Clean-top-3 share 0.778 to 0.815 on train, 0.778 unchanged on held-out.

## Measured on this repo (full clone, code present)

The real-corpus questions (train + held-out, 54 answerable) on a `git clone` of this repo, one index, `decay.code` on vs off:

| arm | answer@1 off → on | answer@3 off → on |
|---|---|---|
| hybrid | 31 → 33 | 45 → 47 |
| semantic | 30 → 29 | 37 → 36 |

59 of 127 docs carry grounding: 58 with drift, 11 with dead refs (6 distinct, among them `scripts/retrieval-eval/mine-selection.mjs`, deleted in 1.15.0). The first run of this check found fallback false positives (`file.ts:208` and `file.js:Name` suffixes, folders written with a trailing `/`, globs, `<placeholders>`, gitignored runtime paths such as `.claude/.semantic-memory/`); they were fixed before release.

## Missed targets

- The clean-top-3 share did not rise on held-out: a demoted dead twin still sits in the top 3. The real-corpus eval vaults hold no code refs and the external 751-doc tree was not available, so the rise on a real tree is unmeasured (a release step).
- The entity card does not reorder prose matches.
- Fallback limits: prose routes can count as dead; symbol cards have no file path without the export.
