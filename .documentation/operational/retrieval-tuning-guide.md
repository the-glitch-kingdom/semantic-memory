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
  - rrf
  - rerank
  - confidence
  - no_strong_match
  - path_class
  - eval
status: active
last_updated: '2026-11-06'
version: 1.9.0
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

1. **Vector arm**: cosine over chunk embeddings (one result per doc).
2. **Lexical arm**: an in-house BM25 index (`src/core/bm25.ts`, no dependency). A chunk counts only when it matches at least `min(2, query terms)` query terms, so one incidental word in a short `symptoms:` chunk does not win.
3. **Boosts on each list before fusion**: `load_priority`, confidence decay, usage boost and `path_class` multipliers.
4. **Reciprocal rank fusion** (k = 60) of the two lists. Fused scores are scaled so a doc ranked first by both arms is 1.0; they are not cosines.
5. **Graph boost**: x1.3 for a doc linked to one of the top 5 semantic hits.
6. **Content-hash dedup**: a live doc and a byte-identical archived copy collapse to the live one.
7. **Optional cross-encoder rerank** (off by default, below).

`search_semantic` stays vector-only and `search_text` stays literal, so the arms can still be compared.

## Reading the result

Each result carries `path`, `title`, `score`, `confidence` (0-1), a ~600-char `excerpt` centred on the match, and `decay` / `usage` blocks when they apply. Pass `full: true` for the old whole-chunk shape.

- **`confidence`** = the doc's cosine, plus its margin over the best other result's cosine, plus 0.1 when BM25 also returned it.
- **`no_strong_match: true`** appears on every result when the top confidence is under 0.50: the corpus most likely does not document the question. Treat it as "not documented", do not quote the results as an answer. The results are still returned.
- **`related`** on the #1 result lists up to 3 linked docs that match on their own (cosine plus lexical bonus >= 0.50). It is skipped when #1 is `no_strong_match`.
- **`_meta.stale`** means the index was loaded from disk and the first reconcile has not finished; results may lag recent edits by a moment.

The 0.50 threshold is calibrated on the fixture (6 negatives, 35 answerable): it flags 6/6 negatives and 2/23 correct #1 answers. It is thin on both sides; re-check it on your own corpus before relying on it (`scripts/retrieval-eval/real-corpus.mjs`).

## Knobs (`vault.schema.yml`)

```yaml
path_class:
  enabled: true
  rules:
    - glob: "**/archive/**"
      multiplier: 0.3
  exclude:
    - "**/archive/**"      # dropped from results; set exclude: [] to keep archived notes (down-weighted)

graph:
  exclude_hubs:            # generated hub files link to everything; they are left out of the graph
    - "**/INDEX.md"
    - "**/REGISTRY.md"

rerank:
  enabled: false           # Xenova/ms-marco-MiniLM-L-6-v2 over the top 30 fused results
  model: "Xenova/ms-marco-MiniLM-L-6-v2"
```

- Globs match with `dot: true`, so `.documentation/archive/` is covered. Plain minimatch `**` skips dot-dirs (see the [KB fact](../knowledge-base/facts/minimatch-star-star-skips-dot-dirs.md)).
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

The gate is `test/retrieval-eval/baseline.json`: @1 floors per arm, archive hits, `answeredFlagged` and `meanBytes` ceilings, link precision and recall. Raise a floor when a change earns it; never lower one. Add cases to `test/retrieval-eval/golden.jsonl` with `facets` (regexes the answer must match), `negative: true` for questions the corpus does not answer.

## See also

- [Indices and storage](../architecture/indices-and-storage.md)
- [Configuration reference](../reference/configuration-reference.md)
- [Tests and validation](../testing/tests-and-validation.md)
