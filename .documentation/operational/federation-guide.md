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
last_updated: '2026-11-11'
version: 1.29.0
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
last_validated: '2026-11-11'
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
    - label: legacy
      path: ../frozen-docs
      default: false                     # opt-in: searched only when a call names it
      locked: true                       # indexed once, never reconciled
  related_repos: true                    # default; false opts out; "opt-in" adds them as default: false
  cold_storage: true                     # false ignores hewtd's cold generations (long-term memory)
```

- `label` must match `[\w.-]+`. `primary` and `long-term` are reserved (this vault, and every old docs generation).
- `default` (true): `false` makes the source opt-in. It is not built, loaded or counted by a call that does not name it (`sources: ["legacy"]`, CLI `--source legacy`). Output of calls that do not name it is byte-identical to a vault without the source.
- `locked` (false): the source is indexed once and never reconciled, and nothing is written into its folder, so it can sit on a read-only mount. If the folder changes later, the old index keeps answering with a `changed since it was indexed` note (a mismatch against a manifest checksum skips it instead). Rebuild on purpose with `search --source <label> --reindex` or the MCP `reindex {source}`. A bad `default` or `locked` value drops the source with a warning. `default: true, locked: true` is allowed but unusual.
- `locked` sources do not follow symlinks.
- `related_repos`: when hit-em-with-the-docs 2.21+ has `reconcile.related_repos: [{name, path}]` in `.claude/hit-em-with-the-docs.json`, each sibling repo's docs tree (its `docs_root`, or `docs_path` before hewtd 3.0, else `.documentation`) joins as a source named `name`. **This is on by default: a vault whose hewtd config lists related repos federates with no semantic-memory setting.** Without the hewtd config nothing changes. A docs folder that points outside the sibling is ignored. Turn it off with `federation: {related_repos: false}`, or use `related_repos: opt-in` to register them as `default: false` sources. Any other value warns and means `true`.
- `cold_storage`: hit-em-with-the-docs' `cold_storage` manifest lists old docs generations; each becomes a locked, opt-in source `cold-<date>`, checked against its checksum and with its `secrets_findings` files left out of the index. `federation: {cold_storage: false}` ignores them. See the [long-term memory guide](./long-term-memory-guide.md).
- Bad entries are dropped with one warning on stderr; bad YAML or JSON never stops the server. Duplicates (same real path, then same label) are dropped.
- A source's own `federation` block is ignored (no recursion). Two servers that federate each other each show the other's docs.

## What you get

- Sources are indexed read-only with this vault's model, under `<index>/sources/<label>-<hash>/`. Nothing is written into a source. The first build runs in the background.
- Each ready source runs the same hybrid pipeline from one query embedding. Pages are merged keeping each source's order; BM25 is rescaled by the source's own `selfTop` (capped at 1) and multiplied by its weight, so a large source does not drown a small one.
- Items carry `source` (`primary` or the label) when a federated merge ran. `content[0]` is still a plain JSON array. A source's own reranker is turned off.
- `read_note` takes `source`; omit it or pass `primary` for this vault. It also resolves opt-in labels and refuses a path in a source's `secrets_findings`.
- `search_hybrid`, `search_semantic` and `search_text` take `sources` (labels; `primary` adds this vault and the default set; without it only the named sources are searched). Hits from a cold generation carry `historical: {generation, source_commit, rotated_at}`. `get_stats` lists `sources` (label, default, locked, state, generation) when any exist.
- Telemetry logs source hits as `label:path`.
- Without `sources`, only `search_hybrid` federates (the default sources); `search_semantic` and `search_text` federate only when `sources` is passed.

## Gotchas

- A source that was missing, unreadable or still indexing at the first search is reported once (stderr and a trailing text block) and stays skipped until the server restarts.
- A stale source is noted in the trailing block and sets `_meta.stale`.
- While the primary is still indexing, the indexing message is returned even if a source is ready.
- Cost on a 183-doc corpus: about +16 MB heap and +40 MB RSS per source; p95 10.5 ms with none, 16.3 ms with one, 19.5 ms with three. A larger source costs proportionally more.

## Checks

`test/retrieval-eval/federation-eval.test.ts` gates federated found@3 above either index alone and per-source @1 within one case of that source alone (train and held-out). Opt-in and locked sources (1.29.0): [long-term memory guide](./long-term-memory-guide.md), [v1.29.0 changelog](../changelog/v1-29-0-long-term-memory.md). See the [v1.19.0 changelog](../changelog/v1-19-0-federated-search.md) and the [configuration reference](../reference/configuration-reference.md#federation-vaultschemayml--v1190).
