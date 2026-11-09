---
title: The in-repo real-corpus eval copies only .documentation, so code-dependent ranking is never exercised
tier: fact
domains:
  - testing
status: active
last_updated: '2026-11-08'
id: real-corpus-eval-never-exercises-code-ranking
confidence: high
last_verified: '2026-11-08'
verify_command: >
  cd "$(git rev-parse --show-toplevel)" && grep -n "documentation" scripts/retrieval-eval/real-corpus.mjs | head -3
provenance:
  - v1.21.0 #71 work: the loss reproduced only on clones with code and history
sources:
  - scripts/retrieval-eval/real-corpus.mjs
  - scripts/eval-against-release.sh
tags:
  - gotcha
  - eval
  - grounding
invalidated_by:
  - the real-corpus eval starts running on a clone with code
---

# The in-repo real-corpus eval copies only .documentation, so code-dependent ranking is never exercised

## Claim
`npm run eval` on the real corpus indexes a copy of `.documentation` with no code or git history, so grounding (dead refs, drift), entity cards and the code graph never run there. A ranking change that touches them can pass every floor and still move #1 (1.16 and 1.17 did).

## Instead
Measure on a clone with code: `scripts/eval-against-release.sh --set <file> <old-version> local`, and run `npm run gate:release` before publishing.

## How to verify
The eval output for the real-corpus split shows no `grounding` blocks; the clone-based run does.
