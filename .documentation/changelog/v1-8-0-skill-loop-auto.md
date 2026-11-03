---
title: v1.8.0 — skill loop auto mode, dedup, and retiring old entries
tier: reference
domains:
  - changelog
audience:
  - developers
  - admin
tags:
  - v1.8.0
  - skill-loop
  - auto-mode
  - dedup
status: active
last_updated: '2026-11-03'
version: 1.8.0
purpose: What 1.8.0 adds to the skill loop (the reviewer judges existing skills
  too, rejects duplicates, retires dead entries and whole skills, applies its
  own changes in opt-in auto mode, and only suggests changes to hand-written
  skills), the slot race it fixes, and how it was validated.
load_priority: 6
estimated_read_time: 3 minutes
word_count: 565
last_validated: '2026-11-03'
backlinks: []
---

# v1.8.0 — skill loop auto mode, dedup, and retiring old entries

1.7 could draft a new skill, or patch a learned skill that was used and then failed. That was all, and a person
approved every draft. Three gaps showed when we read the code: duplicates were only discouraged by one line in
the prompt; a skill's dead steps were never retired, only the whole skill after 30 days unused; and every change
waited for a person. Guide: [the skill loop](../operational/skill-loop.md).

| Change | What it does |
|---|---|
| The reviewer sees the skills | The brief holds in full up to 4 skills the session used or shares words with, with their dead references and failed Verify. The prompt prefers patching to creating. |
| `archive` drafts | The reviewer can retire a whole skill, with a one-line `why`. |
| Retiring entries | A `patch` may drop or correct steps that a dead reference (a path the skill names that no longer exists) or the session shows are gone. |
| Dedup in code | A new skill whose name matches, or whose words overlap ≥ 0.5 with, any loaded skill or waiting draft is rejected, naming the one it duplicates. |
| Suggestions | A patch or archive of a hand-written skill becomes a `suggest` draft: never applied by the loop, shown with its diff at SessionStart and in `skill-loop review`. Skills whose folder is a link are refused at approval ([fact](../knowledge-base/facts/claude-skills-folders-are-links-into-packages.md)). |
| Maintenance reviews | The curator queues one skill-only review when skills have new dead references or a failed Verify. |
| Auto mode | `skill-loop auto on` (`SEMANTIC_MEMORY_SKILL_LOOP_AUTO`, or `skill_loop_auto` per repo), off by default. The worker applies its own new / patch / archive for learned skills as actor `reviewer`, ledgered; SessionStart lists each change once with its ledger id; `rollback` undoes it. The guard is lint and dedup, not the eval gate. |
| Provenance | A patch keeps the evidence its skill was built from. |
| Up to 3 drafts per review | Was 2. |

**Fixed: more than 5 `claude` runs at once.** `acquireSlot` created a slot file, then wrote its pid. A caller
reading in between saw no pid, took the holder for dead, and deleted a live slot. Under the full test suite's load,
7 of 5 runs got through. The slot is now hard-linked from a temp file that already holds the pid
([fact](../knowledge-base/facts/exclusive-create-then-write-is-not-atomic-for-readers.md)).

## Validation

- **New tests (21):**
  - unit: the auto switch and its precedence; overlap and `duplicateOf`; `deadRefs`, including the
    not-a-path cases (`origin/main`, URLs, globs, placeholders); the empty-slot race. The race test fails on the
    old code.
  - integration (fake claude): the brief's related skills and maintenance brief; dedup against a skill and a
    waiting draft; archive rules; suggestions with frontmatter byte for byte and a linked skill; auto on (land +
    patch + archive, each rolled back exactly); auto off (drafts only); suggestions never auto-applied; the
    maintenance job from the curator to a trimmed skill; the SessionStart report.
- **Full suite:** 709/709, twice. `tsc --noEmit` and the build pass.
- **One real `claude -p` maintenance review** (sonnet, $0.030) in a scratch repo, whose learned skill named a
  deleted script. The reviewer read the repo and replaced the dead step with a correct one, and auto mode applied
  it. SessionStart reported it, and `skill-loop rollback` restored the file byte for byte.
