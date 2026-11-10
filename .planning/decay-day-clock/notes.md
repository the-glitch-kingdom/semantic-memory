# Notes: decay day clock (#88)

## Cause (verified on main f6d80a4, 1.27.0)
- `src/core/decay.ts:140`: `const now = input.nowMs ?? Date.now();`, and the same at `:229` (`ageDaysOf`).
- `decayForDoc` (`src/core/decay.ts:196`) calls `computeDecay({...})` without `nowMs`.
- Callers: `src/mcp/context.ts:660` (applyDecay, MCP) and `src/cli/search.ts:145` (CLI).
- `healthcheck.ts` and `lint.ts` pass their own `nowMs`.

## Reproduction
`decayForDoc({ frontmatter: { last_verified: "2026-06-01" } }, defaults)`, called twice 40 ms apart: 0.7348984551199071, then 0.7348984544253394.

The reporter (1.27.0, 4 cold builds, 59 questions): 1 question swaps ranks 4 and 5 across builds, and breaks the prefix rule (limit 5 vs 8) within one build. Their selection log shows the top score differing in the 10th decimal between two calls 39 ms apart.

## Trap
`computeDecay` uses `!(ageDays > 0)` for missing or future dates. A clock pinned to the start of the UTC day gives a doc verified today (date-only = midnight UTC) an age of exactly 0, so it would be penalised. Use the end of the day.

## Reporter's 1.27.0 numbers (for the changelog)
- #1 by limit, of 59: tree A 50 at limits 1/3/5/8, then 49, 48 (1.26.0: 43/49/49/49/48/47); tree B 49 at limits 1–8, then 48, 47 (1.26.0: 42/46/46/48/47/45).
- Set A+B @1 0.72 → 0.75, @3 0.86 → 0.89.

## Eval results: Phase 2
No ranking numbers (tests only). Un-`fails`-ed, all four cases fail on 1.27.0 by sub-1e-9 score drift 40 ms apart (e.g. 0.4683146373095556 vs 0.4683146368978217 for search_hybrid and CLI; unit 0.9278793492164188 vs 0.9278793500321937).
The unit near-tie case shows score drift but the order did not flip with my guessed base ratio; it still pins score equality. The eval file covers search_hybrid and CLI (not search_semantic), limit 5 vs 8 scores.

## Eval results: Phase 3
No ranking numbers. The 4 Phase 2 cases are plain `it` and pass; added unit cases for end-of-day clock, verified-today not penalised, future date, one-day step across midnight UTC.

## Eval results: Phase 4 (branch with the day clock; raw: `branch-phase4.json`; scripts `measure-limits.test.ts`, `repeat.test.ts` in this folder)
- #1 answers at limits 1/3/5/8/10/20: real-train 21, real-heldout 18, hub-train 6, hub-heldout 6 at every limit; 0 questions change #1 across limits 3-10. Identical to 1.27.0 (limit-stable-ranking Phase 6/release review).
- Eval metrics at limit 8 (all @1/@3/@8) identical to 1.27.0: 21/27/27, 18/25/26, 6/10/11, 6/9/10. p95@8 22/14/21/33 ms (one noisy pass, no threshold).
- Build twice on `.documentation` (98 answerable real-set questions, limit 8): search_hybrid and search_semantic 0 differing top-8, 0 differing #1, max score gap 0. The same query 20 times in one process (10 queries, search_hybrid): 0 non-identical results (paths and scores).
- `BAND=1 npm run gate:release` (fresh, no --cache, 1.27.0 package.json vs 1.26.0): PASS. No export: hyb@1 73 vs 73, multi 10/17/21 vs 10/17/21, cov@3 .776 vs .776, dominance 36 vs 35, negatives 43/43, false flags 7/7, mcp vs cli 0 of 166, titled 119/119. Export: 78/78, multi same, dominance 25 vs 25. p95 mcp 26 vs 15 ms (one run, gate has no p95 threshold; cli 14 vs 15, mcp-slow 14 vs 14).
- Note: the gate compares against 1.26.0 because package.json is still 1.27.0; Phase 5 bumps to 1.27.1 and the gate will then pick 1.27.0 (rerun in Phase 7).

## Eval results: Phase 5
No ranking change: version bump (package.json, lockfile, both marketplace.json fields, plugin.json, AGENTS.md frontmatter) and KB fact `exact-vector-search-must-return-k-chunks-not-k-docs`. `hewtd maintain --quick` reports 10 errors / 117 warnings, identical to before the change.

## Eval results: Phase 7
Fresh `npm run gate:release` vs 1.27.0: PASS (0 of 166 mcp/cli differences, titled #1 119/119). Added a decayForDoc test for evergreen, per_type null and git/mtime fallbacks. healthcheck.ts does not use decay; lint.ts passes its own nowMs to computeDecay (unchanged). Eval: 174 passed + 3 expected fail, plus real-corpus-eval passing alone (16 + 1 expected fail).

## Eval results: Phase 8
Docs only. Updated `operational/decay-guide.md`, added `changelog/v1-27-1-decay-day-clock.md`, KB fact `a-per-call-wall-clock-in-ranking-makes-near-ties-swap`, CHANGELOG 1.27.1; AGENTS.md regenerated from branch code (only the timestamp changed). `hewtd maintain --quick`: 10 errors, 120 warnings (117 before; the 3 extra are on the new docs/decay-guide, same class as existing warnings).
