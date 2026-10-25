---
title: Architecture — the Five Layers
tier: reference
domains: [architecture]
audience: [developers]
tags: [architecture, layers, substrate, activation, routing, learning, v1.7.0]
status: active
last_updated: '2026-10-25'
version: '1.7.0'
purpose: Each of the 5 layers with responsibilities, key files, contracts, gotchas, plus the opt-in v1.7 skill loop layer and the Jev bridge
load_priority: 8
---

# Architecture — the five layers

Each layer has a single responsibility. Lower layers have no knowledge of upper layers. Upper layers compose lower-layer primitives without duplicating logic.

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 5 — Routing                                          │
│  research-mode · outage-silence · vault-first (default)     │
│  /mode · /vault · CLAUDE.md mode indicator rule             │
│  Mode-aware hook behavior + transition capture              │
└─────────────────────────────────────────────────────────────┘
                             ▲
┌─────────────────────────────────────────────────────────────┐
│  Layer 4 — Activation                                       │
│  SessionStart hook (preload + state-delta + mode reset)     │
│  UserPromptSubmit hook (mode-gated search + cue capture)    │
│  Stop hook (transition capture per mode)                    │
│  vault-first skill · CLAUDE.md cite-or-deflect rule         │
└─────────────────────────────────────────────────────────────┘
                             ▲
┌─────────────────────────────────────────────────────────────┐
│  Layer 3 — Workflows                                        │
│  ingest_source (source + units → ChangeSet + log_event)     │
│  synthesize_note (answer + sources → ChangeSet + log_event) │
│  log_event / log_query (structured log.md)                  │
│  Hierarchical index auto-regen                              │
└─────────────────────────────────────────────────────────────┘
                             ▲
┌─────────────────────────────────────────────────────────────┐
│  Layer 2 — Structure                                        │
│  vault.schema.yml (types, required fields, enums, lint)     │
│  Provenance frontmatter (sources, derived_from, …)          │
│  apply_patch (atomic creates/updates/deletes/moves)         │
│  Lint (schema_violations, missing_provenance, stale,        │
│        broken_links)                                        │
└─────────────────────────────────────────────────────────────┘
                             ▲
