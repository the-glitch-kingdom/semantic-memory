---
title: Search gaps - reading gaps and handing it to hewtd
tier: guide
domains:
  - operational
audience:
  - developers
  - admin
tags:
  - gaps
  - usage-capture
  - usage-set
  - reconcile
status: active
last_updated: '2026-11-07'
version: 1.15.0
purpose: How do I find the questions my docs failed to answer, read the gaps
  report, and hand it to `hewtd reconcile --gaps`?
symptoms:
  - agent searched the docs then grepped the repo
  - which docs are missing
  - gaps says nothing
  - usage.jsonl is about to be committed
load_priority: 5
estimated_read_time: 2 minutes
word_count: 258
last_validated: '2026-11-08'
backlinks: []
sources:
  - hooks/usage-capture.js
---

# Search gaps - reading gaps and handing it to hewtd

## How the data is collected

The PostToolUse hook `hooks/usage-capture.js` logs to `.claude/.semantic-memory/usage.jsonl` (one per project, rotated at 5 MB): each docs search (query and result paths), each read of a doc that followed it (`use`, with its rank or `null`), and each grep or glob that followed it (`fallback`). Reads of a doc outside the results are logged with `rank: null`. It writes no `selection` events, so ranking does not change. Details: [hooks reference](../reference/hooks-reference.md#posttooluse-usage-capture-v115).

## Reading the report

```bash
semantic-memory gaps                      # text report with signals
semantic-memory gaps --since 2026-11-01   # newer than a date
semantic-memory gaps --include-repo-grep  # count greps outside a vault too
```

- `suggested: new doc` means the agent searched and did not find a doc to read.
- `suggested: symptoms.user_phrase` means it did read a doc: add the phrase to that doc's `symptoms:`.
- The report is noisy: a search answered from the snippet also counts. Read the counts, not the list.

## Handing it to hewtd

```bash
semantic-memory gaps --json > /tmp/gaps.json
npx hewtd reconcile --gaps /tmp/gaps.json
```

The format is [hewtd's](../reference/gaps-format.md). End-to-end acceptance by `reconcile` was not run in v1.15.0; the schema was.

## Turning usage into an eval set

`semantic-memory usage-set` writes `.claude/.semantic-memory/eval/usage.jsonl` from searches that ended in a used doc, and `eval` loads it. See the [retrieval tuning guide](./retrieval-tuning-guide.md).

## Turning it off

`SEMANTIC_MEMORY_USAGE_CAPTURE=0`, `usage_capture: off` in `.claude/.semantic-memory/config`, or `telemetry.enabled: false` in the searched vault.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Empty `gaps` | No log yet, or the `.mcp.json` server is not named `semantic-*`. |
| healthcheck `usage_log_ignored` | Add `.claude/.semantic-memory/usage.jsonl` to `.gitignore`. |
| Server in the plugin never logs | Its `.mcp.json` name must equal or end the name in the tool name. |
| A plain `grep foo` counts as a vault fallback | A grep with no path assumes the cwd. |
