---
title: A candidate pool sized by limit makes ranking depend on limit
tier: fact
domains:
  - troubleshooting
status: active
last_updated: '2026-11-09'
id: a-candidate-pool-sized-by-limit-makes-ranking-depend-on-limit
confidence: high
last_verified: '2026-11-09'
verify_command: >
  cd "$(git rev-parse --show-toplevel)" && npx vitest run test/retrieval-eval/limit-stable.test.ts
provenance:
  - issue #85, src/core/bm25.ts (v1.27.0 development)
sources:
  - src/core/bm25.ts
  - src/mcp/tools/search.ts
  - test/retrieval-eval/limit-stable.test.ts
tags:
  - gotcha
  - limit
  - candidate-pool
  - hybrid
  - same query returns different results at different limit
---

# A candidate pool sized by limit makes ranking depend on limit

## Claim
Fetching `limit * 3` candidates from each arm means a doc inside one arm's pool but outside the other's gets 0 for the missing part, and the fused and coverage scores change with `limit`. Before v1.27, 10 of 10 queries on this repo's `.documentation` broke the prefix rule (`search(q, k)` is not the first k of `search(q, K)`), and 2 changed the #1 answer.

## Instead
Use a pool that does not move with `limit`: `candidatePool(limit) = max(24, limit * 3)` in `src/core/bm25.ts`, so limits 1-8 rank like limit 8. Guard it with a prefix test (`limit-stable.test.ts`). The guarantee stops at 8: above that the pool grows. A bigger fixed pool raised dominance (a broad doc taking top-3 slots) in the eval, so it needs a coverage-boost fix first.

## How to verify
`npx vitest run test/retrieval-eval/limit-stable.test.ts`.

## Consequences
The MCP default `limit` is 10, so a call without `limit` is not a prefix of `limit: 5`.
