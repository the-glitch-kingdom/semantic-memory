---
title: v1.13.0 - built-in retrieval eval
tier: reference
domains:
  - changelog
audience:
  - developers
  - admin
tags:
  - v1.13.0
  - eval
  - baseline
  - issue-56
status: active
last_updated: '2026-11-07'
version: 1.13.0
purpose: What v1.13.0 changed (issue 56), the measured acceptance results, and
  the targets that were missed.
load_priority: 5
estimated_read_time: 2 minutes
word_count: 276
last_validated: '2026-11-08'
backlinks: []
---

# v1.13.0 - built-in retrieval eval

Issue #56. Guide: [retrieval eval guide](../operational/retrieval-eval-guide.md). Flags: [CLI reference](../reference/cli-reference.md).

## What changed

- The eval engine moved from `test/retrieval-eval/` to `src/core/retrieval-eval/`; `npm run eval` and the shipped command share it. No existing number changed.
- `semantic-memory eval --notes <dir>` measures hybrid, semantic, text and grep arms on your vault: @1/@3/@8, found@k, MRR, p50/p95, tiers, negatives per kind, all versus clean. It is side-effect free (`ServerOptions.telemetry: false`, read-only server, meta.json settings).
- `--baseline` / `--check` / `--band` floors with a noise band (default 1 question).
- `semantic-memory eval generate` writes blind, validated questions with the host agent.
- Fixed in review: `--baseline --check` in one run overwrote the floor before checking; it is now refused.
- `enablePositionalOptions()` on the root program: a future root-level option must precede the subcommand.

## Measured (acceptance of #56)

- Fixture, 40-case set: about 1-2 s warm (asserted under 120 s).
- Real corpus (`.documentation/` copy, git history seeded), held-out 27 answerable: hybrid @1/@3/@8 17/24/26, semantic 12/16/24. A swapped-arm floor fails `--check` (exit 1, 10 flipped questions); the unchanged control exits 0.
- CLI against `real-corpus-eval.test.ts`: all within one question (train hybrid 21/25/27 both; held-out hybrid 17/24/26 vs 17/25/26).

## Missed targets

- The external blind-kit run was not done (no set available).
- Generation quality with a real `claude` is unmeasured; the validation thresholds are untuned guesses.
- The offline tarball is 922 MB against the roughly 0.55 GB norm (a cached-model dir of several GB is suspected) and was built from the pre-bump commit; check before publishing.
- Opening the server for eval can still update the index for notes edited since the last index.
- The default eval dir is gitignored, so floors there are not shared.
