---
title: v1.18.0 - query routing
tier: reference
domains:
  - changelog
audience:
  - developers
  - admin
tags:
  - v1.18.0
  - query-routing
  - reading-path
  - issue-61
status: active
last_updated: '2026-11-08'
version: 1.18.0
purpose: What v1.18.0 changed (issue 61), the measured results against v1.17.0,
  and the targets that were missed.
load_priority: 5
estimated_read_time: 3 minutes
sources:
  - src/core/query-type.ts
  - src/core/reading-path.ts
  - src/core/graph.ts
  - src/mcp/tools/search.ts
  - test/fixtures/code-graph-vault/.hewtd/graph.json
  - package.json
word_count: 525
last_validated: '2026-11-08'
backlinks: []
---

# v1.18.0 - query routing

Issue #61. A query is labelled `identifier`, `fact` or `flow`; a flow question gets an ordered `reading_path` on result #1. The ranked list is never reordered.

## What changed

- **Classifier** (`src/core/query-type.ts`): rules only. Identifier = the shared `identifiers()` detector (#57), PascalCase of 3+ words, `--flag`, `name()`. Flow = end to end, walk through, step by step, lifecycle, whole life, journey, big picture, one-page summary, overview of, fit together, flow, "from X to Y". Else fact.
- **`mode`** on `search_hybrid`: `auto` (default), `identifier`, `fact`, `flow` forces the label. `query_type` rides on result #1 and in the search usage event.
- **Walk** (`GraphBuilder.walk`): personalized PageRank, restart 0.15, subgraph grown breadth-first to 300 nodes, 20 steps, nodes with more than 50 edges skipped (seeds exempt). Code and symbol nodes carry the walk but are never returned. No new dependency.
- **`reading_path`** (`src/core/reading-path.ts`) on result #1 when the type is flow: up to 5 steps `{ path, title, section, via }`, seeded by the top 5 hits above the 0.36 weak-match line, ranked by PPR x (1 + hybrid score), a `kind: overview` doc first, then its link order. Members obey the status, tier, domain and date filters; folded copies are excluded. Works without `.hewtd/graph.json`.
- `content[0]` stays a plain JSON array.

## Measured

Against v1.17.0 code measured in the same run (`npm run eval`, search_hybrid). Fact-tier @1 is unchanged on every split because nothing is reordered: fixture-train 37/45, fixture-held-out 22/29, real-train 14/18, real-held-out 14/21.

Multi tier, `#1 + path` against the target max(`#1 + related`, @3):

| split | @3 | #1+related | shipped (auto) | forced flow | forced vs target |
|---|---|---|---|---|---|
| fixture-train | 10/12 | 8/12 | 5/12 | 11/12 | met |
| fixture-held-out | 5/7 | 4/7 | 2/7 | 5/7 | met |
| real-train | 8/9 | 8/9 | 8/9 | 9/9 | met |
| real-held-out | 5/6 | 6/6 | 4/6 | 6/6 | met |

Classifier accuracy: fixture 75/77 train and 50/52 held-out, real 47/47 and 41/43, code 8/10 and 9/10. Latency (p95): 7.8 ms fixture, 16.4 ms real with the path on every call (target 100 ms); p50 +0.6 ms fixture and +6 ms real when the path runs. Payload +0.8 kB (fixture) to +1.2 kB (real) per path. Walk on 5k nodes and 50k edges under 10 ms.

## Missed targets

- **The multi-tier target is not met as shipped.** Most multi questions are two facts joined by "and" and classify as fact, so they get no path (shipped #1+path: 5/12, 2/7, 8/9, 4/6). The gate passes only with `mode: "flow"` forced. `related` still rides on those questions.
- Flow is rare in our sets (11 of 229 docs rows), so flow recall is tested on about 8 rows. The plan's "two wh-clauses joined by and" rule was dropped: on train it caught 2 flows and mislabelled 14 two-fact questions.
- Code-train accuracy sits at the 0.8 floor: kebab-case and "tool subcommand" identifiers are misses (#57 excludes kebab on purpose).
- No fixture doc has `kind: overview`, so overview-first is covered by a unit test only.
- Real-corpus numbers vary by about one case per run.
- The offline tarball is built at release, not on this branch.
