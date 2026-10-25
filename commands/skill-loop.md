---
description: The skill loop — on/off/status, review drafted skills, run the curator, restore or roll back
argument-hint: "[on|off|status|review|curate|restore <name>|rollback <ledger-id>|verify]"
allowed-tools: Bash(npx:*), Bash(node:*), Read
---

The user ran `/skill-loop $ARGUMENTS`. Empty arguments mean `status`.

Every subcommand is the CLI: `node ./node_modules/@theglitchking/semantic-memory/bin/semantic-memory skill-loop <args>`
(or `npx --no @theglitchking/semantic-memory skill-loop <args>` when there is no local install).

- `on` / `off` — edit only `SEMANTIC_MEMORY_SKILL_LOOP` in `~/.claude/settings.json` `env` (a `.bak` is kept);
  applies from the next session — say so. `on --repo` / `off --repo` write the per-repo override in
  `.claude/.semantic-memory/config` instead (it beats the global switch); `--repo --clear` removes it.
  Off never deletes anything: skills already landed stay, as ordinary files.
- `status` — relay verbatim: on/off and why, drafts waiting, today's review budget, last curator run.
- `review` — run `skill-loop review --json`. For each draft show its name, scope, the evidence it cites
  (sessions, failures, corrections), eval scores if any, and for a patch the diff. Ask the user, one draft at a
  time: approve, reject, or edit. Then run `skill-loop review --approve <id>` / `--reject <id>`; for edit, change
  the draft file it names, then approve it. Never approve on the user's behalf.
- `curate` — `skill-loop curate --dry-run` first, show what would go stale or be archived, and run without
  `--dry-run` only when the user agrees. `curate --merge` proposes merges as review drafts.
- `restore <name>`, `rollback <ledger-id>`, `verify` — run them and relay the output.
