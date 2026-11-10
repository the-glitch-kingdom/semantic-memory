---
title: v1.27.1 - decay day clock
tier: reference
domains:
  - changelog
audience:
  - developers
  - admin
tags:
  - v1.27.1
  - ranking
  - decay
  - issue-88
status: active
last_updated: '2026-11-10'
version: 1.27.1
purpose: What v1.27.1 changed about the decay clock, why near-tied notes no
  longer swap between calls, and the measured effect.
load_priority: 5
estimated_read_time: 2 minutes
backlinks: []
sources:
  - src/core/decay.ts
  - test/unit/decay.test.ts
  - test/retrieval-eval/decay-clock.test.ts
  - package.json
word_count: 222
last_validated: '2026-11-10'
---

# v1.27.1 - decay day clock

Issue #88. A patch on 1.27.0.

## Cause

`decayForDoc` never passed `nowMs`, so `computeDecay` read `Date.now()` in milliseconds. A note's multiplier moved in the 10th decimal between calls (0.7348984551 then 0.7348984544, 40 ms apart). Two near-tied notes could swap between calls, limits and builds, which broke the 1.27.0 prefix and rebuild guarantees on rare questions (1 of 59 for the reporter).

## Change

`decayForDoc(doc, config, nowMs = decayClock())`. `decayClock()` is the end of the current UTC day, so every age in a day is measured from one instant. The end, not the start, because `computeDecay` treats an age of 0 or less as missing or future: a note verified today (date-only means midnight UTC) must keep a positive age. `nowMs` stays injectable. MCP `search_*` and CLI `search` share the default. `lint` and `healthcheck` keep their own clocks.

Accepted edge: a search that straddles UTC midnight can use two clocks, a one-day step of decay (about 0.2% at a 365-day half-life).

## Measured (against 1.27.0)

- `gate:release` passes: every count is identical, and mcp vs cli differ on 0 of 166 questions.
- #1 answers and all @1/@3/@8 metrics are identical to 1.27.0 on the real and hub sets; two builds of `.documentation` give 0 differing top-8; the same query 20 times in one process gives identical scores.
- Tests: `test/unit/decay.test.ts` (same multiplier 40 ms apart, verified today, future date, midnight step, fallbacks) and `test/retrieval-eval/decay-clock.test.ts`.
