---
title: A readiness flag set before every score input lands makes the first answers rank differently
tier: fact
domains:
  - troubleshooting
status: active
last_updated: '2026-11-10'
id: a-ready-flag-set-before-every-scoring-input-lands-changes-first-answers
confidence: high
last_verified: '2026-11-10'
verify_command: >
  cd "$(git rev-parse --show-toplevel)" && npx vitest run test/integration/cold-build-ready.test.ts
provenance:
  - issue #90, src/mcp/context.ts (v1.28.0)
sources:
  - src/mcp/context.ts
  - test/integration/cold-build-ready.test.ts
tags:
  - gotcha
  - readiness
  - cold build
  - code graph
  - first answer differs
---

# A readiness flag set before every score input lands makes the first answers rank differently

## Claim
On a cold build the code graph loaded after the docs (#73) and fed grounding into ranking. The index was marked ready, and search tools answered, before grounding landed, so the first answers ranked differently from the same queries seconds later. The search tools gated on the vector index existing, not on `indexState`, so moving the flag alone did not help.

## Instead
Await every scoring input on the cold path before the index is visible: `fullIndex()` awaits the code load before saving and before `getVectorIndex()` returns anything (a `coldBuilding` flag). Keep warm swaps serve-then-stale. Test that the first real answer equals a later one (`cold-build-ready.test.ts`).

## How to verify
`npx vitest run test/integration/cold-build-ready.test.ts`. By hand, on a copy of `.documentation` with the index deleted: 0 of 10 queries differed between the first real answer and one 10 s later.

## Consequences
A cold build answers "Indexing in progress" for the `git log` time of the code load. Warm starts are unchanged.
