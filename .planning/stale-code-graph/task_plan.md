# Task Plan: a stale code-graph export is detected, patched per ref and reported (#95)

## Goal
hit-em-with-the-docs' `.hewtd/graph.json` is rewritten only when hit-em-with-the-docs runs, so after a code commit the grounding describes an older tree, and nothing says so:
- a doc citing a file deleted since the export is not flagged in `dead_refs`;
- a ref to code changed since the export keeps its old `code_changed` date, so `code_drift` misses it.

The fix:
1. Detect it: `source_commit` vs `HEAD`.
2. Patch only the refs to files changed since the export, checked live.
3. Report it in `get_stats`, on results and in `healthcheck`.
4. Stop applying the live tree's graph to locked (cold) sources, which also ends the `fewer than half of its doc keys` warning on every long-term search.

Release as 1.30.0 (minor: new `get_stats` and grounding fields).

**Out of scope.**
- A commit hook that regenerates the graph: hit-em-with-the-docs has that issue.
- Issue item 4 (`code_graph.refresh: on_stale`): hewtd 3.3.0 has no graph-only export, and `hewtd index` also rewrites INDEX.md/REGISTRY.md in the docs tree, so a background refresh would let a search write tracked files. Recorded under Decisions; revisit if hit-em-with-the-docs ships a graph-only export.

## Phases
- [x] Phase 1: Verify and plan (notes.md)
- [x] Phase 2: Acceptance as failing tests first (`it.fails` until fixed); all in `test/integration/stale-code-graph.test.ts`
  - [x] Fixture: a temp git repo built from `test/fixtures/code-graph-vault` (as `test/integration/code-load-order.test.ts:65` does, with `gitHistory`/`stampDates`). A `.hewtd/graph.json` in the hewtd v1 shape, with `source_commit` = the current HEAD, where doc D cites `backend/x.py` (resolved: true) and `backend/y.py` (with a `code_changed` date). Use the real export shape the existing `test/unit/graph-export-fixtures.test.ts` and `code-graph-real-export.test.ts` already pin.
  - [x] Then commit:
    - a deletion of `backend/x.py`: a search returning D lists `backend/x.py` in `dead_refs`, with no hewtd run;
    - an edit of `backend/y.py`: D shows `backend/y.py` in `code_drift` (when D's body is older than the edit).
    Both through MCP `search_hybrid` and CLI `search`.
  - [x] Those results carry `grounding.stale: true` and `grounding.source: "export+live"`. A doc citing only unchanged files keeps `source: "export"` and no `stale`.
  - [x] `get_stats.codeGraph` reports `export_commit`, `behind_head` (commits) and `files_changed_since`, all 0 at HEAD.
  - [x] `healthcheck` reports a finding when the export is more than `CODE_GRAPH_STALE_COMMITS` behind (constant, pick in Phase 3; record why), and none at HEAD.
  - [x] An uncommitted (dirty) deletion of a cited file is also caught: `git diff <source_commit>` compares against the working tree.
  - [x] A dead ref in the export whose file now exists (also untracked) is no longer dead.
  - [x] `source_commit` unknown to git (rebase, shallow clone, another repo) or `null`: every file ref of the export is checked live, `behind_head` is reported as unknown, and nothing throws.
  - [x] **No `graph.json`** (fresh clone): grounding and `get_stats` are byte-identical to main.
  - [x] **Export at HEAD:** grounding byte-identical to main, so the release gate's export runs do not move.
  - [x] **Locked source:** a `long-term` search emits no `fewer than half of its doc keys` warning (capture stderr), and its results carry no grounding from the live tree.
- [x] Phase 3: Detect and patch per ref
  - [x] In `src/core/code-graph.ts`:
    - read `source_commit` in `loadExport`;
    - in `loadCodeData`, when it differs from HEAD, get the changed set from ONE `git diff --name-only --no-renames <source_commit>` (working tree included);
    - on failure (unknown commit, shallow clone), treat every export file ref as changed.
  - [x] For each export ref whose file (`r.file ?? target`) is in the changed set, or that is `resolved: false`:
    - set `resolved` from a live existence check under the git root (`existsSync`, the same root and normalisation `fallbackCode` uses);
    - set `changed` from `gitLastChanged` (one call for all changed files, reused).
    Mark the doc `source: "export+live"` and record the patched files.
    Refs to unchanged files keep the export's data. Symbols are unchanged (the export's symbol table stays as is; record it).
  - [x] `groundDocs` carries `stale: true` on a grounding when any of the doc's refs were patched. `Grounding` gains the optional field; `groundingBlock` passes it through.
  - [x] `CodeData` gains `export?: { commit, behind, changed }`; `behind` comes from `git rev-list --count <source_commit>..HEAD` (null when unknown). Keep spawns to these 2-3 per load; record the cost on this repo and on a large repo (the long-term ~900-file copy is fine).
  - [x] Unit tests in `test/unit/code-graph.test.ts`; Phase 2 grounding tests become plain `it`.
