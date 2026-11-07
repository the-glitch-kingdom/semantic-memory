---
title: MCP result _meta is not shown to the model in Claude Code
tier: fact
domains:
  - troubleshooting
audience:
  - all
tags:
  - gotcha
  - mcp
  - meta
  - stale
  - agent cannot see the stale flag
status: active
id: mcp-meta-is-not-shown-to-the-model
confidence: medium
last_verified: '2026-11-07'
verify_command: >
  cd "$(git rev-parse --show-toplevel)" && npx vitest run test/integration/freshness.test.ts
provenance:
  - issue #48, src/mcp/server.ts (v1.11.0 development)
sources:
  - src/mcp/server.ts
  - test/integration/freshness.test.ts
last_updated: '2026-11-07'
version: 1.0.0
estimated_read_time: 1 minute
word_count: 98
last_validated: '2026-11-07'
backlinks: []
---

# MCP result _meta is not shown to the model in Claude Code

## Claim
Claude Code passes an MCP tool result's text content to the model; `_meta` on the result is not shown to it. `_meta.stale: true` (v1.9.x) therefore told no agent that an older index was answering. Observed from issue #48 verification; not confirmed against Claude Code source.

## Instead
Put state an agent must act on in the response text. v1.11.0 starts `search_hybrid`, `search_semantic` and `search_text` output with a `[stale: ...]` line. Keep `_meta` for clients that read it.

## How to verify
`test/integration/freshness.test.ts` asserts the marker in the text of the three search tools during an upgrade.
