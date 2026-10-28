---
title: v1.7.2 — sessions use the indexed docs
tier: reference
domains:
  - changelog
audience:
  - developers
  - admin
tags:
  - v1.7.2
  - hooks
  - mcp
  - vault-context
  - tool-search
status: active
last_updated: '2026-10-28'
version: 1.7.2
purpose: Why sessions rarely used semantic-memory's indexed docs, the three
  fixes (prompt hook sources, the doc-search redirect, server instructions with
  an always-loaded search tool), and how they were measured.
load_priority: 6
estimated_read_time: 3 minutes
word_count: 485
last_validated: '2026-10-28'
backlinks: []
---

# v1.7.2 — sessions use the indexed docs

On 2026-10-28 a check of real sessions found the semantic search was rarely used. In RE-InvestorHub (986 indexed
docs), 1 of 6 sessions in two weeks called a semantic MCP tool, never the docs server; 4 opened `.documentation`
files directly. Its rule file already said "Always search `semantic-memory-docs` first". glitch-stock-trading-rig
has no semantic server configured, so it is out of scope (setup, not a bug).

| Seen | Cause | Fix |
|---|---|---|
| The prompt hook stopped injecting RE-InvestorHub's docs | The hook searched only `semantic-vault`, `semantic-sidekick` and `semantic-memory`; the repo's plugin-only change named the docs server `semantic-memory-docs` | Any `semantic-*` entry with `--notes` is searched; the drift checks accept any `semantic-*` name |
| Hits for `<task-notification>` and `<agent-message>` turns | Claude Code runs UserPromptSubmit for those turns too ([fact](../knowledge-base/facts/userpromptsubmit-fires-for-task-notifications.md)); 210 such searches in real transcripts | Those turns are not searched |
| Injected blocks led with retired docs | 83 of 141 injected blocks on real prompts had an `archive/` hit | `archive/` hits are dropped before the score gate |
| Claude grepped `.documentation` instead of searching it | Nothing steered it; the MCP tools sat behind tool search | A PreToolUse hook denies a grep of an indexed folder once, naming the server's `search_hybrid`/`search_text`; the retry goes through |
| The MCP tools needed a lookup before use | Claude Code defers MCP tools; the server sent no instructions | The server sends `instructions`; `search_hybrid` is flagged always-loaded ([fact](../knowledge-base/facts/mcp-alwaysload-meta-works-for-project-mcp-json.md)) |

## The score floor stays 0.35

The 2-corpus search was run over 165 real human prompts (RE-InvestorHub, 14 days, locally). Scores did not
separate lookups from directives: "staging is authenticated, go ahead" scored 0.69, "what is the URL to the
webinar page?" 0.39. Injections per floor: 0.35 → 141, 0.45 → 66, 0.5 → 39, 0.6 → 12. Any floor that removes the
noise removes most real lookups too, so the archive filter was the change that the data supported.

## Validation

- **Unit:** the server-name rule, non-human prompts, archive filtering, every redirect decision (folder, subfolder,
  absolute, `./`, Grep glob, Bash grep/rg/git grep/pipelines, retry, env and repo off, outage-silence, no server,
  single file, `find`, Read, Glob), the healthcheck with only `semantic-memory-docs`.
- **Integration:** the real prompt hook with RE-InvestorHub's server names and with notification prompts (both fail
  on 1.7.1); the real redirect hook process (deny, retry allowed, fails open, about 25 ms); server `instructions`
  and the `_meta` flag over an in-memory MCP client.
- **Real, RE-InvestorHub, `claude -p` with the branch's plugin (Sonnet, $1.00 for three runs):** the MFA question was
  answered from the injected docs; "which docs mention PKCE?" grepped the whole repo (allowed by design); a grep of
  `.documentation` was denied and the session called `mcp__semantic-memory-docs__search_hybrid` next, with no tool
  lookup.
- **Tool search:** Haiku with 1.7.1's server ran `ToolSearch` before `search_hybrid`; with 1.7.2's it did not
  (Claude Code 2.1.312, project `.mcp.json`).
- **Golden eval:** unchanged (recall@1 86%, MRR 0.929).
