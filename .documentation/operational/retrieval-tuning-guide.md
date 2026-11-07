---
title: Retrieval Tuning Guide
tier: guide
domains:
  - operational
audience:
  - developers
  - admin
tags:
  - retrieval
  - search_hybrid
  - bm25
  - score-fusion
  - rerank
  - confidence
  - no_strong_match
  - path_class
  - eval
status: active
last_updated: '2026-11-06'
version: 1.9.1
purpose: How search_hybrid ranks, what confidence and no_strong_match mean,
  which knobs exist (path_class.exclude, graph.exclude_hubs, rerank), and how to
  run and extend the retrieval eval.
load_priority: 6
estimated_read_time: 4 minutes
word_count: 606
last_validated: '2026-11-07'
backlinks: []
---

# Retrieval Tuning Guide

Since v1.9.0 `search_hybrid` is the tool to ask a question with. This guide covers what it does, what you can tune, and how to check a change with the eval. The measured before/after is in the [v1.9.0 changelog](../changelog/v1-9-0-retrieval-graph-quality.md).

## How a query is ranked

1. **Vector arm**: cosine over chunk embeddings (one result per doc). HNSW runs with `ef = max(100, k)` so recall vs exact cosine is 0.999 ([KB fact](../knowledge-base/facts/hnswlib-ef-defaults-to-10.md)).
2. **Lexical arm**: an in-house BM25 index (`src/core/bm25.ts`, no dependency). Each chunk is indexed with its doc's `title`, `purpose` and path tokens (split on `/ . - _`) prepended; the returned text is unchanged. A chunk counts only when it matches at least `min(2, query terms)` query terms.
3. **Boosts on each list before fusion**: `load_priority`, confidence decay, usage boost and `path_class` multipliers.
4. **Score fusion** per doc (best chunk): `0.7 * cosine + 0.3 * bm25 / max(bm25 over candidates)`. With no BM25 hits the order is pure cosine. Rank-only RRF was replaced because it let a weak lexical arm displace a strong #1 ([KB fact](../knowledge-base/facts/rank-only-rrf-lets-a-weak-arm-displace-a-strong-first.md)). The 0.7 weight was swept on the train splits only and left at 0.7.
5. **Graph boost**: x1.3 for a doc linked to one of the top 5 semantic hits.
6. **Content-hash dedup**: a live doc and a byte-identical archived copy collapse to the live one.
7. **Optional cross-encoder rerank** (off by default, below).

Paths in `path_class.exclude` are never indexed (no chunks, vectors or BM25 entries); they stay graph-only nodes so `supersedes` edges resolve. Paths in `results.exclude` are indexed but dropped from results.

`search_semantic` stays vector-only and `search_text` stays literal (ranked by match count, then match density), so the arms can still be compared. The CLI/hook path uses the same fusion helper.

## Reading the result

