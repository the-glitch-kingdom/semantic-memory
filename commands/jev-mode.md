---
description: Turn jev mode on or off, or show its state (Jev through jev-loop for semantic-memory's yes/no decisions)
argument-hint: "[on|off|status]"
allowed-tools: Bash(npx:*), Bash(node:*)
---

The user ran `/jev-mode $ARGUMENTS`. Empty arguments mean `status`.

Run `node ./node_modules/@theglitchking/semantic-memory/bin/semantic-memory jev-mode <on|off|status>`
(or `npx --no @theglitchking/semantic-memory jev-mode …` when there is no local install) and relay the
output verbatim.

- `on` / `off` edit only `SEMANTIC_MEMORY_JEV` in `~/.claude/settings.json` `env` (a `.bak` of the previous
  file is kept). The change applies from the next Claude Code session: say so.
- `status` prints on / off / on-but-unavailable with the reason (jev-loop, `TYPESAFE_API_KEY` or python3
  missing) and today's Jev spend by semantic-memory.

Never print or echo `TYPESAFE_API_KEY`.
