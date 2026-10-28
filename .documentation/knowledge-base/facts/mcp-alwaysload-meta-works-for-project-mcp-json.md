---
title: >-
  A tool's _meta "anthropic/alwaysLoad" keeps it out of tool search for a
  project .mcp.json server too
tier: fact
domains:
  - reference
status: active
last_updated: '2026-10-28'
id: mcp-alwaysload-meta-works-for-project-mcp-json
confidence: medium
last_verified: '2026-10-28'
provenance:
  - >-
    claude -p 2.1.312 (haiku) with a project .mcp.json, 2026-10-28: 1.7.1's
    server needed ToolSearch before search_hybrid; 1.7.2's (flagged) did not
  - >-
    https://code.claude.com/docs/en/mcp.md names --mcp-config, the Agent SDK and
    plugins as where the per-tool flag takes effect, and does not mention
    .mcp.json
sources:
  - src/mcp/tools/search.ts
tags:
  - mcp
  - tool-search
  - claude-code
invalidated_by:
  - a Claude Code change to how per-tool alwaysLoad is honoured
---

# A tool's `_meta` `anthropic/alwaysLoad` works for a project `.mcp.json` server

## Claim
Claude Code defers MCP tools behind tool search, so Claude must look a tool up (`ToolSearch`) before calling it. A
server can exempt one tool by setting `_meta: {"anthropic/alwaysLoad": true}` on it in `tools/list` (Claude Code
2.1.285+). The docs name `--mcp-config`, the Agent SDK and plugins as where this takes effect. On 2.1.312 it also
works for a server in a project's `.mcp.json`: with the flag, Haiku called `search_hybrid` directly; without it,
Haiku ran `ToolSearch` first. This was one probe per side, hence medium confidence.

## Instead
To exempt every tool of one server, set `"alwaysLoad": true` on its `.mcp.json` entry. To exempt one tool, set the
`_meta` flag in the server, as semantic-memory 1.7.2 does for `search_hybrid`.
