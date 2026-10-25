---
title: claude --bare ignores OAuth logins; it needs ANTHROPIC_API_KEY
tier: fact
domains:
  - troubleshooting
status: active
last_updated: 2026-10-25T00:00:00.000Z
id: claude-bare-mode-needs-an-api-key
confidence: high
last_verified: '2026-10-25'
verify_command: claude --help | grep -A12 -- '--bare' | grep -q 'OAuth and'
provenance:
  - >-
    claude --help on Claude Code 2.1.310, while fencing the v1.7 skill-loop
    reviewer
sources:
  - src/core/claude-run.ts
tags:
  - gotcha
  - claude-p
  - bare
  - skill-loop
invalidated_by:
  - '--bare reads OAuth credentials'
---

# claude --bare ignores OAuth logins; it needs ANTHROPIC_API_KEY

## Claim
`claude --bare` skips hooks, plugins, CLAUDE.md discovery and auto-memory — the obvious way to fence a background
`claude -p` — but its auth "is strictly ANTHROPIC_API_KEY or apiKeyHelper via --settings (OAuth and keychain are
never read)". On a machine logged in with a Claude subscription and no API key, a `--bare` run cannot
authenticate.

## Instead
Fence with explicit flags instead, which keep the normal login: `--tools …`, `--disallowedTools Task,Agent`,
`--strict-mcp-config`, `--settings '{"disableAllHooks":true}'`, `--setting-sources project,local`,
`--permission-mode dontAsk`, `--no-session-persistence` (what `src/core/claude-run.ts` passes).

## How to verify
`claude --help` and read `--bare`; the verify_command checks the sentence is still there.
