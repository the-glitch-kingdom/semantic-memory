---
title: minimatch "**" skips dot-directories, so "**/archive/**" misses
  .documentation/archive/
tier: fact
domains:
  - troubleshooting
audience:
  - all
tags:
  - gotcha
  - minimatch
  - glob
  - archive
  - path_class
  - archived docs still show up in search results
status: active
last_updated: '2026-11-06'
version: 1.0.0
estimated_read_time: 1 minute
word_count: 139
last_validated: '2026-11-07'
backlinks: []
---

# minimatch "**" skips dot-directories, so "**/archive/**" misses .documentation/archive/

## Claim
By default minimatch's `**` and `*` do not match a path segment that starts with a dot. `minimatch(".documentation/archive/a.md", "**/archive/**")` is false, and so is `"archive/**"`, because the first segment is `.documentation`. Only `{ dot: true }` makes them match. A `path_class` rule written the obvious way therefore left archived docs in the results (the 0.3 down-weight only matched a top-level `archive/`).

## Instead
Pass `{ dot: true }` to every minimatch call that matches vault paths, and write the glob as `**/archive/**`. `src/core/path-class.ts` does both; a new glob matcher over note paths must do the same.

## How to verify
`graph-links.test.ts` asserts the non-match without `dot` and the match with it; `path-class.test.ts` checks `archive/a.md`, `security/archive/a.md` and `.documentation/archive/a.md` against the default exclude.

## Consequences
Before v1.9.0 archived copies of live docs appeared next to them in `search_hybrid` and `search_semantic` results (8 archive hits in the top 8 over 39 fixture queries).
