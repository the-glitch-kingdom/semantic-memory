---
title: v1.31.0 - operating targets
tier: reference
domains:
  - changelog
audience:
  - developers
  - admin
tags:
  - v1.31.0
  - eval
  - targets
  - blind-set
status: active
last_updated: '2026-11-14'
version: 1.31.0
purpose: What v1.31.0 added (targets file, eval init, blind sets, diagnosis, --gaps-out, the optimize-search skill and the measure-and-tune guide) and the measurements behind it.
load_priority: 5
estimated_read_time: 2 minutes
backlinks: []
sources:
  - src/core/retrieval-eval/targets.ts
  - src/core/retrieval-eval/report.ts
  - src/cli/retrieval-eval.ts
  - skills/optimize-search/SKILL.md
  - docs/measure-and-tune.md
---

# v1.31.0 - operating targets

Issue #96. Fact: [a-blind-set-stops-being-blind-once-its-misses-are-fixed](../knowledge-base/facts/a-blind-set-stops-being-blind-once-its-misses-are-fixed.md).

## What changed

- **`eval init`** writes `targets.json`, `BLIND-SETS.md` and a question template into the eval dir; `eval` writes default targets when the file is missing.
- **Targets table** in the report: `all` and `blind` columns, `met` judged on blind cases, `not validated` with none, and a `1/n` noise line.
- **Diagnosis**: each miss is `coverage`, `ranking` or `grounding`, with the grep oracle's result. `--no-oracle` skips it; `--gaps-out <file>` writes coverage misses as `gaps.v1` for `hewtd reconcile --gaps`.
- **Blind cases** whose facet matches no doc count as coverage misses (non-blind cases unchanged). `eval generate` writes `blind: false`.
- **`optimize-search` skill** (`skills/optimize-search/SKILL.md`) and the shipped guide [docs/measure-and-tune.md](../../docs/measure-and-tune.md); help topics `eval` and `optimize-search`.

## Measurements

`gate:release` against 1.30.1: every count identical (hybrid @1 91/139, multi @1/3/8 20/28/31 of 41, negatives flagged 43/47, false flags 7, cli vs mcp differ on 0 of 186). No ranking change. `--json` gains `targets` and `diagnosis` keys; MCP response shapes are unchanged.
