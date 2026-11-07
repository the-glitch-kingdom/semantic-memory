---
title: v1.9.0 — retrieval and graph quality, index freshness
tier: reference
domains:
  - changelog
audience:
  - developers
  - admin
tags:
  - v1.9.0
  - retrieval
  - graph
  - freshness
  - bm25
  - issue-41
status: active
last_updated: '2026-11-06'
version: 1.9.0
purpose: What v1.9.0 changed in search ranking, the link graph and index
  freshness, with the measured before/after tables.
load_priority: 5
estimated_read_time: 4 minutes
word_count: 735
last_validated: '2026-11-07'
backlinks: []
---

# v1.9.0 — retrieval and graph quality, index freshness

Fixes issue #41: on a hewtd docs corpus `search_hybrid` was no better than grep (graph boost never fired, markdown links ignored, backlinks equal to forwardlinks, archived copies in the results), and the index drifted from the files on disk. Tuning and eval: [retrieval tuning guide](../operational/retrieval-tuning-guide.md).

## What changed

- **Hybrid is real hybrid.** BM25 and vector lists fused by reciprocal rank; graph boost seeded from the top 5 semantic hits by path (it used to seed on `.includes(whole query)` and never fired).
- **Typed link graph.** Markdown links, wikilinks, `related_docs`, `cites`, `same-incident` and `supersedes` edges; tag edges off by default; `INDEX.md`/`REGISTRY.md` hubs left out. `backlinks`, `forwardlinks`, `graph_path`, `search_graph` take `types`.
- **Archive exclusion that works.** `path_class.exclude` default `**/archive/**` with `dot: true`; the old `archive/**` rule missed nested and dot-dir archives. Byte-identical live/archived copies collapse to the live one.
- **Abstention and a smaller payload.** `confidence` and `no_strong_match` on results; ~600-char excerpt instead of whole chunks (`full: true` restores); `related` on the #1 result.
- **Pull-based freshness.** No resident watcher (0 inotify watches). A throttled (2 s) reconcile stats the tree before each search, re-parses and re-embeds only files whose bytes changed (content hash), updates HNSW in place, and commits atomically under `index.lock`. A manifest with `schemaVersion` and `generation` replaces the chunk-count staleness check.
- **Opt-in reranker** (`rerank.enabled`, off) and a retrieval eval with a CI floor (`npm run eval`).
- `Watcher` stays exported and `--no-watch` stays accepted (both deprecated no-ops) until v2.0.0. `INDEX_SCHEMA_VERSION` is 3: caches re-parse once, and vectors are not kept (see Upgrading).

## Retrieval, before and after

Fixture `test/fixtures/docs-vault` (21 docs; 35 answerable and 6 negative cases). "Before" is the v1.8.0 code on the same fixture.

| measure | before | after |
|---|---|---|
| `search_hybrid` answer @1 | 19/33 (0.58) | 23/35 (0.66); 25/35 with `related` |
| `search_hybrid` multi-doc #1 + `related` | 2/8 | 4/8 |
| hybrid identical to semantic | every case | no longer |
| archive hits in top 8 | 8 (hybrid), 24 (text) | 0 |
| negatives flagged `no_strong_match` | no signal | 6/6 |
| correct #1 wrongly flagged | n/a | 2/23 |
| backlinks precision / recall | 0.271 / 0.791 | 1.000 / 1.000 |
| mean `search_hybrid` payload | 5,983 B | 4,132 B |

Real corpus (this repo's `.documentation/`, 137 docs, 24 answerable and 6 negative own questions, production launch over stdio):

| measure | v1.8.0 hybrid | v1.9.0 hybrid |
|---|---|---|
| answer @1 / @3 / @8 | 13 / 19 / 21 of 24 | 15 / 19 / 23 of 24 |
| negatives flagged | 0/6 | 6/6 |
| correct #1 answers wrongly flagged | 0 | 4 of 15 |
| archive hits | 0 | 0 |
| mean payload per search | 16,711 B | 6,391 B |

**Target missed:** the plan's answer @1 >= 0.80 was not met (62.5% real corpus, 66% fixture). The misses sit at rank 2 to 5 behind a changelog or reference page that mentions the topic; @3 is 79% and @8 96%. @1 rose, never fell. Known limit, not fixed: `stripMarkdown` drops table rows and inline code before indexing, so identifiers that live only in config tables are not searchable.

## Freshness, before and after

This repo's `.documentation/` copy (137 docs / 255 chunks) unless noted.

| state | before | after |
|---|---|---|
| clean cold start to first answer | 1,352 ms | 431 ms |
| 10 docs edited while the server was down | 8.6% stale vectors; 1,839 ms (full re-parse) | 0% stale; 915 ms (those 10 re-parsed and re-embedded) |
| every file touched, no content change | full re-parse | 459 ms, nothing re-embedded |
| cold start, real corpus, warm cache | 1,409 ms | 844 ms |
| inotify watches | one per file plus one per directory (629 for 537 files + 92 dirs) | 0 |
| 1,000-doc tree, warm start to first answer | n/a | 511-524 ms |
| 1,000-doc tree, edit one doc, next search | full reindex | 32-67 ms |
| edit while a reindex runs | dropped | picked up by the next call |
| save | 5 direct writes, no lock | temp+rename, meta last, `index.lock` |

## Upgrading

Nothing to do. The first start after upgrade re-parses once (schema version bump). Correction: v1.9.0 also re-embedded everything (it kept no old vectors); v1.9.1 migrates them. Offline tarball: 532 MB (was about 0.55 GB expected); the reranker model is not bundled.
