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
last_updated: '2026-11-07'
version: 1.10.0
purpose: How search_hybrid ranks, how frontmatter fields are indexed, what confidence and no_strong_match mean,
  which knobs exist (index_fields, ranking, path_class.exclude, graph.exclude_hubs, rerank), what lost, and how to
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

1. **Vector arm**: cosine over chunk embeddings (one result per doc). Since v1.10 a doc's score is `max(best body cosine, meta_weight x best metadata cosine)`, where metadata chunks are the embedded `purpose` / `summary` / `description` and each symptom phrase (below). HNSW runs with `ef = max(100, k)` so recall vs exact cosine is 0.999 ([KB fact](../knowledge-base/facts/hnswlib-ef-defaults-to-10.md)).
2. **Lexical arm**: an in-house BM25 index (`src/core/bm25.ts`, no dependency). Each chunk is indexed with its doc's field text (v1.10: `title`, `purpose`, `summary`, `description`, `keywords`, `tags`, `symptoms`) and path tokens (split on `/ . - _`) prepended; the returned text is unchanged. A chunk counts only when it matches at least `min(2, query terms)` query terms.
3. **Boosts on each list before fusion**: `load_priority`, confidence decay, usage boost and `path_class` multipliers.
4. **Score fusion** per doc (best chunk): `0.7 * cosine + 0.3 * bm25 / max(bm25 over candidates)`. With no BM25 hits the order is pure cosine. Rank-only RRF was replaced because it let a weak lexical arm displace a strong #1 ([KB fact](../knowledge-base/facts/rank-only-rrf-lets-a-weak-arm-displace-a-strong-first.md)). The 0.7 weight was swept on the train splits only and left at 0.7.
5. **Graph boost**: removed in v1.11.0 (see Trials below).
6. **Content-hash dedup**: a live doc and a byte-identical archived copy collapse to the live one.
7. **Optional cross-encoder rerank** (off by default, below).

Between 4 and 5 sits an optional whole-doc **coverage** boost and **link prior** (`ranking:`), both off by default (below).

Paths in `path_class.exclude` are never indexed (no chunks, vectors or BM25 entries); they stay graph-only nodes so `supersedes` edges resolve. Paths in `results.exclude` are indexed but dropped from results.

`search_semantic` stays vector-only and `search_text` stays literal (ranked by match count, then match density), so the arms can still be compared. The CLI/hook path uses the same fusion helper.

## Reading the result

