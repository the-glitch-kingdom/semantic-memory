---
title: v1.21.0 - hub doc ranking
tier: reference
domains:
  - changelog
audience:
  - developers
  - admin
tags:
  - v1.21.0
  - ranking
  - grounding
status: active
last_updated: '2026-11-08'
version: 1.21.0
purpose: What v1.21.0 changed for issue
load_priority: 5
estimated_read_time: 3 minutes
sources:
  - src/core/decay.ts
  - src/core/indexer.ts
  - src/core/identifiers.ts
  - src/core/code-graph.ts
  - scripts/gate-release.sh
  - scripts/eval-against-release.sh
  - package.json
word_count: 467
last_validated: '2026-11-09'
backlinks: []
---

# v1.21.0 - hub doc ranking

Issue #71: on a 919-doc tree, 1.16 (grounding penalty) and 1.17 (section-only scoring) lost #1 for hub docs. The loss did **not** reproduce on this repo, so the reporter's tree decides after publish (re-run their set C and A+B).

## What changed

- **Grounding ranks by dead refs only.** `drift_penalty` defaults to 1; `< 1` is the per-file opt-in (0.97 restores 1.20). `decay.code: false` is shorthand for off. Schemas installed by 1.16 to 1.20 hold 0.97 explicitly and need `drift_penalty: 1`. See [code-graph](../architecture/code-graph.md#grounding).
- **Doc-level chunk.** Each doc gets a `meta` chunk (`field: "doc"`); score is the max of best section and that chunk, anchors unchanged. Index schema 9 to 10.
- **Grounding inputs filtered**: non-path export refs, duplicate bare names, self-citations. `cited_by[].stale` means dead refs or a stale verdict.
- **PascalCase identifiers** (2+ capitals) count when the code graph knows them, through the one `identifiers(query, known)` detector (MCP and CLI).
- **Eval**: `negative: true` rows are scored as negatives; `eval` prints settings and `related` per #1. Upgrade window (old index served by the new server) now says section, anchor, grounding and card may be missing.
- **Release gate**: `npm run gate:release` compares held-out hybrid and multi @1 with the previous release; required before `npm publish` ([release process](../deployment/release-process.md)). `scripts/eval-against-release.sh` measures published versions or `local` on clones.

## Measured (same run, no export, one run per cell, noise about 1 case)

| set | run | hybrid @1 | multi @1 | negatives flagged |
|---|---|---|---|---|
| held-out, combined (37) | 1.15.0 | 18 | 5/10 | 15/17 |
| | 1.20.0 | 19 | 6/10 | 13/17 |
| | 1.21.0 | 22 | 7/10 | 13/17 |
| train, combined (39) | 1.15.0 | 25 | 9/13 | 19/22 |
| | 1.20.0 | 25 (26 in the Phase 5 run) | 8/13 | 19/22 |
| | 1.21.0 | 24 | 7/13 | 19/22 |

Held-out was never used to choose a constant. `related` per #1 is 1.15 to 1.58 (1.15.0: 0.74 and 0.78 on the real-corpus sets). `npm run eval`: 135 passed, 5 expected fail. Cold index is 7 to 17 percent slower than 1.20.0 (one more chunk per doc).

## Missed targets

- Train hybrid @1 without an export is 24 against 25 (1.15.0); multi @1 is 7/13 against 9/13 (real-corpus train 4/9 against 7/9 in the last run). Per-file drift helped train here; the dead-only default rests on the field report. `drift_penalty: 0.97` is the one-line restore.
- Negatives flagged on held-out are 13/17 against 15/17 for 1.15.0, as in 1.20.0. Nothing here addresses it.
- The reporter's loss did not reproduce, and the stdio card, `related` and fields bugs do not reproduce on a ready index (only in the upgrade window, which is marked, not fixed).
- The gate band is one question on small sets: a regression guard, not proof.
