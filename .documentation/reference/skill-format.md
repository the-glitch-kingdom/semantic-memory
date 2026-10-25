---
title: Learned skill format — the skill_loop frontmatter block and its lint rules
tier: reference
domains:
  - reference
audience:
  - developers
tags:
  - v1.7.0
  - skill-loop
  - skills
  - frontmatter
  - lint
status: active
last_updated: '2026-10-25'
version: 1.7.0
purpose: The contract every skill the skill loop writes follows — frontmatter
  fields, body sections, what stays out of the file — and every rule `skills
  lint` and `lint_vault({checks:["skills"]})` enforce.
load_priority: 6
estimated_read_time: 3 minutes
word_count: 560
last_validated: '2026-10-25'
backlinks: []
---

# Learned skill format

A learned skill is an ordinary Claude Code `SKILL.md` with one extra frontmatter block. Claude Code ignores keys
it does not know (checked on 2.1.310: the skill loads, is listed and triggers), so it loads like any other skill.

```yaml
---
name: build-widget-bundle-with-target
description: "Build the widget bundle with ./scripts/build.sh by passing --target. Use when ./scripts/build.sh fails with 'Exit code 3'."
metadata:
  generated_by: semantic-memory
skill_loop:
  schema: 1
  scope: project            # directory | project | global
  status: active            # draft | active | stale | archived
  pinned: false             # true: the curator and patch drafts never touch it
  triggers: ["Exit code 3", "error: no build target (BUILD_TARGET unset)"]
  applies_to: { paths: [scripts/build.sh], commands: [./scripts/build.sh] }
  provenance: { sessions: [<session id>], failures: [<tool-use id>], corrections: [] }
  cites: [<knowledge-base fact id>]
  supersedes: []
---

## When to use
## Steps
## Pitfalls
## Verify
```

| Field | Meaning |
|---|---|
| `name` | kebab-case, ≤ 64 characters, the same as its folder |
| `description` | the only text Claude sees before loading the skill: what it does and when ("Use when …"), 40–1024 characters |
| `metadata.generated_by` | `semantic-memory`: the marker for other agentskills.io clients, whose `metadata` holds strings only |
| `skill_loop.schema` | `1` |
| `scope` | where it lives: see [the skill loop](../operational/skill-loop.md#scope) |
| `status` | `draft` in `skill-drafts/`, `active` when landed, `stale` after 14 days unused, `archived` in `skills-archive/` |
| `pinned` | set it by hand to keep a skill exactly as it is |
| `triggers` | the literal errors, commands and phrases it answers |
| `applies_to` | the repo paths it is about (must exist for directory / project scope) and the programs its steps run |
| `provenance` | the session, failure and correction it came from. **Required: no evidence, no skill.** |
| `cites` | knowledge-base facts its steps rely on, by id — linked, never copied |
| `supersedes` | skills a merge replaced |

**Why `triggers`, not `symptoms`.** hit-em-with-the-docs reserves `symptoms:` for playbook objects (alert,
pattern, section); a string list under that key makes `hewtd audit` report errors
([hewtd #46](https://github.com/the-glitch-kingdom/hit-em-with-the-docs/issues/46)).

**What stays out of the file.** Use counts and last-used times live in `.claude/.semantic-memory/skill-usage.jsonl`,
so using a skill never changes a tracked file.

**The body.** `## When to use` (two or three lines), `## Steps` (numbered, concrete), `## Pitfalls` (each names
the failure id or fact it comes from), `## Verify` (one command in a fenced block whose exit code proves it
worked, or one sentence a reviewer can check). The task eval and `skill-loop verify` run that command.

## Lint rules

`semantic-memory skills lint [--root <repo>]` (exit 1 on any error) and `lint_vault({checks: ["skills"]})`
lint every learned skill the repo loads (project and directory scope; global ones from `~/.claude/skills/`).
Every draft is linted before it is written and again before it lands.

| Rule | Severity | Fails when |
|---|---|---|
| `frontmatter` | error | no YAML frontmatter |
| `name` | error | missing, not kebab-case, longer than 64, or not its folder's name |
| `description` | error | missing, shorter than 40 or longer than 1024 characters, or no "when" (when / before / after / if) |
| `description` | warn | a vague verb: helps with, handles, deals with, manages, various, stuff, things, misc, general purpose |
| `skill_loop` | error | no block, `schema` not 1, `scope` or `status` not one of the values above |
| `skill_loop` | warn | no `triggers` |
| `provenance` | error | no session, failure or correction |
| `sections` | error | one of the four body sections is missing |
| `cites` | error | a cited id is not a fact in this repo's knowledge base (not checked for global skills) |
| `applies_to` | error | a path does not exist in the repo; a directory-scoped skill without paths |
| `secrets` | error | the file contains a secret (redactor's precise set; line and kind, never the value) |
| `name_clash` | error | a skill the loop did not write (yours, a plugin's linked copy, a global one) already has this name |

The skill loop never edits or archives a skill without `skill_loop:` / `metadata.generated_by: semantic-memory`.
