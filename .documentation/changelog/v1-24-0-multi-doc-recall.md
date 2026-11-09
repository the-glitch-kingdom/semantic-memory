---
title: v1.24.0 - multi-doc recall measurement
tier: reference
domains:
  - changelog
audience:
  - developers
  - admin
tags:
  - v1.24.0
  - multi-doc
  - cov-at-k
  - dominance
  - issue-76
status: active
last_updated: '2026-11-09'
version: 1.24.0
purpose: What v1.24.0 changed (issue 76), the same-run numbers against 1.15.0,
  1.22.0 and 1.23.0, the changes tried and withdrawn, and the targets missed.
load_priority: 5
estimated_read_time: 3 minutes
backlinks: []
word_count: 507
last_validated: '2026-11-09'
sources:
  - src/core/retrieval-eval/metrics.ts
  - scripts/gate-release.sh
  - scripts/eval-against-release.sh
  - src/mcp/context.ts
  - test/fixtures/multi-hub/
  - .documentation/troubleshooting/troubleshooting.md
---

# v1.24.0 - multi-doc recall measurement

Issue #76. Method: [retrieval eval guide](../operational/retrieval-eval-guide.md#multi-hub-sets-and-facet-metrics-v124). Earlier step: [v1.22.0](v1-22-0-mcp-metadata-gap-long-sections.md).

## What changed
- **Ranking is unchanged from 1.23.0.** Two ranking changes were built and withdrawn after a same-run review (below).
- **`cov@k` and `dominance`** in `eval`, `eval --json` and `scripts/eval-against-release.sh`.
- **Multi-hub fixture and sets** (`test/fixtures/multi-hub/`, `multi-hub.jsonl`, `multi-hub-heldout.jsonl`): long operator-notes hubs, narrow one-facet docs, one-chunk broad docs.
- **`gate:release`** adds `multi-hub-heldout`; it fails when multi @3 or @8 drops by more than 1, when `cov@3` drops by more than one multi question's share, or when `dominance` rises by more than 1 slot against the previous release.
- **Fix (`src/mcp/context.ts`)**: `save()` cleared `dirty` after the write, so grounding that landed during a save never reached the cache the CLI reads. It now clears before the write and restores on failure.

## Measured
Same run, 12 sets (6 train, 6 held-out), 232 questions, 61 multi, hybrid, no export. CLI and MCP agree on every count.

| | hyb@1 | hyb@3 | multi @1/3/8 | cov@1/3/8 | dominance |
|---|---|---|---|---|---|
| 1.15.0 | 149 | 191 | 20/38/51 | .52/.81/.94 | 52 |
| 1.22.0 | 152 | 198 | 22/40/47 | .56/.82/.89 | 55 |
| 1.23.0 | 152 | 198 | 22/40/47 | .56/.82/.89 | 55 |
| 1.24.0 | 152 | 198 | 22/40/47 | .56/.82/.89 | 55 |

With an export: 1.15.0 149, 1.22.0 and 1.23.0 157 hyb@1, 1.24.0 equal to 1.23.0 on the gate sets. p95 was 10-32 ms in every run.

## Tried and withdrawn
- **Distinct-doc candidate pool** (`VectorIndex.search` counting docs, not chunks): multi @8 did not move (13 to 13 on multi-hub train); pooled dominance rose 55 to 67. Reverted.
- **Dropping runtime paths and bare names from export dead refs** (`dropNonDead`): fixed an export-only multi loss on train, but with an export hyb@1 fell 157 to 151 on the 12 sets and the gate went red. Reverted.
- **Second-strong-chunk bonus** (three forms) and a **single-chunk dampener**: no multi @8 change on train; the bonus raised dominance. Not kept. A chunk-count prior of -0.03 halves dominance but costs multi @1 and real-corpus `cov@1`; not kept.

## Missed targets
- **Multi @8**: 47 of 61 against 51 on 1.15.0. The 1.22.0 loss is not restored. The reporter's 12/14 and `cov@1` >= .85 could not be measured (their tree and kit are not available).
- **`cov@8`**: .89 against .94 on 1.15.0.
- **Dominance <= 3**: missed by every version, 1.15.0 included. One real 38 KB catch-all doc (`troubleshooting.md`) takes the slots; multi-hub alone is 4-6.
- **Exact term in a hub at #1**: the loss did not reproduce (3/4 or 4/4 on every version).
- Multi @1 is better than 1.15.0 (22 against 20); p95 is well under 100 ms.

## Known limits
The loss is not in the doc pool, per-doc aggregation or export grounding. Leads: a doc-level vector, a facet-splitting query step, the chunk-count prior. Export dead refs include runtime paths and bare names that the span fallback ignores; whether grounding should drop them needs its own eval.
