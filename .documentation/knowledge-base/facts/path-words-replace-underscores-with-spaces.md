---
title: A file named after an identifier is not a body match, because path words
  replace underscores with spaces
tier: fact
domains:
  - troubleshooting
audience:
  - all
tags:
  - gotcha
  - bm25
  - missing_terms
status: active
last_updated: '2026-11-07'
version: 1.0.0
estimated_read_time: 1 minute
word_count: 141
last_validated: '2026-11-08'
backlinks: []
id: path-words-replace-underscores-with-spaces
confidence: high
last_verified: '2026-11-07'
verify_command: >
  cd "$(git rev-parse --show-toplevel)" && npx vitest run
  test/unit/identifiers.test.ts
provenance:
  - 'https://github.com/the-glitch-kingdom/semantic-memory/issues/57'
sources:
  - src/core/identifiers.ts
  - src/core/bm25.ts
invalidated_by:
  - the BM25 tokenizer stops indexing the path words of a doc
---

# A file named after an identifier is not a body match, because path words replace underscores with spaces

## Claim
The indexed text of a doc includes its path with `_` replaced by spaces, so a file named `some_tool_name.md` indexes the tokens `some`, `tool`, `name`, never the joined `some_tool_name`. A body mention keeps the joined token. The missing-identifier check therefore also looks for the identifier in the joined doc paths; without that exemption a query naming the file would be flagged `missing_terms`.

## Instead
Name a doc by its identifier, or write the identifier in a code span in the body. A doc that only says the hyphenated or spaced form does not count as containing the underscored name, and a query using the underscored name is flagged.

## How to verify
The `verify_command` runs the identifier tests, which cover the path exemption and the edge-underscore cases.
