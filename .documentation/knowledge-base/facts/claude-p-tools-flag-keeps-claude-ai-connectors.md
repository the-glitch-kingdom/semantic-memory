---
title: >-
  claude -p --tools limits built-in tools only; claude.ai connectors still load
  unless --strict-mcp-config
tier: fact
domains:
  - troubleshooting
status: active
last_updated: 2026-10-25T00:00:00.000Z
id: claude-p-tools-flag-keeps-claude-ai-connectors
confidence: high
last_verified: '2026-10-25'
verify_command: >
  cd "$(git rev-parse --show-toplevel)" && npx vitest run test/unit/claude-run.test.ts
provenance:
  - observed while fencing the v1.7 skill-loop reviewer (Claude Code 2.1.310)
sources:
  - src/core/claude-run.ts
  - test/unit/claude-run.test.ts
tags:
  - gotcha
  - claude-p
  - mcp
  - skill-loop
  - mcp__claude_ai_Google_Drive__share_file in a fenced run's tools
invalidated_by:
  - claude -p --tools also drops claude.ai connectors
---

# claude -p --tools limits built-in tools only; claude.ai connectors still load unless --strict-mcp-config

## Claim
`claude -p --tools Read,Grep,Glob,Skill` restricts the *built-in* tools, but the claude.ai connectors of the
logged-in account (Google Drive, including `share_file` and `trash_file`; Claude Docs) are still loaded as
`mcp__claude_ai_*` tools: the stream-json `init` event lists them next to the four. A "read-only" fenced run
could share or delete Drive files.

## Instead
Add `--strict-mcp-config` (with no `--mcp-config`): `init` then shows `mcp_servers: []` and exactly the tools
given. In this repo every skill-loop run goes through `fencedArgs` in `src/core/claude-run.ts`, which passes it;
the verify_command runs the test that pins the flags.

## How to verify
`claude -p --tools Read --output-format stream-json --verbose --max-turns 1 "ok" < /dev/null` and read `tools` in
the `init` line, with and without `--strict-mcp-config`. (The verify_command checks this repo's flags, not
Claude Code itself: it makes no model call.)
