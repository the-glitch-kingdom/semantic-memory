# Task Plan: user-help

## Goal
Ship a "help" feature after the knowledge-graph series. It explains how to use semantic-memory's features in task
terms, for example:
- "search across another repo's docs" (federated search)
- "add another index"
- "measure search on my docs" (`eval`)
- "see what my docs fail to answer" (`gaps`)
- "use a different embedder"
- "make decay use git"
- "check the install"

It is available in three places, all served from ONE source of topics so they never drift:
- a `/semantic-memory:help` command;
- `semantic-memory help [topic]` in the CLI;
- an MCP `help` tool the agent can call.

One PR from `feat/user-help`. Built last, so it documents the final feature surface.

## Prerequisites
- The series plans (builtin-eval through federated-search) merged; the help topics describe what actually shipped.

## Rules for every phase
- **Verify before ticking.** Confirm in code, or with a test, that a box is actually done before ticking it.
- **One source of truth.** Topics live in one place (e.g. `src/core/help/topics.ts` or markdown under `docs/help/`);
  the command, the CLI and the MCP tool render it. A test fails when a CLI command, MCP tool or `vault.schema.yml`
  key exists with no help topic covering it (coverage check), and when a topic names a command, flag or key that
  does not exist (drift check).
- **Task-shaped, short, copy-pasteable.** Each topic: what it is for, the steps, the exact commands / config, how to
  check it worked, and a link to the full doc in `.documentation/`.
- **No new dependencies.**

## Phases
- [x] Phase 1: Verify and plan
  - [x] Inventory the final surface after #62: CLI commands and flags (`src/cli/index.ts`), MCP tools
        (`src/mcp/tools/inventory.ts`), slash commands (`commands/*.md`), `vault.schema.yml` keys
        (`schema-default.ts`), hooks, and the `.documentation/` guides; record it in notes.md
  - [x] Read hit-em-with-the-docs' `/help` command (`commands/help.md` in its plugin) for the house pattern
  - [x] Write the topic list (at least: getting started, add another index, federated search, eval and floors,
        gaps and hand-off to hit-em-with-the-docs, embedders/pooling/prompt, decay and git dates, code graph and
        grounding, section results, query routing and `mode`, modes (vault-first / research / outage-silence),
        healthcheck and troubleshooting, offline install, updating)
  - [x] No tracking issue: the user did not ask for one; the PR describes the feature (2026-11-08)
  - [x] Sync main (019c63c, v1.19.0), cut `feat/user-help`, commit this plan
- [x] Phase 2: Topic source and renderer
  - [x] Topics in one source with id, title, aliases, summary, steps, commands, verify, doc link; a renderer for plain
        text (CLI), markdown (command and MCP)
  - [x] `help` with no topic lists topics grouped by task; `help <words>` matches by id, alias or title words
