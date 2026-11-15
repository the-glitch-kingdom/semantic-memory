---
title: v1.31.1 - two-part questions and bare refs
tier: reference
domains:
  - changelog
audience:
  - developers
  - admin
tags:
  - v1.31.1
  - ranking
  - code-graph
status: active
last_updated: '2026-11-14'
version: 1.31.1
purpose: What v1.31.1 changed (opt-in ranking.lexical_agreement for #91 part 2, bare-filename refs in the stale re-check for #98) and the measurements behind the opt-in decision.
load_priority: 5
estimated_read_time: 2 minutes
backlinks: []
sources:
  - src/core/bm25.ts
  - src/core/code-graph.ts
  - src/core/rank.ts
---

# v1.31.1 - two-part questions and bare refs

Issues #91 (part 2) and #98. Fact: [a-fused-score-gives-the-whole-lexical-share-to-one-clause-match](../knowledge-base/facts/a-fused-score-gives-the-whole-lexical-share-to-one-clause-match.md).

## What changed

- **`ranking.lexical_agreement`** (default 0, off). A doc's BM25 share in `fuseScores` is multiplied by `min(1, cosine / best cosine) ^ lexical_agreement`. See the [tuning guide](../operational/retrieval-tuning-guide.md).
- **#98**: `patchStale` resolves a bare filename ref by basename (one basename map from the export's files plus the changed set, no extra git call). A bare ref is re-checked when a file with that name changed; it is live if any such file exists. See [code-graph](../architecture/code-graph.md).
- `fuseScores` clamps the agreement ratio at 0 (a negative cosine gave NaN).

## Measurements

Candidate chosen on train only (exponent 0.4; window 0.4 to 0.45). On `test/fixtures/two-part`, hybrid @1 goes 0/2 to 1/2 with it on. Fresh `BAND=1 gate-release.sh 1.31.0` with it on failed: no-export hybrid @1 89 vs 91, export dominance 28 vs 26; gains were multi @8 +1 and export hybrid @3 +2. So it ships off. With it off, `gate:release` against 1.31.0 passes and cli and mcp agree. Code-load cost on a 1,000-file repo 100 commits behind is within noise (24 and 25 ms vs 20 and 27 ms).
