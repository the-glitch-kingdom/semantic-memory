---
title: Matching an identifier token by token credits docs that hold its words
  scattered
tier: fact
domains:
  - troubleshooting
status: active
last_updated: '2026-11-11'
purpose: Why did a doc that merely mentions "gate", "release" and "sh" rank as
  if it held `gate-release.sh`, and how should an identifier be matched?
symptoms:
  - a query for a file name such as gate-release.sh ranks a doc that never names
    the file above the docs that do
  - top-3 holds one identifier doc and two that only share prose words
id: matching-an-identifier-token-by-token-credits-scattered-words
confidence: high
last_verified: '2026-11-11'
verify_command: >
  cd "$(git rev-parse --show-toplevel)" && grep -n "docContains"
  src/core/bm25.ts src/core/identifiers.ts && npx vitest run
  test/unit/identifier-tier.test.ts
provenance:
  - v1.28.0 identifier tier (#91 part 1), measured top-3 all identifier docs 8/8
    on both sets against 0/8 on 1.27.1
sources:
  - src/core/identifiers.ts
  - src/core/bm25.ts
  - test/unit/identifier-tier.test.ts
  - scripts/gate-release.sh
tags:
  - gotcha
  - ranking
  - identifier
invalidated_by:
  - identifierTier stops using Bm25Index.docContains
audience:
  - all
version: 1.0.0
estimated_read_time: 1 minute
word_count: 138
last_validated: '2026-11-11'
backlinks: []
---

# Matching an identifier token by token credits docs that hold its words scattered

## Claim
Splitting an identifier into tokens and counting how many tokens a doc contains credits any doc that uses "gate", "release" and "sh" somewhere, in different sentences, as if it held `gate-release.sh`. Such a doc then ties with, or outranks, the docs that name the file.

## Instead
Match the name literally, case-insensitive, with `-` and `_` treated alike: `Bm25Index.docContains`. `gate-release.sh` is held as `gate-release`; `check_widgets.py` as `check_widgets` or `check-widgets`. Count only identifiers present in the corpus, so one that no doc holds changes nothing.

## How to verify
`npx vitest run test/unit/identifier-tier.test.ts` passes, and `identifierTier()` in `src/core/identifiers.ts` calls `docContains` rather than testing per-token document frequency.

## Consequences
A test that only checks "some doc ranks first" passes under the token-by-token rule. Assert that the top 3 are all docs that hold the literal name.

## See also
- [best-single-chunk-ranking-loses-to-multi-part-questions-but-clause-coverage-did-not-pay](best-single-chunk-ranking-loses-to-multi-part-questions-but-clause-coverage-did-not-pay.md)