- [x] Phase 4: Report
  - [x] `get_stats.codeGraph` (src/mcp/tools/system.ts:34, from `codeLoad` in src/mcp/context.ts:267) gains `export_commit`, `behind_head` and `files_changed_since`, only when an export was loaded. Without one it is byte-identical to main.
  - [x] `healthcheck`: a `code-graph-stale` warning when `behind_head > CODE_GRAPH_STALE_COMMITS` or unknown. It names the fix: run `npx hewtd index` (hit-em-with-the-docs' command; the finding only names it, never runs it).
  - [x] `grounding.stale` and `source: "export+live"` reach `search_hybrid`, `search_semantic`, CLI `search` and federated results unchanged (`shape` already passes `grounding` through; confirm).
  - [x] The MCP server already reloads code when HEAD's reflog moves (`codeStamp`, context.ts:262), so a commit is picked up at the next reconcile. Confirm with a test (commit, then the next search shows the dead ref), not just by reading.
- [ ] Phase 5: Locked sources skip the code graph
  - [ ] `buildContext` with `locked: true` never calls `loadCodeData`: no export, no span fallback, no grounding. A frozen generation's refs point at code that has moved on, and grounding it against today's tree would mark its history dead. Record the decision.
  - [ ] Opt-in sources that are not locked keep today's behaviour (a sibling repo's own export is valid). Record it.
  - [ ] Phase 2 locked-source tests pass as plain `it`.
