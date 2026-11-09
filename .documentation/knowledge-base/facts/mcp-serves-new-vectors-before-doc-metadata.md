---
title: An MCP server can serve a new vector index before doc metadata is installed
tier: fact
domains:
  - architecture
status: active
last_updated: '2026-11-09'
id: mcp-serves-new-vectors-before-doc-metadata
confidence: high
last_verified: '2026-11-09'
verify_command: >
  cd "$(git rev-parse --show-toplevel)" && npx vitest run
  test/e2e/stdio-load-gap.test.ts test/integration/code-load-order.test.ts
provenance:
  - 'https://github.com/the-glitch-kingdom/semantic-memory/issues/73'
sources:
  - src/mcp/context.ts
  - test/e2e/stdio-load-gap.test.ts
tags:
  - gotcha
  - mcp
  - load-order
---

# An MCP server can serve a new vector index before doc metadata is installed

## Claim
Through 1.21.0, `loadFromDisk` and the reconcile path set the vector index first and installed docs with `setDocuments(docs, await loadCode(docs))`. The argument was awaited first, so on a repo with no `.hewtd/graph.json` and a slow `git log` the first answers had titles equal to paths, no `load_priority`, no decay, no `status`/`generated` filtering and no `related`. The CLI eval builds everything before its first query and the built-in eval waits for ready, so neither could see it.

## Instead
Install docs, filters and the doc-only graph in the same synchronous step as the vector index, and load the code graph afterwards in the background, marking answers `_meta.stale` until it lands. Measure the path agents call: `eval --via mcp` without `--wait-for-ready`, and `npm run gate:release`, whose slow-git arm fails a build whose first answers lack titles.

## How to verify
`verify_command` runs the stdio test, which slows `git log` with a PATH shim and asserts the first answer has its title, `status` and honours the `status` filter. On 1.21.0 the same run scores first answers titled 0/129.

## See also
- [test-swallowing-its-timeout-hides-a-dead-feature](test-swallowing-its-timeout-hides-a-dead-feature.md)
