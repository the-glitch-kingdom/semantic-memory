---
title: v1.14.0 - identifier abstention
tier: reference
domains:
  - changelog
audience:
  - developers
  - admin
tags:
  - v1.14.0
  - abstention
  - missing_terms
  - issue-57
status: active
last_updated: '2026-11-07'
version: 1.14.0
purpose: What v1.14.0 changed (issue 57), the measured acceptance results, and
  the targets that were missed.
load_priority: 5
estimated_read_time: 2 minutes
word_count: 386
last_validated: '2026-11-08'
backlinks: []
---

# v1.14.0 - identifier abstention

Issue #57. Tuning guide: [retrieval tuning guide](../operational/retrieval-tuning-guide.md). Fields: [MCP tools reference](../reference/mcp-tools-reference.md).

## What changed

- A query that names an identifier no indexed doc contains now gets `no_strong_match: true` and `missing_terms: [...]` on every result, in `search_hybrid`, `search_semantic`, the `search` CLI and the prompt hook. It is an OR with the old score rule; plain-English queries behave as before.
- Detected shapes: snake_case, ALL_CAPS with an underscore, lower camelCase, paths (an extension or two slashes), dotted names, backticked spans. Bare acronyms, PascalCase and kebab-case are left out on purpose.
- The check is a BM25 term lookup plus a path-word exemption, so a file named after the identifier counts as present. It reads no graph, gaps or hit-em-with-the-docs export, so it works on any vault.
- The hook prints "Not in the docs: `X`" instead of the weak-match line. The wording is "not in the docs", never "does not exist": the name may live in code.
- One detector, `src/core/identifiers.ts`, reused by later series steps.

## Measured (acceptance of #57)

Identifier negatives flagged, before to after: fixture train 3/8 to 8/8, fixture held-out 3/8 to 8/8, real train 2/8 to 8/8, real held-out 1/8 to 8/8 (target 5/8). The gate requires every case, with no slack, because the detector is deterministic. Answerable questions in every golden set have no missing terms, and the existing false-flag ceilings still pass.

Review found two false-flag paths, fixed with tests: names with edge underscores such as a dunder module name, and slash prose such as TCP/IP.

## Missed targets

- The external "4 of 7 / at most 2 of 34" blind set is not available here; the run is a release step and is not done.
- Bare ALL_CAPS without an underscore and `*.py` globs are not detected.
- A query spelled with underscores is flagged when the docs only say the hyphenated or spaced form. True as worded, but it can surprise.
- The hook line can fire on a pasted code path absent from the docs, past the existing score gate.
- The doc path list is joined on every search; cache it if a vault passes about 50k docs.