Each result carries `path`, `title` (the doc's frontmatter or parsed title), `matched: { field, text }` when a metadata chunk won (the excerpt is still the best body chunk), `score`, `confidence` (0-1), a ~600-char `excerpt` centred on the match, and `decay` / `usage` blocks when they apply. Pass `full: true` for the old whole-chunk shape.

- **`confidence`** = the doc's cosine, plus 0.1 when BM25 also returned it (the margin term was noise and is gone).
- **`no_strong_match: true`** appears on every result when the best cosine is under 0.36 AND the best BM25 score is under 0.8 x the index's threshold. Read it as "weak match, verify before citing", not "not documented". `search_semantic` has no BM25 arm, so cosine alone decides. The results are still returned.
- **`missing_terms`** (v1.14.0) lists identifiers in the query (snake_case, ALL_CAPS with an underscore, camelCase, paths, dotted names, backticked spans) that no indexed doc contains, as a BM25 term lookup. When it is non-empty, `no_strong_match` is true too: the flag is the score rule OR a missing identifier. Read it as "not in the docs", since the name may exist in code. Plain-English queries never get it. A file named after the identifier counts as present ([KB fact](../knowledge-base/facts/path-words-replace-underscores-with-spaces.md)); a doc that only spells it with hyphens or spaces does not. Identifier negatives flagged: 8/8 in all four eval splits (was 3, 3, 2, 1 of 8). See [v1.14.0](../changelog/v1-14-0-identifier-abstention.md).
- **Names and `passing_terms`** (v1.23.0): `missing_terms` also lists product and tool names (`Hotjar`, `tRPC`, `k8s`, lowercase words not in the word list) that no doc has, and `passing_terms` lists a name in at most 1 doc and in none of the top 3 results; both set `no_strong_match`. A name that opens the query is not checked. Expect about 1% false flags from plain compound words. See [v1.23.0](../changelog/v1-23-0-abstention-product-names.md).
- **Presence rules** (v1.25.0): presence counts only docs a search can return, and `autofill` is present when a doc writes `auto-fill`, `auto_fill`, `AutoFill` or a Title Case run. See [presence rules](#presence-rules-v1250).
- **Calibration:** the BM25 threshold is derived per index, not a constant: `bm25SelfTop` in `meta.json` is the median top BM25 score of each titled doc's title used as its own query (up to 200 docs), 5.72 on the fixture and 12.24 on `.documentation/`. 0.36 and 0.8 were chosen on the train splits only (all 24 train negatives flagged, 3/59 answerable flagged). On the held-out sets the targets were missed: fixture false flags 26%, real held-out 7 of 8 negatives flagged. Re-check on your own corpus before relying on it.
- **`related`** on the #1 result lists up to 3 linked docs that match on their own (cosine plus lexical bonus >= 0.50). It is skipped when #1 is `no_strong_match`.
- **Stale marker** (v1.11): when the index was loaded from disk (including an older-format index during an upgrade) and the first reconcile has not finished, `search_hybrid`, `search_semantic` and `search_text` end with a separate `[stale: ...]` text block; re-run to confirm. `_meta.stale` is also set, but Claude Code does not show `_meta` to the model ([KB fact](../knowledge-base/facts/mcp-meta-is-not-shown-to-the-model.md)).

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

## What the indexed text keeps (v1.12)

`stripMarkdown` produces the one text used for BM25, vectors and `search_text`. It keeps inline code contents (backticks dropped), fenced code contents (the fence lines dropped, any indent), and table cells (space-separated; separator rows dropped). `snake_case_name` stays one token; `*`, `~~` and `_` are removed only at word edges (`2*3` is kept). Known shortcut: `__init__` outside code loses its underscores.

**Embed-text choice.** Option (a), the same kept text for vectors and BM25, beat option (b), dropping fenced contents from the embedded text, on the train splits (real-train hybrid 22 vs 20, semantic equal at 19). Held-out was not used to choose. Cost: some prose tiers lose a case, real-train hybrid negatives flagged 12/12 to 9/12 (code tokens raise BM25 on off-topic queries), and cold index time can double on a docs tree with many code blocks. Numbers: [v1.12.0 changelog](../changelog/v1-12-0-index-text-pooling-body-dates.md).

## Section chunks and folding (v1.17)

Chunks split at headings with the trail in the embedded text; this lowered a few existing floors and abstention (real held-out negatives flagged 5/8). Folding rules and numbers: [v1.17.0 changelog](../changelog/v1-17-0-section-results.md).

## Query routing (v1.18)

`classifyQuery` (`src/core/query-type.ts`) is rules only and never changes ranking; flow questions get `reading_path` from `GraphBuilder.walk` (restart 0.15, 300 nodes, 20 steps, degree cap 50, seeds above 0.36). Classifier accuracy, walk numbers and the missed multi-tier target: [v1.18.0 changelog](../changelog/v1-18-0-query-routing.md).

## Trying another embedder (v1.12)

```bash
semantic-memory serve --model BAAI/bge-small-en-v1.5   # pooling and prompt come from the model's own config
```

Override with `embedding.pooling` / `embedding.query_prompt` in `vault.schema.yml` or `--pooling` / `--query-prompt`. The first start re-embeds everything. Judge it on your own questions with `EVAL_MODEL=<model> npx vitest run test/retrieval-eval`; floors fail for other models by construction, and the abstention cutoff (0.36) is calibrated on MiniLM, so other models flag no negatives. On our splits bge-small and arctic-s (right pooling and prompt) did not beat MiniLM, so the default stays. Not supported: models that need a document prefix (nomic-embed).

## Field channels (v1.10)

```yaml
index_fields:
  lexical: [title, purpose, summary, description, keywords, tags, symptoms]
  vector: [purpose, summary, description, symptoms]
  symptom_keys: [user_phrase, error_pattern, alert_name]
  meta_weight: 0.8
ranking:
  coverage_weight: 0     # off
  link_prior: 1          # off
  link_prior_min_links: 5
```

- **Object symptoms** (hit-em-with-the-docs playbooks) are read through `symptom_keys`; `user_phrase` may be a string or a list. `error_pattern` is regex text, so it feeds BM25 only. `target`, `cites` and `severity` are never indexed. Field contract: see the [configuration reference](../reference/configuration-reference.md#index_fields-vaultschemayml---v1100).
- **`meta_weight` 0.8** was picked on train: accuracy is flat within one case from 0.7 to 1.1, while abstention is not (metadata chunks of unrelated notes raise a negative's best cosine; 0.8 is the highest weight that kept every real-train negative flagged). Re-measured in v1.11.0 on train (including a metadata-rich subset): 1.0 gained one case on real train (noise) and lost 1 to 2 negatives; raise it only where `purpose` / `symptoms` are good and missed answers cost more than missed abstentions.
- **Coverage bias.** Docs with no fields get no metadata chunks, so a purpose-carrying neighbour can outrank them. The eval's `nofield` tier measures it (held-out 2 -> 1 in v1.10.0). `get_stats` / `lint_vault` report `fieldCoverage`; if a field is rare in your corpus, fill it in before trusting the channel.
- A field-list change re-parses the corpus; vectors are keyed by text, so only changed metadata embeds. `meta_weight` is search-time only.
- `generated: true` docs are never indexed or returned, and are not graph nodes.

## Trials that lost or were not built

Recorded so nobody repeats them (train splits; held-out read afterwards, same direction).

- **Coverage boost** (`score *= 1 + w * cover`, w 0.1-0.6): no answer gained; cost one real-train paraphrase @1 and one fixture @3. At 0.6 it over-weights checklists (fixture exact 12 -> 11). The overview-vs-narrow-doc case works in a unit test, but fusion already ranks our overview questions first. Shipped wired, off.
- **Link prior** (1.1 at >= 5 links, also 10 and 20): a net loss on the real corpus; link-heavy reference docs displace the specific doc. Shipped wired, off.
- **Answer packet** (#45 section 2): top-3 coverage 0.92 with and without. Not built. The `broad_query` flag is not built either; the read-top-3 / search-each-step guidance covers it.
- **Embedding `error_pattern`**: identical train tables, so BM25 only. **Dropping `alert_name` from vectors**: lost a symptom case, kept.
- **Field-term BM25 weight** (field text at 0.5 / 0.25 of a body term): no fixture change, real train -1; reverted. **`BM25_FRACTION` 0.9-1.2, `NO_STRONG_MATCH_BELOW` 0.38-0.40**: no train gain, false flags rose; unchanged. `COSINE_WEIGHT` 0.7-0.9: arms pull opposite ways; kept 0.7.
- **Graph boost** (v1.11.0; hybrid answer @1, fixture train / held-out, real train / held-out): 1.0 = 38 / 25 / 22 / 14, 1.1 = 38 / 24 / 23 / 14, the old 1.3 = 39 / 22 / 21 / 13. Train chose 1.0 (the real-train +1 for 1.1 is noise), so the boost is removed.
- **Abstention at 0.45** flags every train negative but falsely flags 22% / 31% / 11% of answerable questions (fixture train / held-out, real train), over the 10% ceiling. A top-1/top-2 gap rule and a stricter BM25 rule added no negative within the ceiling. 0.36 kept.
- **Multi-doc recall** (v1.24.0): a distinct-doc candidate pool, a second-strong-chunk bonus, a single-chunk dampener and dropping runtime paths from export dead refs all lost or did nothing on multi @8; see [v1.24.0](../changelog/v1-24-0-multi-doc-recall.md).
- Open: the lexical paraphrase gap (path-token and title matches beating the body answer) and abstention on the held-out sets.

## Graph edges

`backlinks`, `forwardlinks`, `graph_path` and `search_graph` take a `types` filter. Default edges: `link` (markdown `](x.md)`), `wikilink`, `related`, `cites`, `same-incident`. Opt in with `supersedes` (live to archived copy) or `tag` (shared-topic neighbours; excluded by default because it made backlinks equal forwardlinks). `search_graph` seeds from the top 5 semantic hits of the concept, not from a substring match.

## Running the eval

```bash
npm run eval                       # fixture docs vault (test/fixtures/docs-vault), 3 arms, CI step
EVAL_RERANK=1 npm run eval         # try the reranker
EVAL_MODEL=<hf-model> npm run eval # try another 384-d embedder
node scripts/retrieval-eval/stale-audit.mjs <notes>   # stale vectors, orphans, index vs disk
node scripts/retrieval-eval/real-corpus.mjs           # own questions against a real docs tree
semantic-memory usage-set                                # usage.jsonl -> eval/usage.jsonl (searches that ended in a used doc); `eval` loads it
```

The gate is `test/retrieval-eval/baseline.json`: @1 floors per arm, archive hits, `answeredFlagged` and `meanBytes` ceilings, link precision and recall. Raise a floor when a change earns it. Add cases to `test/retrieval-eval/golden.jsonl` with `facets` (regexes the answer must match), `negative: true` for questions the corpus does not answer.

**Tier floors (v1.10).** `baseline.json` `tiers` holds answer@1 and @3 floors for every tier (exact, paraphrase, symptom, nofield, multi, all) per arm and split; the eval fails when any drops. Fixture floors are exact; real-corpus floors sit one below the measured run (random HNSW). Raise a floor when a change earns it.

**Splits and gates (v1.9.1).** Four splits: fixture train (`golden-docs.jsonl`), fixture held-out (`golden-docs-heldout.jsonl`), real train (`real-corpus.jsonl`) and real held-out (`real-corpus-heldout.jsonl`, against `.documentation/`). Tune weights and thresholds on train only; held-out is written before a ranking change and reported as measured. Gates on every split: hybrid @1 >= semantic @1 - 1, paraphrase-tier hybrid @1 >= semantic's, all negatives flagged, answerable false flags <= 10%, plus HNSW recall@k >= 0.97 vs exact cosine. Gates v1.9.1 still misses run as `it.fails` (expected failures) and flip red when fixed; see the [v1.9.1 changelog](../changelog/v1-9-1-ranking-regression.md).

## Chunk windows (v1.22)

Chunks are 1000 characters with a sentence of overlap (was 2000, schema 11); a doc still scores by its best chunk and `section`/`anchor` stay on the section. Chosen on train over plain windows and half-window strides; 800 and 1200 were not tried. Details and the missed hard-set target: [v1.22.0 changelog](../changelog/v1-22-0-mcp-metadata-gap-long-sections.md).

## Grounding and the doc chunk (v1.21)

Grounding ranks by dead refs only (`drift_penalty` 1); `drift_penalty: 0.97` or the `decay.code: false` switch are the knobs. Every doc also gets a `meta` chunk (`field: "doc"`: title, purpose, headings, first paragraph) scored with `meta_weight`; a doc scores as the max of its best section and that chunk, while `section` and `anchor` still come from the body (index schema 10, only the new chunks embed). The in-repo real-corpus eval copies only `.documentation`, so grounding never runs there: measure on a clone with `scripts/eval-against-release.sh` and gate with `npm run gate:release`. See the [v1.21.0 changelog](../changelog/v1-21-0-hub-doc-ranking.md).

## Measuring on your own vault (v1.13)

`semantic-memory eval --notes <dir>` runs the same engine on your own question sets, with `--baseline` / `--check` floors and a noise band of one question. See the [retrieval eval guide](./retrieval-eval-guide.md).

## See also

- [Retrieval eval guide](./retrieval-eval-guide.md)
- [Indices and storage](../architecture/indices-and-storage.md)
- [Configuration reference](../reference/configuration-reference.md)
- [v1.10.0 changelog](../changelog/v1-10-0-retrieval-fields.md)
- [Tests and validation](../testing/tests-and-validation.md)

## Presence rules (v1.25.0)
`missing_terms` and `passing_terms` ask "is this name in the docs", and the answer follows these rules ([v1.25.0](../changelog/v1-25-0-abstention-variants.md)):
- Only searchable docs count: not `generated: true`, `exclude`d or `results.exclude`d. A name only a hub mentions is missing ([KB fact](../knowledge-base/facts/hubs-without-generated-flag-make-absent-names-look-present.md)). Scoring still reads every indexed text.
- Spelling variants match: hyphen, underscore and Title Case runs in the docs are also indexed joined, for presence only (`auto-fill`, `auto_fill`, `AutoFill`, `Smart Retry` give `autofill`, `smartretry`). A lowercase prose pair with a space is not joined.
- A name equal to a file name ignoring case, `-` and `_` is `undocumented`, not missing.
- A lock file or config file never makes a name present: the code graph reads file names, not contents.
