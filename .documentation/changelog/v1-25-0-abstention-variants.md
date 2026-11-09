---
title: v1.25.0 - abstention counts searchable docs and spelling variants
tier: reference
domains:
  - changelog
audience:
  - developers
  - admin
tags:
  - v1.25.0
  - abstention
  - missing-terms
  - issue-78
status: active
last_updated: '2026-11-09'
version: 1.25.0
purpose: What v1.25.0 changed (issue 78), the same-run flag numbers against
  1.23.0 and 1.24.0, and the targets that could not be measured.
load_priority: 5
estimated_read_time: 2 minutes
backlinks: []
word_count: 370
last_validated: '2026-11-09'
sources:
  - src/core/bm25.ts
  - src/core/identifiers.ts
  - src/core/path-class.ts
  - src/core/code-graph.ts
  - test/e2e/abstention-variants.test.ts
  - test/e2e/abstention-parity.test.ts
---

# v1.25.0 - abstention counts searchable docs and spelling variants

Issue #78. Earlier step: [v1.23.0](v1-23-0-abstention-product-names.md). Rules: [retrieval tuning guide](../operational/retrieval-tuning-guide.md#presence-rules-v1250).

## What changed
- **Presence counts only searchable docs.** A name that only a `generated: true`, `exclude`d or `results.exclude`d hub (INDEX.md, REGISTRY.md) mentions is now `missing_terms`, as the search can never return that doc. Scoring is unchanged. [KB fact](../knowledge-base/facts/hubs-without-generated-flag-make-absent-names-look-present.md).
- **Spelling variants count as present.** `autofill` is present when the docs say `auto-fill`, `auto_fill`, `AutoFill` or `Smart Retry`-style Title Case runs. Hyphen and underscore runs and Title Case runs are joined into a presence-only map that scoring never reads. A lowercase prose pair (`auto fill`) is not joined: that was built and withdrawn, as it multiplied the presence vocabulary by eight.
- **A name equal to a file name** ignoring case, `-` and `_` is `undocumented`, not missing.
- Same flags over stdio, the CLI and federation on all 125 absent-terms questions, plain and with the `hewtd index` export (`test/e2e/abstention-parity.test.ts`).

## Measured
Same run, stdio probe, 232 questions, negatives flagged / false flags on controls (identical with and without the export):

| set | 1.23.0 | 1.24.0 | 1.25.0 |
|---|---|---|---|
| absent-terms (32 neg, 28 ctl) | 25 / 5 | 25 / 5 | 25 / 0 |
| absent-terms-heldout (30 neg, 27 ctl) | 30 / 4 | 30 / 4 | 30 / 0 |
| real-corpus (20 / 27) | 15 / 1 | 15 / 1 | 15 / 1 |
| real-corpus-heldout (16 / 27) | 11 / 1 | 11 / 1 | 11 / 1 |

No negative changed. Top-5 ranking is identical to 1.24.0 on all 232 questions. p95 13 to 16 ms against 13 to 14 ms. `gate:release` against 1.24.0 passed on its second run.

## Missed targets
- The reporter's trees and question sets are not in this repo, so the four #78 acceptance checks were answered with our own proxy sets only. None was verified on their data.
- A name written as lowercase prose with a space (`auto fill`) is still flagged against `autofill`.
- Whether the reporter's hubs lack `generated: true` was never answered.
- `gate:release` has no slack for HNSW noise: its first run failed on one export top-3 difference (1 of 166) and the second passed.
