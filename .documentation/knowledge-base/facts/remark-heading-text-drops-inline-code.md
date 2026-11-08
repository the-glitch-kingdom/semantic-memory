---
title: remark heading text drops inline code unless taken from the source
tier: fact
domains:
  - troubleshooting
status: active
last_updated: '2026-11-08'
id: remark-heading-text-drops-inline-code
confidence: high
last_verified: '2026-11-08'
verify_command: >
  cd "$(git rev-parse --show-toplevel)" && npx vitest run test/unit/sections.test.ts
provenance:
  - issue #60, src/core/sections.ts, src/core/indexer.ts (v1.17.0 development)
sources:
  - src/core/sections.ts
  - test/unit/sections.test.ts
tags:
  - gotcha
  - markdown
  - anchors
  - section anchor is wrong for a heading with code
---

# remark heading text drops inline code unless taken from the source

## Claim
A text walk over a remark heading node that handles only `text` children loses `inlineCode` children: `## The \`fold\` rule` becomes "The  rule". The heading's slug (anchor) and its trail then differ from the one hit-em-with-the-docs computes from the source line, and a result's `anchor` points nowhere.

## Instead
Handle `inlineCode` in `nodeToText` (keep its value), and build section trails and anchors from the source heading line with the same rules as hit-em-with-the-docs (`src/core/sections.ts`, parity-tested).

## How to verify
`test/unit/sections.test.ts` compares our anchors with hewtd's `flatSections` / `headingAnchors` for headings with inline code, repeats, setext, `{#id}` and punctuation.

## Consequences
Before the fix a heading with code in it would have produced a wrong anchor; the search `anchor` and `read_note` `#anchor` would not resolve.
