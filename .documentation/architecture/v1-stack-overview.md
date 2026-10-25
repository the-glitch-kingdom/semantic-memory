---
title: v1 stack overview — what v1.0 / v1.1 / v1.2 added
tier: reference
domains: [architecture]
audience: [developers, admin]
tags: [architecture, v1, rebrand, brain-absorption, sessions, contract, drift]
status: active
last_updated: '2026-10-24'
version: '1.6.1'
purpose: Single doc covering everything v1.0 / v1.1 / v1.2 added on top of the v0.x five-layer substrate. Read this BEFORE the per-version changelog entries; it's the architectural narrative, they're the bullet lists.
load_priority: 9
---

# v1 stack overview

The v0.x five-layer substrate (substrate / structure / workflows / activation / routing — see [architecture-layers.md](./architecture-layers.md)) is unchanged in v1.x. What v1.0+ added is **on top**: a verifiable contract artifact, a hard-gated session loop, a multi-agent skill bundler, drift detection, and storage hygiene.

This doc is the architectural narrative. The bullet-list-style "what changed" lives in the changelog domain.

## v1.0 — Rebrand (the unfinished one)

v1.0.0 rebranded the public-facing surface from `semantic-sidekick` to `semantic-memory`:

- npm package: `@theglitchking/semantic-sidekick` → `@theglitchking/semantic-memory`
- Marketplace name + description
- MCP server name (announced in initialize handshake)
- New primary CLI binary: `bin/semantic-memory` (legacy `bin/semantic-sidekick` preserved as alias)

The framing shifted from "vault-helper sidekick" to "unified memory layer." The README at v1.0 announced multi-corpus architecture (vault, code, plans, docs, research, project-map) — though only the **vault** corpus was actually wired through the MCP tool surface. The other 5 stayed as conceptual placeholders for v1.4+ work.

**What v1.0 left half-finished:** the rebrand only changed the public-facing names. Internal package-name lookups in `scripts/link-skills.js`, `hooks/reconcile.js`, `src/cli/index.ts`, and all 7 slash commands stayed hardcoded to `@theglitchking/semantic-sidekick`. This was the bug v1.1.1 hotfixed.

**Storage layout PRESERVED at v1.0** (and through all of v1.x via the v1.0 storage promise):
- `<vault>/.semantic-sidekick-index/` — vector index dir, kept for backwards-compat
- `~/.semantic-sidekick/models/` — embedding model cache, kept for backwards-compat

These intentionally retain the legacy name. Renaming would invalidate every existing user's index and force a model re-download. v2.0 will do the move with a transparent atomic migration.

## v1.1 — brain-absorption

v1.1.0 absorbed four targeted strengths from `JimmyMcBride/brain` while keeping semantic-memory's existing multi-corpus + MCP + drift framing.

### What v1.1 added

| Feature | What it does | Where it lives |
|---|---|---|
| **AGENTS.md contract artifact** | Versionable, regenerable agent contract at the project root with managed-block markers and a preserved Local Notes tail | `src/core/agents-contract.ts`, MCP tools `regenerate_contract` + `inspect_contract`, `/contract` slash command |
| **Hard-gated verification sessions** | `session_start` / `session_run` / `session_finish` / `session_status` — verification-gated work units. `session_finish` refuses without recorded verifications unless `verified: false` + `reason` waiver | `src/core/session.ts`, MCP tools, Stop hook session-aware branch in `hooks/vault-context.js` |
| **Distill ↔ synthesize_note unification** | `synthesize_note` proposal mode (writes to `proposals/<date>-<slug>.md` with `status: proposal`); new `synthesize_promote` atomically promotes a reviewed proposal | `src/core/synthesize.ts` (extended), MCP tool `synthesize_promote` |
| **Multi-agent skill bundler** | `bin/semantic-memory skills install/uninstall/targets/list` for codex / copilot / pi (Claude unchanged). Manifest-based stale detection. | `src/cli/skills.ts`, `bin/semantic-memory skills` CLI |
| **SessionStart drift detection** | Inline JS fast-tier checks for `.mcp.json` server entry, hook registration, AGENTS.md managed blocks, session staleness. Silent on healthy installs; surfaces a `<vault-drift>` block when drift is detected. | `hooks/vault-context.js` (inline), `src/core/healthcheck.ts` (manual `/healthcheck` deep audit) |

