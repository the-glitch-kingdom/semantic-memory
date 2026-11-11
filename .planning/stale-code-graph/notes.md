# Notes: stale code graph (#95)

## Phase 1: verification on main (1.29.0, 97ea0c1)

### How the export is read
- `loadExport` (src/core/code-graph.ts:91) reads `<gitRoot>/.hewtd/graph.json` (v1). Per doc it keeps `refs` with `resolved` and `code_changed`, `body_changed`, `last_verified`, `verdict`, `duplicates` and `points_to`, plus the `symbols` table. **It never reads `source_commit`**, so a stale export is used as if current. That confirms the issue.
- `loadCodeData` (:258) takes the export's docs where it covers them, and the span/link fallback (`fallbackCode`, live `existsSync` plus `gitLastChanged`) for the rest. MCP (context.ts:272) and CLI (src/cli/search.ts:169) share it, so one fix covers both.
- `groundDocs` (:279): dead = file refs with `resolved === false`; drift = refs whose `changed` is after max(body date, last_verified). Grounding feeds the score (`groundingMultiplier`, decay.ts), so stale data also mis-ranks.
- `codeStamp` (context.ts:262) is the export mtime plus the `.git/logs/HEAD` mtime. A commit already triggers `applyCode` at the next reconcile (context.ts:395), but it re-reads the same stale export. The patch belongs in `loadCodeData`, not in the reload trigger.
- `get_stats.codeGraph` (src/mcp/tools/system.ts:34) is `codeLoad` = `{source, loadMs}`.

### Cold sources
- A locked source's context runs `applyCode` like any other. `loadCodeData(<cold path>)` → `repoRoot` finds the live repo, so the live `graph.json` is matched against the cold vault and `loadExport` warns `fewer than half of its doc keys match` (code-graph.ts:114).
- `warnOnce` dedupes per process, but the CLI is a new process per search, so every `--source long-term` search warns.

### hit-em-with-the-docs side (read only)
- hewtd 3.3.0 (`a19861d`) docs/graph-export.md: `source_commit` is HEAD's sha or `null` outside git. The file is written by `hewtd index` and `reconcile --apply`, and is incremental since 3.1.5 (a code commit costs about 1-1.7 s on 920 docs / 3,000 files).
- There is **no graph-only export**: `hewtd index` also regenerates INDEX.md/REGISTRY.md (`--no-graph` is the opposite switch). So issue item 4 would make a search write tracked files. It is out of scope.
- This repo has no `.hewtd/graph.json` of its own, so the fixtures must build one.
