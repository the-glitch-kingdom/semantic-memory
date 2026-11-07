# Notes: retrieval-graph-quality

## Source
Issue #41 (opened 2026-11-07 UTC by TheGlitchKing): benchmark of v1.7.2 on a 751-doc hewtd corpus
(+279 archive). Hybrid @1 0.57, grep @1 0.62. Full issue text: `gh issue view 41`.

## Verification (2026-11-06, against src/ at v1.8.0, commit c22f65c)

| Issue claim | Verdict | Where |
|---|---|---|
| Hybrid graph boost never fires | Confirmed: `searchGraph(query, 2)` seeds by `.includes(whole query)` | `src/mcp/tools/search.ts:123`, `src/cli/search.ts:98` (duplicate), `src/core/graph.ts:113-127` |
| Markdown links ignored | Confirmed: only `wikiLink` nodes + `related_docs` | `src/core/indexer.ts:175`, `src/core/graph.ts:46-67` |
| Tag edges make backlinks == forwardlinks | Confirmed: bidirectional tag edges, untyped `inNeighbors`/`outNeighbors`; `findPath` also walks tag edges | `src/core/graph.ts:81-109` |
| searchGraph favours hubs | Confirmed: degree tiebreak | `src/core/graph.ts:146` |
| No archive exclusion | Partly wrong: `path_class` default `archive/**` x0.3 exists (v1.4). Real bug: glob matches only top-level `archive/`. minimatch: `.documentation/archive/a.md` fails `archive/**` AND `**/archive/**`; passes `**/archive/**` with `{dot:true}` | `src/core/path-class.ts:28`, `src/core/schema-default.ts:99-103` |

## Already exists (reuse, don't rebuild)
- Retrieval eval harness: `test/retrieval-eval/{eval.ts,eval.test.ts,golden.jsonl}` (`npm run eval`),
  recall@k + MRR by class, path-based expected docs, 17 cases vs `test/fixtures/vault`, non-blocking,
  drives `search_semantic` only. Not run in CI (`.github/workflows/ci.yml` runs lint/build/test).
- `symptoms:` frontmatter phrases are indexed as extra chunks (v1.4 Phase 5), `src/core/indexer.ts:95-104`.
- Vector search already returns one result per doc (`src/core/vector.ts:49-56`).
- Selection log `selection.jsonl` (`src/core/telemetry.ts`) records search -> read follow-ups:
  the implicit-label source for mining queries.
- Embedder: default `sentence-transformers/all-MiniLM-L6-v2`, ONNX, `src/core/embedder.ts:13`.
- No BM25/lexical library in node_modules.

## Callers touched by a payload change
`enrichResult` (`src/mcp/context.ts`) is used by 3 sites outside context.ts; search results are
consumed by `hooks/vault-context.js`, `hooks/doc-search-redirect.js`, `src/cli/search.ts`, `src/cli/index.ts`.

## Verification: index freshness (issue comment 2026-11-07T02:06Z, checked 2026-11-06 local)

