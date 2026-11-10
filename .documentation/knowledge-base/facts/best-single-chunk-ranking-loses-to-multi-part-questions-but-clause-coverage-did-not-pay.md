---
title: Best-single-chunk ranking loses to multi-part questions, but per-clause matching did not pay off in the eval
tier: fact
domains:
  - troubleshooting
status: active
last_updated: '2026-11-10'
id: best-single-chunk-ranking-loses-to-multi-part-questions-but-clause-coverage-did-not-pay
confidence: medium
last_verified: '2026-11-10'
verify_command: >
  cd "$(git rev-parse --show-toplevel)" && npx vitest run test/unit/rank.test.ts test/retrieval-eval/multi-clause.test.ts
provenance:
  - issue #91 part 2, src/core/rank.ts (v1.28.0, ships off)
sources:
  - src/core/rank.ts
  - src/core/vector.ts
  - test/retrieval-eval/multi-clause.test.ts
tags:
  - gotcha
  - ranking
  - multi-part
  - measured negative
---

# Best-single-chunk ranking loses to multi-part questions, but per-clause matching did not pay off in the eval

## Claim
A doc scores by its best single chunk, so a doc covering both halves of "A and B" in two chunks can lose to a doc matching one half strongly. Per-clause matching (`ranking.clause_weight`) fixes the multi-clause fixture, but at weight 1 it lost held-out cases against 1.27.1 (no-export hybrid @1 72 vs 73; export 76 vs 78) and cost 2 real-corpus @3 cases on train. It ships off (`0`).

## Instead
Do not turn it on from the fixture alone. Gate it on held-out sets from real multi-part questions; an anonymised repro from the reporter would show whether the real failure is the one the fixture models.

## How to verify
`npx vitest run test/unit/rank.test.ts test/retrieval-eval/multi-clause.test.ts` (the two-part tests are `it.fails` while the weight is 0).

## Consequences
#91 stays open for part 2. If the default turns on, the two `it.fails` start passing and must become plain `it`.