┌─────────────────────────────────────────────────────────────┐
│  Layer 1 — Substrate (inherited from semantic-pages)        │
│  Markdown files + frontmatter (gray-matter)                 │
│  Indexer (AST parse, wikilinks, tags, headers, chunks)      │
│  Embedder (ONNX MiniLM) + VectorIndex (HNSW)                │
│  GraphBuilder (wikilinks + related_docs)                    │
│  TextSearch (BM25-ish keyword)                              │
│  MCP stdio server — 21 core tools                           │
└─────────────────────────────────────────────────────────────┘
```

## Layer 1 — Substrate

**Purpose:** Store and retrieve markdown. Nothing else.

**Owns:** the vault directory, `.semantic-sidekick-index/`, the MCP stdio server entry point.

**Key files:**
- `src/core/indexer.ts` — parses markdown → `IndexedDocument[]`. Now also ships `saveDocsCache/loadDocsCache` for the Phase 2 latency fix.
- `src/core/embedder.ts` — ONNX model wrapper (all-MiniLM-L6-v2 default).
- `src/core/vector.ts` — HNSW index via `hnswlib-node`.
- `src/core/graph.ts` — backlinks + forwardlinks + path + statistics.
- `src/core/search-text.ts` — full-text BM25-style search.
- `src/core/crud.ts` — single-note create/update/delete/move with auto-stamps (last_updated, word_count, estimated_read_time).
- `src/mcp/server.ts` — assembles everything into an MCP server over stdio. 28 tools total (21 substrate + 7 sidekick).

**Contract:** every other layer talks to the substrate via these modules (direct imports) or via MCP tools. No layer reaches past CRUD into raw `fs` calls.

**Gotcha:** substrate fixes come from upstream `semantic-pages`; never push sidekick features into substrate modules without a cherry-pickable fix.

## Layer 2 — Structure

**Purpose:** Give the vault shape. Every note has a known type, required fields, and provenance. Writes are atomic or rolled back.

**Owns:** `vault.schema.yml`, lint definitions, the `apply_patch` primitive.

**Key files:**
- `src/core/schema.ts` — `loadSchema`, `installDefaultSchema`, `validateNote`, `LintFinding` type.
- `src/core/schema-default.ts` — default 4-type schema (note, decision, gotcha, source) shipped in package.
- `src/core/patch.ts` — `applyPatch(notesPath, ChangeSet, opts)` — pre-check → validate → execute → rollback/regen-indexes.
- `src/core/lint.ts` — `lintVault`, `formatLintReport`, broken-link detection.

**Contract:**
- **No write bypasses apply_patch.** Single-note writes via `NoteCrud` still work for internal ops (create/update/delete/move_note MCP tools) but multi-note or provenance-dependent writes go through `apply_patch`.
- **Lint runs on every patch.** Schema errors (severity=error) block; warnings configurable via `allowLintWarnings`.

**Provenance fields (enforced by default schema):** `sources`, `derived_from`, `last_verified`, `status`, `confidence`.

**Gotcha:** `crud.update` with `mode: "overwrite"` discards frontmatter; use `patch-by-heading` or include frontmatter in the new content block when you want to preserve it.

## Layer 3 — Workflows

**Purpose:** The Karpathy-LLM-wiki loops as first-class primitives: ingest sources → proposed patch; query + sources → filed note; activity → structured log.

**Owns:** `ingest_source`, `synthesize_note`, log.md + log_event/log_query, hierarchical INDEX.md auto-regen.

**Key files:**
- `src/core/ingest.ts` — `buildIngestChangeSet` (source-note + derived units). Routes through apply_patch.
- `src/core/synthesize.ts` — `buildSynthesizeChangeSet` (answer + sources → note with auto-wikilinks). Routes through apply_patch.
- `src/core/log.ts` — `logEvent`, `logQuery` — append-only log.md with YAML-in-comment machine-readable blocks.
- `src/core/index-regen.ts` — `regenDirectoryIndex`, `regenIndexesForPaths` — called by apply_patch after successful writes.

**Contract:**
- **Every successful ingest/synthesis auto-logs.** `kind=ingest` or `kind=synthesis` entry in log.md.
- **Every failure auto-logs as `kind=error`.** Includes the tool name, path, and error strings.
- **Indexes auto-regen on apply_patch** unless `regenIndexes: false`.

**Gotcha:** `synthesize_note` calls `apply_patch` with `validate: true` (default). If the provenance is thin, schema will block — add `sources` or `derived_from` to the call.

## Layer 4 — Activation

**Purpose:** Make the vault *present*. Inject context, drive behavior via skill descriptions, enforce citation.

**Owns:** the hooks (SessionStart / UserPromptSubmit / Stop, plus the opt-in PostToolUseFailure fact lookup since v1.6), the `vault-first` skill, the CLAUDE.md cite-or-deflect rule. Since v1.5.2 the hooks search every `semantic-*` notes folder in `.mcp.json`, not only the first. Since v1.5.3 everything they store is redacted (see [secret-redaction.md](../security/secret-redaction.md)).

**Key files:**
- `hooks/vault-context.js` — dispatches on `hook_event_name` from stdin JSON, calls the `semantic-sidekick search` CLI for search injection, calls `semantic-sidekick log-event`/`log-query` for the structured log.
- `hooks/session-start.js` + `hooks/reconcile.js` — inherited plugin runtime; reconciles .mcp.json + auto-update policy.
- `hooks/hooks.json` — plugin's hook registration manifest.
- `skills/vault-first/SKILL.md` — default mode skill. Cite-or-deflect contract.
- `.claude/CLAUDE.md` — project-level rule block reinforcing vault-first behavior.

**Injection points:** see [injection-points.md](./injection-points.md).

**Contract:**
- **Every session boots with vault context.** SessionStart preload fires unconditionally (fails open if vault missing).
- **Every prompt (in applicable modes) gets a search injection** unless fingerprinted-duplicate.
- **Every session close emits a transition-capture prompt when warranted.**

**Gotcha:** the hooks fail open — any error becomes an empty-context emit. If you see "no injection" behavior, check `SIDEKICK_DEBUG=1` output before assuming it's broken.

## Layer 5 — Routing

**Purpose:** Match behavior to situation. Research sessions want aggressive vault; incidents want silence; normal work wants vault-first nudges.

**Owns:** `research-mode` + `outage-silence` mode skills, `/mode` + `/vault` slash commands, the mode file (`.claude/.sidekick-mode`), mode-aware hook branches.

**Key files:**
- `skills/research-mode/SKILL.md` — aggressive-vault skill. Every source filed, synthesis forced on exit.
- `skills/outage-silence/SKILL.md` — terse mode. Suppress auto-vault, force postmortem on exit.
- `commands/mode.md` — /mode slash command template.
- `commands/vault.md` — /vault escape hatch.
- `hooks/vault-context.js` — branches on mode for UserPromptSubmit (outage suppresses) and Stop (mode-specific transition capture).

**Contract:**
- **Explicit `/mode` is ground truth.** Conversational cues suggest; `/mode` decides.
- **SessionStart resets to vault-first.** Time-based decay only at session boundary.
- **`/vault` always works, regardless of mode.** Escape hatch for outage-silence.
- **Mode transitions force capture.** Exiting research → synthesis; exiting outage → postmortem.

**Gotcha:** signal weighting lives in skill description prose, not code. If a mode mis-fires, the fix is in the skill file, not the hook.

## Layer 6 — Learning (v1.7, opt-in)

**Purpose:** Learn *procedures* between sessions, as skills, with a person approving every change. Off by default; off is 1.6.1 behaviour. It sits beside Layer 4 (it uses the same hooks) and writes to `.claude/skills/`, which Claude Code loads on its own.

```
 evidence ──► queue ──► fenced reviewer ──► drafts ──► review / landing ──► curator
 (hooks)     (SessionEnd)  (claude -p,        (skill-drafts/)  (skill-loop review,   (weekly: stale,
                           Read/Grep/Glob)                      --eval gate)         archive, merge)
                                                                     │
                                                              ledger (exact bytes) ──► rollback