- [ ] Phase 6: Measure
  - [ ] Fresh `BAND=1 bash scripts/gate-release.sh 1.29.0`: every count identical (the gate's exports are at HEAD).
  - [ ] Code-load cost with a stale export (100 commits behind, a few hundred changed files) on a ~1,000-file repo: before and after, in ms. Record it in notes.md.
  - [ ] By hand on a real stale export: build one with hewtd 3.3.0 (read only, its built dist, in a temp copy of this repo), commit a deletion of a cited file, and check `dead_refs` and `get_stats`.
- [ ] Phase 7: Release prep
  - [ ] Bump all five version fields to 1.30.0, plus the lockfile.
- [ ] Phase 8: Cleanup -- remove junk and unused code this work created: scratch/test scripts, debug files, probe logging, one-off test functions, commented-out code, dead code from abandoned approaches (MANDATORY)
- [ ] Phase 9: Validate success through comprehensive testing (MANDATORY)
  - [ ] Every Phase 2 test passes as plain `it`.
  - [ ] Edge cases:
    - a renamed file (`--no-renames`: the old path is deleted, the new one added);
    - a ref with a `:line` or `#L` suffix to a changed file;
    - a ref to a directory;
    - a ref git ignores;
    - a changed file outside every doc's refs;
    - a symlinked ref;
    - an export from another repo (keys do not match: unchanged warning and behaviour for the primary);
    - `behind_head` across a merge commit;
    - a detached HEAD;
    - an export whose `source_commit` is ahead of HEAD (after a reset).
  - [ ] Security: a ref target with `..` that escapes the git root is never checked outside it (resolved stays null).
  - [ ] Lint, build, `npm test`, `npm run eval`, `npm run gate:release` (fresh, BAND=1 vs 1.29.0).
  - [ ] Independent review of `git diff main...HEAD` (`claude -p`, given the code, not our conclusions).
- [ ] Phase 10: Documentation pass with hit-em-with-the-docs; no secrets (MANDATORY)
  - [ ] `.documentation/architecture/code-graph.md`: staleness detection, per-ref live patching, `export+live`, `stale`, and locked sources skipping the graph.
  - [ ] `.documentation/reference/mcp-tools-reference.md`: `get_stats.codeGraph` fields and `grounding.stale`/`source`.
  - [ ] `.documentation/troubleshooting/troubleshooting.md`: the `code-graph-stale` healthcheck finding and its fix (`npx hewtd index`).
  - [ ] Plugin help (`src/core/help/topics.ts`): the `code-graph` topic says the export can go stale, what `stale: true` means and how to refresh. `test/unit/help-coverage.test.ts` and `test/unit/cli-help.test.ts` pass. Any `--help` text this touches stays accurate.
  - [ ] KB gotcha fact: an export keyed to a commit silently describes an older tree after the next commit. `## Instead`: compare its commit with HEAD and patch the changed refs live.
  - [ ] `CHANGELOG.md` 1.30.0 and `.documentation/changelog/v1-30-0-stale-code-graph.md`.
  - [ ] `npx hewtd maintain --quick`; never hand-edit INDEX.md or REGISTRY.md. Re-run `npm run eval` after the docs.

## Key Questions
1. Should a search refresh the export (issue item 4)? No. hewtd has no graph-only export, and `hewtd index` writes INDEX/REGISTRY files. A search must not write tracked files. The commit-time refresh is hit-em-with-the-docs' own issue.
2. Should the changed set compare against the working tree or HEAD? The working tree (`git diff <commit>`), so an uncommitted deletion counts too. `behind_head` counts commits only.
3. Should opt-in, unlocked sources also skip the graph? No. Their own repo's export is valid. Only locked sources skip it.

## Decisions Made
- Version 1.30.0.
- Item 4 is out (Key Question 1). The commit hook is hit-em-with-the-docs' own issue (user, 2026-11-11).

- Phase 3: `CODE_GRAPH_STALE_COMMITS = 20` (exported from code-graph.ts, for Phase 4). A null `source_commit` has every file ref re-checked live, so those docs read `export+live`/`stale`; the real-export unit test now gives its export a real HEAD commit. A patched ref whose file is gone loses its `changed` date; a changed one with no commit in the 365-day window keeps the export's date. Symbol table is not re-derived. Spawns per load: `git ls-files` (existing), `git diff`, `git rev-list --count`, and `git log` only when a ref needs a date.

## Errors Encountered
- Phase 4: the get_stats test counted 3 changed files, not 2: the fixture's truth.json is swept into the first `commit()`; the test expects 3.
- Phase 2: `groundingBlock` hides the `verified` verdict, so the fixture export sets verdict `check` on D and E to make a doc without drift or dead refs still carry a grounding block.
- Phase 2: the healthcheck test makes the export 60 commits behind, so Phase 3 must pick `CODE_GRAPH_STALE_COMMITS` below 60, and the finding's `check` must match /code[-_]?graph/ and name `npx hewtd index`.
- Phase 2: a first `--source long-term` search only starts the cold index in the background ("skipped, still indexing"); the locked-source test retries up to 4 times until cold hits arrive.

## Status
**Phase 5 next.** Phase 4 done: get_stats.codeGraph fields, `code-graph-stale` healthcheck finding (warn above 20 commits or unknown commit; ok otherwise), reload-on-commit test; the get_stats and healthcheck it.fails are plain `it` now. Only the locked-source case stays it.fails (Phase 5).

Previous: Phase 3 done: per-ref patching in src/core/code-graph.ts. Three Phase 2 cases are now plain `it`; six `it.fails` remain (get_stats x3, healthcheck, locked source) for Phases 4-5.
