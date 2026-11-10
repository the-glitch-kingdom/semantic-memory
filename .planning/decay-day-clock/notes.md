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
