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

## Eval results: Phase 9 (independent review and validation, same run, 2026-11-08)
**Review (git diff main...HEAD, adversarial).** Checked: no reordering for flow (`shape` only adds fields to #1; payload test asserts equal path order under mode fact vs flow); one identifier detector (`query-type.ts` imports #57's `identifiers()`, adds only PascalCase3+/--flag/name()); walk bounded (maxNodes 300, maxSteps 20, maxDegree 50, tested); code nodes never returned (`walk` filters `isCode`, unit-tested); `content[0]` still a bare array (flags ride on #1); constants not tuned on held-out (classifier rules and the 0.36 seed line chosen on train; the Phase 5 sweep printed held-out beside train for the record, and 0.36 is an existing constant). One real bug found and fixed: **reading_path members that were not hits ignored `status`/`tier`/`domain`/`modifiedAfter`/`modifiedBefore`** (Phase 5 recorded this as a decision; it is a defect, a filtered search could name a doc the filter excludes). `search.ts` now passes an `allowed(path)` predicate into the walk's `skip`; regression test `test/integration/reading-path-filter.test.ts` (fails without the fix: 4 extra neighbours, passes with it). Also made the 5k/50k walk benchmark best-of-9 (it flaked twice under load: 11.4 ms, 304 ms).
Ticked boxes audited against code: all Phase 2-8 boxes hold (labels on 6 splits, `mode` param, `query_type` on #1 and in the usage event, `GraphBuilder.walk`, `readingPath`, `VectorIndex.bestChunk`, x1.3 comment gone, five version fields 1.18.0).

**#61 acceptance checks** (numbers from `npm run eval` in this run; Phase 2 baseline rows are identical):
1. Fact-tier @1 (exact+paraphrase+symptom+nofield, search_hybrid), now vs baseline: fixture-train 37/45 vs 37/45, fixture-heldout 22/29 vs 22/29, real-train 14/18 vs 14/18, real-heldout 14/21 vs 14/21. **Met** (the path never reorders; mode fact vs flow give identical @1/@3 in the forced arm).
2. Multi tier, `#1+reading_path` vs max(`#1+related`, @3):

| split | @3 | #1+related | #1+path as shipped (auto) | #1+path forced flow | verdict |
|---|---|---|---|---|---|
| fixture-train | 10/12 | 8/12 | 5/12 | 11/12 | forced met, shipped **not met** |
| fixture-heldout | 5/7 | 4/7 | 2/7 | 5/7 | forced met, shipped **not met** |
| real-train | 8/9 | 8/9 | 8/9 | 9/9 | forced met, shipped met (equal) |
| real-heldout | 5/6 | 6/6 | 4/6 | 6/6 | forced met, shipped **not met** |

   Why: most multi questions are two facts and classify as fact, so they get no path; `related` still rides on them. The gate (train, forced flow) passes. The PR must say the shipped multi-tier target is not met; the path helps only questions classified flow. Held-out values were measured, not used to tune.
3. Classifier accuracy: train fixture 75/77 = 0.97, real 47/47 = 1.00, code 8/10 = 0.80; held-out fixture 50/52 = 0.96, real 41/43 = 0.95, code 9/10 = 0.90. Reported. Flow recall is thinly tested (4 flow rows on train, 3+1 held-out).
4. Latency, in-process, search_hybrid limit 8, all golden questions of both splits, 3 passes, modes interleaved per question in one run (`auto` = shipped, `fact` = no path, same as v1.17 work, `flow` = path on every call):

| corpus | mode | n | p50 ms | p95 ms | max ms |
|---|---|---|---|---|---|
| fixture | auto | 387 | 3.5 | 7.0 | 20.4 |
| fixture | fact | 387 | 3.4 | 6.0 | 19.7 |
| fixture | flow | 387 | 4.0 | 7.8 | 27.1 |
| real (.documentation) | auto | 270 | 5.6 | 12.6 | 14.7 |
| real (.documentation) | fact | 270 | 5.5 | 8.1 | 14.8 |
| real (.documentation) | flow | 270 | 11.8 | 16.4 | 45.6 |

   p95 <= 100 ms: **met** (worst 16.4 ms p95, 45.6 ms max). The path costs about +0.6 ms p50 on the fixture and +6 ms p50 on the real corpus when it runs; the classifier alone is free (auto ~ fact). Walk on 5k nodes / 50k edges: under 10 ms (best of 9, asserted in `test/unit/graph-walk.test.ts`). Idle-ish machine; the 33 ms p95 external-kit figure is a different harness.
5. Works without hit-em-with-the-docs: **Met.** `test/integration/reading-path-filter.test.ts` asserts the fixture has no `.hewtd/graph.json` and still returns a path on the doc-only graph (and `search-payload.test.ts` builds a path on the same fixture).

**Suite.** lint, build pass; `npm run eval` 125 passed, 5 expected fail. Full `npm test` (run twice): the only failures both times were freshness-scale "warm start under a second" and hook-failure "Jev error or hang" (known load flakes); both pass alone (16/16). Not re-run clean in one pass.
