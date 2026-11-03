---
title: Hand-written skill folders in .claude/skills are usually links into packages
tier: fact
domains:
  - troubleshooting
status: active
last_updated: 2026-11-03T00:00:00.000Z
id: claude-skills-folders-are-links-into-packages
confidence: high
last_verified: '2026-11-03'
verify_command: >
  cd "$(git rev-parse --show-toplevel)" && find .claude/skills -maxdepth 1 -type l -printf '%p -> %l\n'
provenance:
  - observed while building v1.8 suggestions for hand-written skills
sources:
  - src/core/skill-land.ts
  - src/core/skill-review.ts
tags:
  - gotcha
  - skills
  - skill-loop
  - symlink
invalidated_by:
  - relink copies skills instead of linking them
---

# Hand-written skill folders in .claude/skills are usually links into packages

## Claim
Most hand-written skills in a repo's `.claude/skills/` are links made by the plugins' `relink`: into
`node_modules/@theglitchking/<pkg>/skills/<name>`, into the repo's own `skills/`, and sometimes into a
directory that no longer exists, such as an old `/tmp` sandbox. Writing `.claude/skills/<name>/SKILL.md` writes
the package's file, and the next `npm update` undoes it. Deleting it deletes the package's file.

## Instead
Resolve the real path first (`realpath .claude/skills/<name>/SKILL.md`) and change the skill at its source:
upstream for a package, the repo's `skills/` for its own. The skill loop (v1.8) does this. A suggestion for a
linked skill shows the real file and refuses `--approve`; apply it there by hand, then `--reject` it.