### Plus an organizational refactor

v1.1 split `src/mcp/server.ts` (1039 lines, 33 tools in one file) into per-domain modules under `src/mcp/tools/*.ts` with a shared `src/mcp/context.ts`. server.ts shrank to 96 lines. The tool surface stayed bit-for-bit identical (regression snapshot suite gated the change).

### Tool consolidation via deprecation shims (also v1.1)

Six redundant tools became deprecation shims, removed in v2.0:

- `find_schema_violations` → `lint_vault({checks: ["schema"]})`
- `find_missing_provenance` → `lint_vault({checks: ["provenance"]})`
- `find_stale` → `lint_vault({checks: ["stale"]})`
- `find_broken_links` → `lint_vault({checks: ["broken_links"]})`
- `read_multiple_notes` → `read_note` in a loop
- `rename_tag` → `manage_tags({action: "rename", from, to})`

All six remain callable in v1.x with `[DEPRECATED]` prefix in their tool descriptions.

### Tool surface delta

```
v1.0.x: 33 tools
+regenerate_contract +inspect_contract  (Phase 3)
+synthesize_promote                     (Phase 4)
+session_start +session_run
+session_finish +session_status         (Phase 5)
v1.1.0: 40 tools (write mode), 21 (read-only mode)
+verify_note                            (v1.3)
v1.3.0: 41 tools (write mode), 21 (read-only mode)
```

## v1.1.1 — Hotfix: complete the rebrand wiring

v1.1.0 published with the rebrand half-finished. The npm package, marketplace entry, and tool surface had moved to `@theglitchking/semantic-memory`, but install-time + slash-command wiring was still hardcoded to the legacy package path. Fresh `npm install @theglitchking/semantic-memory@1.1.0` failed to register hooks correctly, and the 7 slash commands invoked the OLD `@theglitchking/semantic-sidekick` package (still on npm at 0.2.x) — running ancient pre-rebrand code.

v1.1.1 fixed:
- `scripts/link-skills.js` — postinstall passes the new `packageName`/`pluginName`/`hookCommand`
- `hooks/reconcile.js` — new path preferred; legacy fallback for mid-migration installs
- `hooks/session-start.js` — runtime delegate uses new name
- `hooks/vault-context.js` — `findVaultPath` matches `semantic-memory` `.mcp.json` entries; `findCliBin` prefers new path (v1.5.2 replaced `findVaultPath` with `findNotesSources`, which returns every `semantic-*` entry; the hooks search them all)
- All 7 slash commands updated
- `src/cli/index.ts` — `PKG_NAME`, `findLocalBin`, `runRelink`, `isLocalForm`, `isNpxForm` updated; `LEGACY_PKG_NAME` kept for fallback

## v1.2 — State consolidation

v1.2.0 consolidates every transient state file under one namespace. Three legacy `.claude/.sidekick-*` files move to `.claude/.semantic-memory/`:

| Old path | New path |
|---|---|
| `.claude/.sidekick-mode` | `.claude/.semantic-memory/mode` |
| `.claude/.sidekick-fingerprints.json` | `.claude/.semantic-memory/fingerprints.json` |
| `.claude/.sidekick-capture-pending.json` | `.claude/.semantic-memory/capture-pending.json` |

Reads check the new path first; if absent, fall back to old. Writes always go to new. v2.0 removes the fallback.

`session.json` and `healthcheck-cache.json` were already correctly placed since v1.1.

### What v1.2 added

| Surface | Source |
|---|---|
| **`bin/semantic-memory migrate-state`** — idempotent, opt-in CLI command for the explicit move. `--dry-run` previews; `--force` resolves conflicts. | `src/cli/migrate-state.ts` |
| **`legacy_state_files` healthcheck finding** — detects legacy paths and points at `migrate-state` | `src/core/healthcheck.ts` |
| **`statePath()` helper in vault-context.js** — resolves both new and old paths; reads fall back, writes always go to new | `hooks/vault-context.js` |

## What's NOT in v1.x

These are deferred:

- **Multi-corpus completion** — v1.0 announced 6 corpora (vault, code, plans, docs, research, project-map). Only the vault corpus is wired. Future work, multi-quarter scope.

Shipped since this overview was first written (no longer deferred):