| Comment finding | Verdict | Where / evidence |
|---|---|---|
| 1. Edits never reach the vectors | Confirmed: reuse keyed `${path}:${i}`, no text check; chunk insertions shift keys | `src/mcp/context.ts:199-208,224` |
| 1b. Orphan vectors persist | Confirmed: `cumulativeEmbeddings` starts from the saved map and is saved whole, never pruned. Search is unaffected (HNSW is rebuilt from current chunks only); only disk/RAM bloat | `src/mcp/context.ts:194,255-266` |
| 2. Any change -> full reindex | Confirmed: changed paths ignored | `src/mcp/server.ts:68-69` -> `fullIndex()` -> `indexAll()` |
| 3. Changes during a reindex dropped | Confirmed: `if (indexingPromise) return;` with no dirty flag | `src/mcp/context.ts:270` |
| 4. Cold start re-parses everything | Confirmed: `tryLoadCachedIndex` calls `indexer.indexAll()`; only `src/cli/search.ts` reads `docs.cache.json`. Also: "fresh" = same `totalChunks` only, so an edit that keeps the chunk count is served as `ready` | `src/mcp/context.ts:159,166-168` |
| 4b. `waitForReady` path parses twice | New: `tryLoadCachedIndex()` then `fullIndex()` back to back | `src/mcp/server.ts:52-53` |
| 5. One inotify watch per file; counts inconsistent | Confirmed live (2026-11-06): test-vault server 629 watches = 537 .md + 92 dirs exactly; two servers on the same `.documentation` tree (RE-InvestorHub) hold 662 vs 1,185; two on one `.claude/.vault` hold 2 vs 77 | `/proc/<pid>/fdinfo` inotify lines |
| 6. fs.watch recursive / @parcel/watcher no better on Linux | Not verified (external claims; nodejs/node#65486 not checked). Not needed: the plan drops push watching | n/a |
| 7. Stat scan ~5 ms / 1,030 files | Not re-measured; plausible. Phase 3 measures on the generated ~1k tree | n/a |
| Saves not atomic, no cross-process lock | Confirmed: `Promise.all` of 5 direct `writeFile`s; only the model download uses temp+rename | `src/mcp/context.ts:255-266`, `src/core/embedder.ts:81` |
| meta.json lacks schema/generation | Confirmed: `{model, dimensions, totalChunks, indexedAt}` | `src/mcp/context.ts:260-265` |

Watcher surface to keep compatible: `Watcher` exported from `src/core/index.ts`; `--no-watch` in
`src/cli/index.ts:630`; `options.watch` used by many integration tests; `chokidar` ^5.0.0 dependency.
Tests to rewrite: `test/integration/watcher.test.ts`, `test/integration/stale-index-startup.test.ts`.

## Eval results
(baseline and per-phase numbers go here)

### Phase 2 baseline (v1.8.0 code, fixture `test/fixtures/docs-vault`, 21 docs; 39 cases: 13 exact, 12 paraphrase, 8 multi-doc, 6 negative)

Answered@k = every facet regex matched by a non-archive result in the top k (counts out of 33 answerable).

| arm | @1 | @3 | @8 | exact @1 | paraphrase @1 | multi @1 | archive hits (top 8, 39 q) | mean payload |
|---|---|---|---|---|---|---|---|---|
| search_semantic | 19/33 (0.58) | 30/33 | 32/33 | 9/13 | 8/12 | 2/8 | 8 | 5983 B |
| search_hybrid | 19/33 (0.58) | 30/33 | 32/33 | 9/13 | 8/12 | 2/8 | 8 | 5983 B |
| search_text (grep) | 7/33 (0.21) | 11/33 | 22/33 | 3/13 | 4/12 | 0/8 | 24 | 1544 B |

- Hybrid is identical to semantic on every case: the dead graph boost (issue finding) reproduces.
- Negative top scores (semantic = hybrid): 0.31 0.25 0.14 0.31 0.15 0.36; no abstention signal exists yet.
  search_text returns hits for 4 of 6 negatives (any shared word matches).
- Archive hits are not zero even with the 0.3 down-weight (8 in the top 8 over 39 queries).
- Graph vs hand-written truth (`docs-graph-truth.json`, 19 source docs): forwardlinks precision 0.271 /
  recall 0.791; backlinks precision 0.271 / recall 0.791 (tag edges and hub INDEX/REGISTRY links are the
  false positives; recall is only wikilinks, markdown links are missed).
- Stale-vector audit (`scripts/retrieval-eval/stale-audit.mjs`, this repo's `.documentation/` copy, 137 docs / 255 chunks,
  128 sampled): clean 0% stale, 0 missing, 0 orphans, cold start (createServer with `waitForReady`, to first
  answer) 1352 ms. After inserting a paragraph into 10 docs while no server ran: 8.6% of sampled vectors
  stale (cos < 0.99), restart cold start 1839 ms (full re-parse). Small edits barely move the cosine (an
  edit to one sentence of a 1-chunk doc stayed above 0.99), so 0.99 under-reports; the audit is a floor.
- Selection mining (`mine-selection.mjs`) tested on a synthetic log only (no real log used); output is for hand review.
- Note: `docs.cache.json` is not re-saved on a cached startup, so the audit reads chunks from disk, not the cache.

The CI floor (`test/retrieval-eval/baseline.json`) equals these numbers: @1 19/19/7, archive hits 8/8/24,
link precision 0.271, recall 0.791 (floored to 3 decimals).
