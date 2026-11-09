---
description: Explicit vault search — escape hatch that works in any mode including outage-silence
argument-hint: "<natural-language query>"
allowed-tools: mcp__semantic-memory__search_hybrid, mcp__semantic-memory__read_note, mcp__semantic-memory__get_stats, mcp__semantic-vault__search_hybrid, mcp__semantic-vault__read_note, mcp__semantic-vault__get_stats
---

# /vault — explicit vault search

The user typed `/vault $ARGUMENTS`. This is the explicit vault query that overrides mode gating.

Even in `outage-silence` mode (which suppresses auto-vault activity), `/vault <query>` is always respected.

## Your job

1. **Run `search_hybrid` on the vault server** with `$ARGUMENTS` as the query.
2. **Read the top 2–3 hits in full** via `read_note`.
3. **Answer the query using those notes**, citing the paths.
4. **Do not** file anything (no `ingest_source` / `synthesize_note`) unless the user follows up asking to. This is a read path.
5. **Stay in the current mode** — don't let a `/vault` call exit outage-silence or enter research-mode.

If the query doesn't return useful hits, say "not in vault" and name the closest misses.
