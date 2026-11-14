---
title: A question set stops being blind once you fix the docs its misses land on
tier: fact
domains:
  - troubleshooting
status: active
last_updated: '2026-11-14'
id: a-blind-set-stops-being-blind-once-its-misses-are-fixed
confidence: high
last_verified: '2026-11-14'
verify_command: >
  cd "$(git rev-parse --show-toplevel)" && npx vitest run test/retrieval-eval/operating-targets.test.ts
provenance:
  - issue #96, docs/measure-and-tune.md (v1.31.0)
sources:
  - src/core/retrieval-eval/report.ts
  - docs/measure-and-tune.md
tags:
  - gotcha
  - eval
  - blind-set
  - overfitting
---

# A question set stops being blind once you fix the docs its misses land on

## Claim
On one real docs tree a reconcile pass lifted @1 on the set written from the docs from 0.64 to 0.91, while a blind set (written from outside the docs) moved from 0.27 to 0.30. Fixing a set's misses tunes the docs to that set, so the set no longer measures anything new.

## Instead
Write a fresh held-out blind set before any docs fix driven by an eval, and flip the old one to `"blind": false`. Judge targets only on blind cases (`met` does this) and treat a change of 1/n as noise.

## How to verify
`npx vitest run test/retrieval-eval/operating-targets.test.ts`.

## Consequences
Targets read `not validated` until a blind set exists. Each docs pass costs a new blind set.
