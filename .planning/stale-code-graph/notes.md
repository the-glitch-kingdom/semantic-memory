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

## Eval results: Phase 4
No ranking change (reporting only). `get_stats.codeGraph` gains export_commit/behind_head/files_changed_since only with an export (no export: byte-identical, guard passes). Healthcheck `code-graph-stale` reads graph.json and one `git rev-list --count`; never runs hewtd. `shape` passes grounding through (MCP and CLI cases in the suite assert export+live/stale). Full validation below.
Validation: lint, build, npm test (157 files, 1277 passed) green; eval 24 of 25, real-corpus-eval fails the same 2 floors (search_semantic answer@1 10 < 11) as on clean main; not lowered.

## Eval results: Phase 5
No ranking change (locked sources only lose grounding). Locked-source test captures dist CLI stderr: no `fewer than half` warning, no grounding on cold hits. The test now unlocks the read-only generations in cleanup (makeProject().cleanup()).

## Eval results: Phase 6

Fresh `BAND=1 bash scripts/gate-release.sh 1.29.0` (local 1.29.0 vs published 1.29.0, no --cache), PASS, exit 0.
Every count identical, local vs 1.29.0, on cli and mcp, no export and export:
- no export: hybrid@1 91/139, hyb@3 115, sem@1 79, multi@1/3/8 20/28/31 of 41, cov@3 0.817, dominance 31, negatives flagged 43/47, false flags 7.
- export: hybrid@1 94/139, hyb@3 115, sem@1 81, multi@1/3/8 20/28/32, cov@3 0.817, dominance 23, negatives 43/47, false flags 7.
- mcp vs cli: 0 of 186 questions differ; titled #1 139/139. p95 13-27 ms (cli 14-22), local cold idx 36-37 s, first mcp answer 1.26 s (slow git 0.98 s).
The gate's exports are at HEAD, so the patch step sees no change; this confirms ranking is untouched.

Code-load cost, stale export (synthetic repo: 1,000 files, 100 docs x 10 refs, export 100 commits behind, 300 files changed), `loadCodeData`, median of 7:
- main (no patch): 3 ms. This branch: 22 ms (+19 ms: one `git diff --name-only`, one `rev-list --count`, one `git log` for dates, existsSync on touched refs). Bundled src with esbuild in /tmp; not measured on a repo larger than this.

By hand: hewtd 3.3.1 (sibling repo's built dist, read-only; the installed node_modules copy is 2.21.0) ran `index` in a temp clone of this branch, graph.json v1, source_commit = HEAD. Committed a deletion of src/core/claude-run.ts (cited by architecture/architecture-layers.md). After reindex, the dist CLI search shows that doc `{"source":"export+live","stale":true,... dead_refs include "src/core/claude-run.ts"}`; docs with no patched refs stay source "export". MCP get_stats codeGraph: `export_commit` = the export commit, `behind_head` 1, `files_changed_since` 3 (the deletion plus two tracked files the reindex/index rewrote; not 1, expected).

## Eval results: Phase 9
- Edge-case tests added (test/unit/code-graph.test.ts, "stale-export edge cases"): :line/#L suffix, directory ref, gitignored ref, uncited change keeps source export, symlinked ref, merge commit, detached HEAD, export ahead of HEAD after reset, export from another repo. All pass.
- lint, build, npm test pass (one stdin-eof load flake, passes alone; machine load average ~65 from other sessions). npm run eval under that load: 5 files hit the 600 s beforeAll timeout; re-run alone: 4 pass, real-corpus-eval fails 2 floor tests (search_semantic answer@1 10 < 11), same as clean main. Floor not lowered; needs a re-baseline decision.
- Fresh `BAND=1 bash scripts/gate-release.sh 1.29.0`: PASS. export: hybrid@1 94 vs 94, multi 20/28/32 equal, neg flagged 43 equal; no export: hybrid@1 91 vs 91; mcp vs cli 0 of 186 differ.
- Independent review (`claude -p --setting-sources ""`, given only the diff). Fixed: `..` guard skipped valid names like `..config/x` (now `..` or `../` prefix only); `patched` could list a file twice (now deduped). Rejected: gitLastChanged takes no paths from the export (filters a full `git log`), so no injection or escape; null/unknown commit marking docs export+live is the plan's decision; spawnSync is used by other fast-tier checks; healthcheck and loadExport both use the project root; stale grounding in a locked generation's old cache is historical, not wrong. Known, unfixed: running server does not notice an uncommitted deletion until the next commit or restart (codeStamp watches graph.json and .git/logs/HEAD); an uncommitted edit marks stale without drift.
