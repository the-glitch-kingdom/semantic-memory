---
title: v1.26.0 - default server names
tier: reference
domains:
  - changelog
audience:
  - developers
  - admin
tags:
  - v1.26.0
  - mcp-json
  - issue-81
status: active
last_updated: '2026-11-09'
version: 1.26.0
purpose: What v1.26.0 changed about the server names written to .mcp.json, why
  existing projects need no action, and how to rename an old pair by hand.
load_priority: 5
estimated_read_time: 2 minutes
backlinks: []
word_count: 229
last_validated: '2026-11-09'
sources:
  - hooks/reconcile.js
  - hooks/vault-context.js
  - test/unit/reconcile.test.ts
  - test/unit/skill-surfaces.test.ts
  - scripts/smoke-install.sh
  - .claude/settings.json
  - commands/vault.md
  - commands/contract.md
---

# v1.26.0 - default server names

Issue #81 follow-up. Earlier step: [v1.25.1](v1-25-1-semantic-first-refresh.md). No ranking or index change.

## What changed
- **New defaults.** `hooks/reconcile.js` writes `semantic-memory` (vault, `.claude/.vault`) and `semantic-memory-docs` (`.documentation --read-only`). They were `semantic-vault` and `semantic-sidekick`.
- **Served-folder check.** Nothing is added for a folder some `.mcp.json` entry already serves (`--notes` or `--notes=`, resolved against the project root), whatever the entry is called. Hand-written entries are kept.
- **Removal.** When hit-em-with-the-docs is gone, the docs entry is removed under either docs name, only if it is ours.
- **Other places.** `hooks/vault-context.js` falls back to `semantic-memory`; `commands/vault.md` and `commands/contract.md` list their tools under both names; `scripts/smoke-install.sh` asserts the new key.

## Upgrade: nothing to do
Existing projects need no action. Their entries are never renamed, duplicated or backed up, and the old names stay recognized (the hooks search every `semantic-*` entry with `--notes`).

## Rename by hand (optional)
Renaming changes every tool name the session sees, so do all of these together:
1. In `.mcp.json`, rename the key `semantic-vault` to `semantic-memory` (and `semantic-sidekick` to `semantic-memory-docs`).
2. In permission allowlists (`.claude/settings.json`, `settings.local.json`, `~/.claude/settings.json`), replace `mcp__semantic-vault__` with `mcp__semantic-memory__` and `mcp__semantic-sidekick__` with `mcp__semantic-memory-docs__`.
3. Update CLAUDE.md and other notes that name those tools.
4. Restart the session.

## What the tests pin
`test/unit/reconcile.test.ts` (12 cases): fresh defaults, legacy entries unchanged, a vault or docs entry under another name, removal under either docs name, a hand-written entry, the `.bak` backup and the parse-error path. `test/unit/skill-surfaces.test.ts`: no command body hard-codes an `mcp__semantic-*__` name, and `allowed-tools` lists both names.
