---
title: v1.12.0 — code stays in the indexed text, pooling and query prompt from
  the model config, git decay by body change
tier: reference
domains:
  - changelog
audience:
  - developers
  - admin
tags:
  - v1.12.0
  - stripMarkdown
  - pooling
  - query-prompt
  - decay
  - git
  - issue-51
  - issue-52
  - issue-53
  - issue-54
status: active
last_updated: '2026-11-07'
version: 1.12.0
purpose: What v1.12.0 changed (issues 51 to 54) with measured before/after per
  split, the one-time re-embed on upgrade, the body-date decay rule, measured
  model results, and the targets that were missed.
load_priority: 5
estimated_read_time: 6 minutes
word_count: 1047
last_validated: '2026-11-07'
backlinks: []
---

# v1.12.0 — code stays in the indexed text, pooling and query prompt from the model config, git decay by body change

Issues #51 (leftovers), #52 (code stripped from the indexed text), #53 (pooling and query prompt) and #54 (git decay date moved by frontmatter-only commits). Tuning: [retrieval tuning guide](../operational/retrieval-tuning-guide.md). Decay: [decay guide](../operational/decay-guide.md). Keys: [configuration reference](../reference/configuration-reference.md).

## What changed

- **#51.** A YAML `title` that is a number or date (`title: 2024`) made `search_hybrid` throw `s.toLowerCase is not a function`. The indexer now makes the title a string (a Date becomes `YYYY-MM-DD`, an array is joined with spaces) and the BM25 self-check skips non-string titles. Background refresh errors log their stack. The "re-ranked by graph proximity" wording is gone from the tool descriptions and `AGENTS.md`. The 1.11.0 stale marker was already a separate trailing text block; the changelog wording is fixed.
- **#52 indexed text.** `stripMarkdown` keeps inline code contents, fenced code contents and table cell text (cells space-separated, separator rows dropped), and `snake_case_name` stays one token (`*`, `~~` and `_` are removed only at word edges). The same kept text feeds BM25, the vectors and `search_text`; there is no second text. `search_text` now finds an identifier that only appears in backticks, a table cell or a fenced block.
- **#53 pooling and prompt.** Pooling (`mean` or `cls`) and the query prompt are read from the model's own `1_Pooling/config.json` and `config_sentence_transformers.json` (fetched next to the model files). Only queries get the prompt (`embedQuery`); documents never do. Overrides: `embedding.pooling` and `embedding.query_prompt` in `vault.schema.yml`, or `serve --pooling` and `--query-prompt`. Precedence: CLI, schema, model config. The index records both, and a change forces a reindex. MiniLM vectors are byte-identical to 1.11.0.
- **#54 body dates.** In `git` mode the decay date is the date of the last commit that changed the note's body (the text after the frontmatter), not the last commit. A frontmatter-only commit (a bulk `last_validated` stamp) no longer resets the age. The `decay` block still says `source: "git"`; its `age_days` is the body age. Dates are computed at index time from one `git log --raw` and at most one `git cat-file --batch`; no git call runs per query.
- **Index schema 7.**

## Upgrade note

The first start after upgrading re-embeds every chunk once, because the indexed text changed (code, tables and identifiers are now in it). The old index answers while this runs and responses carry the `[stale: ...]` marker. All git dates are recomputed in the same pass. A user of a CLS model (bge, arctic) gets one more reindex, because pooling changes from mean to cls. A vault that sets nothing keeps MiniLM and mean pooling.

Notes that changed on disk since their last commit still get the flat `decay.missing_penalty` (0.85), not a git date; commit the edit to date the note. This was true in 1.11.0 and is unchanged.

## Measured (answer @1, one run each, HNSW is random per build)

| split | arm | v1.11.0 | v1.12.0 |
|---|---|---|---|
| fixture train (57) | semantic / hybrid | 39 / 38 | 42 / 43 |
| fixture held-out (36) | semantic / hybrid | 23 / 25 | 25 / 26 |
| real train (27) | semantic / hybrid | 15 / 21 | 19 / 22 |
| real held-out (27) | semantic / hybrid | 13 / 15 | 12 / 17 |

Code vault (20 answer docs, each with a same-topic distractor; answer first, 10 cases per split):

| split | semantic | hybrid | search_text |
|---|---|---|---|
| train | 9 to 10 | 9 to 10 | 2 to 10 |
| held-out | 5 to 10 | 6 to 10 | 2 to 10 |

Decay fixture, tier `frontmatter-touch` (body 400 days old, frontmatter-only commit today, against a verified twin): the touched doc now decays as 400 days (multiplier below 0.6) on both splits; held-out hybrid answer first 2/3 to 3/3.

Other embedders, with pooling and prompt read from their config (answer @1, semantic / hybrid): MiniLM, bge-small and arctic-s on real held-out are 12 / 17, 6 / 13 and 7 / 13; on real train 19 / 22, 12 / 20 and 12 / 18; on fixture train 42 / 43, 39 / 40 and 40 / 41. Neither beats MiniLM on any split, so the default stays. The abstention cutoff is calibrated on MiniLM, so other models flag no negatives; those counts say nothing about their ranking.

## Missed targets and negative results

- **#52 "paraphrase @1 within one question" is not met.** Keyword tiers held, but real held-out semantic paraphrase @1 fell 8 to 6 (@3 12 to 10, all @3 18 to 16), fixture-train semantic 18 to 17 and real-train hybrid 5 to 4. Floors were lowered, each recorded in the plan.
- **Real-train hybrid "every negative flagged" fell 12/12 to 9/12** (held-out 7/8 unchanged). Kept code tokens raise BM25 scores of off-topic queries. It is a known failure (`it.fails`), not fixed.
- **Cold index time roughly doubled** on a docs tree with many code blocks (14.9 s to 29.5 s in one noisy run); more chunks are kept. Not re-measured cleanly. The `search_hybrid` mean payload ceiling rose 4,575 to 4,750 B.
- **Option (b)** (drop fenced block contents from the embedded text) was measured on train and lost to the kept text (real-train hybrid 20 vs 22); held-out was not used to choose.
- **#53.** `nomic-embed-text-v1.5` needs `search_query: ` and `search_document: ` prefixes; only a query prompt is configurable, so it is documented, not supported, and not measured. The `--workers` embed path takes the pooling but has no CLS test. An offline start with no cached config files falls back to mean and records mean, so the next online start reindexes. The gain of the pooling fix on bge and arctic against their old mean-pooled numbers was not re-measured.
- **#54.** A body unchanged across more than 20 commits is dated at the 20th, so it decays slightly less than it should. A shallow clone dates old files at its boundary commit.
- **#51 not done (left in the issue by agreement):** identifier-aware fusion, a "#1 + related" metric, the blind set as a CI floor.
- **Release.** The offline tarball built during release prep (922 MB, holds extra cached models) predates the final text rule; rebuild it from a clean model cache and the merge commit before publishing.
