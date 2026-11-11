---
title: v1.30.0 - stale code graph
tier: reference
domains:
  - changelog
audience:
  - developers
  - admin
tags:
  - v1.30.0
  - code-graph
  - issue-95
status: active
last_updated: '2026-11-11'
version: 1.30.0
purpose: What v1.30.0 changed so a hewtd graph export older than HEAD no longer misreports cited code, and the measurements behind it.
load_priority: 5
estimated_read_time: 2 minutes
backlinks: []
sources:
  - src/core/code-graph.ts
  - src/core/healthcheck.ts
  - src/mcp/context.ts
  - test/integration/stale-code-graph.test.ts
  - package.json
---

# v1.30.0 - stale code graph

Issue #95. Details: [code-graph](../architecture/code-graph.md), fact [code-graph-export-goes-stale-after-commit](../knowledge-base/facts/code-graph-export-goes-stale-after-commit.md).

## What changed

- **Per-ref live patching.** The export's `source_commit` is compared with HEAD. Refs to files changed since (working tree included) are re-checked on disk; those docs read `source: "export+live"` with `stale: true`.
- **Reporting.** `get_stats.codeGraph` gains `export_commit`, `behind_head`, `files_changed_since`. Healthcheck finding `code-graph-stale` warns past 20 commits behind or an unknown commit, and names `npx hewtd index`.
- **Locked sources** (cold generations) skip the code graph.
- Not changed: searches never refresh the export; the commit-time refresh is hit-em-with-the-docs' own issue.

## Measured

- `gate-release.sh 1.29.0` (fresh): identical counts to 1.29.0, with and without export (hybrid @1 94/139 and 91/139, multi 20/28/32 and 20/28/31 of 41, negatives 43/47); mcp and cli differ on 0 of 186.
- Cost of a stale export (1,000 files, 100 docs x 10 refs, 100 commits behind, 300 files changed): `loadCodeData` 3 ms to 22 ms.

## Limits

An uncommitted edit marks a doc stale without a drift date; a changed file with no commit in the 365-day window keeps the export's date; a running server reloads only on a commit or `graph.json` change.
