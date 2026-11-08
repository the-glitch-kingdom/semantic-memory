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

## Eval results: Phase 3 (classifier accuracy, rules tuned on train only)
| split | accuracy |
|---|---|
| fixture-train (golden-docs) | 75/77 = 0.97 |
| real-train | 47/47 = 1.00 |
| code-train | 8/10 = 0.80 |
| fixture-heldout | 50/52 = 0.96 |
| real-heldout | 41/43 = 0.95 |
| code-heldout | 9/10 = 0.90 |

Printed by `npm run eval` (test/retrieval-eval/qtype-labels.test.ts); train floor 0.8. Train misses: one kebab/subcommand identifier, one flow ("how does it catch up and where do payloads end up"), two code-set identifiers (sluice-drain, warmctl prime). Ranking unchanged: fact @1 and multi @3 identical to the Phase 2 baseline by construction (the label is attached after ranking; a test checks the path order is the same under a forced mode).

## Eval results: Phase 4
- `GraphBuilder.walk` (src/core/graph.ts), test/unit/graph-walk.test.ts. No retrieval change yet, so eval numbers are unchanged.
- Synthetic 5k-node / 50k-edge random graph, 3 seeds, defaults (maxNodes 300, maxSteps 20): under 10 ms per walk (asserted in the test; mean of 5 after warm-up).
- Choices: seeds are exempt from maxDegree and skip is not applied to them; maxDegree counts all edges incl. code edges; isolated nodes' mass restarts at the seeds; ties break by path. Returns seeds too (Phase 5 picks members).
- Note: on a chain a-b-c-d seeded at a, b outranks a (a's only neighbour collects its whole walk). Phase 5 should drop seeds or weight as the plan says, not assume the seed is first.
- Full npm test: freshness-scale warm start and hook-failure Jev-hang failed under load, both pass alone.

## Eval results: Phase 5 (reading path; seeds clear NO_STRONG_MATCH_BELOW 0.36)
Multi tier, `#1 + reading_path` against max(`#1 + related`, @3). "Forced" = `mode: "flow"` on every case (what the path adds when the classifier is right); "as shipped" = mode auto, so the path attaches only to the few questions classified flow (multi rows are mostly two facts and classify as fact).

| split | @1 | @3 | #1+related | #1+path forced | target max(related, @3) | #1+path as shipped |
|---|---|---|---|---|---|---|
| fixture-train | 4/12 | 10/12 | 8/12 | 11/12 | 10/12 met | 5/12 |
| fixture-heldout | 2/7 | 5/7 | 4/7 | 5/7 | 5/7 met | 2/7 |
| real-train | 7/9 | 8/9 | 8/9 | 9/9 | 8/9 met | 8/9 |
| real-heldout | 4/6 | 5/6 | 6/6 | 6/6 | 6/6 met | 4/6 |

Seed threshold sweep, fixture-train / fixture-heldout multi `#1+path` forced (train chose it; held-out shown for the record only): 0.5: 9/12, 4/7; 0.4: 10/12, 5/7; 0.3: 11/12, 5/7; 0: 11/12, 5/7. Real splits were 9/9 and 6/6 at every threshold. Chosen: 0.36 (existing constant), measured 11/12 and 5/7.
As shipped the path does not reach the target on the multi tier (5/12 on fixture-train vs 10/12): the gate is on forced flow. Plain @1, fact-tier @1 and @3 are unchanged (the path never reorders; `npm run eval` floors pass). Payload cost of the path: mean payload +~800 B per forced-flow case on the fixture (4372 -> 5197 B), +1.2 kB on real. Latency of the path not measured separately (Phase 9).
Gates added: docs-eval (train, exact) and real-corpus-eval (train, one case of slack) assert forced-flow `pathAt1 >= max(expandedAt1, @3)`; the eval prints `#1+path` per tier and a "mode flow forced" block.

## Eval results: Phase 6
Label only. No ranking change, so no eval numbers move. Identifier queries keep #58's entity card on #1 and get no reading_path (path is flow-only); asserted in test/integration/search-payload.test.ts. Stale "x1.3" comment trimmed in src/mcp/tools/search.ts.
