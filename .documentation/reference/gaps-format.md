---
title: gaps.v1 export - what semantic-memory fills
tier: reference
domains:
  - reference
audience:
  - developers
tags:
  - gaps
  - gaps.v1
  - usage-capture
  - hewtd
status: active
last_updated: '2026-11-07'
version: 1.15.0
purpose: How does `semantic-memory gaps --json` fill hewtd's gaps.v1 format, and
  how are used_doc, clustering, redaction and dropped queries decided?
symptoms:
  - gaps --json is empty
  - hewtd reconcile --gaps rejects the file
  - a query is missing from the gaps export
load_priority: 5
estimated_read_time: 2 minutes
word_count: 251
last_validated: '2026-11-08'
backlinks: []
sources:
  - https://github.com/TheGlitchKing/hit-em-with-the-docs/blob/v2.21.0/docs/gaps-format.md
  - https://github.com/TheGlitchKing/hit-em-with-the-docs/blob/v2.21.0/schemas/gaps.v1.schema.json
---

# gaps.v1 export - what semantic-memory fills

The format and schema belong to hit-em-with-the-docs. Source of truth, at v2.21.0: [docs/gaps-format.md](https://github.com/TheGlitchKing/hit-em-with-the-docs/blob/v2.21.0/docs/gaps-format.md) and [schemas/gaps.v1.schema.json](https://github.com/TheGlitchKing/hit-em-with-the-docs/blob/v2.21.0/schemas/gaps.v1.schema.json). This repo keeps no copy; tests validate against the devDependency.

## Output

`semantic-memory gaps --json` prints `{version: 1, source: "semantic-memory <version>", gaps: [...]}`. Each gap has only `query`, `used_doc`, `suggested`, `count`, `last_seen`.

| Field | How it is set |
|---|---|
| `query` | The most frequent wording in the cluster, redacted (broad). |
| `used_doc` | The doc the agent read after the search, vault-relative (never repo-relative or absolute); `null` if none. |
| `suggested` | `symptoms.user_phrase` when `used_doc` is set, else `new doc`. |
| `count` | Searches in the cluster. |
| `last_seen` | Newest search, `YYYY-MM-DD`. |

## What counts as a gap

A search with no `use` inside the 10-minute window, a `fallback` (Grep, Glob or grep-style Bash) before its first `use`, or a doc used that was not in the results. Fallbacks count only inside a vault unless `--include-repo-grep` is given. The text report also shows these signals; `--json` drops them.

## Clustering (no LLM)

Searches with a `used_doc` group by that doc. The rest group greedily by token Jaccard of 0.5 or more.

## Redaction and dropped queries

Queries are redacted when logged and again on export. A query that still holds `[REDACTED]` after that is dropped. The log never holds file contents, tool responses, snippets or grep patterns. The redactor skips placeholder-looking values (anything containing "example"), so a docs example key passes through.

## Without a log

A missing log prints `gaps: []` and exits 0. Nothing here calls or requires hewtd. See [the guide](../operational/search-gaps-guide.md).
