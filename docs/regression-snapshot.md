---
title: Regression-Snapshot Suite
tier: standard
domains:
  - testing
  - operational
status: active
last_updated: 2026-05-07
version: 1.0.0
audience:
  - developers
purpose: Document the regression-snapshot suite, when it fails, how to interpret a failure, and the policy for updating snapshots intentionally.
---

# Regression-Snapshot Suite

The regression suite under `test/regression/` is the **structural stability gate** for semantic-sidekick. It captures the shape of the MCP tool surface — every tool's name, description, input schema, and representative output structure — as vitest snapshots that fail loudly on any unintentional change.

This is the load-bearing baseline for the **semantic-memory rebrand + multi-corpus refactor** (Phase 1.0.0 of the unified memory layer plan). The contract: every snapshot in this suite must remain unchanged through the rebrand unless an intentional break is documented and signed off.

## What the suite covers

### `test/regression/tool-surface.test.ts` — input contract

Three snapshots:

| Snapshot | Captures | Size |
|---|---|---|
| `tool-surface 1` | Full list of registered tools — name, description, complete JSON Schema for inputs | ~1000 lines |
| `tool-name list (compact) 1` | Sorted list of tool names in default mode (44 entries as of v1.6.1; 33 at baseline) | ~46 lines |
| `tool-name list in read-only mode 1` | Sorted list of tool names in `--read-only` mode (20 entries as of v1.6.1; 21 at baseline) | ~21 lines |

Plus structural assertions:
- Default mode exposes exactly 44 tools (33 at baseline)
- `--read-only` mode exposes exactly 20 tools (21 at baseline; `log_event` became write-gated in v1.6.1)
- Read-only mode never exposes any of the 13 listed write tools (explicit name list, `log_event` added in v1.6.1)

### `test/regression/tool-outputs.test.ts` — output contract

16 snapshots covering response shapes for:
- **Deterministic read tools**: `read_note`, `read_multiple_notes`, `list_notes`, `get_frontmatter`, `backlinks`, `forwardlinks`, `graph_path`, `graph_statistics`, `get_stats`
- **Lint tools**: `lint_vault` (rule-name structure)
- **Embedding-dependent tools** (structural only — see below): `search_semantic`, `search_text`, `search_hybrid`, `search_graph`

## Embedding-dependent vs deterministic snapshots

Search tools that route through the embedder produce slightly different scores across runs (within a tolerance). Snapshotting their full output would create false-positive failures.

The suite handles this with two strategies:

1. **Strip volatile fields**: `mtime`, `lastIndexed`, embedding scores are removed (or reduced to presence-checks) before snapshotting.
2. **Shape-only snapshots**: For `search_semantic` / `search_hybrid` / `search_graph`, the snapshot captures only the *keys present* in a result, not the values. The shape regresses if a field is added or removed; embedding score drift never breaks the test.

## When a snapshot fails

A regression-snapshot failure means the tool surface or output shape changed since the snapshot was last written. There are three responses:

### 1. The change is unintentional → fix the regression

This is the default assumption during the semantic-memory rebrand. Investigate what changed, restore the previous behavior. Do not update the snapshot.

### 2. The change is intentional and documented

Examples:
- Adding a new MCP tool (the surface snapshot will gain an entry)
- Extending an existing tool's input schema (the surface snapshot will show the new field)
- Adding a field to a tool's output (the output snapshot will show the new key)

Process:
1. Confirm the change is intentional and matches the published plan
2. Update snapshots: `npm test -- -u test/regression/`
3. Review the diff in the snapshot file as part of the PR
4. Document the intentional break in the relevant CHANGELOG entry (semantic-memory CHANGELOG, probably under the version that introduces it)
5. Sign-off in the PR description: explicit acknowledgment that this is a deliberate break

### 3. The change reflects an upgrade to the embedding model or chunker

If the embedding model changes (e.g., MiniLM-L6 → BGE-m3) or the chunker changes (markdown → tree-sitter for some corpus), the deterministic snapshots may legitimately need to update. Treat as case 2 — explicit, documented, signed off. Note the model/chunker change in the CHANGELOG.

## Updating snapshots

```bash
# Update only the regression suite
npm test -- -u test/regression/

# Update everything (use sparingly)
npm test -- -u
```

Always inspect the resulting diff before committing. A snapshot diff that touches more than the file you changed is a signal that something else regressed.

## Capture process (how the baseline was created)

Captured 2026-05-07 BEFORE any sidekick code changes for the semantic-memory rebrand. Three commits established the baseline:

1. `test(regression): golden snapshots for MCP tool surface` — input contracts (3 snapshots, 6 tests)
2. `test(regression): golden snapshots for MCP tool output shapes` — output contracts (16 snapshots, 16 tests)
3. `docs(regression): document the snapshot suite` — this file

Combined: 19 snapshots / 22 regression tests / 0 failures at baseline.

The full sidekick suite at baseline: 211 tests across 26 files, 21.85s.

## Performance baseline (separate, deferred)

A performance baseline (query latency p50/p95, index size per chunk count) is mentioned in the regression plan but is captured separately by `scripts/regression-perf-baseline.js` (TBD). It is **informational, not gated** — a 10% performance budget will be enforced in Phase 4.2.0, not now.

## Suite lifecycle

The regression suite is a **gate during refactoring**. After the semantic-memory rebrand and multi-corpus refactor are complete, the suite should be re-evaluated:

- Snapshots that captured `--read-only` 21-tool surface may need to evolve to reflect new conditional tool registration (workflow / drift / translation verbs).
- Output snapshots may need to evolve as new corpora come online and result shapes grow corpus tags.
- The suite itself should evolve from "lock current behavior" to "verify multi-corpus behavior remains stable as new corpora are added."

That evolution happens at Phase 4.2.0 (per the plan). Until then: this suite is the immutable baseline.

## Related

- Plan: `~/workspace/the-glitch-kingdom/persistent-planning/.planning/layered-planning-with-mcp-and-hewtd-frontmatter/task_plan.md`
- Companion behavior tests: `test/integration/mcp-server.test.ts`, `test/e2e/stdio-server.test.ts`
- Vitest snapshot docs: https://vitest.dev/guide/snapshot.html
