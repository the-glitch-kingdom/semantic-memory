---
description: Generate or refresh AGENTS.md at the project root — the versionable agent contract. Preserves Local Notes across regenerations.
allowed-tools: mcp__semantic-memory__regenerate_contract, mcp__semantic-memory__inspect_contract, mcp__semantic-vault__regenerate_contract, mcp__semantic-vault__inspect_contract
---

When the user runs `/contract`, dispatch by argument:

- `/contract` (no arg) or `/contract refresh` — call `regenerate_contract` to write or refresh `AGENTS.md` at the project root. Report whether the file was written, whether hand-edits were detected, and how many characters of Local Notes were preserved.
- `/contract inspect` — call `inspect_contract` (read-only) and report whether `AGENTS.md` exists, whether managed-block markers are present, and the size of the Local Notes tail.
- `/contract force` — call `regenerate_contract` with `force=true` to overwrite hand-edited managed-block content. Use only after the user has confirmed they accept losing in-block hand-edits.

If the call returns `hand_edit_detected: true`, do NOT pass `force=true` automatically — surface the warning to the user and let them decide whether to move their changes to the Local Notes section or overwrite.

`AGENTS.md` is the canonical agent contract for this project. The managed block is regenerable from the current tool surface and active modes; the Local Notes section is user-owned and preserved verbatim across regenerations.
