---
title: semantic-sidekick — Overview
tier: guide
domains: [quickstart]
audience: [developers]
tags: [overview, goals, framing, architecture]
status: active
last_updated: '2026-10-24'
version: '1.6.1'
purpose: Value proposition, five-layer summary, firing timeline, design principles
load_priority: 10
---

# semantic-sidekick — overview

> A shelf is retrievable. A prosthesis is present.

## The problem

semantic-pages gives you a searchable markdown vault and 21 MCP tools to operate on it. It's a *shelf*: the knowledge is stored correctly; Claude consults it only when explicitly asked. Observed in practice: a 500-note vault that Claude never reaches for is a liability, not an asset — it creates false confidence ("we've documented that") while being silently bypassed.

semantic-sidekick closes the activation gap. It treats the vault as a *prosthesis*: present during work, not retrievable after. On every session start and every user prompt, the vault fires automatically. On mode transitions, capture is forced. Errors, syntheses, and ingests are logged durably so future-Claude boots with "what's been happening here."

## The value proposition in one sentence

> Turn a retrievable markdown vault into a **present** knowledge prosthesis that auto-fires during work, matches the situation (research vs code vs outage), and forces capture at transitions — so 3-hour sessions produce durable artifacts instead of evaporating into chat history.

## Five layers

| # | Name | Purpose |
|---|---|---|
| 1 | **Substrate** | Markdown vault + hybrid search + graph + MCP (inherited from semantic-pages) |
| 2 | **Structure** | Schema, provenance frontmatter, `apply_patch` (atomic writes), lint |
| 3 | **Workflows** | `ingest_source`, `synthesize_note`, structured `log.md` |
| 4 | **Activation** | SessionStart/UserPromptSubmit/Stop hooks, `vault-first` skill, CLAUDE.md rule |
| 5 | **Routing** | `research` + `outage-silence` mode skills, `/mode` + `/vault` commands, transition capture |

Full layer breakdown in [architecture-layers.md](../architecture/architecture-layers.md).

## What's installed

- **33 MCP tools** (search/read/write/metadata/graph + apply_patch/synthesize_note/ingest_source/install_schema + 4 lints + 3 log/maintenance).
- **4 skills** — `vault-first` (default), `research-mode`, `outage-silence`, plus the inherited `semantic-first`.
- **3 hooks** — SessionStart (mode reset + vault preload + state-delta), UserPromptSubmit (mode-gated search injection), Stop (mode-specific transition capture).
- **2 slash commands** — `/mode`, `/vault`.
- **5 CLI subcommands** — `search`, `lint`, `log-event`, `log-query`, `install-schema` (plus legacy `serve`, `tools`, `normalize-config`, `healthcheck`).

## When it fires (glance chart)

```
Session opens
  │
  ├─ SessionStart hook
  │    ├─ resets .claude/.sidekick-mode → vault-first
  │    ├─ logs mode_change if prior mode was non-default
  │    ├─ runs hybrid search seeded from cwd + branch
  │    └─ injects <vault-state-since> + <vault-context> blocks
  │
User types a prompt
  │
  ├─ UserPromptSubmit hook
  │    ├─ reads .semantic-memory/mode
  │    ├─ if outage-silence → no-op (respect mode contract)
  │    ├─ else: fingerprint check → hybrid search (or skip) → inject <vault-context>
  │    └─ cue detection → append to .semantic-memory/capture-pending.json (per session_id)
  │
Claude answers (consults vault per vault-first rule)
  │
  ├─ Uses mcp__semantic-vault__* tools as needed
  ├─ Calls synthesize_note / ingest_source / apply_patch when appropriate
  │    └─ each success/failure logs to log.md automatically
  │
Session closes
  │
  └─ Stop hook
       ├─ mode=research + pending → synthesis prompt (decision:block)
       ├─ mode=outage-silence → postmortem prompt (decision:block)
       ├─ mode=vault-first + pending → generic capture prompt (decision:block)
       └─ else → {} (no block)
```

## Design principles

- **Activation beats retrieval.** The vault is useless if Claude doesn't reach for it. Hooks + skill descriptions make it automatic.
- **Provenance is non-negotiable.** Every synthesized note names its sources; lint blocks if missing. Prevents the "LLM page with no citations" trap.
- **Atomic writes or nothing.** `apply_patch` is the only sanctioned write path for multi-note changes. Rollback on mid-patch failure.
- **Modes over settings.** Three named modes with conversational triggers beat twenty toggles. `/mode` is explicit; cues are inferred.
- **Relevance-based decay, not time-based.** A mode doesn't un-mode after 3 minutes of silence. It exits on topic shift, explicit change, or session end.
- **Log everything future-Claude needs.** `log.md` is the durable state-of-record across sessions; auto-logging covers ingests, syntheses, errors, mode transitions, and hook crashes.
- **Grow from pain.** Phase 5 (contradiction detection, situation snapshots, calibration) stays unbuilt until observed failures demand it.

## Relationship to semantic-pages

- **Substrate inherited unchanged.** Vector search, graph, 21 core MCP tools all come straight from semantic-pages.
- **Upstream remote tracked but push-disabled.** Substrate fixes cherry-pick in; sidekick-specific work never flows back.
- **Separate package + release cadence.** `@theglitchking/semantic-sidekick` vs `@theglitchking/semantic-pages`.

## What this is NOT

- Not a replacement for semantic-pages — it builds on top.
- Not a team-scale tool — designed for solo developer / single vault / ~500 notes. 10,000+ notes + 15+ contributors is Phase 5+ gated.
- Not an LLM finetune — the "intelligence" is in the skill descriptions, hooks, and rules. Any sufficiently capable model works.
- Not automatic in the literal sense — Claude still drives the tool calls. Hooks inject context; Claude decides what to do with it.
