---
title: A fused score gives the whole lexical share to the doc that is lexically best on one clause
tier: fact
domains:
  - troubleshooting
status: active
last_updated: '2026-11-14'
id: a-fused-score-gives-the-whole-lexical-share-to-one-clause-match
confidence: high
last_verified: '2026-11-14'
verify_command: >
  cd "$(git rev-parse --show-toplevel)" && npx vitest run test/unit/bm25.test.ts -t "fuseScores"
provenance:
  - issue #91 part 2, src/core/bm25.ts (v1.31.1 development)
sources:
  - src/core/bm25.ts
  - test/retrieval-eval/two-part-fixture.test.ts
tags:
  - gotcha
  - fusion
  - hybrid
  - two-part questions
---

# A fused score gives the whole lexical share to the doc that is lexically best on one clause

## Claim
Fusion scores a doc as `w*cosine + (1-w)*bm25/max(bm25)`. The doc with the best BM25 on this query gets the full lexical share even when it matches only one clause of a two-part question, so it can outrank the doc that holds the whole answer (the #91 repro: whole-answer doc at #2).

## Instead
`ranking.lexical_agreement` scales the BM25 share by `min(1, cosine/best cosine)^p`. At p=0.4 it fixed the repro but failed the held-out gate (no-export hybrid @1 89 vs 91, export dominance 28 vs 26), so it ships off (default 0). Measure it on your own train split before enabling; do not tune on held-out.

## How to verify
`test/retrieval-eval/two-part-fixture.test.ts` runs the repro with the setting on; `test/unit/rank.test.ts` pins the default 0.

## Consequences
Default ranking is unchanged in 1.31.1. The effective exponent window is narrow (0.4 to 0.45 on train).
