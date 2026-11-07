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

### Phase 3 (index freshness; fixture `test/fixtures/docs-vault` eval unchanged, generated 1,000-doc tree, this repo's `.documentation/` copy)

Eval after Phase 3 (`npm run eval`): semantic and hybrid arms identical to the Phase 2 baseline (@1 19/33, archive hits 8).
Phase 3 sorts the file listing (glob order follows I/O timing and HNSW results depend on insertion order; two
unsorted runs under load failed the archive-hit gate). That moves the two order-dependent arms: search_text @1 7 -> 6,
archive hits 24 -> 26, and graph precision 0.271 -> 0.257 / recall 0.791 -> 0.750 (which of two same-named docs a
wikilink resolves to depends on listing order; Phase 4 fixes that with archive exclusion). `baseline.json` floors for
those two re-recorded at the deterministic values; they are now stable run to run.

Key Question 5, raw hnswlib-node, 384-d random vectors:

| vectors | rebuild from cached vectors | 50 x (markDelete + addPoint) |
|---|---|---|
| 1,000 | 87 ms | 6 ms |
| 5,000 | 1,020 ms | 17 ms |
| 10,000 | 3,004 ms | 26 ms |

Rebuild is over the 200 ms bar at 5k, so the index is updated in place and compacted (rebuild) past 30% deleted nodes.

