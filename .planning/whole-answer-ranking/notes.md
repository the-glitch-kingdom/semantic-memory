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
