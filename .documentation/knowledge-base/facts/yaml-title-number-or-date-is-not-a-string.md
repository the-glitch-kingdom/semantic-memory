---
title: A numeric or date YAML title is not a string, so code that calls string
  methods on it throws
tier: fact
domains:
  - troubleshooting
audience:
  - all
tags:
  - gotcha
  - yaml
  - frontmatter
  - s.toLowerCase is not a function
status: active
last_updated: '2026-11-07'
version: 1.0.0
estimated_read_time: 1 minute
word_count: 131
last_validated: '2026-11-07'
backlinks: []
id: yaml-title-number-or-date-is-not-a-string
confidence: high
last_verified: '2026-11-07'
verify_command: >
  cd "$(git rev-parse --show-toplevel)" && npx vitest run
  test/integration/non-string-title.test.ts test/unit/bm25.test.ts
provenance:
  - 'https://github.com/the-glitch-kingdom/semantic-memory/issues/51'
sources:
  - src/core/indexer.ts
  - src/core/bm25.ts
invalidated_by:
  - frontmatter parsing is changed to return every scalar as a string

---

# A numeric or date YAML title is not a string, so code that calls string methods on it throws

## Claim
`title: 2024` parses to a number and `title: 2024-05-01` to a `Date`; an unquoted list is an array. Code that assumes `frontmatter.title` is a string fails with `s.toLowerCase is not a function`. In semantic-memory 1.11.0 this broke every `search_hybrid` call on a vault holding such a note (the BM25 self-check tokenized the title).

## Instead
Coerce at the boundary or quote the value. Since 1.12.0 the indexer turns a number into `String(n)`, a Date into `YYYY-MM-DD` and an array into its items joined with spaces; `bm25SelfTop` also skips non-string titles. In a note, write `title: "2024"`.

## How to verify
Index a note with `title: 2024` and one with `title: 2024-05-01`, then call `search_hybrid`; it must answer. The `verify_command` runs the regression tests, which fail on the 1.11.0 code.
