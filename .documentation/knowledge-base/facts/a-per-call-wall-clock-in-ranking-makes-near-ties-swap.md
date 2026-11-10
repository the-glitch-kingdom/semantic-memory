---
title: A per-call wall clock in a ranking input makes near-tied docs swap between calls
tier: fact
domains:
  - troubleshooting
status: active
last_updated: '2026-11-10'
id: a-per-call-wall-clock-in-ranking-makes-near-ties-swap
confidence: high
last_verified: '2026-11-10'
verify_command: >
  cd "$(git rev-parse --show-toplevel)" && npx vitest run test/unit/decay.test.ts test/retrieval-eval/decay-clock.test.ts
provenance:
  - issue #88, src/core/decay.ts (v1.27.1)
sources:
  - src/core/decay.ts
  - test/unit/decay.test.ts
  - test/retrieval-eval/decay-clock.test.ts
tags:
  - gotcha
  - decay
  - clock
  - determinism
  - same query returns different order
---

# A per-call wall clock in a ranking input makes near-tied docs swap between calls

## Claim
Decay read `Date.now()` per call, so a multiplier moved in the 10th decimal between two calls 40 ms apart (0.7348984551 then 0.7348984544). Docs tied closer than that swapped rank between calls, limits and builds, even with exact search and a fixed build order (1 of 59 questions on 1.27.0).

## Instead
Quantize the clock and keep it injectable: `decayClock()` is the end of the current UTC day, passed as the default `nowMs`. Use the end, not the start of the day: age 0 reads as missing or future. Pin it with a same-query-twice test under fake timers (`decay-clock.test.ts`).

## How to verify
`npx vitest run test/unit/decay.test.ts test/retrieval-eval/decay-clock.test.ts`.

## Consequences
A score is fixed for a UTC day and steps once at midnight. A search straddling midnight can see a one-day step (about 0.2%).
