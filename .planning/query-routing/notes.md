# Notes: query-routing

## Verification against main @ 29e74db (2026-11-08, read-only agent)
- **"x1.3 graph boost lowered @1 and was removed in 1.11": true, and the effect was small.**
  - `src/core/graph-boost.ts` is gone (`.documentation/changelog/v1-11-0-boost-decay-fallback.md:36`).
  - Hybrid @1 at boost 1.0 vs 1.3 (fixture train / fixture held-out / real train / real held-out): 38/25/22/14 vs 39/22/21/13 (`retrieval-tuning-guide.md:140`).
  - Only the fixture held-out drop (3 cases) is beyond noise.
- **"#1 + related lifted multi-doc 0.49 to 0.77": true for v1.11 only.**
  - Re-run of the external kit's `graph_reach.py`: v1.11 multi @1 0.49, #1+related 0.77, @3 0.74. v1.12: multi @1 0.52, #1+related **0.69**, @3 **0.87**.
  - On v1.12 plain @3 already beats #1+related, so a reading path has to beat @3.
- **Nothing in ranking uses the graph today.**
  - The boost is gone, and `link_prior` defaults to 1 (`src/core/rank.ts:20,46`).
  - `related` only adds a field: neighbours of #1 that the search also found, at confidence ≥ 0.5 (`search.ts:28-34,60`, `confidence.ts:7`).
  - So "no graph boost for facts" is already the case. The new work is the classifier, the walk and the label.
- **No PPR exists.**
  - graphology has none. `searchGraph` is a breadth-first search by rings (`graph.ts:209-233`).
  - Edges: links, wikilinks, related, cites, same-incident (`graph.ts:10`). Hub and `generated` docs are not nodes (`graph.ts:50`).
- **Overview first is possible.** hewtd marks overviews with `kind: overview` (`hit-em-with-the-docs/docs/retrieval-fields.md:12`), and every indexed doc keeps its full frontmatter (`types.ts:5`).
- **`query_type` in the response.** The response is a bare JSON array (the harness at `harness.ts:30` parses it), so flags go on result items, following the `no_strong_match` and `related` pattern.
- **Latency: we have no in-repo measurement.**
  - The 33 ms p95 is from the external kit on an idle machine. The same kit measured 80 ms p95 on v1.11 on a loaded machine, so the headroom is thin.
  - #56 adds p50/p95.
- **Labelled questions: partly there.**
  - 34 `multi` questions exist across 4 files.
  - Most are two facts joined by "and" (`golden-docs.jsonl` m01-m03), not step-by-step flows.
- **Reuse:** `GraphBuilder` (edges, hub exclusion, `isExcluded`), the `relatedTo` pattern, `read_note` with `section`, `expandedAt1` (`eval.ts:145,191`), the docs-eval gate (`docs-eval.test.ts:158-161`).
