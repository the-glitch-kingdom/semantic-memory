---
title: hnswlib ef defaults to 10, so searchKnn recall drops without setEf
tier: fact
domains:
  - troubleshooting
status: active
last_updated: '2026-11-06'
id: hnswlib-ef-defaults-to-10
confidence: high
last_verified: '2026-11-06'
verify_command: >
  cd "$(git rev-parse --show-toplevel)" && npx vitest run test/unit/vector-ef.test.ts
provenance:
  - issue #43, src/core/vector.ts (v1.9.1 development)
sources:
  - src/core/vector.ts
  - test/unit/vector-ef.test.ts
tags:
  - gotcha
  - hnsw
  - recall
  - vector search misses the right chunk
---

# hnswlib ef defaults to 10, so searchKnn recall drops without setEf

## Claim
hnswlib-node's query-time `ef` defaults to 10. `searchKnn(q, k)` with k above 10 then returns a poor approximation of the true top k. On this repo's `.documentation/` (268 chunks) recall@24 against exact cosine was 0.929 at the default and 0.999 with `ef = max(100, k)`; on 2,764 test-vault vectors it was 0.935 at the default, 0.988 at ef 100. `ef` is not stored in `hnsw.bin`, so a loaded or grown index is back at 10.

## Instead
Call `setEf(Math.max(100, k))` before every `searchKnn`. `VectorIndex.search` does it on each call, which covers a fresh build, `addChunks` growth, `resizeIndex` and a loaded index with one call site. Do not set it once after `initIndex` or `readIndexSync`.

## How to verify
`test/unit/vector-ef.test.ts` asserts the raised ef after load and after incremental growth. The retrieval eval gates HNSW recall@k >= 0.97 vs exact cosine (`npm run eval`).

## Consequences
Before v1.9.1 a correct chunk could be missing from the vector arm entirely, which showed up as hybrid ranking worse than expected.
