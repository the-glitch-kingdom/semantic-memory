---
title: Federation guide
tier: guide
domains:
  - operational
audience:
  - developers
  - admin
tags:
  - federation
  - search-hybrid
  - related-repos
  - issue-62
status: active
last_updated: '2026-11-08'
version: 1.19.0
purpose: How to search other vaults and sibling docs trees from one
  search_hybrid call, what it costs, and its limits.
load_priority: 5
estimated_read_time: 2 minutes
sources:
  - src/core/federation.ts
  - src/core/federation-merge.ts
  - src/mcp/sources.ts
  - src/mcp/tools/search.ts
  - src/mcp/tools/read.ts
  - .claude/hit-em-with-the-docs.json
  - test/retrieval-eval/federation-eval.test.ts
backlinks: []
word_count: 387
last_validated: '2026-11-08'
---

# Federation guide

One `search_hybrid` call can search this vault and other docs trees (sources) and return one merged list. Off until a source is configured.

## Configure

In `<vault>/vault.schema.yml`:

```yaml
federation:
  sources:
    - label: platform-docs
      path: ../platform/.documentation   # relative to this vault
      weight: 1                          # optional, positive number
  related_repos: true                    # default; false opts out
```

- `label` must match `[\w.-]+`. `primary` is reserved for this vault.
- `related_repos`: when hit-em-with-the-docs 2.21+ has `reconcile.related_repos: [{name, path}]` in `.claude/hit-em-with-the-docs.json`, each sibling repo's docs tree (its `docs_root`, or `docs_path` before hewtd 3.0, else `.documentation`) joins as a source named `name`. **This is on by default: a vault whose hewtd config lists related repos federates with no semantic-memory setting.** Without the hewtd config nothing changes. A docs folder that points outside the sibling is ignored. Turn it off with `federation: {related_repos: false}`.
- Bad entries are dropped with one warning on stderr; bad YAML or JSON never stops the server. Duplicates (same real path, then same label) are dropped.
- A source's own `federation` block is ignored (no recursion). Two servers that federate each other each show the other's docs.

## What you get

- Sources are indexed read-only with this vault's model, under `<index>/sources/<label>-<hash>/`. Nothing is written into a source. The first build runs in the background.
- Each ready source runs the same hybrid pipeline from one query embedding. Pages are merged keeping each source's order; BM25 is rescaled by the source's own `selfTop` (capped at 1) and multiplied by its weight, so a large source does not drown a small one.
- Items carry `source` (`primary` or the label) when a federated merge ran. `content[0]` is still a plain JSON array. A source's own reranker is turned off.
- `read_note` takes `source`; omit it or pass `primary` for this vault.
- Telemetry logs source hits as `label:path`.
- Only `search_hybrid` and `read_note` are federated.

## Gotchas

- A source that was missing, unreadable or still indexing at the first search is reported once (stderr and a trailing text block) and stays skipped until the server restarts.
- A stale source is noted in the trailing block and sets `_meta.stale`.
- While the primary is still indexing, the indexing message is returned even if a source is ready.
- Cost on a 183-doc corpus: about +16 MB heap and +40 MB RSS per source; p95 10.5 ms with none, 16.3 ms with one, 19.5 ms with three. A larger source costs proportionally more.

## Checks

`test/retrieval-eval/federation-eval.test.ts` gates federated found@3 above either index alone and per-source @1 within one case of that source alone (train and held-out). See the [v1.19.0 changelog](../changelog/v1-19-0-federated-search.md) and the [configuration reference](../reference/configuration-reference.md#federation-vaultschemayml--v1190).
