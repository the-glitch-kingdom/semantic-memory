---
title: >-
  gray-matter called without options caches by content, including a parse that
  threw
tier: fact
domains:
  - troubleshooting
status: active
last_updated: 2026-10-24T00:00:00.000Z
id: gray-matter-caches-a-failed-parse
confidence: high
last_verified: '2026-10-25'
verify_command: >
  cd "$(git rev-parse --show-toplevel)" && npx vitest run
  test/unit/frontmatter.test.ts test/unit/indexer.test.ts
provenance:
  - observed in the v1.6.1 release audit (gray-matter 4.0.3)
sources:
  - src/core/matter.ts
  - test/unit/frontmatter.test.ts
  - test/unit/indexer.test.ts
tags:
  - gotcha
  - gray-matter
  - frontmatter
  - Invalid frontmatter in
  - 'note title is the YAML block (title: x purpose: ...)'
  - a second frontmatter block at the top of a note
invalidated_by:
  - gray-matter stops caching parses that threw
---

# gray-matter called without options caches by content, including a parse that threw

## Claim
`matter(str)` with no options stores the file object in `matter.cache[str]` *before* parsing. If the YAML is invalid, the first call throws, and the unparsed object stays cached. The second call with the same string returns it without throwing: `data` is `{}` and `content` still holds the whole `---` block. The cached `data` object is also shared by every caller that parses identical content, so mutating it (`data[key] = …`) changes what the next parse returns.

## Instead
Pass options (an empty object is enough) to skip the cache: `matter(str, {})`. In this repo, import `src/core/matter.ts`, which does that, instead of `gray-matter`.

## How to verify
Parse the same invalid-YAML string twice: without options, the second call doesn't throw and `content` starts with `---`. With `{}`, both calls throw. The `verify_command` runs the regression tests: a bad note indexed twice in one process, `update_frontmatter` retried on a bad note, and two notes with identical content.

## Consequences
In semantic-memory 1.5.2–1.6.0:
- The "index the body only" fallback held only for the first parse in a process. Every rebuild after it indexed the YAML block as a heading.
- `update_frontmatter` on such a note threw once, then wrote a second frontmatter block on retry.
- One update's edits leaked into the next parse of identical content.
