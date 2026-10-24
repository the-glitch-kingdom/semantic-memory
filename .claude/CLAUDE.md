# Project Instructions

> **Primary contract: [`/AGENTS.md`](../AGENTS.md)** — generated and refreshed by `regenerate_contract`. Read that file first; it lists active modes, the required workflow, and the live tool surface.
>
> This file augments AGENTS.md with repo-specific rules that are not part of the generic contract — vault-first behavior, mode routing details, and pointers to project tooling.

## Overview
<!-- Describe the project, its purpose, and primary goals -->

## Architecture
<!-- High-level structure, key technologies, and how components relate -->

## Conventions
<!-- Coding standards, naming conventions, patterns to follow -->

## Setup

After cloning, run the setup script once to install all plugins and dependencies:

```bash
bash .claude/scripts/setup.sh
```

This installs: persistent-planning, babel-fish, and hit-em-with-the-docs.

## Key Commands
<!-- Important scripts or commands used in this project -->

## Plugins & Tools

### persistent-planning
Structured planning system for complex tasks. Use this when starting any multi-step or non-trivial task.
- `/start-planning "task name"` — initializes a persistent plan with task_plan.md and notes.md in `.planning/`
- Installed as the `persistent-planning@persistent-planning-marketplace` Claude Code plugin (not copied into `.claude/skills/`)

### babel-fish
Generates and maintains a live project map of routes, models, import chains, vocabulary, and infra profile.
- Auto-regenerates on every commit via pre-commit hook
- Manual regeneration: `python3 .claude/project-map/generate.py --force`
- Project map: `.claude/project-map/PROJECT_MAP.md`
- Rules auto-loaded: `.claude/rules/project-vocabulary.md`, `.claude/rules/operational-runbook.md`
- Developer skill: `.claude/skills/<project>-developer-skill/SKILL.md`

### hit-em-with-the-docs
Self-managing documentation system with pattern discovery and hierarchical doc structure.
- `/docs load <domain>` — load docs for a specific domain
- `/docs list` — list all 15 documentation domains
- `/docs search <query>` — search across all docs
- `/docs stats` — documentation health stats
- `/docs maintain` — run maintenance
- `/docs integrate <file>` — integrate a document into the system
- `/discover patterns` — discover coding patterns
- `/discover anti-patterns` — detect anti-patterns and code smells
- `/discover standards` — extract implicit coding standards
- CLI also available: `npx hewtd`

## Vault-first rule (Phase 1 activation)

For any project-scoped prose question — "how does X work here", "what's our process for Y", "where does Z live", "why is this structured this way", operational runbook questions, known-issue/gotcha lookups — consult the vault **before** answering.

1. **Check injected context first.** If you see a `<vault-context>` block in the conversation (from `SessionStart` or `UserPromptSubmit` hooks), read the listed note paths before searching again.
2. **If context is thin, search the vault.** Call `mcp__semantic-vault__search_hybrid` with the user's question. Read 2–3 promising hits via `read_note`.
3. **Cite or deflect — only when the prompt is actually a vault lookup.** End project-question answers one of two ways:
   - **Cite**: name the note paths the answer came from (`per runbooks/deploy.md and decisions/2026-03-auth.md`).
   - **Deflect**: say "not in vault" and name the nearest misses. Do not silently fall back to training data or web search.
4. **Offer to capture** when you answer from outside the vault (user told you, web search, prior knowledge): one-line offer to file it as a note. Don't force it.

**Do NOT narrate "not in vault" on non-lookup prompts.** The UserPromptSubmit hook injects `<vault-context>` on every prompt unconditionally — but this rule only applies when the user's question shape is a vault-eligible project lookup. For meta-questions about the tool ("is X the same as Y?"), debugging ("I see this error"), status checks ("did that work?"), directives ("proceed", "merge"), or conversational turns ("thanks"), silently ignore the injected block and answer directly. Opening with "not in vault" in those cases is noise, not honest deflection.

Boundary: code-symbol lookups (`where is function X`) go to `Grep`. Active incidents (user mentions "down / broken / rollback / customers / oncall" or pastes alert logs) switch to `outage-silence` — stop auto-firing vault search.

See `.claude/skills/vault-first/SKILL.md` for the full mode contract.

## Routing / mode indicator rule (Phase 4)

Three modes compete as ground-truth routers: `vault-first` (default), `research`, `outage-silence`. The active mode lives in `.claude/.semantic-memory/mode` (legacy `.claude/.sidekick-mode` still readable through v1.x; v1.2 introduces the new path) as a single-line plain text value.

- **Reading the mode:** `cat .claude/.semantic-memory/mode` (or legacy `.claude/.sidekick-mode`); defaults to `vault-first` if neither exists.
- **Explicit override:** `/mode research | vault-first | outage-silence` is **ground truth**. If the user set a mode explicitly, stay in it regardless of conversational signal until the user changes it or the session ends.
- **Visible indicator:** prefix the first line of every response with `[research]` or `[outage]` when in those modes. `vault-first` is the default — no prefix needed.
- **Mode transitions trigger capture:**
  - Exiting `research` → draft a `synthesize_note` (dry-run first) of the session's findings before switching.
  - Exiting `outage-silence` → draft a postmortem as `synthesize_note` (type `gotcha` or `decision`) before switching.
- **`/vault <query>` is always respected**, even in `outage-silence`.

When conversational cues strongly suggest a mode change and the explicit mode hasn't been set, switch visibly ("entering outage-silence — customer-visible issue") and update the mode file via the `/mode` command — don't drift silently.

## Notes
<!-- Anything else Claude should know about this workspace -->

## Project Map

**Project Map**: For any project-specific question, read
[`.claude/project-map/PROJECT_MAP.md`](.claude/project-map/PROJECT_MAP.md) —
auto-generated index of routes, models, import chains, infra profile,
and vocabulary translator. Regenerated automatically on commit.

To regenerate manually:
```bash
python .claude/project-map/generate.py --force
```
