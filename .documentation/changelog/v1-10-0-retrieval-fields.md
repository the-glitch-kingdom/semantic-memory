---
title: v1.10.0 — retrieval-ready fields
tier: reference
domains:
  - changelog
audience:
  - developers
  - admin
tags:
  - v1.10.0
  - retrieval
  - frontmatter
  - symptoms
  - index_fields
  - meta_weight
  - generated
  - issue-44
  - issue-45
status: active
last_updated: '2026-11-07'
version: 1.10.0
purpose: What v1.10.0 changed so the frontmatter fields authors write to be
  found are searchable (issues 44 and 45), with measured before/after per split
  and tier, and the targets that were missed.
load_priority: 5
estimated_read_time: 4 minutes
word_count: 772
last_validated: '2026-11-07'
backlinks: []
---

# v1.10.0 — retrieval-ready fields

Issues #44 (index the fields) and #45 (whole-doc coverage, link prior, agent guidance, per-tier gates). **This release includes v1.9.1** ([ranking regression fix](./v1-9-1-ranking-regression.md)), which was merged but never published; npm goes 1.9.0 to 1.10.0. Tuning detail and negative results: [retrieval tuning guide](../operational/retrieval-tuning-guide.md).

## What changed

- **Field channels.** `title`, `purpose`, `summary`, `description`, `keywords`, `tags` and `symptoms` feed the BM25 field text. Object-form `symptoms` (the hit-em-with-the-docs playbook shape) are read: `user_phrase` (string or list), `error_pattern`, `alert_name`; `target`, `cites` and `severity` are not indexed. Path tokens stay in.
- **Metadata vectors.** `purpose` / `summary` / `description` and each symptom phrase are embedded as extra chunks (`kind: meta` + field), keyed `sha256(model \0 text)`. A doc's vector score is `max(best body cosine, meta_weight x best meta cosine)`. `error_pattern` is BM25 only (embedding it changed no train answer). The v1.4 string-symptom chunk path is replaced by this one mechanism.
- **`matched`.** When a metadata chunk wins, the result carries `matched: { field, text }`; the excerpt is still the best body chunk. `title` is the frontmatter title.
- **`index_fields`** in `vault.schema.yml` (`lexical`, `vector`, `symptom_keys`, `meta_weight` 0.8). A field-list change re-parses; only changed metadata embeds.
- **`generated: true`** docs are never chunked, embedded, returned, graph nodes, hubs or link-prior targets (#43's globs remain the fallback).
- **Coverage report.** `get_stats` and `lint_vault` report `fieldCoverage`, the share of docs carrying each indexed field.
- **`ranking:`** (`coverage_weight`, `link_prior`, `link_prior_min_links`): whole-doc idf coverage and a link prior, shared by MCP and CLI. **Shipped off** (0 / 1 / 5): they did not help on train.
- **Agent guidance** (read the top 3 excerpts for broad questions; search each step separately) in the `search_hybrid` description, server instructions and both `semantic-first` / `vault-first` skills.
- **Gates.** `baseline.json` `tiers` floors (@1 and @3, every tier, both arms) on all four splits; new eval tiers `symptom` and `nofield`; the fixture gained object-symptom playbooks, field docs, no-field docs and `generated: true` files.
- **Upgrade.** Schema 4 to 5: body vectors are reused, only metadata texts embed; the old index answers (stale) meanwhile.

## Retrieval, before and after

Hybrid answer @1 / @3 (n answerable). "Before" is v1.9.1 ranking on the same questions (Phase 2 baseline); "after" is v1.10.0. Fixture train grew from 49 to 57 cases in Phase 4 (8 new train questions), so its "after" n is larger.

| Split | before @1 / @3 | after @1 / @3 | semantic @1 now |
|---|---|---|---|
| fixture train | 25 / 38 (49) | 39 / 51 (57 cases, 51 answerable) | 39 |
| fixture held-out | 20 / 26 (36) | 22 / 29 (36) | 23 |
| real train | 20 / 25 (27) | 21 / 27 (27) | 15 |
| real held-out | 14 / 23 (27) | 14 / 23 (27) | 13 |

Per tier, hybrid @1 (before -> after; n differs on fixture train):

| Tier | fixture train | fixture held-out | real train | real held-out |
|---|---|---|---|---|
| exact | 12 -> 12 | 4 -> 4 | 9 -> 9 | 1 -> 1 |
| paraphrase | 7 -> 14 (of 20) | 12 -> 12 | 5 -> 5 | 10 -> 10 |
| symptom | 0 -> 6 (of 6) | 0 -> 3 (of 3) | - | - |
| nofield | 2 -> 2 | 2 -> 1 | - | - |
| multi-doc | 4 -> 5 | 2 -> 2 (of 6) | 6 -> 7 | 3 -> 3 |

Abstention (`no_strong_match`), after: fixture train negatives 11/12 flagged, false flags 5/51 (9.8%); fixture held-out 7/8 and 7/36; real train 12/12 and 0; real held-out 7/8 and 2/27. HNSW recall 1.000.

## Missed targets

- **Held-out paraphrase did not improve** (fixture 12 -> 12, real 10 -> 10); hybrid is still behind semantic on fixture paraphrase (train 14 vs 18, held-out 12 vs 13). Path-token and title matches beat the body answer; no train-only knob closed it.
- **Coverage and link prior did not reproduce the issue's gain** and ship off. The multi-doc tier did not move by their doing.
- **Abstention rule not met** on fixture train (11/12 negatives), fixture held-out and real held-out (7/8). These stay expected-failure gates.
- **Coverage bias** visible on one held-out case: fixture held-out nofield 2 -> 1 (not tuned).
- Semantic fixture-train exact @3 13 -> 12 (the alert name embeds close to a dead-letter question; dropping it lost a symptom case).
- The answer packet (#45) and `broad_query` flag were not built (no measured gain / need).

## Upgrading

No action. The first start re-parses and embeds metadata chunks only. Set `index_fields` to change the field lists; try `ranking.coverage_weight: 0.3` only after measuring on your corpus.
