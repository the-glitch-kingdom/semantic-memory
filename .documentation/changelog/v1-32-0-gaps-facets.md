---
title: v1.32.0 - gaps facets
tier: reference
domains:
  - changelog
audience:
  - developers
  - admin
tags:
  - v1.32.0
  - eval
  - gaps
status: active
last_updated: '2026-11-14'
version: 1.32.0
purpose: What v1.32.0 changed (richer eval --gaps-out, nearest-doc diagnosis lines, code-line facet warning) for issue #101.
load_priority: 5
estimated_read_time: 2 minutes
backlinks: []
sources:
  - src/core/retrieval-eval/report.ts
  - src/core/retrieval-eval/metrics.ts
  - src/cli/retrieval-eval.ts
---

# v1.32.0 - gaps facets

Issue #101. Fact: [facets copied from code lines](../knowledge-base/facts/facets-copied-from-code-lines-score-every-blind-question-as-coverage.md).

## What changed

- **`--gaps-out`** entries add `id`, `tier`, `blind`, `facets`, `missing_facets`, `nearest_doc` `{path, facet_coverage, rank}` and `expected` to the five gaps.v1 fields. A topic-absent entry omits `nearest_doc`. See the [eval guide](../operational/retrieval-eval-guide.md).
- **Diagnosis**: coverage lines end with `nearest: <path> k/n` or `nearest: none` (extend that doc, or write a new one).
- **Warning**: one stderr line per missing facet that looks like a code line (`isCodeLineFacet`, copied from hewtd's `is_code_line_facet`); labels and stdout are unchanged.
- Facet-shape rule in `BLIND-SETS.md` and `docs/measure-and-tune.md`.

## Measurements

No ranking change: a fresh `BAND=1 gate-release.sh 1.31.1` passes with identical counts (hybrid @1 91/139, multi @1/3/8 20/28/31 of 41). In #101 the same 25 questions gave 25/25 coverage with code-line facets, against 11 coverage, 6 ranking, 3 grounding and 5 answered with prose facets.