Each result carries `path`, `title` (the doc's frontmatter or parsed title), `score`, `confidence` (0-1), a ~600-char `excerpt` centred on the match, and `decay` / `usage` blocks when they apply. Pass `full: true` for the old whole-chunk shape.

- **`confidence`** = the doc's cosine, plus 0.1 when BM25 also returned it (the margin term was noise and is gone).
- **`no_strong_match: true`** appears on every result when the best cosine is under 0.36 AND the best BM25 score is under 0.8 x the index's threshold. Read it as "weak match, verify before citing", not "not documented". `search_semantic` has no BM25 arm, so cosine alone decides. The results are still returned.
- **Calibration:** the BM25 threshold is derived per index, not a constant: `bm25SelfTop` in `meta.json` is the median top BM25 score of each titled doc's title used as its own query (up to 200 docs), 5.72 on the fixture and 12.24 on `.documentation/`. 0.36 and 0.8 were chosen on the train splits only (all 24 train negatives flagged, 3/59 answerable flagged). On the held-out sets the targets were missed: fixture false flags 26%, real held-out 7 of 8 negatives flagged. Re-check on your own corpus before relying on it.
- **`related`** on the #1 result lists up to 3 linked docs that match on their own (cosine plus lexical bonus >= 0.50). It is skipped when #1 is `no_strong_match`.
- **`_meta.stale`** means the index was loaded from disk (including an older-format index during an upgrade) and the first reconcile has not finished; results may lag recent edits.

## Knobs (`vault.schema.yml`)

```yaml
path_class:
  enabled: true
  rules:
    - glob: "**/archive/**"
      multiplier: 0.3
  exclude:
    - "**/archive/**"      # not indexed at all; set exclude: [] to keep archived notes (down-weighted)

results:
  exclude:                 # indexed, but dropped from results
    - "**/INDEX.md"
    - "**/REGISTRY.md"
    - "**/reports/link-check-*.md"

graph:
  exclude_hubs:            # generated hub files link to everything; they are left out of the graph
    - "**/INDEX.md"
    - "**/REGISTRY.md"

rerank:
  enabled: false           # Xenova/ms-marco-MiniLM-L-6-v2 over the top 30 fused results
  model: "Xenova/ms-marco-MiniLM-L-6-v2"
```

- Globs match with `dot: true`, so `.documentation/archive/` is covered. Plain minimatch `**` skips dot-dirs (see the [KB fact](../knowledge-base/facts/minimatch-star-star-skips-dot-dirs.md)).
- Changing `path_class.exclude` changes the index's ignore-glob hash, so the corpus is re-parsed on the next start (vectors are reused by chunk text).
- `results.exclude` applies to semantic, hybrid, graph seeds and text search, even when `path_class.enabled` is false.
- `graph.exclude_hubs` is read at server start; a change needs a restart.
- `search_text` honours `path_class.exclude` unless the call passes an explicit `pathGlob`.
- **Rerank stays off.** The only variants that raised @1 (+1 case of 35, within noise) cost about 0.7 s per search against a 150 ms bar, and the fast variants lost the gain. Turning it on downloads about 90 MB on first use; if the model cannot load, the fused order is used and a line is logged once.
- **The embedder stays MiniLM.** `bge-small` and `gte-small` were no better on `search_hybrid` and raised negative cosines to 0.5-0.8, which breaks abstention.

## Graph edges

`backlinks`, `forwardlinks`, `graph_path` and `search_graph` take a `types` filter. Default edges: `link` (markdown `](x.md)`), `wikilink`, `related`, `cites`, `same-incident`. Opt in with `supersedes` (live to archived copy) or `tag` (shared-topic neighbours; excluded by default because it made backlinks equal forwardlinks). `search_graph` seeds from the top 5 semantic hits of the concept, not from a substring match.

## Running the eval

```bash
npm run eval                       # fixture docs vault (test/fixtures/docs-vault), 3 arms, CI step
EVAL_RERANK=1 npm run eval         # try the reranker
EVAL_MODEL=<hf-model> npm run eval # try another 384-d embedder
node scripts/retrieval-eval/stale-audit.mjs <notes>   # stale vectors, orphans, index vs disk
node scripts/retrieval-eval/real-corpus.mjs           # own questions against a real docs tree
node scripts/retrieval-eval/mine-selection.mjs        # draft eval questions from selection.jsonl (hand review)
```

The gate is `test/retrieval-eval/baseline.json`: @1 floors per arm, archive hits, `answeredFlagged` and `meanBytes` ceilings, link precision and recall. Raise a floor when a change earns it. Add cases to `test/retrieval-eval/golden.jsonl` with `facets` (regexes the answer must match), `negative: true` for questions the corpus does not answer.

**Splits and gates (v1.9.1).** Four splits: fixture train (`golden-docs.jsonl`), fixture held-out (`golden-docs-heldout.jsonl`), real train (`real-corpus.jsonl`) and real held-out (`real-corpus-heldout.jsonl`, against `.documentation/`). Tune weights and thresholds on train only; held-out is written before a ranking change and reported as measured. Gates on every split: hybrid @1 >= semantic @1 - 1, paraphrase-tier hybrid @1 >= semantic's, all negatives flagged, answerable false flags <= 10%, plus HNSW recall@k >= 0.97 vs exact cosine. Gates v1.9.1 still misses run as `it.fails` (expected failures) and flip red when fixed; see the [v1.9.1 changelog](../changelog/v1-9-1-ranking-regression.md).

## See also

- [Indices and storage](../architecture/indices-and-storage.md)
- [Configuration reference](../reference/configuration-reference.md)
- [Tests and validation](../testing/tests-and-validation.md)
