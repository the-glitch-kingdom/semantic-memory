---
title: Rank-only RRF at k=60 lets a weak second arm displace a strong #1
tier: fact
domains:
  - troubleshooting
status: active
last_updated: '2026-11-06'
id: rank-only-rrf-lets-a-weak-arm-displace-a-strong-first
confidence: high
last_verified: '2026-11-06'
verify_command: >
  cd "$(git rev-parse --show-toplevel)" && npx vitest run test/unit/confidence.test.ts -t "fuseScores"
provenance:
  - issue #43, src/core/bm25.ts (v1.9.1 development)
sources:
  - src/core/bm25.ts
  - test/unit/confidence.test.ts
tags:
  - gotcha
  - rrf
  - fusion
  - hybrid
  - search_hybrid ranks worse than search_semantic
---

# Rank-only RRF at k=60 lets a weak second arm displace a strong #1

## Claim
Reciprocal rank fusion scores `1/(60+rank)` per arm and ignores the scores. With k=60 the gap between rank 1 and rank 3 is tiny, so a doc that is a clear cosine #1 but only mid-list in BM25 can lose to a doc that is mid-list in both. On the fixture held-out set hybrid was 4 answers below vector-only at @1 (13 vs 17).

## Instead
Fuse scores, not ranks: per doc, `0.7 * cosine + 0.3 * bm25 / max(bm25)` using the best chunk, then the boosts; with no BM25 hits, keep the cosine order. `fuseScores` in `src/core/bm25.ts`. Compare hybrid with semantic on the same split in the eval before trusting any fusion change.

## How to verify
`confidence.test.ts` covers `fuseScores`; `docs-eval.test.ts` gates hybrid @1 >= semantic @1 - 1 per split.

## Consequences
Score fusion lifted the real train split from 13 to 17 at @1 but did not close the fixture held-out gap (still 13 vs 17); see the v1.9.1 changelog.
