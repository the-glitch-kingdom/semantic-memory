# Notes: whole-answer ranking (#90, #91)

## Phase 1: verification on main (1.27.1, 70d452f)

### #90: cold build answers before the grounding multiplier lands
- `fullIndex()` (src/mcp/context.ts:562) runs `sync(true)`. `sync` ends with `setDocuments(docs); void applyCode(docs);` (around :486), then `fullIndex` saves and sets `indexState = "ready"`. The code load (`loadCode` → `loadCodeData`, `git log`) is not awaited.
- `applyCode` (:278) recomputes each doc's `grounding` via `groundDocs`, then rebuilds the graph. `isStale()` is `stale || codePending > 0` (:772), so responses carry the stale marker meanwhile, but they still rank.
- Grounding feeds the score: `decayForDoc` (src/core/decay.ts:219) multiplies `groundingMultiplier(doc.grounding)` into the multiplier, while the `decay` block reports age decay alone. This matches the report exactly:
  - only two docs move, both down (dead refs or drift found once the code lands);
  - the decay blocks are identical before and after.
- Warm restart: `loadFromDisk` installs cached docs with their saved grounding (`applyCode` schedules a save when grounding changes), so it is stable from the first answer. That also matches the report.
- This is the #73 design ("doc metadata is installed with the index, the code graph after"; test/integration/code-load-order.test.ts). Fix only the cold path. There nothing is served before ready, so waiting costs only the code-load time.

### #91 part 1: identifier outranked by docs without it
- Reproduced on our own `.documentation` (CLI `search`, limit 6):
  - "What does gate-release.sh check, and what exit codes does it return?" gives #1 `deployment/release-process.md` (has it), #2 `changelog/v1-23-0-abstention-product-names.md` (no), #3 `reference/cli-reference.md` (no), #4 `changelog/v1-22-0-…` (has it).
  - `gate-release.sh` is in 5 non-archive docs, so the reporter's test (top min(N,3) contain it) fails.
  - The same shape with `build-offline-tarball.sh` (3 docs) and `install-offline.sh` (1 doc) passes: their identifier docs were already on top.
- `classifyQuery` labels these `identifier`, but the label never changes ranking (query-type.ts doc comment). `identifiers()` (src/core/identifiers.ts) catches `x_y.py`, `a-b.sh` (DOTTED), paths and backticks. `Bm25Index.docHas` and `has` / `hasJoined` give presence per doc and per corpus.
- Ranking steps (MCP `hybridRanked`, src/mcp/tools/search.ts:112; CLI src/cli/search.ts:169):
  1. vector + BM25 at `candidatePool(limit)`;
  2. per-arm boosts;
  3. `fuseScores`;
  4. `applyCoverage` (default off: coverage_weight 0, link_prior 1);
  5. filters;
  6. the reranker.
  The tier goes after coverage and before the reranker.

### #91 part 2: multi-part questions
- `VectorIndex.search` scores a doc by its best body chunk, or its best metadata chunk times meta_weight (src/core/vector.ts:137-173). BM25 takes the best chunk too (bm25.ts `search`). So two strong sections never add up.
- The only whole-doc signal is `applyCoverage`'s term coverage, off by default since the retrieval-ready-fields sweep. #87 records that a larger pool with it raised dominance.
- Not reproducible on our corpora without the reporter's tree. Phase 2 builds a fixture and new train/held-out rows. The release comment asks for an anonymised repro, `{id, tier, q, facets}` JSONL.
- `VectorIndex.bestChunk(docPath, q)` already scores one doc's body chunks against a query vector from the stored points. A multi-vector variant is the natural place for per-clause matching.

### Constraints carried from #85/#87 (user decisions)
- Gate each change separately against the previous release at limit 8, BAND=1.
- Tune on train only; dominance is the guard against breadth rewards.
- The candidate pool stays 24 (`candidatePool`); a larger pool is #87's own release.