```

| Stage | What | Key files |
|---|---|---|
| Evidence | Redacted logs of failed commands, corrections and learned-skill uses | `hooks/vault-context.js`, `hooks/skill-loop.js`, `src/core/skill-evidence.ts` |
| Queue | SessionEnd writes a job if the session has signal and starts a detached worker (SessionEnd's 1.5 s limit means it only writes and spawns). One worker per repo; at most 10 reviews a day | `src/core/skill-queue.ts`, `skill-worker.ts` |
| Fenced reviewer | One `claude -p` per job: Read/Grep/Glob only, no Bash, MCP, hooks or subagents, nothing outside the repo; at most 5 `claude` processes machine-wide; `SEMANTIC_MEMORY_REVIEWER=1` makes every semantic-memory hook exit. It answers JSON; semantic-memory redacts, lints and writes the draft | `src/core/claude-run.ts`, `skill-review.ts`, `skill-review-prompt.ts`, `skill-schema.ts` |
| Scope | Directory or project by rule; global only by promotion (the same lesson in two repos) and approval; private repos stay project and are never indexed | `src/core/skill-scope.ts` |
| Review and landing | `skill-loop review`: approve, reject or `--eval` (trigger eval, optional task replay). The eval gate must adopt a draft, or `--override <why>` | `src/core/skill-land.ts`, `skill-eval/`, `skill-gate.ts` |
| Ledger | Every change with its exact before/after bytes; `rollback <id>` undoes one | `src/core/skill-ledger.ts` |
| Curator | Unused 14 days: stale. Unused 30 days: archived (never deleted; `restore`). Pinned and hand-written skills untouched. Merging is opt-in | `src/core/skill-curator.ts`, `skill-merge.ts` |

**Contract:**
- **Nothing lands unapproved.** The reviewer never writes a skill; semantic-memory writes drafts, a person lands them.
- **Nothing blocks a session.** Hooks only write small files and spawn detached processes; errors are swallowed.
- **Off means off.** No writes, no spawns, no hook output.

**Gotcha:** the reviewer is a nested `claude` run. If a hook ever acted inside it, it would record evidence of its own review. That is what the recursion guard prevents.

Docs: [skill-loop.md](../operational/skill-loop.md), [skill-format.md](../reference/skill-format.md).

### The Jev bridge (v1.7, opt-in)

Jev mode lets semantic-memory ask Jev (TypeSafe's typed-decision model) closed-set yes/no questions. Every call goes through `hooks/jev-bridge.py`, which loads jev-loop's `router.ask` (redaction, cache, ledger, budget). `src/core/jev.ts` spawns it with a hard timeout; any failure is `{scores: {}, error}`, and a missing score is treated as "no", never as permission. Acting on a yes needs >= 0.95.

| Caller | Mode | Used for |
|---|---|---|
| `semantic-memory-hook` | batch in jev-loop until it lists it as live; own daily ceiling `SEMANTIC_MEMORY_JEV_DAILY_TOKENS` | The failure hook's fit gate (Layer 4) |
| `semantic-memory-judge` | batch | `eval-failures` judging (`scripts/eval-failures/judge-jev.mjs`) |
| `semantic-memory-skill-loop` | batch | The skill loop's scope question and duplicate checks before a merge |

Requires jev-loop (`JEV_LOOP_DIR`), `TYPESAFE_API_KEY` and `python3`; `jev-mode status` says what is missing. Never used on text that has not passed jev-loop's redaction. See [jev-mode.md](../operational/jev-mode.md).

## Cross-layer concerns

### Logging (Phase 4.5)

All layers write to `log.md` when they do something durable or fail visibly:

| Source | Kinds written | When |
|---|---|---|
| Layer 3 `ingest_source` | `ingest`, `error` | On apply_patch resolution |
| Layer 3 `synthesize_note` | `synthesis`, `error` | On apply_patch resolution |
| Layer 2 `apply_patch` (direct MCP) | `error` | On ok=false |
| Layer 4 `SessionStart` hook | `mode_change` | If prior mode was non-default (drift from a previous session that didn't `/mode vault-first` before closing) |
| Layer 4 hook crashes | `error` | Uncaught exception in vault-context.js |
| Layer 6 skill loop | none in `log.md` | Its record is `.claude/.semantic-memory/skill-ledger.jsonl` and `skill-loop.log` |

See [logs-and-events.md](../operational/logs-and-events.md) for the full format + query patterns.

### The CLI (shared surface across layers)

`semantic-sidekick <subcommand>` is the shared invocation point. The MCP server is one subcommand (`serve`, default); hooks shell out to other subcommands (`search`, `log-event`, `log-query`, `lint`). This keeps the hook code free of core imports — any install of the CLI works as the hook backend.
