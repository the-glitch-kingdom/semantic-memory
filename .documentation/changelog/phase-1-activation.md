---
title: Phase 1 — Activation Layer
tier: reference
domains: [changelog]
audience: [developers]
tags: [phase-1, activation, hooks, skill, changelog]
status: active
last_updated: '2026-04-23'
version: '0.2.3'
purpose: 'What the Phase 1 activation layer shipped: hooks, vault-first skill, CLAUDE.md rule'
load_priority: 4
---

# Phase 1 — Activation Layer

> The hypothesis test: does proactive hook-driven search + a mode skill + a CLAUDE.md rule actually change Claude's behavior from "retrieves when asked" to "consults the vault by default"? Phase 1 ships that stack against the unmodified semantic-sidekick substrate and measures.

## What Phase 1 is

The **activation layer** is the difference between a vault that is *retrievable* (exists on disk, searchable via MCP when Claude decides to look) and a vault that is *present* (results already in context when Claude starts answering). Phase 1 adds three cooperating pieces:

1. **Hooks** — `SessionStart` and `UserPromptSubmit`, both backed by a single Node script (`hooks/vault-context.js`) that shells out to a new CLI search subcommand and injects results as a `<vault-context>` block.
2. **`vault-first` mode skill** — `skills/vault-first/SKILL.md`. Triggers on project-scoped prose questions, instructs Claude to read the injected context first, search the vault if thin, and cite-or-deflect on every answer.
3. **CLAUDE.md rule** — enforces the cite-or-deflect behavior at the system-prompt level so it holds even when the skill description isn't the deciding factor.

## How it fires under the hood

### CLI surface — the new `search` subcommand

`semantic-sidekick search <query> --notes <vault> [--limit N] [--text-only] [--json]`

Extracts the index-load + hybrid-search path from the MCP server and exposes it to shell callers. The MCP server is still the primary interface; the CLI is there so hooks don't have to spin up a JSON-RPC client.

Two paths:
- **Hybrid (default):** loads cached vector index + graph, embeds the query, semantic search, graph re-rank, returns top K with snippets.
- **`--text-only`:** skips the embedder, runs TextSearch keyword matching. Faster cold start but much noisier for natural-language prompts (Phase 1 measured it at 4/8 positives vs. 7/8 for hybrid — currently unused in production).

Output is always JSON on stdout, exit 0 on success, 1 + stderr message on failure.

### The hook (`hooks/vault-context.js`)

Single Node script, two modes selected by the `hook_event_name` field on stdin JSON:

**SessionStart mode**
- Seeds a search query from the project basename + current git branch (e.g. `"semantic-sidekick feat sidekick layers"`).
- Calls the CLI with hybrid search (30s timeout).
- Formats top hits into a `<vault-context source="sessionstart">` block and emits it as `hookSpecificOutput.additionalContext`.
- One fire per session.

**UserPromptSubmit mode**
- Reads the user prompt from stdin JSON.
- Computes a normalized sha1 fingerprint of the prompt; checks `.claude/.sidekick-fingerprints.json` (ring buffer of 10).
- If fingerprint was seen recently → suppresses (no re-fire). This stops "same question rephrased three turns later" from re-injecting identical context.
- Otherwise runs hybrid search (30s timeout), injects `<vault-context source="prompt">` block, updates fingerprint log.

**Vault path resolution:**
1. `$SIDEKICK_VAULT_PATH` env override (test-only).
2. `.mcp.json` → `mcpServers.semantic-vault.args` → `--notes <path>`.
3. Fallback: `.claude/.vault/` if it exists.
4. No vault found → emit empty context, don't block.

**Fail-open posture:** any error (missing vault, CLI failure, timeout, parse failure) emits empty additionalContext and exits 0. A broken hook must never prevent Claude from responding.

## How a user invokes it

Phase 1 activation is **passive** — no explicit invocation needed. Install the plugin, have a populated vault, `.mcp.json` wired up, and every session / prompt triggers the hooks automatically.

Explicit escape hatches:
- `SIDEKICK_DEBUG=1` — stderr-logs hook decisions (event, seed query, vault path, CLI bin).
- `SIDEKICK_VAULT_PATH=/path/to/vault` — overrides vault discovery (used by the test runner).
- Delete `.claude/.sidekick-fingerprints.json` to reset the re-fire suppressor.

Claude-level explicit calls (when the hook missed or context was thin):
- `mcp__semantic-vault__search_hybrid` with the user's question.
- `mcp__semantic-vault__read_note` on the top paths.

## When it auto-fires vs. when the user triggers it

| Trigger | Event | Notes |
|---|---|---|
| Claude Code session starts | `SessionStart` hook | Always fires once per session if a vault is configured. |
| User sends a prompt | `UserPromptSubmit` hook | Fires on every prompt unless the fingerprint matches one of the last 10. |
| User asks project-scoped prose question | `vault-first` skill | Kicks in regardless of hook status — skill description routes Claude to vault tools. |
| User explicitly asks `mcp__semantic-vault__*` | direct MCP call | Bypasses everything above; always works when MCP is up. |

## Failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| No `<vault-context>` block appears at session start | Hook not registered in `.claude/settings.json`, or vault path not resolvable | Check `settings.json` has `SessionStart` + `UserPromptSubmit` entries pointing at `./hooks/vault-context.js`; verify `.mcp.json` has `semantic-vault` with `--notes <path>`; run with `SIDEKICK_DEBUG=1` |
| Hook hangs at session start | Index not yet built; `search` is reindexing in the foreground | Run `node dist/cli/index.js --notes <vault> --reindex` once; subsequent sessions use the cached index |
| Same prompt fires repeatedly with same results | Fingerprint cache corrupted or absent | Delete `.claude/.sidekick-fingerprints.json` and retry |
| Hook injects context but Claude doesn't cite | `vault-first` skill not loaded (missing `.claude/skills/vault-first/` symlink), or CLAUDE.md rule missing | Verify symlink and that `.claude/CLAUDE.md` contains the vault-first rule block |
| Hits are irrelevant for natural-language prompts | `--text-only` mode active, or index model mismatch | Ensure hook runs hybrid (default); if output says "model mismatch", run `--reindex` |
| Hook takes >6s per prompt | Indexer re-parses all notes on each CLI invocation | Known Phase 1 cost; Phase 2 will add a parsed-doc cache to drop this to <1s |
| Negative-case prompts still get context injected | Expected — the hook doesn't classify prompts. The `vault-first` skill + CLAUDE.md rule instruct Claude to ignore irrelevant hits and answer directly | Not a bug. The skill description is the classifier, not the hook |

## Known gaps (Phase 1 scope boundary)

- No mode routing yet — `research-mode` / `outage-silence` arrive in Phase 4. For now, `vault-first` is always "on" when the skill triggers.
- No capture-on-close (Stop hook) — that's Phase 2, alongside `synthesize_note`.
- No schema validation, no provenance enforcement — Phase 2.
- Per-prompt latency (~6s warm, ~12s cold) is high enough to feel slow. Acceptable for hypothesis validation, not for daily use. Phase 2 priority.

## Test suite

`test/phase1/run.js` — 10-case conversational suite (8 positive, 2 negative). Invokes the hook with each prompt, extracts the top paths from the injected block, asserts the expected note appears. Pass criterion: ≥7/10 overall AND ≥75% of positive cases. Current status: **9/10, 7/8 positives — PASS**.

Run: `node test/phase1/run.js`

## Commit boundary

Phase 1 ships as a single commit on `feat/sidekick-layers`. Next commit is Phase 2 (structure + capture).
