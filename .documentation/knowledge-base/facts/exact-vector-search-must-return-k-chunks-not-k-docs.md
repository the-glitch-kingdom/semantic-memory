---
title: Exact vector search must return the k nearest chunks, not k docs
tier: fact
domains:
  - troubleshooting
  - testing
status: active
last_updated: '2026-11-09'
purpose: Why does the exact (brute-force) vector search cut to k chunks before grouping by doc, and what breaks if it returns k docs?
symptoms:
  - dominance rises after switching vector search from HNSW to exact
  - one broad doc such as troubleshooting.md takes more top-3 slots on questions it does not answer
id: exact-vector-search-must-return-k-chunks-not-k-docs
confidence: high
last_verified: '2026-11-09'
verify_command: >
  cd "$(git rev-parse --show-toplevel)" && npx vitest run test/unit/vector-exact.test.ts
provenance:
  - issue #85, fixed in 4cccce1 (v1.27.0 development)
sources:
  - src/core/vector.ts
  - test/unit/vector-exact.test.ts
tags:
  - gotcha
  - vector
  - exact-search
  - ranking
invalidated_by:
  - the vector arm returns docs instead of chunks to fusion
---

# Exact vector search must return the k nearest chunks, not k docs

## Claim
HNSW `knn(k)` returns the k nearest chunks, which group into at most k docs. The exact path in `src/core/vector.ts` first returned k docs (keeping every chunk until k distinct docs were found). That hands fusion a wider candidate pool than HNSW did, and broad docs reach the vector arm more often. Dominance (top-3 slots one doc takes on questions it does not answer) rose to 39 against 35 on the gate sets.

## Instead
Sort chunks by cosine (ties by doc path, then label), truncate to k chunks, then group by doc. `test/unit/vector-exact.test.ts` pins it.

## How to verify
`src/core/vector.ts` has a comment at the truncation ("k nearest chunks, as HNSW's knn returns"). Run the unit test above.

## Consequences
Any change to the exact path that widens the pool changes ranking and the dominance gate, even though it looks like a pure accuracy gain.

## See also
- [a-candidate-pool-sized-by-limit-makes-ranking-depend-on-limit](a-candidate-pool-sized-by-limit-makes-ranking-depend-on-limit.md)