## Eval results: Phase 2 (main = 1.27.1; the branch has no src change yet, so `local` equals main)

New sets, written from the issue's question shapes before any change and never edited to fit a result. Run with `scripts/eval-against-release.sh --cache --set <file> 1.27.1 local` (cli arm, counts repeat exactly; p95 not same-run for cached rows).

| set | questions | corpus | hyb@1 | hyb@3 | sem@1 | multi@1/3/8 | cov@1/3/8 | dom |
|---|---|---|---|---|---|---|---|---|
| whole-answer (train) | 12 | multi-hub fixture | 11/12 | 12 | 10/12 | 11/12/12 of 12 | 0.92/1.00/1.00 | 4 |
| whole-answer-heldout | 12 | multi-hub fixture | 10/12 | 11 | 8/12 | 10/11/11 of 12 | 0.83/0.92/0.92 | 4 |
| identifier-tier (train) | 8 | identifier-tier fixture | 8/8 | 8 | 8/8 | n/a | n/a | 2 |
| identifier-tier-heldout | 8 | identifier-tier fixture | 8/8 | 8 | 6/8 | n/a | n/a | 1 |

1.27.1 and local rows are identical on every set (no src change).

Reading them honestly:
- **Identifier sets**: @1 is already 8/8, because the best identifier doc is #1 (the issue reports #2 and #3). The failure the tier fixes is in slots 2 and 3, which @1/@3 facet metrics do not see. Measured separately on main (hybrid, limit 8): the top 3 hold only identifier docs for **0/8 train and 0/8 held-out** questions; identifier docs fill **9/24 (train) and 11/24 (held-out)** of the top-3 slots. Phase 4's gate must report this "top-3 all identifier docs" count next to the @1/@3 numbers; @1 cannot move.
- **Whole-answer sets**: main already answers 11/12 and 10/12 at @1 (multi@3 12 and 11). The hub docs here hold both answers in one doc, so best-chunk ranking mostly finds the hub; the rows leave little headroom (1 and 2 misses). They guard against a regression and cannot show a large gain. The discriminating reproduction of part 2 is the `multi-clause` fixture (X first, Y third on main for "How do we rotate the cluster certificates, and where are the audit logs kept?": scores 0.6436 / 0.5847 (audit-log-retention) / 0.5662).
- Our own `.documentation` reproduction (Phase 1) is not gated: "What does gate-release.sh check, and what exit codes does it return?" ranks two docs without the name at #2 and #3.

### Failing tests written (all fail on main for the stated reason, verified by running them as plain `it`)
- `test/integration/cold-build-ready.test.ts`: 3 `it.fails` (fullIndex() resolves with isStale() true; first answer with and without `waitForReady` differs from the settled answer on `golden-graph.jsonl` train questions, over `code-graph-vault` with the code load delayed 1.5 s).
- `test/retrieval-eval/identifier-tier.test.ts`: 8 `it.fails` (4 scripts x hybrid and CLI: top 3 all contain the script) and 6 plain guards (identifier-only query ranks its docs first; an identifier in no doc keeps main's top 2).
- `test/retrieval-eval/multi-clause.test.ts`: 2 `it.fails` (hybrid and CLI: Y above X) and 2 plain guards (one-part question keeps X first).
- `test/retrieval-eval/whole-answer-fixture.test.ts`: facet-holder check of the four new sets (13 tests, plain).
- `scripts/eval-against-release.sh` now copies `identifier-tier/` for the identifier sets and `multi-hub/` for the whole-answer sets.

### Phase 2 validation
`npm run lint && npm run build && npm test`: 145 files passed (1158 passed, 3 expected fail). `npm run eval`: all passed except `real-corpus-eval.test.ts`, whose beforeAll hit its 600 s hook timeout once under load (the 23-file run); alone it passed in 3m21 (16 passed, 1 expected fail). Recorded as a load flake, no change.
