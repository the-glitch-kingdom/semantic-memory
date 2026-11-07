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
