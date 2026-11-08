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

## Eval results: Phase 2 (labels and baseline, v1.17.0 code, 2026-11-08)
Labels: `qtype` (identifier | fact | flow) hand-set on six splits only (golden-docs, golden-docs-heldout, real-corpus, real-corpus-heldout, golden-code, golden-code-heldout), read from the question, not from the tier. `test/retrieval-eval/qtype-labels.test.ts` checks every row has a valid label. Other golden files (golden.jsonl, decay, graph, section) are not part of the routing eval and are unlabelled.

| split | identifier | fact | flow |
|---|---|---|---|
| fixture-train (77 rows) | 14 | 59 | 4 |
| fixture-heldout (52) | 11 | 38 | 3 |
| real-train (47) | 11 | 33 | 3 |
| real-heldout (43) | 9 | 33 | 1 |
| code-train (10) | 8 | 2 | 0 |
| code-heldout (10) | 8 | 2 | 0 |

Judgement calls: most `multi`-tier rows are two facts joined by "and" and are labelled `fact`; only broad "walk me through / big picture / how do the parts fit" rows (and two "catch up and where does it end up" rows) are `flow`. Flow is rare: 11 of 229 docs rows, so the flow route can move at most a few multi cases. Error-text and symptom questions are `fact` unless they name a code token (ERR_ROLLUP_MISSING, HarborBacklogHigh, RollupJobSkipped are `identifier`; "rebalance timed out after 30000ms" is `fact`). Ambiguous: real x21 (layers stack + escape hatch) labelled `flow`; real xh21 (refactor changes + tools that became shims) labelled `fact`.

Baseline, search_hybrid, `npm run eval` (docs-eval, real-corpus-eval; fact-tier = exact + paraphrase + symptom + nofield, negatives excluded; multi = tier multi; latency = per-call ms over answerable+negative cases, in-process on an idle-ish machine):

| split | fact-tier @1 | fact-tier @3 | multi @1 | multi @3 | multi #1+related | p50 / p95 ms |
|---|---|---|---|---|---|---|
| fixture-train | 37/45 | 43/45 | 4/12 | 10/12 | 8/12 | 8 / 13 |
| fixture-heldout | 22/29 | 26/29 | 2/7 | 5/7 | 4/7 | 16 / 26 |
| real-train | 14/18 | 17/18 | 7/9 | 8/9 | 8/9 | 7 / 13 |
| real-heldout | 14/21 | 20/21 | 4/6 | 5/6 | 6/6 | 7 / 13 |

search_semantic (reference): fixture-train 38/45 fact @1, multi 2/12 @1, 12/12 @3; fixture-heldout 22/29, multi 1/7, 5/7; real-train 13/18, multi 5/9, 8/9; real-heldout 7/21, multi 4/6, 5/6.
Code sets (answer ranked first, search_hybrid): train 10/10, heldout 10/10.
Targets for later phases: the reading path on multi must reach `max(#1+related, @3)`: fixture-train 10/12, fixture-heldout 5/7, real-train 8/9, real-heldout 6/6 (the #1+related column already equals or beats @3 on real splits). Real-corpus numbers vary by about one case per run.
