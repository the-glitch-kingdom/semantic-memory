---
title: Facets copied from code lines score every blind question as a coverage miss
tier: fact
domains:
  - troubleshooting
status: active
last_updated: '2026-11-14'
id: facets-copied-from-code-lines-score-every-blind-question-as-coverage
confidence: high
last_verified: '2026-11-14'
verify_command: >
  cd "$(git rev-parse --show-toplevel)" && npx vitest run test/retrieval-eval/gaps-facets.test.ts
provenance:
  - issue #101, docs/measure-and-tune.md (v1.32.0)
sources:
  - src/core/retrieval-eval/metrics.ts
  - docs/measure-and-tune.md
tags:
  - gotcha
  - eval
  - facets
---

# Facets copied from code lines score every blind question as a coverage miss

## Claim
A facet regex copied verbatim from a line of code (`class Foo:`, `x = 1`, a line ending in `;`) matches no prose doc, because prose never quotes the line. Every blind question using such facets is labelled coverage, whatever the docs say. In #101 the same 25 questions gave 25/25 coverage with code-line facets and 11 coverage, 6 ranking, 3 grounding and 5 answered with prose facets.

## Instead
Write one fact per facet, in words the answering doc would use, tolerant of prose phrasing. The eval warns on stderr for each code-line facet.

## How to verify
`npx vitest run test/retrieval-eval/gaps-facets.test.ts`.

## Consequences
Diagnosis and `--gaps-out` are only as good as the facets; `/reconcile --gaps` proposes docs for questions that were already answered.
