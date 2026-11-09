---
title: Generated hubs without generated true made absent names look present
tier: fact
domains:
  - troubleshooting
audience:
  - all
tags:
  - gotcha
  - missing_terms
  - hubs
status: active
last_updated: '2026-11-09'
version: 1.0.0
estimated_read_time: 1 minute
word_count: 150
last_validated: '2026-11-09'
backlinks: []
id: hubs-without-generated-flag-make-absent-names-look-present
confidence: high
last_verified: '2026-11-09'
verify_command: >
  cd "$(git rev-parse --show-toplevel)" && npx vitest run
  test/e2e/abstention-variants.test.ts
provenance:
  - 'https://github.com/the-glitch-kingdom/semantic-memory/issues/78'
sources:
  - src/core/path-class.ts
  - src/core/bm25.ts
invalidated_by:
  - presence is counted over docs a search cannot return
---

# Generated hubs without generated true made absent names look present

## Claim
Before 1.25.0, `missing_terms` counted a name as present if any indexed doc had it, including hubs (INDEX.md, REGISTRY.md) under `results.exclude`. Such a hub lists every doc title, so a product named only in a hub, for example a GraphQL page that was never written, was not flagged. Hubs carrying `generated: true` were already skipped; `hewtd index` adds that flag. Reproduced in `test/e2e/abstention-variants.test.ts` on hubs with and without the flag. Whether the reporter's hubs lacked the flag is unconfirmed.

## Instead
From 1.25.0 presence counts only searchable docs (`isSearchableDoc` in `src/core/path-class.ts`), so the flag no longer matters. On older versions, run `hewtd index` so hubs carry `generated: true`.

## How to verify
The `verify_command` runs the e2e file, whose hub-only case is flagged on all four arms (hubs with and without the flag, with and without the export).
