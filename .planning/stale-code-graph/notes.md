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

## Eval results: Phase 2
Tests and fixtures only (test/integration/stale-code-graph.test.ts; the export is built in a temp git repo from test/fixtures/code-graph-vault with `source_commit` = HEAD, D = audit-export-a.md citing X=export_audit_log.py and Y=prune_backups.py). Run with `PLAIN=1` the 9 `it.fails` cases fail as plain `it`, each for the stated reason (no dead_refs/code_drift/stale from a stale export; no export_commit/behind_head/files_changed_since in get_stats; unknown/null source_commit not live-checked; no healthcheck finding; locked source warns `fewer than half of its 1 doc keys` and grounds cold docs from the live export). Plain guards pass on main: unchanged-files doc keeps `source: export`, export-at-HEAD grounding exact, no graph.json gives `{source, loadMs}` only.
Ranking numbers: not measured (no src change).
Full validation: lint, build, `npm test` (157 files, 1265 passed, 9 expected fail) green. `npm run eval`: 24 of 25 files pass; `real-corpus-eval.test.ts` fails 2 floors (search_semantic answer@1 10 < 11), identically on a clean `main` worktree and with .planning stashed, so it is not caused by this phase (1.29.0 real corpus vs the recorded floor). The first eval run also hit the 600 s beforeAll timeout while the machine's load average was ~38. Left for the owner: re-measure and re-baseline with a recorded reason.

## Eval results: Phase 3
No ranking change expected (an export at HEAD is untouched; guard test passes). Full validation run below.
Validation: lint, build, `npm test` (1 load flake: stdin-eof, passes alone) green. `npm run eval`: 23 of 25 files pass; graph-eval fixture expectation updated (its export has a null source_commit, so its docs now read `export+live`; drift unchanged); real-corpus-eval still fails the same 2 floors (search_semantic answer@1 10 < 11) as on clean main (Phase 2 note); not lowered.
