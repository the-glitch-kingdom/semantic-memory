---
title: A hewtd graph export is keyed to a commit and silently describes an older tree after the next commit
tier: fact
domains:
  - troubleshooting
  - architecture
status: active
last_updated: '2026-11-11'
purpose: Why does a search show a cited file as live (or drifted) when it was deleted or edited in a later commit?
symptoms:
  - a doc cites a file that was deleted, yet grounding has no dead_refs
  - grounding.stale is true and source is export+live
  - healthcheck warns code-graph-stale
id: code-graph-export-goes-stale-after-commit
confidence: high
last_verified: '2026-11-11'
verify_command: >
  cd "$(git rev-parse --show-toplevel)" && grep -n "patchStale\|CODE_GRAPH_STALE_COMMITS" src/core/code-graph.ts
provenance:
  - issue #95, fixed in 1.30.0
sources:
  - src/core/code-graph.ts
  - src/core/healthcheck.ts
  - test/integration/stale-code-graph.test.ts
tags:
  - gotcha
  - code-graph
invalidated_by:
  - hit-em-with-the-docs refreshes .hewtd/graph.json on every commit
  - patchStale in src/core/code-graph.ts is removed
---

# A hewtd graph export is keyed to a commit and silently describes an older tree after the next commit

## Claim
`.hewtd/graph.json` records `source_commit`. Its resolved paths, dead refs and change dates are true for that commit only. Before 1.30.0 semantic-memory trusted it as if it were HEAD, so a file deleted or edited in a later commit still looked live and undrifted.

## Instead
Compare the export's commit with HEAD and patch the changed refs live: `git diff --name-only <commit>` gives the changed files, and only refs to those files (or recorded dead) are re-checked on disk. Docs so patched read `source: "export+live"`, `stale: true`. Do not try to refresh the export from a search; `npx hewtd index` does that and writes tracked files.

## How to verify
`test/integration/stale-code-graph.test.ts` commits a deletion after the export and expects the dead ref. `get_stats` `codeGraph.behind_head` shows how far behind the export is.

## Consequences
A repo whose commit hook does not run `npx hewtd index` accumulates stale docs; the `code-graph-stale` healthcheck warns past 20 commits.

## See also
- [code-graph](../../architecture/code-graph.md)