Generated tree, 1,000 docs / ~3,000 chunks (330 random words each, wikilinks, tags), 37 MB index:
- cold build (no cache, MiniLM, in-process): 120 s (200 docs: 24 s)
- warm start to first answer (createServer, nothing changed, search_semantic): 511-524 ms; answer carries `_meta.stale` until the first reconcile ends; 0 files re-parsed, 0 chunks embedded
- search with an idle reconcile before it (1,000 files stat'd, nothing changed): 25 ms total; second search inside the 2 s window: 4-12 ms
- edit one doc, next search: 32-67 ms total (reconcile + parse + embed 1 chunk + HNSW update)
- full graph rebuild 11-14 ms; text index setDocuments 0 ms (why the graph is rebuilt whole, not patched)

This repo's `.documentation/` copy (137 docs / 255 chunks), `stale-audit.mjs` (now also compares the committed HNSW chunk list with the files on disk):

| state | stale vectors | missing | orphans | index vs disk mismatch | cold start to first answer |
|---|---|---|---|---|---|
| Phase 2 baseline, clean | 0% | 0 | 0 | n/a | 1,352 ms |
| Phase 2 baseline, 10 docs edited while down | 8.6% | n/a | n/a | n/a | 1,839 ms (full re-parse) |
| Phase 3, clean | 0% | 0 | 0 | 0 | 431 ms |
| Phase 3, 10 docs edited while down | 0% | 0 | 0 | 0 | 915 ms (re-parse + re-embed those 10 only) |
| Phase 3, every file touched, no content change | 0% | 0 | 0 | 0 | 459 ms (manifest rewrite only) |

Inotify: `createServer` holds 0 inotify instances (counted in `/proc/self/fdinfo`, `freshness.test.ts`); before it held one watch per file + directory.
Not measured: the real production `.mcp.json` launch (Phase 11), Windows/macOS.

### Phase 4 (graph and ranking fixes; fixture `test/fixtures/docs-vault`, `npm run eval`, 3 identical runs)

| arm | @1 (was) | @3 | @8 | archive hits (was) |
|---|---|---|---|---|
| search_semantic | 20/33 (19) | 30/33 | 32/33 | 0 (8) |
| search_hybrid | 20/33 (19) | 30/33 | 32/33 | 0 (8) |
| search_text | 6/33 (6) | 15/33 | 24/33 | 0 (26) |

- Graph vs hand-written truth: forwardlinks and backlinks precision 1.000 (was 0.257), recall 1.000 (was 0.750).
  Markdown links add the recall, hub exclusion and the tag-edge default removal add the precision.
- The one extra @1 hit is the live doc no longer sharing a slot with its archived copy. Hybrid still equals semantic at @1 on
  this fixture: the 1.3 boost reorders scores but no fixture case has the answer just below a linked top hit. Unit test
  `graph-links.test.ts` proves the order change where it exists.
- Negative top scores are still 0.14 to 0.45: abstention is Phase 7.
- minimatch: `**/archive/**` does not match `.documentation/archive/a.md` without `{ dot: true }` (asserted in `graph-links.test.ts`).
- `INDEX_SCHEMA_VERSION` 1 -> 2: caches re-parse, vectors are kept.

### Phase 5 (BM25 + RRF in search_hybrid; fixture grew to 35 answerable cases: 2 symptom-phrased cases s01/s02, both hit @1 in every vector arm)

| arm | @1 | @3 | @8 | exact @1 | paraphrase @1 | negative top scores |
|---|---|---|---|---|---|---|
| search_semantic (vector only, unchanged) | 22/35 | 32/35 | 34/35 | 11/15 | 9/12 | 0.31 0.25 0.14 0.31 0.15 0.36 |
| search_hybrid (before this phase, 35-case set) | 22/35 | 32/35 | 34/35 | 11/15 | 9/12 | |
| search_hybrid (BM25 + RRF) | 23/35 | 30/35 | 34/35 | 12/15 | 9/12 | 0.50 0.50 0.50 0.50 0.94 0.97 |
| search_text (grep) | 6/35 | 15/35 | 25/35 | 2/15 | 3/12 | |

- Tuning path (each full eval on the fixture): plain RRF with the graph boost applied after fusion: @1 15/35 (RRF scores are flat,
  a x1.3 boost jumps many ranks), so boosts/priority/decay/path-class now act on each arm's list before fusion. Stopword-less BM25: 19 -> 22
  with a stoplist. Lexical weight 0.3 / 0.5 / 0.7 gave identical results (RRF k=60 is flat; any rank-1 lexical hit lifts a doc many places),
  so no weight option. Short `symptoms:` chunks score high on one incidental query word; requiring >= min(2, query terms) matched terms per chunk
  took @1 22 -> 23 and paraphrase @3 9 -> 10 of 12 (semantic: 12).
- Cost: hybrid @3 is 30/35 vs 32/35 for vector alone (paraphrase queries get incidental lexical hits). Phase 6 rerank is where that is expected to be recovered.
- Negative top scores in hybrid are not comparable to cosine (RRF scale, 1.0 = ranked first by both arms): abstention is Phase 7.
- Floors raised: semantic 22, hybrid 23, text 6.

### Phase 6 (rerank and embedder trials; fixture eval, 35 answerable cases, baseline hybrid @1 23 / @3 30 / @8 34)

Machine was loaded (load average 12-16 on 8 cores) during every latency number, so latencies are pessimistic; the ratios between rows are the signal.
Latency = `search_hybrid` through an in-process MCP client on the fixture, 35 warm queries (script in the session scratchpad, not committed); base (no rerank) is p50 5 ms / p95 30 ms.

Cross-encoder `Xenova/ms-marco-MiniLM-L-6-v2` (fp32 ONNX unless noted), `EVAL_RERANK=1 npm run eval`:

| variant | hybrid @1 / @3 / @8 | p50 / p95 ms | cold first query |
|---|---|---|---|
| no rerank (baseline) | 23 / 30 / 34 | 5 / 30 | 12 ms |
| rerank top 30, len 512, order by rerank score only | 24 / 31 / 32 | 675 / 775 | 860 ms |
| same, blended by RRF with the fused rank (weight 1.0) | 24 / 31 / 33 | not measured | |
| same, blend weight 0.5 | 24 / 31 / 34 | not measured | |
| top 30, len 256 | not run | 728 / 883 | 1,001 ms |
| top 10, len 256 | not run | 477 / 687 | 1,012 ms |
| top 30, len 256, int8 | not run | 478 / 715 | 1,992 ms |
| top 30, len 128, int8 | not run | 248 / 346 | 621 ms |
| top 15, len 128, int8 | not run | 222 / 356 | 660 ms |
| top 10, len 128, int8 | 22 or less (fails the @1 floor of 23) | 148 / 235 | 511 ms |
| top 5, len 128, int8 | 23 / 31 / 34 (no gain) | 140 / 227 | 344 ms |

- Decision: reranker stays OFF by default (`rerank.enabled: false`). The only variants that raise @1 (+1 case of 35, within noise) cost 0.7 s per search, 4.5x the 150 ms bar;
  every variant fast enough to approach the bar loses the gain. Time is inference (10 pairs x 160 tokens = ~400 ms under load; tokenizing is 1-6 ms), not setup.
- The code path stays (config `rerank.enabled` / `rerank.model` in vault.schema.yml, fallback to the fused order if the model cannot load) and is tested in `test/unit/reranker.test.ts`.
  Because it is not default, `scripts/build-offline-tarball.sh` and the expected tarball size (~0.55 GB) are unchanged. Pure rerank order was kept (blending gave no extra @1).
- Hybrid @8 falls 34 -> 32 with pure rerank order (top-30 re-scored, the answer sometimes pushed out of the top 8): another reason not to default it.

Embedder trials (all 384-d, fp32, same index shape; `EVAL_MODEL=<name> npm run eval`, fresh embedding of the fixture):

| embedder | pooling / query prefix | semantic @1 / @3 / @8 | hybrid @1 / @3 / @8 | negative top cosine |
|---|---|---|---|---|
| all-MiniLM-L6-v2 (default) | mean | 22 / 32 / 34 | 23 / 30 / 34 | 0.14-0.36 |
| BAAI/bge-small-en-v1.5 | CLS | 22 / 30 / 33 | 21 / 28 / 34 | 0.53-0.66 |
| BAAI/bge-small-en-v1.5 | CLS + "Represent this sentence for searching relevant passages: " | 22 / 30 / 33 | 20 / 27 / 32 | 0.52-0.67 |
| thenlper/gte-small | mean | 24 / 32 / 32 | 19 / 26 / 33 | 0.76-0.83 |

- Decision: default embedder unchanged. gte-small is +2 @1 on the vector arm alone but -4 on `search_hybrid` (the product's main arm; its compressed cosine range
  of 0.7-0.85 makes the fixed x1.3 graph boost and the min-term gate act differently), and both alternatives raise negative cosines to 0.5-0.8, which
  makes Phase 7's abstention harder. The CLS-pooling and prefix changes used for bge were a throwaway patch to `embedder.ts`, reverted: no trial code ships.
- The trial models (bge, gte, the cross-encoder, ~0.4 GB) were deleted from `~/.semantic-sidekick/models` after the runs so the offline tarball does not pick them up.