- [x] Phase 3: Surfaces
  - [x] CLI `semantic-memory help [topic]` (commander's own `--help` stays for flags)
  - [x] MCP tool `help({topic?})` in the inventory and the tool-surface snapshot
  - [x] `commands/help.md` slash command that runs the CLI (the hewtd pattern)
- [x] Phase 4: Write the topics
  - [x] `semantic-memory search --paths`: one vault-relative doc path per line (no JSON), so hit-em-with-the-docs'
        `reconcile.search_command` can use our search. hewtd (2.21.0, `src/core/reconcile/search.ts`) splits the
        template on whitespace, substitutes `{query}` into one argument, runs it without a shell (30 s timeout) and keeps
        stdout lines that are indexed docs (docs-relative or absolute). Test it with hewtd's own parsing rules.
  - [x] Topic "use semantic search inside hit-em-with-the-docs reconcile": `.claude/hit-em-with-the-docs.json` →
        `"reconcile": {"search_command": "npx semantic-memory search --notes .documentation --paths {query}"}`,
        checked end to end with `hewtd reconcile` in a scratch copy.
  - [x] Every topic from Phase 1, checked by running each command it shows in a temp vault
- [ ] Phase 5: Release prep v1.20.0
  - [ ] Bump all five version fields, lockfile; offline tarball builds
- [ ] Phase 6: Cleanup -- remove junk and unused code this work created: scratch/test scripts, debug files, probe logging, one-off test functions, commented-out code, dead code from abandoned approaches (MANDATORY)
  - [ ] Dead-code check over the branch diff.
- [ ] Phase 7: Validate success through comprehensive testing -- we need to validate success thoroughly through comprehensive testing of our changes (MANDATORY)
  - [ ] Coverage test: every CLI command, MCP tool and schema key is covered by a topic (or explicitly exempted)
  - [ ] Drift test: every command, flag and key a topic names exists
  - [ ] CLI, MCP and slash-command output render the same topic; unknown topic suggests the closest ones
  - [ ] The "add another index" and "federated search" topics followed step by step in a temp project work end to end
  - [ ] Full suite; known flakes re-run alone. Answer each goal item in notes.md.
- [ ] Phase 8: Documentation pass -- a full hit-em-with-the-docs pass to create/update/deprecate as many docs as needed to capture all our changes: new procedures, tools, troubleshooting steps, gotchas, KB articles, etc. Never include secrets or passwords (MANDATORY)
  - [ ] Changelog doc and `CHANGELOG.md`; `.documentation/reference/cli-reference.md`, `.documentation/reference/mcp-tools-reference.md`;
        `README.md` points at `help`; `npx hewtd maintain --quick`; regenerate AGENTS.md; tick the last boxes so
        `/plan-status` reads COMPLETE

## Key Questions
1. Resolved: TypeScript objects in `src/core/help/topics.ts` (type-checked; the coverage and drift tests read them directly).

## Decisions Made
- Phase 4: `search --paths` prints unique `hit.path` values (vault-relative, the form hewtd matches against its docs-relative index); the config template uses `npx semantic-memory` (resolves from node_modules/.bin in a project with the package). The hewtd-search topic links cli-reference.md until Phase 8 documents `--paths` there.
- Phase 2: all 15 topics are written now with real commands (summary/steps/commands/verify/doc); Phase 4 re-checks each command in a temp vault and fills out detail. `hewtd-search` names `search --paths`, which Phase 4 adds. Matching: exact id/alias, else shared-word score (id/alias word 3, title word 1), ties return several; stop words include search/doc/docs because nearly every topic mentions them.
- Planned after the series so it documents the final surface; the coverage and drift tests keep it current afterwards.

## Errors Encountered
- Phase 3: first full `npm test` had 2 load flakes (freshness-scale warm start, hook-failure Jev-hang); both pass alone. Tool-count tests (44 -> 45, read-only 20 -> 21) and the tool-surface snapshot updated for the new `help` tool: intended, not a floor change.
- Phase 4: one load flake (hook-failure Jev-hang, 3827 ms vs 3000) in the full run; passes alone.
- Phase 4: topic claims corrected after running them: decay `git` is already the default (not something to set); `lint --strict` is not a federation check (exits 1 on a vault of docs without `status`), removed; `eval --check` exits 1 without a baseline, so `--baseline` is a step; `healthcheck` only works from a project with the plugin installed; `search`/`eval` need a built index (`serve --reindex`).

## Status
**Currently in Phase 5** - release prep v1.20.0 (Phase 4 done: `search --paths`, hewtd-search topic verified, all topic commands run)

---

## Notes
- This file persists across sessions
- Update status after each phase
- Mark completed phases with [x]
- Save research to notes.md instead of stuffing context

## On Completion
This plan is complete when every checkbox above is checked. That IS the
completion signal -- there is no separate status to remember to flip.

When complete, archive it instead of deleting it:

    /plan-status                  # confirm this plan reads COMPLETE
    /archive-plan user-help    # -> .planning/.archive/user-help/

Archiving moves this directory to the gitignored .planning/.archive/ and stamps
it archived. Nothing is destroyed.
