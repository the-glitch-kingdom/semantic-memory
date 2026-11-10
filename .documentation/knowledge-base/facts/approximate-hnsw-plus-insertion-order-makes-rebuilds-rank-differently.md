---
title: Approximate HNSW plus insertion order makes rebuilds rank differently
tier: fact
domains:
  - troubleshooting
status: active
last_updated: '2026-11-09'
id: approximate-hnsw-plus-insertion-order-makes-rebuilds-rank-differently
confidence: high
last_verified: '2026-11-09'
verify_command: >
  cd "$(git rev-parse --show-toplevel)" && npx vitest run test/retrieval-eval/reproducible-build.test.ts test/unit/reconcile-order.test.ts
provenance:
  - issue #85 second comment, src/core/vector.ts and src/core/reconcile.ts (v1.27.0 development)
sources:
  - src/core/vector.ts
  - src/core/reconcile.ts
  - test/retrieval-eval/reproducible-build.test.ts
  - test/unit/reconcile-order.test.ts
tags:
  - gotcha
  - hnsw
  - reproducibility
  - two builds rank differently
---

# Approximate HNSW plus insertion order makes rebuilds rank differently

## Claim
HNSW is deterministic but order-sensitive: the same embeddings inserted in a different order gave 337 of 353 queries with a different top 8. `reconcile` filled its parse list in file stat/read completion order, so the insertion order followed I/O timing and two builds of identical files ranked differently. The embeddings were identical (max abs difference 0 on one machine).

## Instead
Exact search for typical vault sizes: `VectorIndex.search` brute-forces cosine at or below `EXACT_MAX_VECTORS` (100,000 live chunks), ties by path then label. Sort the parse list in `reconcile` so HNSW above 100k is reproducible too. Add a build-twice test.

## How to verify
`npx vitest run test/retrieval-eval/reproducible-build.test.ts test/unit/reconcile-order.test.ts`.

## Consequences
Across different CPUs, batched ONNX output is not bit-exact, so compare scores with a tolerance. Exact search changed ranking against 1.26.0 (a broad doc reaches the vector arm's top-k more often), see the v1.27.0 changelog.
