# Task Plan: decay reads a day clock, so ranking is a pure function of the index and the date (#88)

## Goal
The confidence-decay multiplier is the same for every call on the same UTC day. Today `decayForDoc` (`src/core/decay.ts:196`) never passes `nowMs`, so `computeDecay` reads `Date.now()` in milliseconds. A doc's multiplier changes between calls (0.7348984551 → 0.7348984544 over 40 ms). Two near-tied docs can then swap between calls, limits and builds. The reporter saw this in 1 of 59 questions on 1.27.0: ranks 4 and 5 swapped across builds, and limit 5 vs 8 within one build.

Release as 1.27.1 (patch).

## Phases
- [x] Phase 1: Verify and plan (notes.md)
- [x] Phase 2: Reproduce first, as failing tests (expected-fail until fixed)
  - [x] Unit (`test/unit/decay.test.ts`): `decayForDoc` on the same doc, called twice with a real clock 20+ ms apart (or with `vi.useFakeTimers` advancing 40 ms within one UTC day), returns an identical multiplier. Fails on main.
  - [x] Ranking (`test/retrieval-eval/decay-clock.test.ts`, `it.fails`, fake Date; plus the near-tie unit case in decay.test.ts): two docs whose decayed scores tie to within 1e-9. The same query run twice in one process, and at limit 5 vs 8, returns identical scores and order (`search_hybrid` and CLI `search`). Build the near-tie with fake timers, or by injecting the clock, whichever needs no sleeps. Mark failing cases `it.fails`.
- [x] Phase 3: The day clock
  - [x] `decayForDoc(doc, config, nowMs = decayClock())`, keeping `nowMs` injectable. `decayClock()` returns the END of the current UTC day: `(Math.floor(Date.now() / MS_PER_DAY) + 1) * MS_PER_DAY`.
    - Why the end, not the start: `computeDecay` treats age ≤ 0 as missing or in the future (`!(ageDays > 0)`). With the start of the day, a doc verified today (date-only `last_verified` = midnight UTC) would get age exactly 0 and fall to the fallback or penalty path. The end of the day keeps today's verification positive. Every age is then measured from one fixed instant per day.
    - Check `ageDaysOf` and the evergreen path behave the same way.
    - A `last_verified` later today (a datetime) stays positive. A future date stays future.
  - [x] Pass `nowMs` through from both callers: both call `decayForDoc(doc, cfg)` and take the new default `decayClock()`, so MCP and CLI share one clock (no call-site change needed).
  - [x] Any other ranking input that reads the wall clock per call? Grep `Date.now()` in `src/mcp/tools/search.ts`, `src/mcp/context.ts` (the usage boost, telemetry) and `src/core/*`. Usage boost changes with logged citations by design; record that, don't change it. Fix only what moves a score between two identical calls with no index or citation change.
  - [x] Eval and release check: they must give the same numbers whatever the time of day. If eval or `gate-release.sh` compare runs taken minutes apart that could straddle midnight UTC, pin the clock, e.g. with an env override such as `SEMANTIC_MEMORY_NOW` read once in `decayClock()`. Add the override only if a real straddle risk exists, and record the decision.
    - Decided: no override. The only other per-call clocks are context.ts:439 (a boolean flag) and :693 (a citation cache TTL); neither moves a score. Midnight straddle moves a score by one day of decay (a ~0.2% step at 365d), not a tie-break flip risk worth an env knob.
  - [x] Phase 2 tests pass as plain `it`.
- [x] Phase 4: Measure
  - [x] Run the #85 per-limit script (`.planning/.archive/limit-stable-ranking/measure-limits.test.ts`, if present locally, or its equivalent) on the branch: #1 accuracy and eval metrics at limit 8 must be identical to 1.27.0's (21/18/6/6; all @1/@3/@8 as in that notes.md). Decay moves only at day granularity, so expect no change; record any difference.
  - [x] Build twice on this repo's `.documentation`: 0 differing top-8 results. The same query 20 times in one process: identical scores.
  - [x] `npm run gate:release` (fresh, BAND=1) vs 1.27.0 passes.
- [x] Phase 5: Release prep, plus #85's leftovers
  - [x] Bump all five version fields to 1.27.1, plus the lockfile.
  - [x] KB gotcha fact (left over from #85): exact vector search must return the k nearest chunks, not k docs. Returning k docs widened the vector pool and raised dominance (39 vs 35). `## Instead`: truncate to k chunks, then group by doc. `test/unit/vector-exact.test.ts` pins it.
- [x] Phase 6: Cleanup -- remove junk and unused code this work created: scratch/test scripts, debug files, probe logging, one-off test functions, commented-out code, dead code from abandoned approaches (MANDATORY)
- [ ] Phase 7: Validate success through comprehensive testing (MANDATORY)
  - [ ] Phase 2 tests pass, and none are left as `it.fails`.
  - [ ] Edge cases, with fake timers:
    - a doc verified today (date-only, and a datetime earlier today) is fresh, not penalised;
    - a doc verified tomorrow is still "in the future";
    - two calls straddling UTC midnight differ by exactly one day of age;
    - `evergreen` and `per_type: null` are unchanged;
    - the `git` and `mtime` fallbacks are unchanged.
  - [ ] The healthcheck and lint decay paths (`src/core/healthcheck.ts`, `src/core/lint.ts`) still pass their own `nowMs` and are unaffected.
  - [ ] Lint, build, `npm test`, `npm run eval`, `npm run gate:release` (fresh).
  - [ ] Independent review of `git diff main...HEAD`.
- [ ] Phase 8: Documentation pass with hit-em-with-the-docs; no secrets (MANDATORY)
  - [ ] The decay doc (find it: the one describing `computeDecay` / half-life, likely under `.documentation/operational/` or `architecture/`). Say that age is measured from the end of the current UTC day, so a score is fixed for the day.
  - [ ] KB gotcha fact: a per-call wall clock in a ranking input makes near-tied docs swap between calls. `## Instead`: a quantized, injectable clock, plus a same-query-twice test.
  - [ ] `CHANGELOG.md` 1.27.1, and `.documentation/changelog/v1-27-1-decay-day-clock.md`.
  - [ ] `npx hewtd maintain --quick`; never hand-edit INDEX.md or REGISTRY.md. Re-run `npm run eval` after the docs.

## Key Questions
1. Start or end of the UTC day? The end (see Phase 3): a doc verified today must keep a positive age.
2. Per-process pinning instead? No. A long-running MCP server would then never age its docs. The day clock ages them once a day.

## Decisions Made
- Version 1.27.1. Ranking is unchanged apart from sub-day jitter.
- Phase 6: removed the scratch measurement scripts and configs (measure-limits.test.ts, repeat.test.ts, two vitest configs); kept branch-phase4.json as raw numbers. src diff has no debug or dead code.

## Errors Encountered

## Status
**Phases 1-6 done; next Phase 7.** Phase 1: Reproduced on 1.27.0: `decayForDoc` on one doc, 40 ms apart, gives 0.7348984551199071 and then 0.7348984544253394.
