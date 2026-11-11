---
title: Long-term memory guide
tier: guide
domains:
  - operational
audience:
  - developers
  - admin
tags:
  - long-term-memory
  - cold-storage
  - federation
  - issue-93
status: active
last_updated: '2026-11-11'
version: 1.29.0
purpose: How to search old docs generations (long-term memory) on request, what
  is never searched by default, how to rebuild a frozen generation, and what the
  session-start notice means.
load_priority: 5
estimated_read_time: 4 minutes
sources:
  - src/core/cold.ts
  - src/core/federation.ts
  - src/mcp/sources.ts
  - src/mcp/tools/search.ts
  - src/cli/search-sources.ts
  - hooks/cold-notice.js
  - hooks/vault-context.js
  - test/integration/long-term-optin.test.ts
  - .claude/hit-em-with-the-docs.json
backlinks: []
word_count: 723
last_validated: '2026-11-11'
---

# Long-term memory guide

Old docs generations are frozen, read-only copies of a docs tree. They are searchable **on request only**: never in a plain search, never in the prompt hook's injected context, never counted in abstention (`no_strong_match`, `missing_terms`).

## Where generations come from

hit-em-with-the-docs 3.2+ rotates an outgoing docs tree into `.documentation-cold/<YYYY-MM-DD>[-N]/` (or `reconcile.cold_root`) and records it under `cold_storage` in `.claude/hit-em-with-the-docs.json`: `{generation, path, source_commit, rotated_at, checksum, disk_checksum, secrets_findings}`. Rotation, the secrets scan and undo belong to hit-em-with-the-docs; semantic-memory only searches the result.

Each registered generation becomes an opt-in, locked source labelled `cold-<generation>`. The reserved label `long-term` means every one of them. `primary` and `long-term` cannot be used as labels of your own sources.

## Search it

| Where | How |
|---|---|
| MCP tools | `search_hybrid`, `search_semantic` and `search_text` take `sources: ["long-term"]` (or one `cold-<date>` label). `["primary", "long-term"]` searches this vault and the history together. `read_note {path, source: "cold-<date>"}` reads a hit. |
| CLI | `semantic-memory search --notes .documentation --source long-term "what did we do about X"` (repeat `--source` for several). |
| Prompt | Say "search long-term memory for ...", "in the long-term memory ...", "check the old docs ...", "historically, what did we ..." or "back in 2025, what ...". The prompt hook then injects only a `<vault-context source="long-term">` block, marked as past behaviour, with each hit's generation date. |

Every hit carries `source: "cold-<date>"` and `historical: {generation, source_commit, rotated_at}`. A plain search carries neither. An unknown label, `sources: []` and "no source can answer" each get a plain-text message, never a silent fallback to the default set.

The first query builds the generation's index under `<index>/sources/` and answers "Indexing in progress" until it is ready; a ~900-file generation took about 48 s, then answers in ~30 ms (p95). Nothing is built or loaded by ordinary traffic.

## What is never searched by default

- Any source with `default: false`, which includes every cold generation.
- A file listed in `secrets_findings` (whole file, by path; not by line). It is not indexed and `read_note` refuses it.
- Symlinks inside a locked source (not followed, not listed).
- A generation whose checksum no longer matches the manifest, or that has no checksum.
- Everything, when `federation: {cold_storage: false}` is set in `vault.schema.yml`.

A generation's own `archive/` folder **is** searchable (the generation is history as a whole); its 0.3 archive multiplier still applies.

## Checksums

`checksum` and `disk_checksum` use hit-em-with-the-docs' definition: sha256 over the lines `relpath\0sha256(file)` (symlinks as `relpath\0link:sha256(target)`), sorted by path and joined with `\n` (no trailing newline). `disk_checksum` covers every file on disk; `checksum` covers only git-tracked files. A generation is accepted when the whole tree matches `disk_checksum`, or when the `git ls-files` subset matches `checksum` (a fresh clone lacks the gitignored files).

Limit: when only the tracked subset matches, an edit to a gitignored file is not caught. hit-em-with-the-docs' own audit does catch it.

## Locked sources: never reindexed behind your back

A locked source is indexed once, with nothing written into its folder, and is not reconciled afterwards. If the folder changes, the old index keeps answering and the response carries `[federation: source "x" changed since it was indexed ...]` (a source with a manifest checksum is instead skipped as a mismatch). Rebuild only on purpose:

```bash
semantic-memory search --notes .documentation --source cold-2026-11-11 --reindex "query"
```

or the MCP `reindex {source: "cold-2026-11-11"}`. `--reindex` rebuilds every `--source` named (`long-term` expands to all generations) and then searches. A locked source without a manifest checksum records its checksum at build time in `<index>/locked.json`; a rebuild re-records it.

## Session-start notice

`hooks/cold-notice.js` (SessionStart) prints one line per new registered generation, once (`.claude/.semantic-memory/cold-notified.json`), plus a line to the model. Problems show on every startup and resume; nothing shows on `clear`/`compact`, under `SEMANTIC_MEMORY_REVIEWER=1`, or without a cold folder.

| Status | Meaning | Fix |
|---|---|---|
| registered | In the manifest, folder present, checksum matches. Searchable. | none |
| unregistered | A folder under the cold root that the manifest does not list. | rotate with hit-em-with-the-docs, or register it |
| checksum-mismatch | The folder changed after it was registered. Skipped. | restore it, or re-register with a new checksum |
| missing-path | Registered but the folder is gone. | restore the folder |
| disabled | `federation.cold_storage: false`. | remove the setting |
| cold root inside the docs root / outside the repo | The root is ignored. | move `reconcile.cold_root` |

`semantic-memory healthcheck` reports the same statuses as its `cold-generations` finding.

## Cost

Measured on a 912-file generation: checksum 11 ms; with the generation configured, default searches are unchanged (`gate:release` against 1.28.0: identical counts, no index created under `sources/`). The checksum is recomputed on each session start and hook run (about 20 ms per 1,000 files).

See also: [federation guide](./federation-guide.md), [MCP tools reference](../reference/mcp-tools-reference.md), [CLI reference](../reference/cli-reference.md), [v1.29.0 changelog](../changelog/v1-29-0-long-term-memory.md).