- **Confidence decay** — SHIPPED in v1.3.0: age-aware search re-ranking by `last_verified` with type-aware half-life, `verify_note`, `evergreen`. See the [v1.3 changelog](../changelog/v1-3-confidence-decay.md).
- **`/healthcheck --fix`** and **code-symbol drift lint** (`code_symbols`) — SHIPPED in v1.2.3. See the [v1.2.3 changelog](../changelog/v1-2-3-hygiene-completion.md).

## Composition — how the layers cooperate at v1.2

```
┌────────────────────────────────────────────────────────────────────────┐
│  Project root (.claude/CLAUDE.md → AGENTS.md as primary contract)      │
│  AGENTS.md — managed-block contract (regenerable from MCP tool list)   │
└────────────────────────────────────────────────────────────────────────┘
   │
   ▼
┌────────────────────────────────────────────────────────────────────────┐
│  hooks/                                                                │
│   • SessionStart: reconcile.js + vault-context.js                      │
│       → fast-tier drift check (silent on healthy)                      │
│       → vault-context block (mode-aware)                               │
│       → state-delta block (last 14d log events)                        │
│   • UserPromptSubmit: vault-context.js                                 │
│       → fingerprint-suppressed text search                             │
│   • Stop: vault-context.js                                             │
│       → session-aware branch (if session.json open)                    │
│       → mode-specific transition prompts (research/outage)             │
│       → vault-first capture-pending prompt                             │
└────────────────────────────────────────────────────────────────────────┘
   │
   ▼
┌────────────────────────────────────────────────────────────────────────┐
│  MCP server (src/mcp/server.ts → context.ts → tools/*.ts)              │
│   • 41 tools across 11 modules                                         │
│   • Per-domain registration: search/read/write/patch/lint/log/         │
│     metadata/graph/system/contract/session                             │
│   • Conditional registration: write-mode tools gated on !readOnly      │
└────────────────────────────────────────────────────────────────────────┘
   │
   ▼
┌────────────────────────────────────────────────────────────────────────┐
│  Vault (.claude/.vault/)                                               │
│   • Markdown notes (canonical source of truth)                         │
│   • vault.schema.yml (frontmatter validation rules)                    │
│   • log.md (append-only event log)                                     │
│   • proposals/ (review-first synthesize_note targets, v1.1+)           │
└────────────────────────────────────────────────────────────────────────┘
   │  (derived state — rebuildable from above)
   ▼
┌────────────────────────────────────────────────────────────────────────┐
│  <vault>/.semantic-sidekick-index/ (kept at this name for v1.x compat) │
│   • meta.json, hnsw.bin, hnsw-meta.json (vector index)                 │
│   • embeddings.json (~MB to MBs)                                       │
│   • graph.json (knowledge graph)                                       │
│   • docs.cache.json (parsed-frontmatter cache)                         │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│  Per-machine (~/) — global cache, shared across all projects           │
│   ~/.semantic-sidekick/models/  (HuggingFace ONNX model cache, ~90MB)  │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│  Per-project runtime state (gitignored)                                │
│   <project>/.claude/.semantic-memory/                                  │
│     mode (v1.2)                                                        │
│     fingerprints.json (v1.2)                                           │
│     capture-pending.json (v1.2)                                        │
│     session.json (v1.1+)                                               │
│     healthcheck-cache.json (v1.1+)                                     │
│   <project>/.claude/.sidekick-* (legacy, readable through v1.x)        │
└────────────────────────────────────────────────────────────────────────┘
```

## Where to read next

- [architecture-layers.md](./architecture-layers.md) — the v0.x five-layer substrate (still the foundation)
- [injection-points.md](./injection-points.md) — exactly where Claude sees vault data
- [mcp-internals.md](./mcp-internals.md) — how tools/*.ts modules cooperate
- [sessions-guide.md](../operational/sessions-guide.md) — operational guide to the v1.1 session loop
- [contract-guide.md](../operational/contract-guide.md) — operational guide to AGENTS.md
- [drift-detection.md](../operational/drift-detection.md) — operational guide to drift checks + `/healthcheck`
- [state-migration.md](../operational/state-migration.md) — v1.2 state file migration
- [indices-and-storage.md](./indices-and-storage.md) — every file the plugin writes to disk
