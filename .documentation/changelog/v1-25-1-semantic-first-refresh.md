---
title: v1.25.1 - semantic-first skill refresh
tier: reference
domains:
  - changelog
audience:
  - developers
  - admin
tags:
  - v1.25.1
  - skills
  - issue-81
status: active
last_updated: '2026-11-09'
version: 1.25.1
purpose: What v1.25.1 changed (issue 81), what the tests now pin, and the
  trigger check that could not be measured.
load_priority: 5
estimated_read_time: 2 minutes
backlinks: []
word_count: 255
last_validated: '2026-11-09'
sources:
  - skills/semantic-first/SKILL.md
  - hooks/vault-context.js
  - test/unit/skill-surfaces.test.ts
  - test/e2e/skill-result-fields.test.ts
  - hooks/reconcile.js
  - src/core/synthesize.ts
  - test/unit/search-guidance.test.ts
  - src/core/claude-run.ts
  - commands/vault.md
  - commands/mode.md
---

# v1.25.1 - semantic-first skill refresh

Issue #81. Earlier step: [v1.25.0](v1-25-0-abstention-variants.md). No ranking or index change.

## What changed
- **Shorter skill.** `skills/semantic-first/SKILL.md` is the reporter's draft, about 534 words against about 1,968 plus a 1,099-word reference file. The two-server lines name the servers by role and give both name pairs (`semantic-memory-docs` / `semantic-memory`, or the defaults `semantic-sidekick` / `semantic-vault`), as `hooks/reconcile.js` writes the defaults.
- **Reference file deleted.** `references/vault-frontmatter.md` documented `tier`, `source` and `owner`, which `synthesize_note` never writes (`src/core/synthesize.ts`).
- **Sibling skills** use bare tool names on "the vault server", no `mcp__` prefix, `top_k` or `create_note`.
- **Hook messages** print the writable server's `.mcp.json` name through `vaultTool()` in `hooks/vault-context.js`, falling back to `semantic-vault`.
- **Server instructions** name `passing_terms`.

## What the tests pin
`test/unit/skill-surfaces.test.ts`: no tool prefixes, `top_k` or `create_note`; every tool a skill names is in `CURRENT_TOOL_INVENTORY`; the seven result fields, the "Indexing in progress" string and the multi-part wording are present. `test/e2e/skill-result-fields.test.ts` reads a real `search_hybrid` response from a built server: all seven fields appear and the schema has `limit`, not `top_k`. `search-guidance.test.ts` now asserts the draft's rule (search each part, or read down to result 8).

## Missed targets
- **Trigger check not measured.** `runTrigger` runs claude with `maxTurns` 2; a run that calls the Skill and goes on ends as `error_max_turns` and is discarded, so counts are biased against triggering. The fix is in the tooling: count a Skill call seen before the stop as a vote.
- `commands/vault.md`, `commands/mode.md`, `commands/contract.md` and one CLI help string still say `mcp__semantic-vault__`.
- `vaultTool()` prints the `.mcp.json` key; a plugin-launched server may be exposed under another `mcp__` name. Only the Stop hook's `session_finish` message has a test.
