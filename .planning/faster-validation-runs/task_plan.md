# Task Plan: Faster validation runs

## Goal
Cut the time each plan's workflow and each CI run spends validating, by removing repeated work only. The same tests run and the same numbers are measured; nothing is weakened. This is internal tooling, so there is no npm release.

## Phases
- [x] Phase 1: Plan and setup (measured where #76's workflow spent its time; see notes.md)
  - [x] Plan-runner prompt (outside the repo, in the session's workflow script) has three new rules:
    - test budget: the full suite once per phase, at commit; skipped for diffs that touch only `.planning/`;
    - one heavy job at a time;
    - reuse published-release counts for in-phase decisions.
- [ ] Phase 2: Measure first (nothing else running heavy jobs)
  - [ ] Baseline wall times on this machine: `npm test`, `npm run eval`, one `eval-against-release.sh <prev> local` (default sets), `npm run gate:release`.
  - [ ] Determinism check for the cache: measure one published version twice, from two fresh clones and indexes (CLI and MCP, with and without `--export`). Diff the per-question results (`probes`, tiers, negatives flagged).
    - Record how many questions differ, if any.
    - If more than the real-corpus slack (1 per set) differ, the cache is limited to the npm pack and build and never reuses results. Record that decision.
  - [ ] Record numbers in notes.md under "Eval results: Phase 2".
- [ ] Phase 3: Each test runs once
  - [ ] `package.json` "test" becomes `vitest run --exclude 'test/retrieval-eval/**'`. "eval" is unchanged (`vitest run test/retrieval-eval`).
  - [ ] Check that `npm test` plus `npm run eval` runs every `test/**/*.test.ts` file exactly once: compare file lists (`vitest list --json` or the run output) against the glob.
  - [ ] CI (`.github/workflows/ci.yml`) already runs both steps; only the comment changes, if needed.
- [ ] Phase 4: Load flakes retry instead of costing a full re-run
  - [ ] `{ retry: 2 }` on exactly the tests seen failing only under load, and passing alone:
    - freshness-scale "a warm start answers in under a second…" (CI 1085 ms > 1000 ms on PR #80);
    - hook-failure "Jev error or hang → nothing…";
    - stdin-eof "exits on SIGTERM";
    - skill-queue SessionEnd timing and links-exclude, only if found in this phase's runs.
  - [ ] No blanket retry in the vitest config.
  - [ ] Each retried test gets a one-line comment: why it retries (load timing), and what still fails it (a deterministic failure fails all 3 attempts).
- [ ] Phase 5: Opt-in cache for published releases in `scripts/eval-against-release.sh`
  - [ ] `--cache` (or `EVAL_CACHE=<dir>`, default `~/.cache/semantic-memory-eval`), opt-in only. `local` is never cached.
  - [ ] Cache key: version, `--export` / `--docs-only` / `--slow-git`, a hash of the corpus, and a sha256 of the set files' contents.
    - The corpus hash is `git rev-parse HEAD^{tree}` plus the copied fixture files, or the `.documentation` contents with `--docs-only`.
  - [ ] Cached: the unpacked package, the indexed clone tree, `index.sec`, and the CLI arm's `eval.json`.
    - The MCP arm is driven by this checkout's `dist/`. It is reused only when the sha256 of `dist/cli/index.js` matches; otherwise it re-runs on the cached index.
  - [ ] Cached rows show "(cached)" in the run column, and their p95, cold idx and first answer are marked as not same-run.
  - [ ] `gate-release.sh` never passes `--cache`, so the gate always measures fresh.
  - [ ] If Phase 2's determinism check failed, cache only the package unpack and skip result reuse.
- [ ] Phase 6: Release gate tolerates HNSW noise in its MCP vs CLI check
  - [ ] `gate-release.sh`: "local mcp and cli differ" fails only above `BAND` (1) questions, and prints the differing questions. Same slack as the real-corpus floors (#78 Phase 9 failed once on 1 of 166).
- [ ] Phase 7: Workflow prompt follow-up (outside the repo)
  - [ ] The plan-runner's REUSE MEASUREMENTS rule points at `eval-against-release.sh --cache` for in-phase measurements, and never for Phase 9 or the gate.
  - [ ] Its test-budget rule matches the new `npm test` / `npm run eval` split.
- [ ] Phase 8: Cleanup -- remove junk and unused code this work created: scratch/test scripts, debug files, probe logging, one-off test functions, commented-out code, dead code from abandoned approaches (MANDATORY)
  - [ ] No scratch timing scripts in the repo; the cache dir is outside the repo.
- [ ] Phase 9: Validate success through comprehensive testing (MANDATORY)
  - [ ] Lint and build; `npm test` and `npm run eval` both green. Union of their files = every test file, each once (Phase 3 check re-run).
  - [ ] Retry proof: temporarily make one retried test's assertion always fail. It must fail after 3 attempts. Revert.
  - [ ] Cache:
    - [ ] cold run, then warm run (same key): identical table counts, and the warm run is faster (time both);
    - [ ] change a set file → cache miss;
    - [ ] new commit → miss;
    - [ ] rebuild `dist/` → CLI arm reused, MCP arm re-run;
    - [ ] `local` never cached;
    - [ ] `--cache` absent → old behaviour, temp dir removed.
  - [ ] Gate: `npm run gate:release` passes against the previous version and does not use the cache (verify no cache dir is read). Slack check: a forced 1-question MCP/CLI difference passes; 2 fail. A tiny node check is enough.
  - [ ] CI on the PR green, with the step times recorded (test step and eval step) against PR #79's run (453 s and 214 s).
  - [ ] After: the same wall times as Phase 2, recorded beside the baseline.
- [ ] Phase 10: Documentation pass with hit-em-with-the-docs; no secrets (MANDATORY)
  - [ ] `.documentation/testing/tests-and-validation.md`: `npm test` excludes `test/retrieval-eval/`, and `npm run eval` covers it. Which tests retry, and why.
  - [ ] `.documentation/operational/retrieval-eval-guide.md`: `eval-against-release.sh --cache`, what is reused and what is always fresh.
  - [ ] `.documentation/deployment/release-process.md`: the gate's MCP/CLI slack of 1, and that the gate never uses the cache.
  - [ ] New KB fact (gotcha), `.documentation/knowledge-base/facts/wait-for-ready-blocks-mcp-initialize.md`:
    - `--wait-for-ready` indexes before answering `initialize`, so a test client needs `connect(transport, { timeout })`;
    - the SDK's 60 s default timed out on CI (PR #80, fixed in 9c0301b);
    - `## Instead` and a `verify_command`.
  - [ ] `CHANGELOG.md`: an "Unreleased (tooling)" note, or none if tooling changes are not logged there. Check the convention first.
  - [ ] `npx hewtd maintain --quick`; never hand-edit INDEX.md or REGISTRY.md.

## Key Questions
1. Are a published release's per-question results identical across two fresh index builds on this machine? This decides whether results are cached or only the build is. Answered in Phase 2.
2. Does the vitest version here support `--exclude` on `vitest run`? Answered in Phase 3; if not, use a config `exclude` keyed on an env var.

## Decisions Made
- No npm release: tooling and tests only.
- The gate and Phase 9's final comparison always measure fresh; the cache is opt-in for in-phase decisions.
- Retries are per-test for observed load flakes only, never blanket.

## Errors Encountered
- (none yet)

## Status
**Currently in Phase 2.** Starts after #78 (v1.25.0) ships. Must merge before any new issue's workflow starts (user, 2026-11-09).
